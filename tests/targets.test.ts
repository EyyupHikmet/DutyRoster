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
});
