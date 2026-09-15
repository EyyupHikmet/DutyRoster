import { describe, it, expect } from "vitest";
import { freezeScheduleReport, openSlotCount, sameReport, MonthForReport } from "../src/utils/scheduleReport";
import { DbTeacher } from "../src/db";

// September 2026 starts on a Tuesday: 22 weekdays, weekends on 5–6, 12–13, 19–20, 26–27.
const staff = (): DbTeacher[] => [
  { id: "T2", name: "Davut", target_hours: 4, priority: 1 },
  { id: "T3", name: "Çağlar", target_hours: 5, priority: 2 },
  { id: "T1", name: "Cengiz", target_hours: 3, priority: 1 },
];

const eylul = (overrides: Partial<MonthForReport> = {}): MonthForReport => ({
  year: 2026,
  month: 9,
  generatedSchedule: { "2026-09-01": ["T1"], "2026-09-02": ["T2", "T3"] },
  holidays: ["2026-09-03"],
  weekendDutyDays: ["2026-09-06"],
  extraDays: ["2026-09-06"],
  teachersPerDay: 1,
  daySpecificTeachers: { "2026-09-02": 2 },
  monthlyTargets: { T3: 2 },
  ...overrides,
});

describe("freezeScheduleReport", () => {
  it("keeps what the duty report needs: names, effective targets, days and assignments", () => {
    const report = freezeScheduleReport(eylul(), staff());

    expect(report.year).toBe(2026);
    expect(report.month).toBe(9);
    expect(report.teachers).toEqual([
      { id: "T1", name: "Cengiz", target: 3 },
      { id: "T3", name: "Çağlar", target: 2 },
      { id: "T2", name: "Davut", target: 4 },
    ]);
    expect(report.assignments).toEqual({ "2026-09-01": ["T1"], "2026-09-02": ["T2", "T3"] });
    expect(report.holidays).toEqual(["2026-09-03"]);
    expect(report.weekendDutyDays).toEqual(["2026-09-06"]);
    expect(report.extraDays).toEqual(["2026-09-06"]);
  });

  it("records the required count of every duty day and of no other day", () => {
    const report = freezeScheduleReport(eylul(), staff());

    expect(report.requiredCounts["2026-09-01"]).toBe(1);
    expect(report.requiredCounts["2026-09-02"]).toBe(2);
    expect(report.requiredCounts["2026-09-06"], "a weekend duty day").toBe(1);
    expect(report.requiredCounts, "a non-duty weekday").not.toHaveProperty("2026-09-03");
    expect(report.requiredCounts, "a weekend day without duty").not.toHaveProperty("2026-09-05");
    expect(Object.keys(report.requiredCounts)).toHaveLength(22);
  });

  it("is not changed by later edits to the staff or the month", () => {
    const teachers = staff();
    const month = eylul();
    const report = freezeScheduleReport(month, teachers);

    teachers[0].name = "Davut Yılmaz";
    teachers[1].target_hours = 9;
    month.generatedSchedule["2026-09-01"].push("T2");
    month.holidays.push("2026-09-04");

    expect(report.teachers.map((t) => t.name)).toEqual(["Cengiz", "Çağlar", "Davut"]);
    expect(report.teachers.find((t) => t.id === "T3")?.target).toBe(2);
    expect(report.assignments["2026-09-01"]).toEqual(["T1"]);
    expect(report.holidays).toEqual(["2026-09-03"]);
  });
});

describe("openSlotCount", () => {
  it("counts the slots left open across the month", () => {
    // 22 duty days asking for 23 slots in total; 3 of them are filled.
    expect(openSlotCount(freezeScheduleReport(eylul(), staff()))).toBe(20);
  });

  it("is zero when every duty day is covered", () => {
    const full = freezeScheduleReport(eylul({ daySpecificTeachers: {} }), staff());
    for (const date of Object.keys(full.requiredCounts)) full.assignments[date] = ["T1"];

    expect(openSlotCount(full)).toBe(0);
  });
});

describe("sameReport", () => {
  it("treats a report whose days are listed in another order as unchanged", () => {
    const a = freezeScheduleReport(eylul(), staff());
    const b = freezeScheduleReport(
      eylul({
        generatedSchedule: { "2026-09-02": ["T3", "T2"], "2026-09-01": ["T1"] },
        holidays: ["2026-09-03"],
      }),
      [...staff()].reverse()
    );

    expect(sameReport(a, b)).toBe(true);
  });

  it("notices a changed assignment", () => {
    const a = freezeScheduleReport(eylul(), staff());
    const b = freezeScheduleReport(eylul({ generatedSchedule: { "2026-09-01": ["T2"], "2026-09-02": ["T2", "T3"] } }), staff());

    expect(sameReport(a, b)).toBe(false);
  });

  it("notices a renamed teacher", () => {
    const renamed = staff();
    renamed[0].name = "Davut Yılmaz";

    expect(sameReport(freezeScheduleReport(eylul(), staff()), freezeScheduleReport(eylul(), renamed))).toBe(false);
  });

  it("notices a changed target, extra day or non-duty day", () => {
    const base = freezeScheduleReport(eylul(), staff());

    expect(sameReport(base, freezeScheduleReport(eylul({ monthlyTargets: {} }), staff()))).toBe(false);
    expect(sameReport(base, freezeScheduleReport(eylul({ extraDays: [] }), staff()))).toBe(false);
    expect(sameReport(base, freezeScheduleReport(eylul({ holidays: [] }), staff()))).toBe(false);
  });
});
