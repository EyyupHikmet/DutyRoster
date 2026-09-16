import { describe, it, expect } from "vitest";
import { t, i18n, DEFAULT_LANGUAGE } from "../../src/i18n";
import { tr } from "../../src/i18n/locales/tr";

// The interface speaks Turkish by default (ADR-0004). Every user-visible
// string is looked up through this instance rather than written into a
// component, so a second language means adding a locale, not editing the app.

/** Every key of a locale, as `t()` addresses it: "step3.ruleFairnessTitle". */
const keysOf = (resource: object, prefix = ""): string[] =>
  Object.entries(resource).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : keysOf(value as object, `${prefix}${key}.`)
  );

describe("the interface language", () => {
  it("answers in Turkish out of the box", () => {
    expect(DEFAULT_LANGUAGE).toBe("tr");
    expect(i18n.language).toBe("tr");
    expect(t("wizard.step1")).toBe("Kadro & Uygunluk");
  });

  it("answers from every area of the app, not just one", () => {
    expect(t("step2.dutyDay")).toBe("Nöbet Var");
    expect(t("step3.approve")).toBe("Onayla");
    expect(t("export.sheetTotal")).toBe("Toplam");
    expect(t("posts.addTitle")).toBe("Nöbet Yeri Ekle");
    expect(t("solverError.no_teachers")).toContain("Kadroda kayıtlı öğretmen bulunmamaktadır");
  });

  it("fills in what a message is about", () => {
    expect(t("roster.heading", { count: 12 })).toBe("Öğretmen Kadrosu (12)");
    expect(t("step3.pinOverTarget", { name: "Elif", pinned: 3, target: 2 })).toBe("Elif: 3 güne sabitlendi, hedefi 2");
  });

  it("has no blank string anywhere in the locale", () => {
    const blanks = keysOf(tr).filter((key) => String(t(key)).trim() === "");

    expect(blanks).toEqual([]);
  });

  it("returns a string for every key it holds, never an object", () => {
    const notStrings = keysOf(tr).filter((key) => typeof t(key) !== "string");

    expect(notStrings).toEqual([]);
  });
});
