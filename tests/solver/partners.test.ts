import { describe, it, expect } from "vitest";
import { PartnerGroup, creditPartnerGroups } from "../../src/solver/partners";

const g = (id: string, memberIds: string[], goalDays: number): PartnerGroup => ({
  id,
  memberIds,
  goalDays,
});

describe("creditPartnerGroups", () => {
  it("üyelerin tamamı aynı gündeyse o günü gruba sayar", () => {
    const schedule = { "2026-10-01": ["T1", "T2"], "2026-10-02": ["T3"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 1)])).toEqual({ g1: 1 });
  });

  it("üyelerden biri eksikse o günü saymaz", () => {
    const schedule = { "2026-10-01": ["T1", "T3"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 1)])).toEqual({ g1: 0 });
  });

  it("birden fazla günü toplar", () => {
    const schedule = {
      "2026-10-01": ["T1", "T2"],
      "2026-10-02": ["T1", "T2"],
      "2026-10-05": ["T1"],
    };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 2)])).toEqual({ g1: 2 });
  });

  it("ortak üyesi olmayan iki grup aynı günü birlikte alabilir", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3", "T4"] };
    const groups = [g("g1", ["T1", "T2"], 1), g("g2", ["T3", "T4"], 1)];
    expect(creditPartnerGroups(schedule, groups)).toEqual({ g1: 1, g2: 1 });
  });

  it("ortak üyesi olan iki grup aynı günden yalnızca biri sayılır", () => {
    // T3 her iki gruptaysa, tek bir gün iki kez sayılamaz.
    // g1 ve g2 eşit boyutta olduğundan, id'ye göre tie-break yapılır:
    // g1 < g2 lexicographically, bu yüzden g1 kazanır.
    const schedule = { "2026-10-01": ["T1", "T2", "T3"] };
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 1)];
    const credit = creditPartnerGroups(schedule, groups);
    expect(credit.g1).toBe(1);
    expect(credit.g2).toBe(0);
    expect(credit.g1 + credit.g2).toBe(1);
  });

  it("çakışma durumunda daha kalabalık grup önceliklidir", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3"] };
    const groups = [g("small", ["T1", "T2"], 1), g("big", ["T1", "T2", "T3"], 1)];
    expect(creditPartnerGroups(schedule, groups)).toEqual({ big: 1, small: 0 });
  });

  it("üç kişilik bir grubu tam kadro olduğunda sayar", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3"], "2026-10-02": ["T1", "T2"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2", "T3"], 2)])).toEqual({ g1: 1 });
  });

  it("grup yoksa boş bir sonuç döndürür", () => {
    expect(creditPartnerGroups({ "2026-10-01": ["T1"] }, [])).toEqual({});
  });

  it("üyesi olmayan bir grup hiçbir gün sayılmaz", () => {
    // Boş memberIds, her gün için `every` true döndürür, ancak
    // bu grup hiçbir zaman kredi almamalı.
    const schedule = {
      "2026-10-01": ["T1", "T2"],
      "2026-10-02": ["T3"],
      "2026-10-03": ["T4"],
    };
    expect(creditPartnerGroups(schedule, [g("empty", [], 1)])).toEqual({ empty: 0 });
  });
});
