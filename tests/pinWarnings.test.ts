import { describe, it, expect } from "vitest";
import { pinWarnings } from "../src/utils/pinWarnings";
import { DbTeacher } from "../src/db";

// A pin always wins (#18). These warnings only make sure the principal knows
// when one goes past a teacher's target or lands on a day they marked Uygun Değil.

const teacher = (id: string, name: string, target: number): DbTeacher => ({
  id,
  name,
  target_hours: target,
  priority: 1,
  post_id: "kiz",
});

const staff = [teacher("T1", "Elif", 2), teacher("T2", "Çağlar", 4)];

const warnings = (overrides: Partial<Parameters<typeof pinWarnings>[0]> = {}) =>
  pinWarnings({
    teachers: staff,
    pinnedAssignments: {},
    monthlyTargets: {},
    availabilities: {},
    ...overrides,
  });

describe("pinWarnings", () => {
  it("says nothing when no pin passes a target or lands on an unavailable day", () => {
    expect(warnings({ pinnedAssignments: { "2026-12-01": ["T1"], "2026-12-02": ["T1", "T2"] } })).toEqual({
      overTarget: [],
      unavailable: [],
    });
  });

  it("names a teacher whose pins alone pass their target", () => {
    const result = warnings({
      pinnedAssignments: { "2026-12-01": ["T1"], "2026-12-02": ["T1", "T2"], "2026-12-03": ["T1"] },
    });

    expect(result.overTarget).toEqual([{ id: "T1", name: "Elif", pinned: 3, target: 2 }]);
  });

  it("counts against the month's target when the month overrides it", () => {
    const pinnedAssignments = { "2026-12-01": ["T2"], "2026-12-02": ["T2"] };

    expect(warnings({ pinnedAssignments }).overTarget, "Çağlar's usual target is 4").toEqual([]);
    expect(warnings({ pinnedAssignments, monthlyTargets: { T2: 1 } }).overTarget).toEqual([
      { id: "T2", name: "Çağlar", pinned: 2, target: 1 },
    ]);
  });

  it("names every pin that lands on a day the teacher marked Uygun Değil", () => {
    const result = warnings({
      pinnedAssignments: { "2026-12-01": ["T1", "T2"], "2026-12-04": ["T2"] },
      availabilities: {
        T1: { "2026-12-01": "unavailable" },
        T2: { "2026-12-01": "preferred", "2026-12-04": "unavailable" },
      },
    });

    expect(result.unavailable).toEqual([
      { id: "T2", name: "Çağlar", date: "2026-12-04" },
      { id: "T1", name: "Elif", date: "2026-12-01" },
    ]);
  });

  it("lists teachers in Turkish alphabetical order and ignores pins of teachers no longer in the staff", () => {
    const result = warnings({
      pinnedAssignments: {
        "2026-12-01": ["T2", "gone", "T1"],
        "2026-12-02": ["T2", "T1"],
        "2026-12-03": ["T2", "T1"],
      },
      monthlyTargets: { T2: 1 },
    });

    expect(result.overTarget.map((w) => w.name)).toEqual(["Çağlar", "Elif"]);
  });
});
