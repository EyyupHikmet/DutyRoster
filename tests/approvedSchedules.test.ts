import { describe, it, expect } from "vitest";
import {
  approvedCopyFor,
  earlierInSchoolYear,
  schoolYearStart,
  searchApprovedSchedules,
} from "../src/utils/approvedSchedules";

const copy = (id: string, year: number, month: number, schedule_id = `s-${id}`) => ({ id, schedule_id, year, month });

const copies = [
  copy("ocak27", 2027, 1),
  copy("aralik26", 2026, 12),
  copy("kasim26", 2026, 11),
  copy("eylul26", 2026, 9),
  copy("agustos26", 2026, 8),
  copy("subat26", 2026, 2),
];

describe("schoolYearStart", () => {
  it("starts the school year in Eylül", () => {
    expect(schoolYearStart(2026, 9)).toBe(2026);
    expect(schoolYearStart(2026, 12)).toBe(2026);
    expect(schoolYearStart(2027, 1)).toBe(2026);
    expect(schoolYearStart(2027, 8)).toBe(2026);
  });
});

describe("earlierInSchoolYear", () => {
  it("picks approved schedules of earlier months in the same school year, latest first", () => {
    expect(earlierInSchoolYear(copies, 2026, 12).map((c) => c.id)).toEqual(["kasim26", "eylul26"]);
  });

  it("reaches back across the new year, but not past Eylül", () => {
    expect(earlierInSchoolYear(copies, 2027, 1).map((c) => c.id)).toEqual(["aralik26", "kasim26", "eylul26"]);
  });

  it("finds nothing for Eylül, whose Ağustos belongs to the previous school year", () => {
    expect(earlierInSchoolYear(copies, 2026, 9)).toEqual([]);
  });

  it("never includes the working month's own approved schedule", () => {
    expect(earlierInSchoolYear(copies, 2026, 11).map((c) => c.id)).toEqual(["eylul26"]);
  });
});

describe("searchApprovedSchedules", () => {
  it("returns everything for an empty or blank search", () => {
    expect(searchApprovedSchedules(copies, "")).toHaveLength(copies.length);
    expect(searchApprovedSchedules(copies, "   ")).toHaveLength(copies.length);
  });

  it("matches the month name ignoring case and Turkish marks", () => {
    expect(searchApprovedSchedules(copies, "kasim").map((c) => c.id)).toEqual(["kasim26"]);
    expect(searchApprovedSchedules(copies, "ARALIK").map((c) => c.id)).toEqual(["aralik26"]);
    expect(searchApprovedSchedules(copies, "Şub").map((c) => c.id)).toEqual(["subat26"]);
    expect(searchApprovedSchedules(copies, "eylul").map((c) => c.id)).toEqual(["eylul26"]);
  });

  it("matches the year, and month and year together", () => {
    expect(searchApprovedSchedules(copies, "2027").map((c) => c.id)).toEqual(["ocak27"]);
    expect(searchApprovedSchedules(copies, "ağustos 2026").map((c) => c.id)).toEqual(["agustos26"]);
    expect(searchApprovedSchedules(copies, "kasım  2027")).toEqual([]);
  });
});

describe("approvedCopyFor", () => {
  it("finds the approved schedule of the working schedule by its id", () => {
    expect(approvedCopyFor(copies, "s-kasim26", 2026, 11)?.id).toBe("kasim26");
  });

  it("finds nothing when the working schedule has no approved copy", () => {
    expect(approvedCopyFor(copies, "some-other-schedule", 2026, 11)).toBeUndefined();
  });

  it("falls back to the month for a month not saved yet, such as one set up again after a reset", () => {
    expect(approvedCopyFor(copies, null, 2026, 11)?.id).toBe("kasim26");
    expect(approvedCopyFor(copies, null, 2026, 10)).toBeUndefined();
  });
});
