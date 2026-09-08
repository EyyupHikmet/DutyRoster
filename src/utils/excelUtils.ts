import * as XLSX from "xlsx";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile as writeFsFile } from "@tauri-apps/plugin-fs";
import { DbTeacher } from "../db";
import { MONTHS_TR, getDaysInMonth, formatDateYYYYMMDD } from "./dateUtils";

// Real destination picker + versioned filename + real bytes on disk,
// replacing the old silent XLSX.writeFile() browser-style download.

/**
 * In-session, per-(year, month) export counter used to suggest a distinguishing
 * "_vN" filename each time the same month is exported again. This is
 * deliberately a module-level in-memory Map, not persisted anywhere:
 *
 * LIMITATION (deliberate, not an oversight):
 * a perfect "does this file already exist" scheme is impossible here — the
 * target directory isn't known until *after* the user picks it in the Save-As
 * dialog, and this counter has no visibility into the filesystem at all. It
 * only tracks "how many times has THIS running app session successfully
 * exported THIS (year, month)", so:
 *   - It resets to v1 on every app restart (or full page reload), even if
 *     v1..v5 already exist on disk from a previous session.
 *   - It has no idea what the user actually named the file last time (they can
 *     freely rename/overwrite in the dialog) or whether v1 already exists in
 *     the folder they're about to pick.
 *   - It only advances on a *successful* save (see recordExportVersion below),
 *     so repeatedly opening and cancelling the dialog does not burn version
 *     numbers.
 * This is a reasonable default, not a collision-proof guarantee — exactly the
 * tradeoff the task's Dispatch Notes call for ("pick a reasonable one... and
 * say so explicitly"). The suggested name is always just a starting point the
 * user can freely edit or overwrite in the native dialog, like any Save-As.
 */
const exportVersionCounters = new Map<string, number>();

const versionKey = (year: number, month: number) => `${year}-${month}`;

/** Returns the version number to *suggest* for the next export of this month (peek, no mutation). */
export const getNextExportVersion = (year: number, month: number): number => {
  return (exportVersionCounters.get(versionKey(year, month)) ?? 0) + 1;
};

/** Records that `version` was actually used for a successful save of this month. */
export const recordExportVersion = (year: number, month: number, version: number): void => {
  exportVersionCounters.set(versionKey(year, month), version);
};

/** Resets all in-session export version counters. Exposed for test isolation. */
export const resetExportVersionCounters = (): void => {
  exportVersionCounters.clear();
};

/**
 * Builds the default suggested filename for a month's export: the existing
 * `${year}_${monthName}_Nobet_Raporu` scheme, plus a `_v${version}` suffix so
 * repeated exports for the same month are distinguishable by default in the
 * Save-As dialog.
 */
export const buildExportFilename = (year: number, month: number, version: number): string => {
  const monthName = MONTHS_TR[month - 1];
  return `${year}_${monthName}_Nobet_Raporu_v${version}.xlsx`;
};

export type ExportScheduleResult =
  | { status: "saved"; path: string; filename: string }
  | { status: "canceled" }
  | { status: "error"; message: string };

/** Injectable seams for testing without a real Tauri IPC bridge (mirrors the
 * xlsxReader DI pattern already used by parseExcelRoster above). */
export interface ExportScheduleDeps {
  saveDialog?: (options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;
  writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  xlsxWriter?: { write: (wb: XLSX.WorkBook, opts: XLSX.WritingOptions) => any };
}

/** Defaults applied to a teacher imported from a bare name list. Same values
 * the "add teacher" form starts with, so a single-column import lands the user
 * in exactly the state they would be in had they typed the names by hand. */
const DEFAULT_TARGET_HOURS = 1;
const DEFAULT_PRIORITY = 1;

/** Case/diacritic-insensitive fold for header matching. Turkish needs the
 * explicit i/ı/İ mapping: NFD does not decompose the dotless i, and
 * "İSİM".toLowerCase() produces a combining dot rather than a plain "i". */
const foldHeader = (value: unknown): string =>
  String(value)
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Words that, alone in the first cell of a single-column sheet, mean "this row
 * is a header, not a teacher". */
const SINGLE_COLUMN_HEADERS = new Set([
  "ad", "adi", "ad soyad", "adsoyad", "isim", "isimler", "ogretmen",
  "ogretmenler", "ogretmen adi", "ogretmen listesi", "kadro", "liste",
  "name", "names", "full name", "teacher", "teachers", "list",
]);

/**
 * Fallback for the shape a lot of people actually have: one column, nothing but
 * teacher names, with or without a header.
 *
 * The keyed parse above cannot read these. `sheet_to_json` treats row 1 as the
 * header row, so a bare name list silently turns the FIRST teacher into a
 * column key and then finds none of the expected columns in the rest — the
 * import yields zero teachers and loses a name in the process.
 *
 * This reads the raw grid instead and requires exactly one populated column, so
 * it cannot misread a real multi-column sheet whose headers simply were not
 * recognised: that case still imports nothing, as before, rather than importing
 * a column of the wrong thing.
 */
const parseSingleColumnRoster = (rawRows: unknown[][]): DbTeacher[] => {
  const populatedColumns = new Set<number>();
  for (const row of rawRows) {
    if (!Array.isArray(row)) continue;
    row.forEach((cell, index) => {
      if (cell !== undefined && cell !== null && String(cell).trim() !== "") {
        populatedColumns.add(index);
      }
    });
  }
  if (populatedColumns.size !== 1) return [];

  const column = [...populatedColumns][0];
  const names: string[] = [];
  for (const row of rawRows) {
    if (!Array.isArray(row)) continue;
    const cell = row[column];
    if (cell === undefined || cell === null) continue;
    const name = String(cell).trim();
    if (name) names.push(name);
  }

  if (names.length > 0 && SINGLE_COLUMN_HEADERS.has(foldHeader(names[0]))) {
    names.shift();
  }

  return names.map((name) => ({
    id: crypto.randomUUID(),
    name,
    target_hours: DEFAULT_TARGET_HOURS,
    priority: DEFAULT_PRIORITY,
  }));
};

/**
 * Parses an imported Excel file data binary string into a list of DbTeachers.
 * Accepts an optional xlsxReader parameter for test dependency injection.
 */
export const parseExcelRoster = (
  binaryData: string,
  xlsxReader: { read: (data: any, options: any) => any; utils: { sheet_to_json: (sheet: any, options?: any) => any[] } } = XLSX
): DbTeacher[] => {
  const workbook = xlsxReader.read(binaryData, { type: "binary" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsxReader.utils.sheet_to_json(sheet);

  const importedTeachers: DbTeacher[] = [];
  
  for (const row of rows) {
    // Robust column parsing supporting exact Turkish headers or common synonyms
    const name = row["Ad"] || row["Adı"] || row["Öğretmen Adı"] || row["Name"] || row["Teacher"];
    const target = row["Hedef Saat"] || row["Hedef"] || row["Saat"] || row["Target Hours"] || row["Hours"] || DEFAULT_TARGET_HOURS;
    const priorityStr = row["Öncelik"] || row["Kıdem"] || row["Priority"] || 1;

    if (name) {
      let priority = 1; // Default Düşük/Orta/Yüksek weight
      if (String(priorityStr).toLowerCase().includes("yüksek") || String(priorityStr) === "3" || String(priorityStr).toLowerCase().includes("high")) {
        priority = 3;
      } else if (String(priorityStr).toLowerCase().includes("orta") || String(priorityStr) === "2" || String(priorityStr).toLowerCase().includes("medium")) {
        priority = 2;
      }

      importedTeachers.push({
        id: crypto.randomUUID(),
        name: String(name).trim(),
        target_hours: Number(target),
        priority: priority
      });
    }
  }

  // Nothing matched the expected columns. Before giving up, try the bare
  // "one column of names" sheet, which the keyed read above structurally
  // cannot see (row 1 is consumed as the header).
  if (importedTeachers.length === 0) {
    const rawRows = xlsxReader.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    return parseSingleColumnRoster(rawRows ?? []);
  }

  return importedTeachers;
};

/**
 * Exports the monthly duty schedule to a multi-sheet Excel (.xlsx) file.
 *
 * This now opens a native Save-As dialog so the user chooses the
 * destination (instead of the old silent XLSX.writeFile() browser-download,
 * which always landed silently in the OS Downloads folder inside the Tauri
 * webview), and writes the real .xlsx bytes to that chosen path via
 * @tauri-apps/plugin-fs. The workbook content/sheets themselves are
 * byte-for-byte unchanged from before this task.
 */
export const exportScheduleToExcel = async (
  year: number,
  month: number,
  generatedSchedule: Record<string, string[]>,
  teachers: DbTeacher[],
  holidays: string[],
  weekendDutyDays: string[],
  extraDays: string[],
  deps: ExportScheduleDeps = {}
): Promise<ExportScheduleResult> => {
  const doSaveDialog = deps.saveDialog ?? saveDialog;
  const doWriteFile = deps.writeFile ?? writeFsFile;
  const xlsxWriter = deps.xlsxWriter ?? XLSX;

  const daysInMonth = getDaysInMonth(year, month);
  
  // Sheet 1: Nöbet Listesi (Day-by-Day schedule)
  const exportRows1: any[][] = [];
  exportRows1.push(["Tarih", "Gün", "Nöbetçi Öğretmen(ler)", "Nöbet Tipi", "Durum"]);

  for (const d of daysInMonth) {
    const dateStr = formatDateYYYYMMDD(d);
    const dayName = d.toLocaleDateString("tr-TR", { weekday: "long" });
    const dateFriendly = d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    let status = "Nöbet Günü";
    if (isWeekend && !weekendDutyDays.includes(dateStr)) {
      status = "Hafta Sonu (Tatil)";
    } else if (!isWeekend && holidays.includes(dateStr)) {
      status = "Resmi Tatil / Okul Kapalı";
    }

    const assignedIds = generatedSchedule[dateStr] || [];
    const assignedNames = assignedIds
      .map((id) => teachers.find((t) => t.id === id)?.name || "Bilinmeyen Öğretmen")
      .join(", ");

    const isExtra = extraDays.includes(dateStr);
    const dutyType = assignedIds.length > 0 ? (isExtra ? "Ekstra Nöbet" : "Standart Nöbet") : "-";

    exportRows1.push([
      dateFriendly,
      dayName,
      assignedNames || (status !== "Nöbet Günü" ? "-" : "Atanamadı"),
      dutyType,
      status
    ]);
  }

  // Sheet 2: Öğretmen Raporu (Detailed Summary & Analytics)
  const exportRows2: any[][] = [];
  exportRows2.push([
    "Öğretmen Adı Soyadı", 
    "Hedef Görev Sayısı", 
    "Toplam Atanan Nöbet", 
    "Hafta İçi (Standart)", 
    "Hafta Sonu", 
    "Toplam Ekstra Nöbet", 
    "Fark (Hedef - Atanan)"
  ]);

  // Calculate statistics for each teacher
  for (const t of teachers) {
    let totalAssigned = 0;
    let weekdayDuties = 0;
    let weekendDuties = 0;
    let extraDutiesCount = 0;

    for (const d of daysInMonth) {
      const dateStr = formatDateYYYYMMDD(d);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const assignedIds = generatedSchedule[dateStr] || [];

      if (assignedIds.includes(t.id)) {
        totalAssigned++;
        const isExtra = extraDays.includes(dateStr);

        if (isExtra) {
          extraDutiesCount++;
        }

        if (isWeekend) {
          weekendDuties++;
        } else {
          if (!isExtra) {
            weekdayDuties++;
          }
        }
      }
    }

    const difference = t.target_hours - totalAssigned;

    exportRows2.push([
      t.name,
      t.target_hours,
      totalAssigned,
      weekdayDuties,
      weekendDuties,
      extraDutiesCount,
      difference
    ]);
  }

  // Build Multi-sheet Excel Sheet using xlsx
  const workbook = XLSX.utils.book_new();

  // Tab 1: Nöbet Listesi
  const worksheet1 = XLSX.utils.aoa_to_sheet(exportRows1);
  XLSX.utils.book_append_sheet(workbook, worksheet1, "Nöbet Listesi");
  
  // Tab 2: Öğretmen Raporu
  const worksheet2 = XLSX.utils.aoa_to_sheet(exportRows2);
  XLSX.utils.book_append_sheet(workbook, worksheet2, "Öğretmen Analiz Raporu");

  // Auto-size columns slightly for sheet 1
  const maxColWidth1 = exportRows1[0].map((_, colIdx) => 
    Math.max(...exportRows1.map(row => String(row[colIdx] || '').length))
  );
  worksheet1["!cols"] = maxColWidth1.map(w => ({ wch: Math.min(Math.max(w + 3, 10), 35) }));

  // Auto-size columns slightly for sheet 2
  const maxColWidth2 = exportRows2[0].map((_, colIdx) =>
    Math.max(...exportRows2.map(row => String(row[colIdx] || '').length))
  );
  worksheet2["!cols"] = maxColWidth2.map(w => ({ wch: Math.min(Math.max(w + 3, 10), 35) }));

  // Ask the user where to save it (native Save-As dialog) instead of the old
  // silent XLSX.writeFile() browser-download. The suggested name carries the
  // in-session version indicator documented above; the user is free to rename
  // or overwrite it in the dialog exactly like any normal OS Save-As.
  const version = getNextExportVersion(year, month);
  const suggestedFilename = buildExportFilename(year, month, version);

  let targetPath: string | null;
  try {
    targetPath = await doSaveDialog({
      title: "Nöbet Raporunu Kaydet",
      defaultPath: suggestedFilename,
      filters: [{ name: "Excel Dosyası", extensions: ["xlsx"] }]
    });
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err)
    };
  }

  // User dismissed the dialog without choosing a destination (AC5): no error,
  // no write, no false "saved" confirmation — just report the cancellation so
  // the caller can leave everything exactly as it was.
  if (!targetPath) {
    return { status: "canceled" };
  }

  let bytes: Uint8Array;
  try {
    const written = xlsxWriter.write(workbook, { type: "array", bookType: "xlsx" });
    bytes = written instanceof Uint8Array ? written : new Uint8Array(written);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err)
    };
  }

  try {
    await doWriteFile(targetPath, bytes);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err)
    };
  }

  // Only advance the in-session counter on genuine success (see the
  // documented limitation above the counter's declaration).
  recordExportVersion(year, month, version);

  const filename = targetPath.split(/[\\/]/).pop() ?? suggestedFilename;
  return { status: "saved", path: targetPath, filename };
};
