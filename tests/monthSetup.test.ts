import { describe, it, expect } from "vitest";
import { daySettingsOf } from "../src/utils/monthSetup";
import { DbSchedule } from "../src/db";

// "Başka nöbet yerinden kopyala" copies a month's day settings from another
// duty post: non-duty days, extra duty days and required counts, nothing else.

const row = (config: unknown, overrides: Partial<DbSchedule> = {}): DbSchedule => ({
  id: "s1",
  post_id: "erkek",
  year: 2027,
  month: 3,
  assignments: JSON.stringify({ "2027-03-01": ["T1"] }),
  holidays: JSON.stringify(["2027-03-19"]),
  weekend_duty_days: JSON.stringify(["2027-03-06"]),
  config: typeof config === "string" ? config : JSON.stringify(config),
  ...overrides,
});

describe("daySettingsOf", () => {
  it("reads only the day settings of another post's month", () => {
    const settings = daySettingsOf(
      row({
        mode: "random",
        respectTargets: true,
        teachersPerDay: 2,
        daySpecificTeachers: { "2027-03-06": 3 },
        extraDays: ["2027-03-06", "2027-03-19"],
        pinnedAssignments: { "2027-03-02": ["T1"] },
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }],
        monthlyTargets: { T1: 5 },
      })
    );

    expect(settings).toEqual({
      holidays: ["2027-03-19"],
      weekendDutyDays: ["2027-03-06"],
      extraDays: ["2027-03-06", "2027-03-19"],
      teachersPerDay: 2,
      daySpecificTeachers: { "2027-03-06": 3 },
    });
  });

  it("falls back to the month's defaults for settings the other month never saved", () => {
    // Mart 2027 weekends: 6–7, 13–14, 20–21, 27–28.
    expect(daySettingsOf(row({ mode: "fairness" }))).toEqual({
      holidays: ["2027-03-19"],
      weekendDutyDays: ["2027-03-06"],
      extraDays: ["2027-03-06", "2027-03-07", "2027-03-13", "2027-03-14", "2027-03-20", "2027-03-21", "2027-03-27", "2027-03-28"],
      teachersPerDay: 1,
      daySpecificTeachers: {},
    });
  });

  it("returns nothing for a month whose saved data cannot be read", () => {
    expect(daySettingsOf(row("{not json"))).toBeNull();
  });
});
