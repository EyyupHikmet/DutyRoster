import { describe, it, expect } from "vitest";
import { solve, Teacher, AvailabilityStatus, SolverConfig } from "../../src/solver/index";

// One order shared by every distribution rule (#18): teachers below their
// target come before teachers who have reached it, then Tercihli before
// Uygun, and only then does the rule itself break the tie. A teacher's target
// is no longer just a sort key a preference can jump over.

const teacher = (id: string, target: number, priority = 1): Teacher => ({
  id,
  name: id,
  target_hours: target,
  priority,
});

type Availabilities = Record<string, Record<string, AvailabilityStatus>>;

/** Availabilities from "id date date" lines, e.g. prefers("A", "2026-12-03"). */
const status = (entries: Array<[string, string, AvailabilityStatus]>): Availabilities => {
  const map: Availabilities = {};
  for (const [id, date, value] of entries) {
    map[id] = { ...(map[id] ?? {}), [date]: value };
  }
  return map;
};

const config = (overrides: Partial<SolverConfig> = {}): SolverConfig => ({
  mode: "fairness",
  teachersPerDay: 1,
  pinnedAssignments: {},
  ...overrides,
});

const counts = (schedule: Record<string, string[]>): Record<string, number> => {
  const total: Record<string, number> = {};
  for (const ids of Object.values(schedule)) for (const id of ids) total[id] = (total[id] ?? 0) + 1;
  return total;
};

describe("teachers below their target come first", () => {
  it("gives the date to a teacher below target over one at target who prefers it (Eşit Dağıtım)", () => {
    // Ali has both of his 2 duties already; Can has 3 of 6.
    const dates = ["2026-12-01", "2026-12-02", "2026-12-03"];
    const result = solve(
      dates,
      [teacher("Ali", 2), teacher("Can", 6)],
      status([
        ["Ali", "2026-12-03", "preferred"],
        ["Can", "2026-12-03", "available"],
      ]),
      config({ pinnedAssignments: { "2026-12-01": ["Ali"], "2026-12-02": ["Ali"] } })
    );

    expect(result.success).toBe(true);
    expect(result.schedule!["2026-12-03"]).toEqual(["Can"]);
  });

  it("alternates two teachers who both prefer every Monday, then fills the rest with the one still below target", () => {
    // Four Mondays and two Tuesdays. Ayşe's target is 2, Ali's is 4.
    const mondays = ["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"];
    const tuesdays = ["2026-12-08", "2026-12-15"];
    const prefersMondays = status(
      mondays.flatMap((date) => [
        ["Ayşe", date, "preferred"] as [string, string, AvailabilityStatus],
        ["Ali", date, "preferred"] as [string, string, AvailabilityStatus],
      ])
    );

    const result = solve([...mondays, ...tuesdays], [teacher("Ayşe", 2), teacher("Ali", 4)], prefersMondays, config());

    expect(result.success).toBe(true);
    // Equal counts: Eşit Dağıtım then prefers whoever has more of their target left.
    expect(mondays.map((d) => result.schedule![d][0])).toEqual(["Ali", "Ayşe", "Ali", "Ayşe"]);
    expect(tuesdays.map((d) => result.schedule![d][0])).toEqual(["Ali", "Ali"]);
  });

  it("serves the higher-priority teacher's target first, then the other's (Kıdem Öncelikli)", () => {
    const mondays = ["2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"];
    const prefersMondays = status(
      mondays.flatMap((date) => [
        ["Ayşe", date, "preferred"] as [string, string, AvailabilityStatus],
        ["Ali", date, "preferred"] as [string, string, AvailabilityStatus],
      ])
    );

    const result = solve([...mondays], [teacher("Ayşe", 2, 3), teacher("Ali", 4, 1)], prefersMondays, config({ mode: "priority" }));

    expect(result.success).toBe(true);
    expect(mondays.map((d) => result.schedule![d][0])).toEqual(["Ayşe", "Ayşe", "Ali", "Ali"]);
  });

  it("outranks priority: a high-priority teacher at target loses to a low-priority one below it", () => {
    const result = solve(
      ["2026-12-05", "2026-12-06"],
      [teacher("Ayşe", 1, 3), teacher("Burak", 3, 1)],
      {},
      config({ mode: "priority", pinnedAssignments: { "2026-12-05": ["Ayşe"] } })
    );

    expect(result.schedule!["2026-12-06"]).toEqual(["Burak"]);
  });

  it("does not outrank preference: below target, the teacher who prefers the date gets it", () => {
    const result = solve(
      ["2026-12-06"],
      [teacher("Ayşe", 3, 3), teacher("Burak", 3, 1)],
      status([["Burak", "2026-12-06", "preferred"]]),
      config({ mode: "priority" })
    );

    expect(result.schedule!["2026-12-06"]).toEqual(["Burak"]);
  });

  it("applies to Rastgele too: a teacher at target is never picked over one below it", () => {
    for (let run = 0; run < 25; run++) {
      const result = solve(
        ["2026-12-01", "2026-12-02"],
        [teacher("Ali", 1), teacher("Can", 4)],
        status([["Ali", "2026-12-02", "preferred"]]),
        config({ mode: "random", pinnedAssignments: { "2026-12-01": ["Ali"] } })
      );

      expect(result.schedule!["2026-12-02"]).toEqual(["Can"]);
    }
  });

  it("still spreads the month randomly when everyone is below target", () => {
    const dates = Array.from({ length: 12 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`);
    const staff = [teacher("Ali", 6), teacher("Can", 6), teacher("Ece", 6)];

    const runs = Array.from({ length: 8 }, () => dates.map((d) => solve(dates, staff, {}, config({ mode: "random" })).schedule![d][0]).join(","));

    expect(new Set(runs).size, "the same month twice in a row is not random").toBeGreaterThan(1);
  });
});

describe("what happens once everyone has reached their target", () => {
  it("with the target cap off, a teacher at target fills the day rather than leaving it open", () => {
    const result = solve(
      ["2026-12-01", "2026-12-02"],
      [teacher("Ali", 1), teacher("Can", 1)],
      {},
      config({ respectTargets: false })
    );

    expect(result.success).toBe(true);
    expect(result.unfilled).toEqual([]);
    expect(counts(result.schedule!)).toEqual({ Ali: 1, Can: 1 });
  });

  it("with the target cap on, the slot stays open instead", () => {
    const result = solve(
      ["2026-12-01", "2026-12-02", "2026-12-03"],
      [teacher("Ali", 1), teacher("Can", 1)],
      {},
      config({ respectTargets: true })
    );

    expect(result.success).toBe(true);
    expect(result.unfilled).toEqual([{ date: "2026-12-03", required: 1, assigned: 0 }]);
  });

  it("uses a teacher over target only after every teacher at target", () => {
    // Ali is already one past his target of 1; Can has exactly reached hers.
    const result = solve(
      ["2026-12-01", "2026-12-02", "2026-12-04"],
      [teacher("Ali", 1), teacher("Can", 1)],
      {},
      config({ pinnedAssignments: { "2026-12-01": ["Ali"], "2026-12-02": ["Ali", "Can"] }, teachersPerDay: { "2026-12-02": 2, "2026-12-01": 1, "2026-12-04": 1 } })
    );

    expect(result.schedule!["2026-12-04"]).toEqual(["Can"]);
  });
});

describe("partner groups and the target band", () => {
  const group = (goalDays: number) =>
    config({
      pinnedAssignments: { "2026-12-01": ["Ali", "Veli"] },
      teachersPerDay: { "2026-12-01": 2, "2026-12-02": 2 },
      partnerGroups: [{ id: "g1", memberIds: ["Ali", "Veli"], goalDays }],
    });
  // Ali and Veli share duties; Ali reaches his target on the pinned day.
  const staff = [teacher("Ali", 1), teacher("Veli", 4), teacher("Can", 4)];

  it("serves a group's shared duty day even with a member at target, the way a pin does", () => {
    // A group goal is the principal's explicit decision, like a pin: the band
    // orders the ordinary search, it does not overrule a day they asked for.
    const result = solve(["2026-12-01", "2026-12-02"], staff, {}, group(2));

    expect(result.schedule!["2026-12-02"]).toEqual(["Ali", "Veli"]);
  });

  it("stops preferring a member at target once the group has served its days", () => {
    const result = solve(["2026-12-01", "2026-12-02"], staff, {}, group(1));

    expect([...result.schedule!["2026-12-02"]].sort()).toEqual(["Can", "Veli"]);
  });
});
