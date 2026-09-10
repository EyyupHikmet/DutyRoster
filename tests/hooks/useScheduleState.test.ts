import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScheduleState } from "../../src/hooks/useScheduleState";
import * as db from "../../src/db";

vi.mock("../../src/db", () => ({
  getSchedule: vi.fn(),
  saveSchedule: vi.fn(),
  getAllSchedules: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const { getSchedule, saveSchedule, getAllSchedules } = mockedDb;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(crypto, "randomUUID").mockReturnValue("fresh-uuid" as `${string}-${string}-${string}-${string}-${string}`);
});

describe("useScheduleState", () => {
  it("loadScheduleData() with no saved schedule resets to defaults, with extraDays defaulting to that month's weekends", async () => {
    mockedDb.getSchedule.mockResolvedValue(null);
    const { result } = renderHook(() => useScheduleState());

    await act(async () => {
      await result.current.loadScheduleData(2026, 9); // September 2026
    });

    expect(result.current.generatedSchedule).toEqual({});
    expect(result.current.holidays).toEqual([]);
    expect(result.current.weekendDutyDays).toEqual([]);
    expect(result.current.pinnedAssignments).toEqual({});
    // Sept 2026: weekends fall on 5,6,12,13,19,20,26,27
    expect(result.current.extraDays).toEqual([
      "2026-09-05", "2026-09-06",
      "2026-09-12", "2026-09-13",
      "2026-09-19", "2026-09-20",
      "2026-09-26", "2026-09-27",
    ]);
  });

  it("loadScheduleData() with a saved schedule hydrates all state from the stored JSON", async () => {
    mockedDb.getSchedule.mockResolvedValue({
      id: "s1",
      year: 2026,
      month: 10,
      assignments: JSON.stringify({ "2026-10-01": ["T1"] }),
      holidays: JSON.stringify(["2026-10-29"]),
      weekend_duty_days: JSON.stringify(["2026-10-03"]),
      config: JSON.stringify({
        mode: "priority",
        teachersPerDay: 2,
        pinnedAssignments: { "2026-10-01": ["T1"] },
        extraDays: ["2026-10-03"],
        daySpecificTeachers: { "2026-10-01": 3 },
      }),
    });

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    expect(result.current.generatedSchedule).toEqual({ "2026-10-01": ["T1"] });
    expect(result.current.holidays).toEqual(["2026-10-29"]);
    expect(result.current.weekendDutyDays).toEqual(["2026-10-03"]);
    expect(result.current.solverMode).toBe("priority");
    expect(result.current.teachersPerDay).toBe(2);
    expect(result.current.pinnedAssignments).toEqual({ "2026-10-01": ["T1"] });
    expect(result.current.extraDays).toEqual(["2026-10-03"]);
    expect(result.current.daySpecificTeachers).toEqual({ "2026-10-01": 3 });
  });

  it("loadScheduleData() falls back to 'fairness'/1/{}s when the stored config is missing optional fields", async () => {
    mockedDb.getSchedule.mockResolvedValue({
      id: "s1",
      year: 2026,
      month: 10,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: "{}",
    });

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    expect(result.current.solverMode).toBe("fairness");
    expect(result.current.teachersPerDay).toBe(1);
    expect(result.current.pinnedAssignments).toEqual({});
    expect(result.current.daySpecificTeachers).toEqual({});
  });

  it("handleToggleExtraDay() adds then removes a date from extraDays", () => {
    const { result } = renderHook(() => useScheduleState());

    act(() => result.current.handleToggleExtraDay("2026-10-15"));
    expect(result.current.extraDays).toContain("2026-10-15");

    act(() => result.current.handleToggleExtraDay("2026-10-15"));
    expect(result.current.extraDays).not.toContain("2026-10-15");
  });

  it("handleToggleDayEligibility() toggles holidays for weekdays and weekendDutyDays for weekends independently", () => {
    const { result } = renderHook(() => useScheduleState());

    act(() => result.current.handleToggleDayEligibility("2026-10-06", false)); // weekday -> holidays
    expect(result.current.holidays).toContain("2026-10-06");
    expect(result.current.weekendDutyDays).not.toContain("2026-10-06");

    act(() => result.current.handleToggleDayEligibility("2026-10-03", true)); // weekend -> weekendDutyDays
    expect(result.current.weekendDutyDays).toContain("2026-10-03");
    expect(result.current.holidays).not.toContain("2026-10-03");
  });

  it("handleClearPins() removes only the given date's pinned assignments", () => {
    const { result } = renderHook(() => useScheduleState());

    act(() => {
      result.current.setPinnedAssignments({
        "2026-10-01": ["T1"],
        "2026-10-02": ["T2"],
      });
    });

    act(() => result.current.handleClearPins("2026-10-01"));

    expect(result.current.pinnedAssignments).toEqual({ "2026-10-02": ["T2"] });
  });

  it("saveGeneratedScheduleToDb() serializes current state and a fresh UUID into a DbSchedule and persists it", async () => {
    mockedDb.saveSchedule.mockResolvedValue(undefined);
    const { result } = renderHook(() => useScheduleState());

    act(() => {
      result.current.setSelectedYear(2026);
      result.current.setSelectedMonth(11);
      result.current.setSolverMode("random");
      result.current.setTeachersPerDay(2);
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveGeneratedScheduleToDb({ "2026-11-01": ["T1", "T2"] });
    });

    expect(ok).toBe(true);
    expect(mockedDb.saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fresh-uuid",
        year: 2026,
        month: 11,
        assignments: JSON.stringify({ "2026-11-01": ["T1", "T2"] }),
      })
    );
    const savedConfig = JSON.parse(mockedDb.saveSchedule.mock.calls[0][0].config);
    expect(savedConfig.mode).toBe("random");
    expect(savedConfig.teachersPerDay).toBe(2);
  });

  it("saveGeneratedScheduleToDb() returns false and does not throw when persistence fails", async () => {
    mockedDb.saveSchedule.mockRejectedValue(new Error("db down"));
    const { result } = renderHook(() => useScheduleState());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saveGeneratedScheduleToDb({});
    });

    expect(ok).toBe(false);
  });

  // Dirty-tracking and the decoupled draft-save path.
  describe("isDirty / saveDraftToDb", () => {
    it("is false before any load has happened", () => {
      const { result } = renderHook(() => useScheduleState());
      expect(result.current.isDirty).toBe(false);
    });

    it("is false immediately after loadScheduleData() with no saved schedule (fresh defaults are the baseline, not 'dirty')", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      const { result } = renderHook(() => useScheduleState());

      await act(async () => {
        await result.current.loadScheduleData(2026, 9);
      });

      expect(result.current.isDirty).toBe(false);
    });

    it("is false immediately after loadScheduleData() hydrates a saved schedule", async () => {
      mockedDb.getSchedule.mockResolvedValue({
        id: "s1",
        year: 2026,
        month: 10,
        assignments: JSON.stringify({ "2026-10-01": ["T1"] }),
        holidays: JSON.stringify(["2026-10-29"]),
        weekend_duty_days: JSON.stringify(["2026-10-03"]),
        config: JSON.stringify({
          mode: "priority",
          teachersPerDay: 2,
          pinnedAssignments: { "2026-10-01": ["T1"] },
          extraDays: ["2026-10-03"],
          daySpecificTeachers: { "2026-10-01": 3 },
        }),
      });
      const { result } = renderHook(() => useScheduleState());

      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });

      expect(result.current.isDirty).toBe(false);
    });

    it("becomes true after changing a field post-load (e.g. toggling a holiday)", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      const { result } = renderHook(() => useScheduleState());

      await act(async () => {
        await result.current.loadScheduleData(2026, 9);
      });
      expect(result.current.isDirty).toBe(false);

      act(() => result.current.handleToggleDayEligibility("2026-09-07", false));

      expect(result.current.isDirty).toBe(true);
    });

    it("returns to false when a change is reverted, regardless of array insertion order (order-independent comparison)", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      const { result } = renderHook(() => useScheduleState());

      await act(async () => {
        await result.current.loadScheduleData(2026, 9);
      });

      act(() => result.current.handleToggleDayEligibility("2026-09-07", false)); // add to holidays
      expect(result.current.isDirty).toBe(true);

      act(() => result.current.handleToggleDayEligibility("2026-09-07", false)); // toggle back off
      expect(result.current.isDirty).toBe(false);
    });

    it("becomes true after changing solverMode/teachersPerDay even with no saved schedule for the month", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      const { result } = renderHook(() => useScheduleState());

      await act(async () => {
        await result.current.loadScheduleData(2026, 9);
      });
      expect(result.current.isDirty).toBe(false);

      act(() => result.current.setSolverMode("priority"));
      expect(result.current.isDirty).toBe(true);
    });

    it("saveDraftToDb() persists the current (possibly empty) generatedSchedule and clears isDirty", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      mockedDb.saveSchedule.mockResolvedValue(undefined);
      const { result } = renderHook(() => useScheduleState());

      await act(async () => {
        await result.current.loadScheduleData(2026, 9);
      });

      act(() => {
        result.current.setSelectedYear(2026);
        result.current.setSelectedMonth(9);
        result.current.handleToggleDayEligibility("2026-09-07", false);
      });
      expect(result.current.isDirty).toBe(true);

      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.saveDraftToDb();
      });

      expect(ok).toBe(true);
      // Draft save persists the CURRENT generatedSchedule, which is still {}
      // — an empty/never-generated assignments map is a valid draft state.
      expect(mockedDb.saveSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          year: 2026,
          month: 9,
          assignments: JSON.stringify({}),
        })
      );
      expect(result.current.isDirty).toBe(false);
    });

    it("saveGeneratedScheduleToDb() (the existing generate-flow auto-save) also clears isDirty, unchanged from before", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      mockedDb.saveSchedule.mockResolvedValue(undefined);
      const { result } = renderHook(() => useScheduleState());

      await act(async () => {
        await result.current.loadScheduleData(2026, 11);
      });
      act(() => result.current.handleToggleExtraDay("2026-11-05"));
      expect(result.current.isDirty).toBe(true);

      // Mirrors App.tsx's handleGenerateSchedule: it sets generatedSchedule
      // via setGeneratedSchedule() and THEN calls saveGeneratedScheduleToDb()
      // with the same result — both must happen for the post-save baseline to
      // match the in-memory generatedSchedule state exactly.
      act(() => result.current.setGeneratedSchedule({ "2026-11-02": ["T1"] }));
      await act(async () => {
        await result.current.saveGeneratedScheduleToDb({ "2026-11-02": ["T1"] });
      });

      expect(result.current.isDirty).toBe(false);
      expect(result.current.generatedSchedule).toEqual({ "2026-11-02": ["T1"] });
    });
  });

  describe("avoidConsecutiveDays (üst üste iki gün nöbet verme)", () => {
    it("defaults to off", () => {
      const { result } = renderHook(() => useScheduleState());
      expect(result.current.avoidConsecutiveDays).toBe(false);
    });

    it("hydrates from the stored config", async () => {
      mockedDb.getSchedule.mockResolvedValue({
        id: "s1",
        year: 2026,
        month: 10,
        assignments: JSON.stringify({}),
        holidays: JSON.stringify([]),
        weekend_duty_days: JSON.stringify([]),
        config: JSON.stringify({ mode: "fairness", avoidConsecutiveDays: true }),
      });

      const { result } = renderHook(() => useScheduleState());
      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });

      expect(result.current.avoidConsecutiveDays).toBe(true);
    });

    it("stays off for months saved before the flag existed", async () => {
      mockedDb.getSchedule.mockResolvedValue({
        id: "s1",
        year: 2026,
        month: 10,
        assignments: JSON.stringify({}),
        holidays: JSON.stringify([]),
        weekend_duty_days: JSON.stringify([]),
        config: JSON.stringify({ mode: "priority", respectTargets: true }),
      });

      const { result } = renderHook(() => useScheduleState());
      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });

      expect(result.current.avoidConsecutiveDays).toBe(false);
    });

    it("is persisted into the saved config blob", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      mockedDb.saveSchedule.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useScheduleState());
      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });
      act(() => {
        result.current.setAvoidConsecutiveDays(true);
      });
      await act(async () => {
        await result.current.saveDraftToDb();
      });

      const saved = mockedDb.saveSchedule.mock.calls[0][0];
      expect(JSON.parse(saved.config).avoidConsecutiveDays).toBe(true);
    });

    it("counts as an unsaved change, and saving clears it", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      mockedDb.saveSchedule.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useScheduleState());
      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });
      expect(result.current.isDirty).toBe(false);

      act(() => {
        result.current.setAvoidConsecutiveDays(true);
      });
      expect(result.current.isDirty, "Kural değişikliği kaydedilmemiş sayılmalı").toBe(true);

      await act(async () => {
        await result.current.saveDraftToDb();
      });
      expect(result.current.isDirty).toBe(false);
    });
  });

  describe("respectTargets (aylık hedefleri kesinlikle aşma)", () => {
    it("defaults to off", () => {
      const { result } = renderHook(() => useScheduleState());
      expect(result.current.respectTargets).toBe(false);
    });

    it("hydrates from the stored config", async () => {
      mockedDb.getSchedule.mockResolvedValue({
        id: "s1",
        year: 2026,
        month: 10,
        assignments: JSON.stringify({}),
        holidays: JSON.stringify([]),
        weekend_duty_days: JSON.stringify([]),
        config: JSON.stringify({ mode: "fairness", respectTargets: true }),
      });

      const { result } = renderHook(() => useScheduleState());
      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });

      expect(result.current.respectTargets).toBe(true);
    });

    it("stays off for months saved before the flag existed", async () => {
      mockedDb.getSchedule.mockResolvedValue({
        id: "s1",
        year: 2026,
        month: 10,
        assignments: JSON.stringify({}),
        holidays: JSON.stringify([]),
        weekend_duty_days: JSON.stringify([]),
        config: JSON.stringify({ mode: "priority", teachersPerDay: 2 }),
      });

      const { result } = renderHook(() => useScheduleState());
      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });

      expect(result.current.respectTargets).toBe(false);
    });

    it("is persisted into the saved config blob", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      mockedDb.saveSchedule.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useScheduleState());
      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });
      act(() => {
        result.current.setRespectTargets(true);
      });
      await act(async () => {
        await result.current.saveDraftToDb();
      });

      const saved = mockedDb.saveSchedule.mock.calls[0][0];
      expect(JSON.parse(saved.config).respectTargets).toBe(true);
    });

    it("counts as an unsaved change, and saving clears it", async () => {
      mockedDb.getSchedule.mockResolvedValue(null);
      mockedDb.saveSchedule.mockResolvedValue(undefined as never);

      const { result } = renderHook(() => useScheduleState());
      await act(async () => {
        await result.current.loadScheduleData(2026, 10);
      });
      expect(result.current.isDirty).toBe(false);

      act(() => {
        result.current.setRespectTargets(true);
      });
      expect(result.current.isDirty).toBe(true);

      await act(async () => {
        await result.current.saveDraftToDb();
      });
      expect(result.current.isDirty).toBe(false);
    });
  });
});

describe("aylık nöbet grupları ve hedefleri", () => {
  it("kaydedilmiş aydan grupları ve hedefleri yükler", async () => {
    vi.mocked(getSchedule).mockResolvedValue({
      id: "s1",
      year: 2026,
      month: 10,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: JSON.stringify({
        mode: "fairness",
        teachersPerDay: 1,
        pinnedAssignments: {},
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
        monthlyTargets: { T1: 5 },
      }),
    });

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    expect(result.current.partnerGroups).toEqual([
      { id: "g1", memberIds: ["T1", "T2"], goalDays: 2 },
    ]);
    expect(result.current.monthlyTargets).toEqual({ T1: 5 });
  });

  it("bu anahtarları içermeyen eski ayları boş olarak yükler", async () => {
    vi.mocked(getSchedule).mockResolvedValue({
      id: "s1",
      year: 2026,
      month: 10,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: JSON.stringify({ mode: "fairness", teachersPerDay: 1, pinnedAssignments: {} }),
    });

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    expect(result.current.partnerGroups).toEqual([]);
    expect(result.current.monthlyTargets).toEqual({});
  });

  it("grup eklemek ayı değişmiş sayar", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setPartnerGroups([{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }]);
    });
    expect(result.current.isDirty).toBe(true);
  });

  it("aylık hedef değiştirmek ayı değişmiş sayar", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    act(() => {
      result.current.setMonthlyTargets({ T1: 3 });
    });
    expect(result.current.isDirty).toBe(true);
  });

  it("grupları ve hedefleri ay kaydına yazar", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    act(() => {
      result.current.setPartnerGroups([{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }]);
      result.current.setMonthlyTargets({ T1: 3 });
    });
    await act(async () => {
      await result.current.saveDraftToDb();
    });

    const saved = vi.mocked(saveSchedule).mock.calls.at(-1)![0];
    const config = JSON.parse(saved.config);
    expect(config.partnerGroups).toEqual([{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }]);
    expect(config.monthlyTargets).toEqual({ T1: 3 });
  });

  it("başka bir aydan grupları yeni kimliklerle kopyalar", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    vi.mocked(getAllSchedules).mockResolvedValue([
      {
        id: "s1",
        year: 2026,
        month: 9,
        assignments: "{}",
        holidays: "[]",
        weekend_duty_days: "[]",
        config: JSON.stringify({
          partnerGroups: [{ id: "old", memberIds: ["T1", "T2"], goalDays: 2 }],
          monthlyTargets: { T1: 5 },
        }),
      },
    ]);

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
      await result.current.copyPartnersFromMonth(2026, 9, ["T1", "T2"]);
    });

    expect(result.current.partnerGroups).toHaveLength(1);
    expect(result.current.partnerGroups[0].memberIds).toEqual(["T1", "T2"]);
    expect(result.current.partnerGroups[0].goalDays).toBe(2);
    expect(result.current.partnerGroups[0].id).not.toBe("old");
    expect(result.current.monthlyTargets).toEqual({ T1: 5 });
  });

  it("kopyalarken kadroda olmayan üyeleri atar ve tek üye kalan grubu almaz", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    vi.mocked(getAllSchedules).mockResolvedValue([
      {
        id: "s1",
        year: 2026,
        month: 9,
        assignments: "{}",
        holidays: "[]",
        weekend_duty_days: "[]",
        config: JSON.stringify({
          partnerGroups: [
            { id: "old1", memberIds: ["T1", "TX"], goalDays: 2 },
            { id: "old2", memberIds: ["T1", "T2", "TX"], goalDays: 1 },
          ],
          monthlyTargets: { T1: 5, TX: 9 },
        }),
      },
    ]);

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
      await result.current.copyPartnersFromMonth(2026, 9, ["T1", "T2"]);
    });

    expect(result.current.partnerGroups).toHaveLength(1);
    expect(result.current.partnerGroups[0].memberIds).toEqual(["T1", "T2"]);
    expect(result.current.monthlyTargets).toEqual({ T1: 5 });
  });
});
