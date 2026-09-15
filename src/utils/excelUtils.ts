import * as XLSX from "xlsx";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile as writeFsFile } from "@tauri-apps/plugin-fs";
import { DbTeacher } from "../db";
import { MONTHS_TR, getDaysInMonth, formatDateYYYYMMDD } from "./dateUtils";
import { foldForSearch, foldName } from "./turkishText";
import { freezeScheduleReport, ReportTeacher, ScheduleReport } from "./scheduleReport";
import { schoolYearStart } from "./approvedSchedules";

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
 * `${year}_${monthName}_Nöbet_Raporu` scheme, plus a `_v${version}` suffix so
 * repeated exports for the same month are distinguishable by default in the
 * Save-As dialog.
 */
export const buildExportFilename = (year: number, month: number, version: number): string => {
  const monthName = MONTHS_TR[month - 1];
  return `${year}_${monthName}_Nöbet_Raporu_v${version}.xlsx`;
};

/** A teacher read from an import sheet, before joining a duty post's staff. */
export type ImportedTeacher = Omit<DbTeacher, "post_id">;

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

/** Header matching is as forgiving as search (AGENTS.md, "Turkish text"). */
const foldHeader = foldForSearch;

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
const parseSingleColumnRoster = (rawRows: unknown[][]): ImportedTeacher[] => {
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
): ImportedTeacher[] => {
  const workbook = xlsxReader.read(binaryData, { type: "binary" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsxReader.utils.sheet_to_json(sheet);

  const importedTeachers: ImportedTeacher[] = [];
  
  for (const row of rows) {
    // Headers are compared folded, so "ÖĞRETMEN ADI", "Öğretmen Adı" and " Adı "
    // all find their column. An exact key lookup misses capitalised Turkish
    // headers entirely ("Adı" !== "ADI").
    const cells = new Map(Object.entries(row).map(([header, value]) => [foldHeader(header), value]));
    const pick = (...headers: string[]): any => {
      for (const header of headers) {
        const value = cells.get(foldHeader(header));
        if (value) return value;
      }
      return undefined;
    };

    // Robust column parsing supporting Turkish headers or common synonyms
    const name = pick("Ad", "Adı", "Öğretmen Adı", "Name", "Teacher");
    const target = pick("Hedef Saat", "Hedef", "Saat", "Target Hours", "Hours") || DEFAULT_TARGET_HOURS;
    const priorityStr = pick("Öncelik", "Kıdem", "Priority") || 1;

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

/** Rows of one schedule's day-by-day list sheet. */
const listRows = (report: ScheduleReport): unknown[][] => {
  const rows: unknown[][] = [["Tarih", "Gün", "Nöbetçi Öğretmen(ler)", "Nöbet Tipi", "Durum"]];
  const nameOf = (id: string) => report.teachers.find((t) => t.id === id)?.name || "Bilinmeyen Öğretmen";

  for (const d of getDaysInMonth(report.year, report.month)) {
    const dateStr = formatDateYYYYMMDD(d);
    const dayName = d.toLocaleDateString("tr-TR", { weekday: "long" });
    const dateFriendly = d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    let status = "Nöbet Günü";
    if (isWeekend && !report.weekendDutyDays.includes(dateStr)) {
      status = "Hafta Sonu (Tatil)";
    } else if (!isWeekend && report.holidays.includes(dateStr)) {
      status = "Resmi Tatil / Okul Kapalı";
    }

    const assignedIds = report.assignments[dateStr] || [];
    const assignedNames = assignedIds.map(nameOf).join(", ");
    const isExtra = report.extraDays.includes(dateStr);
    const dutyType = assignedIds.length > 0 ? (isExtra ? "Ekstra Nöbet" : "Standart Nöbet") : "-";

    rows.push([
      dateFriendly,
      dayName,
      assignedNames || (status !== "Nöbet Günü" ? "-" : "Atanamadı"),
      dutyType,
      status
    ]);
  }
  return rows;
};

const REPORT_HEADER = [
  "Öğretmen Adı Soyadı",
  "Hedef Görev Sayısı",
  "Toplam Atanan Nöbet",
  "Hafta İçi (Standart)",
  "Hafta Sonu",
  "Toplam Ekstra Nöbet",
  "Fark (Hedef - Atanan)"
];

interface DutyTotals {
  name: string;
  post: string;
  target: number;
  total: number;
  weekday: number;
  weekend: number;
  extra: number;
}

/** One teacher's duty totals within one schedule. */
const totalsFor = (report: ScheduleReport, teacher: ReportTeacher): DutyTotals => {
  const totals: DutyTotals = { name: teacher.name, post: report.postName ?? "", target: teacher.target, total: 0, weekday: 0, weekend: 0, extra: 0 };

  for (const d of getDaysInMonth(report.year, report.month)) {
    const dateStr = formatDateYYYYMMDD(d);
    if (!(report.assignments[dateStr] || []).includes(teacher.id)) continue;

    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isExtra = report.extraDays.includes(dateStr);
    totals.total++;
    if (isExtra) totals.extra++;
    if (isWeekend) {
      totals.weekend++;
    } else if (!isExtra) {
      totals.weekday++;
    }
  }
  return totals;
};

const totalsRow = (t: DutyTotals): unknown[] => [t.name, t.target, t.total, t.weekday, t.weekend, t.extra, t.target - t.total];

/** Rows of one schedule's teacher report sheet. */
const reportRows = (report: ScheduleReport): unknown[][] => [
  REPORT_HEADER,
  ...report.teachers.map((t) => totalsRow(totalsFor(report, t)))
];

/**
 * Rows of the running total: each teacher's duties added up across every
 * schedule. Teachers are matched by name (ADR-0006), so a teacher imported
 * again under a new id is still one row, named as in the latest schedule.
 */
const runningTotalRows = (latestFirst: ScheduleReport[], withPost = false): unknown[][] => {
  const byName = new Map<string, DutyTotals>();
  for (const report of [...latestFirst].reverse()) {
    for (const teacher of report.teachers) {
      const month = totalsFor(report, teacher);
      const key = foldName(teacher.name);
      const sum = byName.get(key);
      if (!sum) {
        byName.set(key, month);
        continue;
      }
      sum.name = month.name;
      sum.post = month.post;
      sum.target += month.target;
      sum.total += month.total;
      sum.weekday += month.weekday;
      sum.weekend += month.weekend;
      sum.extra += month.extra;
    }
  }
  const sums = [...byName.values()].sort(
    (a, b) => (withPost ? a.post.localeCompare(b.post, "tr") : 0) || a.name.localeCompare(b.name, "tr")
  );
  return withPost
    ? [["Nöbet Yeri", ...REPORT_HEADER], ...sums.map((t) => [t.post, ...totalsRow(t)])]
    : [REPORT_HEADER, ...sums.map(totalsRow)];
};

const monthIndex = (report: ScheduleReport) => report.year * 12 + report.month;
const latestFirst = (reports: ScheduleReport[]) => [...reports].sort((a, b) => monthIndex(b) - monthIndex(a));
const monthLabel = (report: ScheduleReport) => `${MONTHS_TR[report.month - 1]} ${report.year}`;

const appendSheet = (workbook: XLSX.WorkBook, name: string, rows: unknown[][]) => {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // Size columns to their content, within limits.
  const columns = Math.max(...rows.map((row) => row.length));
  sheet["!cols"] = Array.from({ length: columns }, (_, col) => {
    const width = Math.max(...rows.map((row) => String(row[col] ?? "").length));
    return { wch: Math.min(Math.max(width + 3, 10), 35) };
  });
  XLSX.utils.book_append_sheet(workbook, sheet, name);
};

/**
 * The duty report workbook for one or more schedules. A single schedule keeps
 * its two familiar sheets. Several get a list and a report sheet each, latest
 * month first so the workbook opens on it, then the running total.
 */
/** Options for a duty report. */
export interface DutyReportOptions {
  /** Every duty post's schedules in one workbook, grouped by post (#28). */
  allPosts?: boolean;
}

const EXCEL_SHEET_NAME_MAX = 31;

/**
 * A sheet name for one post's schedule, e.g. "Kız Yurdu – Aralık 2026 – Liste".
 * Excel allows 31 characters and refuses : \ / ? * [ ], and names must be
 * unique (ignoring case): the month is shortened first ("Ara 2026"), then the
 * post's name with "…", and a repeated name gets a number.
 */
const postSheetName = (report: ScheduleReport, kind: "Liste" | "Rapor", used: Set<string>): string => {
  const post = (report.postName ?? "").replace(/[:\\/?*[\]]/g, "-").trim();
  const fullMonth = `${MONTHS_TR[report.month - 1]} ${report.year}`;
  const shortMonth = `${MONTHS_TR[report.month - 1].slice(0, 3)} ${report.year}`;
  for (let copy = 1; ; copy++) {
    const tag = copy === 1 ? "" : ` ${copy}`;
    const compose = (name: string, month: string) => `${name}${tag} – ${month} – ${kind}`;
    let sheet = compose(post, fullMonth);
    if (sheet.length > EXCEL_SHEET_NAME_MAX) sheet = compose(post, shortMonth);
    if (sheet.length > EXCEL_SHEET_NAME_MAX) {
      const room = EXCEL_SHEET_NAME_MAX - compose("", shortMonth).length;
      sheet = compose(`${post.slice(0, Math.max(room - 1, 1))}…`, shortMonth);
    }
    const key = sheet.toLocaleLowerCase("tr");
    if (!used.has(key)) {
      used.add(key);
      return sheet;
    }
  }
};

export const buildDutyReportWorkbook = (reports: ScheduleReport[], options: DutyReportOptions = {}): XLSX.WorkBook => {
  const workbook = XLSX.utils.book_new();

  // Every post: each post's sheets together, posts in Turkish order and each
  // post's latest month first, every sheet titled with the post and month in
  // full, then one running total with a post column.
  if (options.allPosts) {
    const byPost = [...reports].sort(
      (a, b) => (a.postName ?? "").localeCompare(b.postName ?? "", "tr") || monthIndex(b) - monthIndex(a)
    );
    const used = new Set<string>();
    for (const report of byPost) {
      const title = [`${report.postName ?? ""} – ${monthLabel(report)}`];
      appendSheet(workbook, postSheetName(report, "Liste", used), [title, ...listRows(report)]);
      appendSheet(workbook, postSheetName(report, "Rapor", used), [title, ...reportRows(report)]);
    }
    if (byPost.length > 1) appendSheet(workbook, "Toplam", runningTotalRows(latestFirst(reports), true));
    return workbook;
  }

  const ordered = latestFirst(reports);

  if (ordered.length === 1) {
    appendSheet(workbook, "Nöbet Listesi", listRows(ordered[0]));
    appendSheet(workbook, "Öğretmen Analiz Raporu", reportRows(ordered[0]));
    return workbook;
  }

  for (const report of ordered) {
    appendSheet(workbook, `${monthLabel(report)} – Liste`, listRows(report));
    appendSheet(workbook, `${monthLabel(report)} – Rapor`, reportRows(report));
  }
  appendSheet(workbook, "Toplam", runningTotalRows(ordered));
  return workbook;
};

/**
 * The suggested file name. A single schedule keeps its familiar name; several
 * are named by school year and the months they span, e.g.
 * `2026-2027_Eylül-Aralık_Nöbet_Raporu_v1.xlsx`.
 */
export const buildDutyReportFilename = (reports: ScheduleReport[], version: number, options: DutyReportOptions = {}): string => {
  const ordered = latestFirst(reports);
  const latest = ordered[0];
  if (options.allPosts) {
    const earliestOfAll = ordered[ordered.length - 1];
    if (monthIndex(earliestOfAll) === monthIndex(latest)) {
      return `${latest.year}_${MONTHS_TR[latest.month - 1]}_Tüm_Nöbet_Yerleri_Nöbet_Raporu_v${version}.xlsx`;
    }
    const startYear = schoolYearStart(latest.year, latest.month);
    return `${startYear}-${startYear + 1}_${MONTHS_TR[earliestOfAll.month - 1]}-${MONTHS_TR[latest.month - 1]}_Tüm_Nöbet_Yerleri_Nöbet_Raporu_v${version}.xlsx`;
  }
  if (ordered.length === 1) return buildExportFilename(latest.year, latest.month, version);

  const earliest = ordered[ordered.length - 1];
  const start = schoolYearStart(latest.year, latest.month);
  return `${start}-${start + 1}_${MONTHS_TR[earliest.month - 1]}-${MONTHS_TR[latest.month - 1]}_Nöbet_Raporu_v${version}.xlsx`;
};

/** Export counters are kept per distinct report: one month, or one span of months. */
const reportVersionKey = (reports: ScheduleReport[]): string => {
  const ordered = latestFirst(reports);
  const latest = ordered[0];
  if (ordered.length === 1) return versionKey(latest.year, latest.month);
  const earliest = ordered[ordered.length - 1];
  return `${versionKey(earliest.year, earliest.month)}..${versionKey(latest.year, latest.month)}`;
};

/**
 * Exports the working month's duty report, optionally together with earlier
 * approved schedules, to an Excel (.xlsx) file.
 *
 * This now opens a native Save-As dialog so the user chooses the
 * destination (instead of the old silent XLSX.writeFile() browser-download,
 * which always landed silently in the OS Downloads folder inside the Tauri
 * webview), and writes the real .xlsx bytes to that chosen path via
 * @tauri-apps/plugin-fs.
 */
export const exportScheduleToExcel = async (
  year: number,
  month: number,
  generatedSchedule: Record<string, string[]>,
  teachers: DbTeacher[],
  holidays: string[],
  weekendDutyDays: string[],
  extraDays: string[],
  deps: ExportScheduleDeps = {},
  monthlyTargets: Record<string, number> = {},
  earlierReports: ScheduleReport[] = []
): Promise<ExportScheduleResult> => {
  // Required counts do not appear in any sheet, so the defaults are harmless here.
  const working = freezeScheduleReport(
    { year, month, generatedSchedule, holidays, weekendDutyDays, extraDays, teachersPerDay: 1, daySpecificTeachers: {}, monthlyTargets },
    teachers
  );
  return exportDutyReport([working, ...earlierReports], deps);
};

/**
 * Exports the duty report of one or more schedules (the working month,
 * approved schedules, or both) to an Excel file at a place the user picks.
 */
export const exportDutyReport = async (
  reports: ScheduleReport[],
  deps: ExportScheduleDeps = {},
  options: DutyReportOptions = {}
): Promise<ExportScheduleResult> => {
  const doSaveDialog = deps.saveDialog ?? saveDialog;
  const doWriteFile = deps.writeFile ?? writeFsFile;
  const xlsxWriter = deps.xlsxWriter ?? XLSX;

  const workbook = buildDutyReportWorkbook(reports, options);

  // Ask the user where to save it (native Save-As dialog) instead of the old
  // silent XLSX.writeFile() browser-download. The suggested name carries the
  // in-session version indicator documented above; the user is free to rename
  // or overwrite it in the dialog exactly like any normal OS Save-As.
  // Every-post reports count their versions apart from one post's.
  const key = `${options.allPosts ? "all:" : ""}${reportVersionKey(reports)}`;
  const version = (exportVersionCounters.get(key) ?? 0) + 1;
  const suggestedFilename = buildDutyReportFilename(reports, version, options);

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
  exportVersionCounters.set(key, version);

  const filename = targetPath.split(/[\\/]/).pop() ?? suggestedFilename;
  return { status: "saved", path: targetPath, filename };
};
