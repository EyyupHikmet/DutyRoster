import { describe, it, expect } from "vitest";
import { effectiveTarget } from "../src/utils/targets";

describe("effectiveTarget", () => {
  it("ay için özel hedef yoksa öğretmenin genel hedefini döndürür", () => {
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, {})).toBe(4);
  });

  it("ay için tanımlı hedef genel hedefin yerine geçer", () => {
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, { T1: 6 })).toBe(6);
  });

  it("başka bir öğretmenin aylık hedefi bu öğretmeni etkilemez", () => {
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, { T2: 6 })).toBe(4);
  });

  it("sıfır geçerli bir aylık hedeftir ve genel hedefin yerine geçer", () => {
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, { T1: 0 })).toBe(0);
  });

  it("sayı olmayan bir değer yok sayılır ve genel hedefe düşülür", () => {
    const broken = { T1: undefined } as unknown as Record<string, number>;
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, broken)).toBe(4);
  });

  // The Number.isFinite half of the guard was untested before this — only
  // `undefined` (caught by `typeof override === "number"` alone) exercised
  // it. NaN and Infinity are both `typeof "number"`, so a regression that
  // weakened the guard to a bare `typeof` check would pass every test above
  // while silently letting either through as a teacher's effective target.
  it("NaN yok sayılır ve genel hedefe düşülür", () => {
    const broken = { T1: NaN } as Record<string, number>;
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, broken)).toBe(4);
  });

  it("Infinity yok sayılır ve genel hedefe düşülür", () => {
    const broken = { T1: Infinity } as Record<string, number>;
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, broken)).toBe(4);
  });

  it("sayısal bir metin (typeof 'string') yok sayılır ve genel hedefe düşülür", () => {
    const broken = { T1: "6" } as unknown as Record<string, number>;
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, broken)).toBe(4);
  });
});
