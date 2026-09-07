import { describe, it, expect, beforeEach } from "vitest";
import { solve, Teacher, AvailabilityStatus, SolverConfig } from "../src/solver/index";

// Migrated from the original hand-rolled tsx-executed assert script onto vitest.
// Every assertion/condition below is preserved verbatim from the pre-migration
// version (git history: tests/solver.test.ts) — only the runner/harness changed
// (vitest describe/it/expect instead of a custom assert() + top-level try/catch).

const mockTeachers: Teacher[] = [
  { id: "T1", name: "Ahmet Yılmaz", target_hours: 4, priority: 3 }, // High Priority
  { id: "T2", name: "Ayşe Kaya", target_hours: 4, priority: 1 }, // Standard
  { id: "T3", name: "Mehmet Demir", target_hours: 2, priority: 1 }, // Standard, low target
  { id: "T4", name: "Zeynep Çelik", target_hours: 4, priority: 2 }, // Medium Priority
];

const mockDates = [
  "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",
  "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14",
]; // 10 days

let mockAvailabilities: Record<string, Record<string, AvailabilityStatus>>;

function resetAvailabilities() {
  mockAvailabilities = { T1: {}, T2: {}, T3: {}, T4: {} };
  for (const tId in mockAvailabilities) {
    for (const d of mockDates) {
      mockAvailabilities[tId][d] = "available";
    }
  }
}

beforeEach(() => {
  resetAvailabilities();
});

describe("Nöbet Çözücü Motor Testleri (solver)", () => {
  it("Test 1: Temel Çözme ve İzin Kısıtları", () => {
    // T1 is unavailable on 2026-10-01
    mockAvailabilities["T1"]["2026-10-01"] = "unavailable";
    // T2 prefers 2026-10-02
    mockAvailabilities["T2"]["2026-10-02"] = "preferred";

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success, "Temel çözme başarılı olmalı").toBe(true);
    expect(result.schedule, "Program tanımlı olmalı").toBeDefined();

    const schedule = result.schedule!;
    // Ahmet (T1) should NOT be scheduled on Oct 1st
    expect(
      schedule["2026-10-01"].includes("T1"),
      "T1 izinli gününde nöbete yazılmamalı"
    ).toBe(false);
  });

  it("Test 2: Adalet Öncelikli Dağıtım (Fairness Mode)", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);
    expect(result.success, "Eşit Dağıtım çözme başarılı olmalı").toBe(true);

    const schedule = result.schedule!;
    const counts: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
    for (const date of mockDates) {
      for (const tId of schedule[date]) {
        counts[tId]++;
      }
    }

    // Since there are 10 days, 1 teacher per day, total 10 slots.
    // T3 has target hours 2, others have 4.
    // Fairness should distribute loads relatively evenly.
    // T3 should have at most 2 assignments, others should have around 2-3 assignments.
    expect(counts["T3"] <= 2, "Mehmet (T3) hedef saati olan 2'yi aşmamalı").toBe(true);
    expect(counts["T1"] >= 2 && counts["T1"] <= 3, "T1 dengeli nöbet almalı").toBe(true);
    expect(counts["T2"] >= 2 && counts["T2"] <= 3, "T2 dengeli nöbet almalı").toBe(true);
  });

  it("Test 3: Manuel Sabitleme (Strict Locking / Pinning Constraint)", () => {
    const config: SolverConfig = {
      mode: "strict",
      teachersPerDay: 1,
      pinnedAssignments: {
        "2026-10-05": ["T1"], // Pin Ahmet (T1) on Oct 5th
        "2026-10-06": ["T3"], // Pin Mehmet (T3) on Oct 6th
      },
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);
    expect(result.success, "Sabitleme modunda çözme başarılı olmalı").toBe(true);

    const schedule = result.schedule!;
    expect(schedule["2026-10-05"].includes("T1"), "Oct 5th sabitlemesi korunmalı").toBe(true);
    expect(schedule["2026-10-06"].includes("T3"), "Oct 6th sabitlemesi korunmalı").toBe(true);
  });

  it("Test 4: Çözümsüz Sıkışma Teşhisi (Unsolvable Case Bottleneck Diagnostic)", () => {
    // Mark ALL teachers as unavailable on 2026-10-07
    for (const t of mockTeachers) {
      mockAvailabilities[t.id]["2026-10-07"] = "unavailable";
    }

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);
    expect(result.success, "Çözümsüz durumda solver hata vermeli").toBe(false);
    expect(result.error_date, "Hata kaynağı tarih 2026-10-07 olarak tespit edilmeli").toBe(
      "2026-10-07"
    );
    expect(
      !!result.error_message?.includes("7 Ekim 2026"),
      "Hata mesajı Türkçe tarih içermeli"
    ).toBe(true);
  });

  it("Test 5: Gün Bazlı Öğretmen Sayısı Varyasyonları Override", () => {
    // We set day-specific required teacher count overrides
    const dayOverrides: Record<string, number> = {
      "2026-10-01": 2, // Oct 1st requires 2 teachers
      "2026-10-02": 3, // Oct 2nd requires 3 teachers
      // others default to 1
    };

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: dayOverrides, // Pass the record override map
      pinnedAssignments: {},
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);
    expect(
      result.success,
      "Gün bazlı öğretmen sayısı varyasyonları ile çözme başarılı olmalı"
    ).toBe(true);

    const schedule = result.schedule!;

    // Verify required teacher count overrides are respected on each day
    expect(schedule["2026-10-01"].length, "1 Ekim için gereken öğretmen sayısı 2 olmalı").toBe(2);
    expect(schedule["2026-10-02"].length, "2 Ekim için gereken öğretmen sayısı 3 olmalı").toBe(3);
    expect(
      schedule["2026-10-05"].length,
      "Normal günler için gereken öğretmen sayısı varsayılan 1 olmalı"
    ).toBe(1);
    expect(
      schedule["2026-10-09"].length,
      "Normal günler için gereken öğretmen sayısı varsayılan 1 olmalı"
    ).toBe(1);
  });
});
