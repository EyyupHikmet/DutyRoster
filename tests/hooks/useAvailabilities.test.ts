import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAvailabilities } from "../../src/hooks/useAvailabilities";
import * as db from "../../src/db";

vi.mock("../../src/db", () => ({
  getAvailabilities: vi.fn(),
  saveAvailability: vi.fn(),
}));

const mockedDb = vi.mocked(db);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAvailabilities", () => {
  it("loadAvailabilities() reshapes the flat DB rows into a teacherId -> date -> status map", async () => {
    mockedDb.getAvailabilities.mockResolvedValue([
      { teacher_id: "T1", date: "2026-10-01", status: "preferred" },
      { teacher_id: "T1", date: "2026-10-02", status: "unavailable" },
      { teacher_id: "T2", date: "2026-10-01", status: "available" },
    ]);

    const { result } = renderHook(() => useAvailabilities());
    await act(async () => {
      await result.current.loadAvailabilities();
    });

    expect(result.current.availabilities).toEqual({
      T1: { "2026-10-01": "preferred", "2026-10-02": "unavailable" },
      T2: { "2026-10-01": "available" },
    });
  });

  it("loadAvailabilities() swallows errors and returns an empty map", async () => {
    mockedDb.getAvailabilities.mockRejectedValue(new Error("db down"));
    const { result } = renderHook(() => useAvailabilities());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.loadAvailabilities();
    });

    expect(returned).toEqual({});
  });

  it("handleCycleAvailability() cycles available -> preferred -> unavailable -> available and persists each step", async () => {
    mockedDb.saveAvailability.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAvailabilities());

    let step1: string | undefined;
    await act(async () => {
      step1 = await result.current.handleCycleAvailability("T1", "2026-10-01");
    });
    expect(step1).toBe("preferred");
    expect(result.current.availabilities.T1["2026-10-01"]).toBe("preferred");

    let step2: string | undefined;
    await act(async () => {
      step2 = await result.current.handleCycleAvailability("T1", "2026-10-01");
    });
    expect(step2).toBe("unavailable");

    let step3: string | undefined;
    await act(async () => {
      step3 = await result.current.handleCycleAvailability("T1", "2026-10-01");
    });
    expect(step3).toBe("available");

    expect(mockedDb.saveAvailability).toHaveBeenCalledTimes(3);
    expect(mockedDb.saveAvailability).toHaveBeenNthCalledWith(1, {
      teacher_id: "T1",
      date: "2026-10-01",
      status: "preferred",
    });
  });

  it("handleCycleAvailability() with no selected teacher id returns 'available' and does not save", async () => {
    const { result } = renderHook(() => useAvailabilities());

    let returned: string | undefined;
    await act(async () => {
      returned = await result.current.handleCycleAvailability("", "2026-10-01");
    });

    expect(returned).toBe("available");
    expect(mockedDb.saveAvailability).not.toHaveBeenCalled();
  });

  it("handleCycleAvailability() on save failure returns the pre-cycle status but does NOT roll back the optimistic UI state (real gap, not asserted as a bug fix — see Specialist Log)", async () => {
    mockedDb.saveAvailability.mockRejectedValue(new Error("db down"));
    const { result } = renderHook(() => useAvailabilities());

    let returned: string | undefined;
    await act(async () => {
      returned = await result.current.handleCycleAvailability("T1", "2026-10-01");
    });

    // Current status defaults to "available", so the attempted next status is "preferred".
    // The hook's return value correctly reports the pre-cycle status ("available") on failure...
    expect(returned).toBe("available");
    // ...but setAvailabilities() ran optimistically BEFORE the failed save and is never rolled
    // back in the catch block, so the in-memory state is left showing "preferred" even though
    // nothing was actually persisted. Documented here as observed behavior, not a desired one.
    expect(result.current.availabilities.T1["2026-10-01"]).toBe("preferred");
  });
});
