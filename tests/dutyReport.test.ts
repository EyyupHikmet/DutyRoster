import { describe, it, expect, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import {
  buildDutyReportWorkbook,
  buildDutyReportFilename,
  exportDutyReport,
  exportScheduleToExcel,
  resetExportVersionCounters,
} from "../src/utils/excelUtils";
import { freezeScheduleReport, MonthForReport } from "../src/utils/scheduleReport";
import { DbTeacher } from "../src/db";

const month = (year: number, m: number, overrides: Partial<MonthForReport>): MonthForReport => ({
  year,
  month: m,
  generatedSchedule: {},
  holidays: [],
  weekendDutyDays: [],
  extraDays: [],
  teachersPerDay: 1,
  daySpecificTeachers: {},
  monthlyTargets: {},
  ...overrides,
});

const teacher = (id: string, name: string, target: number): DbTeacher => ({ id, name, target_hours: target, priority: 1 });

// Eylül 2026: 1st Tuesday, 6th Sunday. Kasım 2026: 2nd Monday, 7th Saturday. Aralık 2026: 1st Tuesday.
const eylul = freezeScheduleReport(
  month(2026, 9, {
    generatedSchedule: { "2026-09-01": ["T1"], "2026-09-02": ["T2", "T3"], "2026-09-06": ["T3"] },
    weekendDutyDays: ["2026-09-06"],
    extraDays: ["2026-09-06"],
  }),
  [teacher("T1", "Cengiz", 3), teacher("T2", "Davut", 4), teacher("T3", "Çağlar", 2)]
);

// Çağlar was imported again (new id) and typed in capitals; Davut has left; Zeynep joined.
const kasim = freezeScheduleReport(
  month(2026, 11, {
    generatedSchedule: { "2026-11-02": ["X3"], "2026-11-03": ["X3", "T4"], "2026-11-07": ["T1"] },
    weekendDutyDays: ["2026-11-07"],
    extraDays: ["2026-11-07"],
  }),
  [teacher("T1", "Cengiz", 3), teacher("X3", "ÇAĞLAR", 5), teacher("T4", "Zeynep", 1)]
);

const aralik = freezeScheduleReport(
  month(2026, 12, { generatedSchedule: { "2026-12-01": ["T5"], "2026-12-02": ["T6", "X3"] } }),
  [teacher("T1", "Cengiz", 3), teacher("X3", "Çağlar", 5), teacher("T5", "Sule", 2), teacher("T6", "Şule", 2)]
);

const readBack = (wb: XLSX.WorkBook) => XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), { type: "array" });
const rows = (wb: XLSX.WorkBook, sheet: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1 });

const REPORT_HEADER = [
  "Öğretmen Adı Soyadı",
  "Hedef Görev Sayısı",
  "Toplam Atanan Nöbet",
  "Hafta İçi (Standart)",
  "Hafta Sonu",
  "Toplam Ekstra Nöbet",
  "Fark (Hedef - Atanan)",
];

describe("buildDutyReportWorkbook", () => {
  it("keeps today's two sheets for a single schedule", () => {
    const wb = readBack(buildDutyReportWorkbook([eylul]));

    expect(wb.SheetNames).toEqual(["Nöbet Listesi", "Öğretmen Analiz Raporu"]);
  });

  it("gives every schedule a list and a report sheet, latest month first, then Toplam", () => {
    const wb = readBack(buildDutyReportWorkbook([kasim, aralik, eylul]));

    expect(wb.SheetNames).toEqual([
      "Aralık 2026 – Liste",
      "Aralık 2026 – Rapor",
      "Kasım 2026 – Liste",
      "Kasım 2026 – Rapor",
      "Eylül 2026 – Liste",
      "Eylül 2026 – Rapor",
      "Toplam",
    ]);
  });

  it("reports each month from its own frozen names and targets", () => {
    const wb = readBack(buildDutyReportWorkbook([kasim, aralik, eylul]));

    expect(rows(wb, "Kasım 2026 – Rapor")).toEqual([
      REPORT_HEADER,
      ["Cengiz", 3, 1, 0, 1, 1, 2],
      ["ÇAĞLAR", 5, 2, 2, 0, 0, 3],
      ["Zeynep", 1, 1, 1, 0, 0, 0],
    ]);
    expect(rows(wb, "Eylül 2026 – Liste")[2]).toEqual([
      "2 Eylül 2026",
      "Çarşamba",
      "Davut, Çağlar",
      "Standart Nöbet",
      "Nöbet Günü",
    ]);
  });

  it("calls a day without duty exactly that, since the dorm is not necessarily closed", () => {
    // Eylül 2026: the 3rd is switched off, the 5th is a weekend day with no duty.
    const off = freezeScheduleReport(
      month(2026, 9, { generatedSchedule: { "2026-09-01": ["T1"] }, holidays: ["2026-09-03"] }),
      [teacher("T1", "Cengiz", 3)]
    );
    const listed = rows(readBack(buildDutyReportWorkbook([off])), "Nöbet Listesi");

    expect(listed[3], "a weekday switched off").toEqual(["3 Eylül 2026", "Perşembe", "-", "-", "Nöbet Yok"]);
    expect(listed[5], "a weekend day without duty").toEqual(["5 Eylül 2026", "Cumartesi", "-", "-", "Nöbet Yok (Hafta Sonu)"]);
  });

  it("adds up each teacher across schedules in Toplam, matched by name", () => {
    const wb = readBack(buildDutyReportWorkbook([kasim, aralik, eylul]));

    expect(rows(wb, "Toplam")).toEqual([
      REPORT_HEADER,
      ["Cengiz", 9, 2, 1, 1, 1, 7],
      // Two ids and two spellings, one teacher; named as in the latest schedule.
      ["Çağlar", 12, 5, 4, 1, 1, 7],
      // Missing from Kasım and Aralık, which count as zero.
      ["Davut", 4, 1, 1, 0, 0, 3],
      // Turkish marks keep two names apart.
      ["Sule", 2, 1, 1, 0, 0, 1],
      ["Şule", 2, 1, 1, 0, 0, 1],
      ["Zeynep", 1, 1, 1, 0, 0, 0],
    ]);
  });
});

describe("buildDutyReportFilename", () => {
  it("keeps today's name for a single schedule", () => {
    expect(buildDutyReportFilename([eylul], 1)).toBe("2026_Eylül_Nöbet_Raporu_v1.xlsx");
  });

  it("names the school year and the months covered for several schedules", () => {
    expect(buildDutyReportFilename([kasim, aralik, eylul], 2)).toBe("2026-2027_Eylül-Aralık_Nöbet_Raporu_v2.xlsx");
  });
});

describe("exportScheduleToExcel with earlier approved schedules", () => {
  beforeEach(() => resetExportVersionCounters());

  it("writes the working month together with the earlier schedules", async () => {
    let suggested: string | undefined;
    let written: Uint8Array | undefined;

    const result = await exportScheduleToExcel(
      2026,
      12,
      aralik.assignments,
      [teacher("T1", "Cengiz", 3), teacher("X3", "Çağlar", 5), teacher("T5", "Sule", 2), teacher("T6", "Şule", 2)],
      [],
      [],
      [],
      {
        saveDialog: async (options) => {
          suggested = options.defaultPath;
          return "C:\\rapor.xlsx";
        },
        writeFile: async (_path, data) => {
          written = data;
        },
      },
      {},
      [kasim, eylul]
    );

    expect(result.status).toBe("saved");
    expect(suggested).toBe("2026-2027_Eylül-Aralık_Nöbet_Raporu_v1.xlsx");
    expect(XLSX.read(written!, { type: "array" }).SheetNames).toEqual([
      "Aralık 2026 – Liste",
      "Aralık 2026 – Rapor",
      "Kasım 2026 – Liste",
      "Kasım 2026 – Rapor",
      "Eylül 2026 – Liste",
      "Eylül 2026 – Rapor",
      "Toplam",
    ]);
  });
});

describe("one duty report for every duty post", () => {
  const post = (postName: string, year: number, m: number, generatedSchedule: Record<string, string[]>, staff: DbTeacher[]) =>
    freezeScheduleReport(month(year, m, { postName, generatedSchedule }), staff);

  // Aralık 2026: 1st Tuesday, 2nd Wednesday. Kasım 2026: 2nd Monday, 3rd Tuesday.
  const erkekAralik = post("Erkek Yurdu", 2026, 12, { "2026-12-01": ["A"], "2026-12-02": ["A"] }, [teacher("A", "Ali", 2)]);
  const kizAralik = post("Kız Yurdu", 2026, 12, { "2026-12-01": ["B"] }, [teacher("B", "Ayşe", 3)]);
  const kizKasim = post("Kız Yurdu", 2026, 11, { "2026-11-02": ["B"], "2026-11-03": ["B"] }, [teacher("B", "Ayşe", 3)]);

  it("groups sheets by post in Turkish order, latest month first, then one running total", () => {
    const wb = readBack(buildDutyReportWorkbook([kizKasim, erkekAralik, kizAralik], { allPosts: true }));

    expect(wb.SheetNames).toEqual([
      "Erkek Yurdu – Ara 2026 – Liste",
      "Erkek Yurdu – Ara 2026 – Rapor",
      "Kız Yurdu – Aralık 2026 – Liste",
      "Kız Yurdu – Aralık 2026 – Rapor",
      "Kız Yurdu – Kasım 2026 – Liste",
      "Kız Yurdu – Kasım 2026 – Rapor",
      "Toplam",
    ]);
  });

  it("names the post and month in full on the first row of each sheet", () => {
    const wb = readBack(buildDutyReportWorkbook([erkekAralik, kizAralik], { allPosts: true }));

    expect(rows(wb, "Erkek Yurdu – Ara 2026 – Liste")[0]).toEqual(["Erkek Yurdu – Aralık 2026"]);
    expect(rows(wb, "Kız Yurdu – Aralık 2026 – Rapor").slice(0, 3)).toEqual([
      ["Kız Yurdu – Aralık 2026"],
      REPORT_HEADER,
      ["Ayşe", 3, 1, 1, 0, 0, 2],
    ]);
  });

  it("adds a post column to the running total, sorted by post, then teacher", () => {
    const zeynep = teacher("C", "Zeynep", 1);
    const erkekWithTwo = post("Erkek Yurdu", 2026, 12, { "2026-12-01": ["A", "C"], "2026-12-02": ["A"] }, [zeynep, teacher("A", "Ali", 2)]);
    const wb = readBack(buildDutyReportWorkbook([kizKasim, erkekWithTwo, kizAralik], { allPosts: true }));

    expect(rows(wb, "Toplam")).toEqual([
      ["Nöbet Yeri", ...REPORT_HEADER],
      ["Erkek Yurdu", "Ali", 2, 2, 2, 0, 0, 0],
      ["Erkek Yurdu", "Zeynep", 1, 1, 1, 0, 0, 0],
      ["Kız Yurdu", "Ayşe", 6, 3, 3, 0, 0, 3],
    ]);
  });

  it("keeps sheet names within Excel's 31 characters, unique, and free of characters Excel refuses", () => {
    const longA = post("Erkek Öğrenci Pansiyonu A", 2026, 8, {}, [teacher("A", "Ali", 2)]);
    const longB = post("Erkek Öğrenci Pansiyonu B", 2026, 8, {}, [teacher("B", "Ayşe", 2)]);
    const odd = post("Bina 2/3 [Yeni]", 2026, 12, {}, [teacher("C", "Can", 2)]);

    const names = readBack(buildDutyReportWorkbook([longA, longB, odd], { allPosts: true })).SheetNames;

    expect(names).toContain("Bina 2-3 -Y… – Ara 2026 – Liste");
    expect(names.filter((n) => n.startsWith("Erkek Öğr"))).toHaveLength(4);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(31);
    expect(new Set(names.map((n) => n.toLocaleLowerCase("tr"))).size).toBe(names.length);
  });

  it("names every post in the sheets even when only one post had a schedule", () => {
    const wb = readBack(buildDutyReportWorkbook([kizAralik], { allPosts: true }));

    expect(wb.SheetNames).toEqual(["Kız Yurdu – Aralık 2026 – Liste", "Kız Yurdu – Aralık 2026 – Rapor"]);
  });

  it("names the file for every post, for one month or several", () => {
    expect(buildDutyReportFilename([erkekAralik, kizAralik], 1, { allPosts: true })).toBe(
      "2026_Aralık_Tüm_Nöbet_Yerleri_Nöbet_Raporu_v1.xlsx"
    );
    expect(buildDutyReportFilename([kizAralik], 1, { allPosts: true })).toBe("2026_Aralık_Tüm_Nöbet_Yerleri_Nöbet_Raporu_v1.xlsx");
    expect(buildDutyReportFilename([erkekAralik, kizAralik, kizKasim], 2, { allPosts: true })).toBe(
      "2026-2027_Kasım-Aralık_Tüm_Nöbet_Yerleri_Nöbet_Raporu_v2.xlsx"
    );
  });

  it("suggests that file name when exporting", async () => {
    resetExportVersionCounters();
    let suggested: string | undefined;

    await exportDutyReport(
      [erkekAralik, kizAralik],
      {
        saveDialog: async (options) => {
          suggested = options.defaultPath;
          return null;
        },
      },
      { allPosts: true }
    );

    expect(suggested).toBe("2026_Aralık_Tüm_Nöbet_Yerleri_Nöbet_Raporu_v1.xlsx");
  });
});
