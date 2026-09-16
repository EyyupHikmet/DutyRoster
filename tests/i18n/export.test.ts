import { describe, it, expect, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { i18n } from "../../src/i18n";
import { buildDutyReportWorkbook, buildDutyReportFilename } from "../../src/utils/excelUtils";
import { freezeScheduleReport } from "../../src/utils/scheduleReport";
import { DbTeacher } from "../../src/db";

// The workbook follows the interface language (ADR-0008), including its sheet
// names — which Excel limits to 31 characters and refuses to see repeated.
// English month names are longer than the three-letter Turkish shortening was
// designed around, so the limit is worth checking in both languages.

afterEach(async () => {
  await i18n.changeLanguage("tr");
});

const teacher = (id: string, name: string): DbTeacher => ({ id, name, target_hours: 2, priority: 1, post_id: "p" });

const month = (postName: string, year: number, month: number) =>
  freezeScheduleReport(
    {
      year,
      month,
      postName,
      generatedSchedule: { [`${year}-${String(month).padStart(2, "0")}-01`]: ["T1"] },
      holidays: [],
      weekendDutyDays: [],
      extraDays: [],
      teachersPerDay: 1,
      daySpecificTeachers: {},
      monthlyTargets: {},
    },
    [teacher("T1", "Cengiz")]
  );

const reports = [
  month("Erkek Öğrenci Pansiyonu A", 2026, 12),
  month("Erkek Öğrenci Pansiyonu B", 2026, 12),
  month("Kız Yurdu", 2026, 9),
];

describe("the exported workbook in English", () => {
  it("keeps every sheet name within Excel's limit and tells them apart", async () => {
    await i18n.changeLanguage("en");

    const names = buildDutyReportWorkbook(reports, { allPosts: true }).SheetNames;

    expect(names.every((name) => name.length <= 31), `too long: ${names.filter((n) => n.length > 31)}`).toBe(true);
    expect(new Set(names.map((n) => n.toLocaleLowerCase("tr"))).size).toBe(names.length);
    // "Kız Yurdu – September 2026 – List" is 33 characters, so the month is
    // shortened in the tab and written out in full in the sheet's title row.
    expect(names).toContain("Kız Yurdu – Sep 2026 – List");
    expect(names[names.length - 1]).toBe("Total");

    const title = XLSX.utils.sheet_to_json<unknown[]>(
      buildDutyReportWorkbook(reports, { allPosts: true }).Sheets["Kız Yurdu – Sep 2026 – List"],
      { header: 1 }
    )[0];
    expect(title).toEqual(["Kız Yurdu – September 2026"]);
  });

  it("names the file in English, keeping it safe for a filesystem", async () => {
    await i18n.changeLanguage("en");

    const single = buildDutyReportFilename([month("Kız Yurdu", 2026, 12)], 1);
    const span = buildDutyReportFilename(reports, 2, { allPosts: true });

    expect(single).toBe("2026_December_Duty_Report_v1.xlsx");
    expect(span).toBe("2026-2027_September-December_All_Duty_Posts_Duty_Report_v2.xlsx");
    for (const name of [single, span]) expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("reads back through XLSX, so the names are ones Excel accepts", async () => {
    await i18n.changeLanguage("en");

    const written = XLSX.write(buildDutyReportWorkbook(reports, { allPosts: true }), { type: "array", bookType: "xlsx" });

    expect(XLSX.read(written, { type: "array" }).SheetNames).toContain("Total");
  });
});
