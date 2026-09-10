import { describe, it, expect, beforeEach } from "vitest";
import { solve, Teacher, AvailabilityStatus, SolverConfig } from "../src/solver/index";
import { shiftDate } from "../src/utils/dateUtils";

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

  // --- Aylık hedefleri kesinlikle aşma (respectTargets) ---
  //
  // Without this flag `target_hours` is only a sort key: the backtracker has to
  // fill EVERY slot or fail outright, so it happily assigns a teacher a 5th
  // duty when their target is 2. With the flag on, the target becomes a hard
  // constraint and days are allowed to stay open instead.

  it("Test 6: respectTargets kapalıyken hedefler aşılabilir (mevcut davranış korunur)", () => {
    // 4 teachers, targets 4/4/2/4 = 14 slots against 10 days is plenty, so
    // force scarcity: only T3 (target 2) may work at all.
    for (const d of mockDates) {
      mockAvailabilities["T1"][d] = "unavailable";
      mockAvailabilities["T2"][d] = "unavailable";
      mockAvailabilities["T4"][d] = "unavailable";
    }

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success, "Bayrak kapalıyken çözüm bulunmalı").toBe(true);
    const schedule = result.schedule!;
    for (const d of mockDates) {
      expect(schedule[d], `${d} günü doldurulmuş olmalı`).toEqual(["T3"]);
    }
    expect(result.unfilled, "Bayrak kapalıyken boş gün raporu olmamalı").toEqual([]);
  });

  it("Test 7: respectTargets açıkken hiçbir öğretmen aylık hedefini aşmaz", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      respectTargets: true,
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success, "Kısmi de olsa sonuç dönmeli").toBe(true);
    const schedule = result.schedule!;

    const counts: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
    for (const d of mockDates) {
      for (const id of schedule[d] ?? []) counts[id]++;
    }

    for (const t of mockTeachers) {
      expect(
        counts[t.id] <= t.target_hours,
        `${t.name} hedefi ${t.target_hours} olmasına rağmen ${counts[t.id]} nöbet almış`
      ).toBe(true);
    }
  });

  it("Test 8: Kapasite yetmediğinde ay tamamen boş dönmez, günler açık kalır", () => {
    // The user's reported scenario, scaled down: every teacher's target is 2,
    // so total capacity is 8 duties against 10 days needing 1 each.
    const lowTargets: Teacher[] = mockTeachers.map((t) => ({ ...t, target_hours: 2 }));

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      respectTargets: true,
    };

    const result = solve(mockDates, lowTargets, mockAvailabilities, config);

    expect(result.success, "Kapasite yetmese de kısmi çizelge dönmeli").toBe(true);
    const schedule = result.schedule!;

    const filled = mockDates.filter((d) => (schedule[d] ?? []).length === 1);
    const empty = mockDates.filter((d) => (schedule[d] ?? []).length === 0);

    expect(filled.length, "Kapasite kadar gün doldurulmalı").toBe(8);
    expect(empty.length, "Kalan günler boş bırakılmalı").toBe(2);

    // Every open slot must be reported, so the UI can warn about it.
    expect(result.unfilled, "Boş gün raporu dönmeli").toBeDefined();
    expect(result.unfilled!.length).toBe(2);
    for (const gap of result.unfilled!) {
      expect(empty).toContain(gap.date);
      expect(gap.required).toBe(1);
      expect(gap.assigned).toBe(0);
    }
  });

  it("Test 9: Kısmi doldurma slot bazındadır, gün bazında değil", () => {
    // Oct 1st needs 3 teachers but only T1 and T2 are available that day —
    // the day must keep those 2 rather than being abandoned entirely.
    mockAvailabilities["T3"]["2026-10-01"] = "unavailable";
    mockAvailabilities["T4"]["2026-10-01"] = "unavailable";

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: { "2026-10-01": 3 },
      pinnedAssignments: {},
      respectTargets: true,
    };

    const result = solve(["2026-10-01"], mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    expect(result.schedule!["2026-10-01"].length, "Gün 2 nöbetçiyle kalmalı").toBe(2);
    expect(result.unfilled).toEqual([
      { date: "2026-10-01", required: 3, assigned: 2 },
    ]);
  });

  it("Test 10: Manuel sabitleme hedef sınırını geçersiz kılar", () => {
    // T3's target is 2, but the principal pinned them onto 3 days by hand.
    // An explicit pin is a decision, not a suggestion — it must be honoured,
    // and the cap then blocks any FURTHER duty for that teacher.
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {
        "2026-10-01": ["T3"],
        "2026-10-02": ["T3"],
        "2026-10-05": ["T3"],
      },
      respectTargets: true,
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    expect(schedule["2026-10-01"]).toEqual(["T3"]);
    expect(schedule["2026-10-02"]).toEqual(["T3"]);
    expect(schedule["2026-10-05"]).toEqual(["T3"]);

    // ...but T3 gets nothing beyond the three pins.
    const t3Count = mockDates.filter((d) => (schedule[d] ?? []).includes("T3")).length;
    expect(t3Count, "T3 sabitlenen 3 günün ötesine geçmemeli").toBe(3);
  });

  it("Test 11: Hedefi 0 olan öğretmen respectTargets açıkken hiç nöbet almaz", () => {
    const withZero: Teacher[] = mockTeachers.map((t) =>
      t.id === "T1" ? { ...t, target_hours: 0 } : t
    );

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      respectTargets: true,
    };

    const result = solve(mockDates, withZero, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const t1Count = mockDates.filter((d) => (result.schedule![d] ?? []).includes("T1")).length;
    expect(t1Count, "Hedefi 0 olan öğretmen nöbet almamalı").toBe(0);
  });

  // --- Üst üste iki gün nöbet verme (avoidConsecutiveDays) ---
  //
  // A second hard rule, orthogonal to respectTargets: a teacher must never be
  // on duty on two ADJACENT CALENDAR days. A weekend or a holiday in between
  // counts as a real gap, so Friday→Monday and Tuesday→Thursday-over-a-holiday
  // both stay legal.

  it("Test 12: avoidConsecutiveDays kapalıyken ardışık günler serbesttir (mevcut davranış korunur)", () => {
    // "Kıdem Öncelikli" always reaches for the highest-priority teacher first,
    // so T1 (priority 3) sweeps the whole month — including the adjacent
    // 1–2 October pair. This is the behavior the new flag has to change, and
    // the behavior it must leave alone when off.
    const config: SolverConfig = {
      mode: "priority",
      teachersPerDay: 1,
      pinnedAssignments: {},
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    expect(schedule["2026-10-01"], "1 Ekim en kıdemliye gitmeli").toEqual(["T1"]);
    expect(schedule["2026-10-02"], "Bayrak kapalıyken ertesi gün de aynı kişiye verilebilir").toEqual(["T1"]);
  });

  it("Test 13: avoidConsecutiveDays açıkken hiçbir öğretmen ardışık iki gün nöbet tutmaz", () => {
    // Same priority-driven setup as Test 12, which without the flag hands T1
    // every single day. With it on, nobody may take two adjacent dates.
    const config: SolverConfig = {
      mode: "priority",
      teachersPerDay: 1,
      pinnedAssignments: {},
      avoidConsecutiveDays: true,
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success, "4 öğretmenle 10 gün rahatlıkla çözülmeli").toBe(true);
    const schedule = result.schedule!;

    expect(schedule["2026-10-02"], "2 Ekim artık T1'e verilemez").not.toContain("T1");

    for (const d of mockDates) {
      const next = shiftDate(d, 1);
      for (const id of schedule[d] ?? []) {
        expect(
          (schedule[next] ?? []).includes(id),
          `${id} hem ${d} hem ${next} gününde nöbetçi yazılmış`
        ).toBe(false);
      }
    }
  });

  it("Test 14: Cuma–Pazartesi ardışık sayılmaz, aradaki hafta sonu boşluktur", () => {
    // 2 Oct 2026 is a Friday, 5 Oct is the following Monday. Only T1 can work,
    // so the rule must allow both days or the month cannot be filled.
    const dates = ["2026-10-02", "2026-10-05"];
    for (const d of dates) {
      mockAvailabilities["T2"][d] = "unavailable";
      mockAvailabilities["T3"][d] = "unavailable";
      mockAvailabilities["T4"][d] = "unavailable";
    }

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      avoidConsecutiveDays: true,
    };

    const result = solve(dates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    expect(result.schedule!["2026-10-02"]).toEqual(["T1"]);
    expect(result.schedule!["2026-10-05"]).toEqual(["T1"]);
    expect(result.unfilled).toEqual([]);
  });

  it("Test 15: Aradaki tatil günü boşluk sayılır", () => {
    // 7 Oct is not a duty day at all, so 6 Oct and 8 Oct are not back to back.
    const dates = ["2026-10-06", "2026-10-08"];
    for (const d of dates) {
      mockAvailabilities["T2"][d] = "unavailable";
      mockAvailabilities["T3"][d] = "unavailable";
      mockAvailabilities["T4"][d] = "unavailable";
    }

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      avoidConsecutiveDays: true,
    };

    const result = solve(dates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    expect(result.schedule!["2026-10-06"]).toEqual(["T1"]);
    expect(result.schedule!["2026-10-08"]).toEqual(["T1"]);
  });

  it("Test 16: Manuel sabitleme korunur ama komşu günlerini kapatır", () => {
    // Like the hard target cap, an explicit pin is the principal's decision:
    // the rule never removes it, it only stops the solver ADDING a duty on
    // either side of it. T3 is the only teacher who can work 5 and 7 October,
    // so with the pin on the 6th both neighbours must go unfilled.
    const dates = ["2026-10-05", "2026-10-06", "2026-10-07"];
    for (const d of ["2026-10-05", "2026-10-07"]) {
      mockAvailabilities["T1"][d] = "unavailable";
      mockAvailabilities["T2"][d] = "unavailable";
      mockAvailabilities["T4"][d] = "unavailable";
    }

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: { "2026-10-06": ["T3"] },
      avoidConsecutiveDays: true,
    };

    const result = solve(dates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    expect(schedule["2026-10-06"], "Sabitlenen gün korunmalı").toEqual(["T3"]);
    expect(schedule["2026-10-05"], "Sabitlemenin bir öncesi kapalı").toEqual([]);
    expect(schedule["2026-10-07"], "Sabitlemenin bir sonrası kapalı").toEqual([]);
    expect(result.unfilled!.map((g) => g.date).sort()).toEqual(["2026-10-05", "2026-10-07"]);
  });

  it("Test 17: Kural yüzünden doldurulamayan gün hata vermez, açık kalır ve raporlanır", () => {
    // Two adjacent days, exactly one eligible teacher. With the rule on this is
    // unsatisfiable — but that must degrade to an open day plus a warning, the
    // way the hard target cap does, not to a red "Sıkışma Hatası".
    const dates = ["2026-10-01", "2026-10-02"];
    for (const d of dates) {
      mockAvailabilities["T2"][d] = "unavailable";
      mockAvailabilities["T3"][d] = "unavailable";
      mockAvailabilities["T4"][d] = "unavailable";
    }

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      avoidConsecutiveDays: true,
    };

    const result = solve(dates, mockTeachers, mockAvailabilities, config);

    expect(result.success, "Kısmi de olsa sonuç dönmeli").toBe(true);
    expect(result.error_message, "Sıkışma hatası verilmemeli").toBeUndefined();

    const schedule = result.schedule!;
    const filled = dates.filter((d) => (schedule[d] ?? []).length === 1);
    const empty = dates.filter((d) => (schedule[d] ?? []).length === 0);
    expect(filled.length, "İki günden yalnız biri doldurulabilir").toBe(1);
    expect(empty.length).toBe(1);

    expect(result.unfilled!.length).toBe(1);
    expect(result.unfilled![0]).toEqual({ date: empty[0], required: 1, assigned: 0 });
  });

  it("Test 18: İki katı kural birlikte çalışır — ne hedef aşılır ne ardışık gün verilir", () => {
    const config: SolverConfig = {
      mode: "priority",
      teachersPerDay: 1,
      pinnedAssignments: {},
      respectTargets: true,
      avoidConsecutiveDays: true,
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;

    const counts: Record<string, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
    for (const d of mockDates) {
      for (const id of schedule[d] ?? []) counts[id]++;
    }
    for (const t of mockTeachers) {
      expect(
        counts[t.id] <= t.target_hours,
        `${t.name} hedefi ${t.target_hours} iken ${counts[t.id]} nöbet almış`
      ).toBe(true);
    }

    for (const d of mockDates) {
      const next = shiftDate(d, 1);
      for (const id of schedule[d] ?? []) {
        expect(
          (schedule[next] ?? []).includes(id),
          `${id} hem ${d} hem ${next} gününde nöbetçi yazılmış`
        ).toBe(false);
      }
    }
  });
});

describe("Nöbet grupları (partner groups)", () => {
  it("grup üyelerini aynı günlere birlikte yerleştirir", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    const together = mockDates.filter(
      (d) => schedule[d].includes("T1") && schedule[d].includes("T2")
    );
    expect(together.length).toBeGreaterThanOrEqual(2);
    expect(result.unfilledGroups).toEqual([]);
  });

  it("günlük nöbetçi sayısı 1 olsa da üç kişilik grup birlikte görev alır", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2", "T4"], goalDays: 1 }],
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    const groupDays = mockDates.filter((d) => schedule[d].length === 3);
    expect(groupDays).toHaveLength(1);
    expect(schedule[groupDays[0]].sort()).toEqual(["T1", "T2", "T4"]);
    // Diğer günler tek nöbetçiyle kalır.
    for (const d of mockDates) {
      if (d !== groupDays[0]) expect(schedule[d]).toHaveLength(1);
    }
  });

  it("yerleştirilemeyen ortak günleri bildirir ama çizelgeyi yine de üretir", () => {
    // T2 yalnızca tek bir günde uygun; 3 ortak gün mümkün değil.
    for (const d of mockDates.slice(1)) {
      mockAvailabilities["T2"][d] = "unavailable";
    }

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 3 }],
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    expect(result.schedule).toBeDefined();
    expect(result.unfilledGroups).toEqual([{ groupId: "g1", goal: 3, placed: 1 }]);
  });

  it("sabitlenmiş tam kadro bir gün grubun hedefinden düşer", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 2,
      pinnedAssignments: { "2026-10-01": ["T1", "T2"] },
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }],
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    expect(result.unfilledGroups).toEqual([]);
    const schedule = result.schedule!;
    const together = mockDates.filter(
      (d) => schedule[d].includes("T1") && schedule[d].includes("T2")
    );
    expect(together).toContain("2026-10-01");
  });

  it("grup günleri üst üste iki gün kuralına tabidir", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }],
      avoidConsecutiveDays: true,
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    for (const teacherId of ["T1", "T2", "T3", "T4"]) {
      for (const d of mockDates) {
        if (!schedule[d].includes(teacherId)) continue;
        expect(schedule[shiftDate(d, 1)]?.includes(teacherId) ?? false).toBe(false);
      }
    }
  });

  it("goalDays 2 iken grubun kendi iki günü de ardışık olmaz", () => {
    // Test 12/13 için goalDays: 1 yeterliydi, ama tek günlük bir hedef grubun
    // KENDİ günlerinin birbirine göre ardışık olup olmadığını hiç sınamaz —
    // sınanacak ikinci bir gün yok. goalDays: 2 ile placePartnerGroups'un
    // grubu iki AYRI, komşu olmayan takvim gününe yerleştirdiğini doğrudan
    // doğrular.
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
      avoidConsecutiveDays: true,
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    expect(result.unfilledGroups).toEqual([]);
    const schedule = result.schedule!;
    const together = mockDates.filter(
      (d) => schedule[d].includes("T1") && schedule[d].includes("T2")
    );
    expect(together).toHaveLength(2);
    const [first, second] = together;
    expect(shiftDate(first, 1)).not.toBe(second);
    expect(shiftDate(second, 1)).not.toBe(first);
  });

  it("grup tanımlı olmayan bir ay eskisiyle birebir aynı sonucu verir", () => {
    const base: SolverConfig = {
      mode: "strict",
      teachersPerDay: 1,
      pinnedAssignments: {},
    };

    const without = solve(mockDates, mockTeachers, mockAvailabilities, base);
    const withEmpty = solve(mockDates, mockTeachers, mockAvailabilities, {
      ...base,
      partnerGroups: [],
    });

    expect(without.schedule).toEqual(withEmpty.schedule);
    expect(without.unfilledGroups).toBeUndefined();
  });
});
