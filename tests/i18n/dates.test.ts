import { describe, it, expect, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { i18n } from "../../src/i18n";
import { formatDateLong, monthName, shortDayNames } from "../../src/utils/dateUtils";
import { formatApprovalDate } from "../../src/utils/approvedSchedules";
import { buildDutyReportWorkbook } from "../../src/utils/excelUtils";
import { freezeScheduleReport } from "../../src/utils/scheduleReport";

// Dates are interface text: they follow the language, through Intl, with no
// month or day table in the code (ADR-0008). Before this, four places wrote
// "tr-TR" into the formatter and stayed Turkish whatever the interface said.

afterEach(async () => {
  await i18n.changeLanguage("tr");
});

const eylul = freezeScheduleReport(
  {
    year: 2026,
    month: 9,
    generatedSchedule: { "2026-09-02": ["T1"] },
    holidays: [],
    weekendDutyDays: [],
    extraDays: [],
    teachersPerDay: 1,
    daySpecificTeachers: {},
    monthlyTargets: {},
  },
  [{ id: "T1", name: "Cengiz", target_hours: 4, priority: 1, post_id: "yurt" }]
);

const rows = (wb: XLSX.WorkBook, sheet: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1 });

describe("dates", () => {
  it("are written in Turkish while the interface is Turkish", () => {
    expect(formatApprovalDate("2026-12-03T10:00:00")).toBe("3 Aralık 2026");
    expect(monthName(9)).toBe("Eylül");
    expect(shortDayNames()[0]).toBe("Pzt");
    expect(formatDateLong("2026-09-02", { weekday: "long" })).toBe("Çarşamba");
  });

  it("follow the interface into English", async () => {
    await i18n.changeLanguage("en");

    expect(formatApprovalDate("2026-12-03T10:00:00")).toBe("December 3, 2026");
    expect(monthName(9)).toBe("September");
    expect(shortDayNames()[0]).toBe("Mon");
    expect(formatDateLong("2026-09-02", { weekday: "long" })).toBe("Wednesday");
  });

  it("follow the interface into the exported workbook too", async () => {
    expect(rows(buildDutyReportWorkbook([eylul]), "Nöbet Listesi")[2]).toEqual([
      "2 Eylül 2026",
      "Çarşamba",
      "Cengiz",
      "Standart Nöbet",
      "Nöbet Günü",
    ]);

    await i18n.changeLanguage("en");

    expect(rows(buildDutyReportWorkbook([eylul]), "Duty List")[2]).toEqual([
      "September 2, 2026",
      "Wednesday",
      "Cengiz",
      "Standard Duty",
      "Duty Day",
    ]);
  });
});
