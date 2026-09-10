import { describe, it, expect } from "vitest";
import { turkishPossessiveSuffix } from "../src/utils/turkishNumberSuffix";

describe("turkishPossessiveSuffix", () => {
  // Turkish vowel harmony follows how each number is actually pronounced
  // ("sıfır", "bir", "iki", ...), not its final digit.
  const expected: Record<number, string> = {
    0: "'ı", // sıfır
    1: "'i", // bir
    2: "'si", // iki (ends in a vowel -> buffered)
    3: "'ü", // üç
    4: "'ü", // dört
    5: "'i", // beş
    6: "'sı", // altı (ends in a vowel -> buffered)
    7: "'si", // yedi (ends in a vowel -> buffered)
    8: "'i", // sekiz
    9: "'u", // dokuz
  };

  for (const [n, suffix] of Object.entries(expected)) {
    it(`${n} için doğru eki döndürür`, () => {
      expect(turkishPossessiveSuffix(Number(n))).toBe(suffix);
    });
  }

  // The "tens" class: each takes a suffix from its OWN word's last vowel
  // ("on", "yirmi", "otuz", ...), not from digit 0's ("sıfır").
  const tens: Record<number, string> = {
    10: "'u", // on
    20: "'si", // yirmi (ends in a vowel -> buffered)
    30: "'u", // otuz
    40: "'ı", // kırk
    60: "'ı", // altmış
    70: "'i", // yetmiş
    100: "'ü", // yüz
  };

  for (const [n, suffix] of Object.entries(tens)) {
    it(`${n} için kendi son sesli harfine göre eki döndürür`, () => {
      expect(turkishPossessiveSuffix(Number(n))).toBe(suffix);
    });
  }

  it("bileşik sayılarda son basamağın telaffuzunu kullanır (11 -> 'bir' gibi)", () => {
    expect(turkishPossessiveSuffix(11)).toBe("'i");
  });
});
