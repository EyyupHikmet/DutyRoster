import { describe, it, expect, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import {
  parseExcelRoster,
  buildExportFilename,
  getNextExportVersion,
  recordExportVersion,
  resetExportVersionCounters,
  exportScheduleToExcel,
  ExportScheduleDeps
} from "../src/utils/excelUtils";
import { DbTeacher } from "../src/db";

// Migrated from the original hand-rolled tsx-executed assert script onto vitest.
// Assertions/conditions preserved verbatim from the pre-migration version.

describe("Excel Yardımcı Programı Testleri (excelUtils)", () => {
  it("Test 1: parseExcelRoster with Turkish headers and varying priorities (DI)", () => {
    const mockXlsxReader = {
      read: () => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } }) as any,
      utils: {
        sheet_to_json: () =>
          [
            { "Adı": "Canan Dağdeviren", "Hedef": 5, "Öncelik": "Yüksek" },
            { "Ad": "Aziz Sancar", "Hedef Saat": "6", "Kıdem": "Orta" },
            { "Öğretmen Adı": "Oktay Sinanoğlu", "Saat": 3, "Kıdem": "1" },
          ] as any,
      },
    };

    const result = parseExcelRoster("dummy_binary_string", mockXlsxReader);

    expect(result.length, "Üç öğretmen başarıyla yüklenmeli").toBe(3);

    // Check Teacher 1 (Canan)
    expect(result[0].name, "Öğretmen adı Canan Dağdeviren olmalı").toBe("Canan Dağdeviren");
    expect(result[0].target_hours, "Hedef saati 5 olmalı").toBe(5);
    expect(result[0].priority, "Yüksek kıdem priority 3 olarak eşleşmeli").toBe(3);

    // Check Teacher 2 (Aziz)
    expect(result[1].name, "Öğretmen adı Aziz Sancar olmalı").toBe("Aziz Sancar");
    expect(result[1].target_hours, "Hedef saati 6 olmalı").toBe(6);
    expect(result[1].priority, "Orta kıdem priority 2 olarak eşleşmeli").toBe(2);

    // Check Teacher 3 (Oktay)
    expect(result[2].name, "Öğretmen adı Oktay Sinanoğlu olmalı").toBe("Oktay Sinanoğlu");
    expect(result[2].target_hours, "Hedef saati 3 olmalı").toBe(3);
    expect(result[2].priority, "Standart kıdem priority 1 olarak eşleşmeli").toBe(1);
  });

  it("Test 2: parseExcelRoster with English headers (DI)", () => {
    const mockXlsxReader = {
      read: () => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } }) as any,
      utils: {
        sheet_to_json: () =>
          [
            { "Name": "Cahit Arf", "Target Hours": 4, "Priority": "3" },
            { "Teacher": "Behram Kurşunoğlu", "Hours": 5, "Priority": "high" },
          ] as any,
      },
    };

    const result = parseExcelRoster("dummy_binary_string", mockXlsxReader);

    expect(result.length, "İki İngilizce öğretmen satırı yüklenmeli").toBe(2);
    expect(result[0].name, "Adı Cahit Arf olmalı").toBe("Cahit Arf");
    expect(result[0].target_hours, "Hedef saati 4 olmalı").toBe(4);
    expect(result[0].priority, "Öncelik 3 olmalı").toBe(3);

    expect(result[1].name, "Adı Behram Kurşunoğlu olmalı").toBe("Behram Kurşunoğlu");
    expect(result[1].target_hours, "Hedef saati 5 olmalı").toBe(5);
    expect(result[1].priority, "Öncelik 'high' priority 3 olmalı").toBe(3);
  });

  // A bare one-column list of names is a shape real users actually have, and the
  // keyed parse structurally cannot read it: sheet_to_json consumes row 1 as the
  // header row, so the first teacher becomes a column key and the rest match none
  // of the expected columns. These drive the REAL xlsx library rather than a mock,
  // because that header behaviour is exactly what is being covered.
  const sheetFrom = (rows: unknown[][]): string => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
    return XLSX.write(wb, { type: "binary", bookType: "xlsx" });
  };

  it("imports a single column of bare names with no header row at all", () => {
    const result = parseExcelRoster(
      sheetFrom([["Ahmet Yılmaz"], ["Ayşe Kaya"], ["Mehmet Demir"]])
    );

    expect(result.map((t) => t.name), "Üç ismin tamamı yüklenmeli — ilki başlık sanılmamalı").toEqual([
      "Ahmet Yılmaz",
      "Ayşe Kaya",
      "Mehmet Demir",
    ]);
    expect(result[0].target_hours, "Hedef saat varsayılanı 1 olmalı").toBe(1);
    expect(result[0].priority, "Kıdem varsayılanı 1 (Standart) olmalı").toBe(1);
  });

  it("skips a single-column header the keyed parse does not recognise", () => {
    const result = parseExcelRoster(
      sheetFrom([["Öğretmenler"], ["Canan Dağdeviren"], ["Aziz Sancar"]])
    );

    expect(result.map((t) => t.name), "Başlık satırı öğretmen olarak eklenmemeli").toEqual([
      "Canan Dağdeviren",
      "Aziz Sancar",
    ]);
  });

  it("recognises a single-column header regardless of Turkish casing", () => {
    // "İSİM".toLowerCase() yields a combining dot rather than a plain "i", which
    // is why header folding maps İ/I/ı explicitly instead of relying on NFD.
    const result = parseExcelRoster(sheetFrom([["İSİM"], ["Oktay Sinanoğlu"]]));

    expect(result.map((t) => t.name)).toEqual(["Oktay Sinanoğlu"]);
  });

  it("trims blank rows and whitespace in a single-column list", () => {
    const result = parseExcelRoster(
      sheetFrom([["  Cahit Arf  "], [""], ["Behram Kurşunoğlu"], [null as unknown as string]])
    );

    expect(result.map((t) => t.name)).toEqual(["Cahit Arf", "Behram Kurşunoğlu"]);
  });

  it("still imports nothing from a multi-column sheet with unrecognised headers", () => {
    // The fallback must not start guessing that some arbitrary first column is
    // a name column; that would import the wrong thing silently.
    const result = parseExcelRoster(
      sheetFrom([
        ["Sicil", "Bölüm"],
        ["1024", "Matematik"],
        ["1025", "Fizik"],
      ])
    );

    expect(result, "Çok sütunlu tanınmayan tablodan içe aktarım yapılmamalı").toEqual([]);
  });

  it("does not disturb a single column that already has a recognised header", () => {
    const result = parseExcelRoster(sheetFrom([["Ad"], ["Feryal Özel"], ["Ali Kuşçu"]]));

    expect(result.map((t) => t.name)).toEqual(["Feryal Özel", "Ali Kuşçu"]);
    expect(result[0].target_hours).toBe(1);
  });
});

// Save-As destination picker + versioned default filename +
// post-save confirmation. Tests exportScheduleToExcel via its ExportScheduleDeps
// dependency injection seam (mirrors parseExcelRoster's xlsxReader DI above), so
// no real Tauri IPC bridge (@tauri-apps/plugin-dialog / plugin-fs) is needed —
// the real plugin modules are still imported by excelUtils.ts, but never called.
describe("excelUtils — buildExportFilename / version counter", () => {
  beforeEach(() => {
    resetExportVersionCounters();
  });

  it("buildExportFilename keeps the existing year+month scheme and adds _v{version}", () => {
    expect(buildExportFilename(2026, 9, 1)).toBe("2026_Eylül_Nobet_Raporu_v1.xlsx");
    expect(buildExportFilename(2026, 9, 3)).toBe("2026_Eylül_Nobet_Raporu_v3.xlsx");
    expect(buildExportFilename(2027, 1, 2)).toBe("2027_Ocak_Nobet_Raporu_v2.xlsx");
  });

  it("getNextExportVersion starts at 1 for a month never exported this session", () => {
    expect(getNextExportVersion(2026, 9)).toBe(1);
  });

  it("getNextExportVersion does not advance merely by being peeked repeatedly", () => {
    expect(getNextExportVersion(2026, 9)).toBe(1);
    expect(getNextExportVersion(2026, 9)).toBe(1);
  });

  it("recordExportVersion advances the counter so the next suggestion increments", () => {
    expect(getNextExportVersion(2026, 9)).toBe(1);
    recordExportVersion(2026, 9, 1);
    expect(getNextExportVersion(2026, 9)).toBe(2);
    recordExportVersion(2026, 9, 2);
    expect(getNextExportVersion(2026, 9)).toBe(3);
  });

  it("tracks each (year, month) independently", () => {
    recordExportVersion(2026, 9, 1);
    expect(getNextExportVersion(2026, 9)).toBe(2);
    expect(getNextExportVersion(2026, 10)).toBe(1);
    expect(getNextExportVersion(2027, 9)).toBe(1);
  });
});

describe("excelUtils — exportScheduleToExcel (save dialog + fs write)", () => {
  beforeEach(() => {
    resetExportVersionCounters();
  });

  const teachers: DbTeacher[] = [
    { id: "T1", name: "Ahmet", target_hours: 4, priority: 1 }
  ];

  function makeDeps(overrides: Partial<ExportScheduleDeps> = {}): ExportScheduleDeps {
    return {
      saveDialog: async () => "C:\\Users\\test\\Belgeler\\2026_Eylül_Nobet_Raporu_v1.xlsx",
      writeFile: async () => {},
      xlsxWriter: { write: () => new Uint8Array([1, 2, 3]) },
      ...overrides
    };
  }

  it("on a chosen destination, writes real bytes and reports status 'saved' with the path/filename", async () => {
    let writtenPath: string | null = null;
    let writtenBytes: Uint8Array | null = null;
    const deps = makeDeps({
      writeFile: async (path, data) => {
        writtenPath = path;
        writtenBytes = data;
      }
    });

    const result = await exportScheduleToExcel(
      2026, 9, { "2026-09-01": ["T1"] }, teachers, [], [], [], deps
    );

    expect(result.status).toBe("saved");
    if (result.status === "saved") {
      expect(result.path).toBe("C:\\Users\\test\\Belgeler\\2026_Eylül_Nobet_Raporu_v1.xlsx");
      expect(result.filename).toBe("2026_Eylül_Nobet_Raporu_v1.xlsx");
    }
    expect(writtenPath).toBe("C:\\Users\\test\\Belgeler\\2026_Eylül_Nobet_Raporu_v1.xlsx");
    expect(writtenBytes).toBeInstanceOf(Uint8Array);
  });

  it("suggests the default filename to the save dialog with the current version, and advances it only after success", async () => {
    let seenDefaultPath: string | undefined;
    const deps = makeDeps({
      saveDialog: async (options) => {
        seenDefaultPath = options.defaultPath;
        return "C:\\out\\whatever.xlsx";
      }
    });

    await exportScheduleToExcel(2026, 9, {}, teachers, [], [], [], deps);
    expect(seenDefaultPath).toBe("2026_Eylül_Nobet_Raporu_v1.xlsx");

    await exportScheduleToExcel(2026, 9, {}, teachers, [], [], [], deps);
    expect(seenDefaultPath).toBe("2026_Eylül_Nobet_Raporu_v2.xlsx");
  });

  it("cancel path: a null path from the dialog returns status 'canceled', never writes, and does not advance the version counter", async () => {
    const writeFile = async () => {
      throw new Error("writeFile should never be called on cancel");
    };
    const deps = makeDeps({ saveDialog: async () => null, writeFile });

    const result = await exportScheduleToExcel(2026, 9, {}, teachers, [], [], [], deps);

    expect(result.status).toBe("canceled");
    expect(getNextExportVersion(2026, 9)).toBe(1); // unchanged — cancel doesn't burn a version
  });

  it("a writeFile failure returns status 'error' with a message, not a false 'saved' result", async () => {
    const deps = makeDeps({
      writeFile: async () => {
        throw new Error("disk full");
      }
    });

    const result = await exportScheduleToExcel(2026, 9, {}, teachers, [], [], [], deps);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("disk full");
    }
    // A failed write must not consume the suggested version either.
    expect(getNextExportVersion(2026, 9)).toBe(1);
  });

  it("a save-dialog rejection (e.g. plugin/IPC error) returns status 'error', not an uncaught rejection", async () => {
    const deps = makeDeps({
      saveDialog: async () => {
        throw new Error("dialog plugin unavailable");
      }
    });

    const result = await exportScheduleToExcel(2026, 9, {}, teachers, [], [], [], deps);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("dialog plugin unavailable");
    }
  });
});
