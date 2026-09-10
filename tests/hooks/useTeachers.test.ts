import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTeachers } from "../../src/hooks/useTeachers";
import * as db from "../../src/db";

// db.ts's real SQL semantics are covered separately in tests/db.test.ts; here we
// mock the db module entirely so these tests isolate the hook's own state-machine
// logic (form state, selection, edit/delete flows) from persistence concerns.
vi.mock("../../src/db", () => ({
  getTeachers: vi.fn(),
  saveTeacher: vi.fn(),
  deleteTeacher: vi.fn(),
}));

const mockedDb = vi.mocked(db);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(crypto, "randomUUID").mockReturnValue("new-uuid" as `${string}-${string}-${string}-${string}-${string}`);
});

describe("useTeachers", () => {
  it("loadTeachers() populates the list and auto-selects the first teacher when none selected", async () => {
    mockedDb.getTeachers.mockResolvedValue([
      { id: "T1", name: "Ahmet", target_hours: 4, priority: 1 },
      { id: "T2", name: "Zeynep", target_hours: 5, priority: 2 },
    ]);

    const { result } = renderHook(() => useTeachers());

    await act(async () => {
      await result.current.loadTeachers();
    });

    expect(result.current.teachers).toHaveLength(2);
    expect(result.current.selectedTeacherId).toBe("T1");
  });

  it("loadTeachers() swallows errors and returns an empty list", async () => {
    mockedDb.getTeachers.mockRejectedValue(new Error("db down"));
    const { result } = renderHook(() => useTeachers());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.loadTeachers();
    });

    expect(returned).toEqual([]);
    expect(result.current.teachers).toEqual([]);
  });

  // Minimal context for tests that only care about the save happening at
  // all, not about monthly-target enforcement (covered separately below).
  const emptyCtx = () => ({
    partnerGroups: [],
    monthlyTargets: {},
    applyMonthlyTarget: vi.fn(),
  });

  it("handleSaveTeacherSubmit() rejects an empty/whitespace name without calling saveTeacher", async () => {
    const { result } = renderHook(() => useTeachers());
    act(() => {
      result.current.setTeacherName("   ");
    });

    let submitResult: boolean | undefined;
    await act(async () => {
      submitResult = await result.current.handleSaveTeacherSubmit(undefined, emptyCtx());
    });

    expect(submitResult).toBe(false);
    expect(mockedDb.saveTeacher).not.toHaveBeenCalled();
  });

  it("handleSaveTeacherSubmit() creates a new teacher with a fresh UUID and resets the form", async () => {
    mockedDb.saveTeacher.mockResolvedValue(undefined);
    mockedDb.getTeachers.mockResolvedValue([
      { id: "new-uuid", name: "Ahmet Yılmaz", target_hours: 6, priority: 3 },
    ]);

    const { result } = renderHook(() => useTeachers());
    act(() => {
      result.current.setTeacherName("Ahmet Yılmaz");
      result.current.setTeacherTarget(6);
      result.current.setTeacherPriority(3);
    });

    await act(async () => {
      await result.current.handleSaveTeacherSubmit(undefined, emptyCtx());
    });

    expect(mockedDb.saveTeacher).toHaveBeenCalledWith({
      id: "new-uuid",
      name: "Ahmet Yılmaz",
      target_hours: 6,
      priority: 3,
    });
    // Form resets after a successful save
    expect(result.current.teacherName).toBe("");
    expect(result.current.teacherTarget).toBe(4);
    expect(result.current.teacherPriority).toBe(1);
    expect(result.current.editingTeacherId).toBeNull();
  });

  it("handleSaveTeacherSubmit() reuses editingTeacherId (update, not insert) when editing", async () => {
    mockedDb.saveTeacher.mockResolvedValue(undefined);
    mockedDb.getTeachers.mockResolvedValue([]);

    const { result } = renderHook(() => useTeachers());
    act(() => {
      result.current.handleEditTeacherClick({
        id: "existing-id",
        name: "Old Name",
        target_hours: 2,
        priority: 1,
      });
      result.current.setTeacherName("New Name");
    });

    await act(async () => {
      await result.current.handleSaveTeacherSubmit(undefined, emptyCtx());
    });

    expect(mockedDb.saveTeacher).toHaveBeenCalledWith(
      expect.objectContaining({ id: "existing-id", name: "New Name" })
    );
  });

  it("handleDeleteTeacherClick() asks for confirmation and, if declined, does not delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useTeachers());

    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.handleDeleteTeacherClick("T1");
    });

    expect(returned).toBe(false);
    expect(mockedDb.deleteTeacher).not.toHaveBeenCalled();
  });

  it("handleDeleteTeacherClick() deletes and, if the deleted teacher was selected, re-selects the new first teacher", async () => {
    mockedDb.deleteTeacher.mockResolvedValue(undefined);
    mockedDb.getTeachers
      .mockResolvedValueOnce([
        { id: "T1", name: "Ahmet", target_hours: 4, priority: 1 },
        { id: "T2", name: "Zeynep", target_hours: 5, priority: 2 },
      ])
      .mockResolvedValueOnce([{ id: "T2", name: "Zeynep", target_hours: 5, priority: 2 }]);

    const { result } = renderHook(() => useTeachers());
    await act(async () => {
      await result.current.loadTeachers();
    });
    expect(result.current.selectedTeacherId).toBe("T1");

    await act(async () => {
      await result.current.handleDeleteTeacherClick("T1");
    });

    expect(mockedDb.deleteTeacher).toHaveBeenCalledWith("T1");
    await waitFor(() => expect(result.current.selectedTeacherId).toBe("T2"));
  });
});

describe("aylık nöbet hedefi", () => {
  // Note: adapted from the task brief to this file's existing mocking
  // convention (mockedDb.getTeachers rather than a standalone vi.mocked
  // import), since this file mocks the whole db module via `vi.mock`.
  const ctx = (overrides = {}) => ({
    partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 3 }],
    monthlyTargets: {},
    applyMonthlyTarget: vi.fn(),
    ...overrides,
  });

  it("kaydederken hedefi bu aya yazar", async () => {
    mockedDb.getTeachers.mockResolvedValue([
      { id: "T1", name: "Ali", target_hours: 4, priority: 1 },
    ]);
    const { result } = renderHook(() => useTeachers());
    await act(async () => {
      await result.current.loadTeachers();
    });

    act(() => {
      result.current.handleEditTeacherClick({ id: "T1", name: "Ali", target_hours: 4, priority: 1 });
      result.current.setTeacherTarget(5);
    });

    const context = ctx();
    await act(async () => {
      await result.current.handleSaveTeacherSubmit(undefined, context);
    });

    expect(context.applyMonthlyTarget).toHaveBeenCalledWith("T1", 5);
  });

  it("grup taahhüdünün altına inen hedefi reddeder", async () => {
    mockedDb.getTeachers.mockResolvedValue([
      { id: "T1", name: "Ali", target_hours: 4, priority: 1 },
      { id: "T2", name: "Ayşe", target_hours: 4, priority: 1 },
    ]);
    const { result } = renderHook(() => useTeachers());
    await act(async () => {
      await result.current.loadTeachers();
    });

    act(() => {
      result.current.handleEditTeacherClick({ id: "T1", name: "Ali", target_hours: 4, priority: 1 });
      result.current.setTeacherTarget(2); // g1 3 gün istiyor
    });

    const context = ctx();
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.handleSaveTeacherSubmit(undefined, context);
    });

    expect(saved).toBe(false);
    expect(context.applyMonthlyTarget).not.toHaveBeenCalled();
    expect(result.current.teacherError).toMatch(/Ali/);
  });
});
