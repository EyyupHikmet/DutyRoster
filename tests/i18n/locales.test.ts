import { describe, it, expect } from "vitest";
import { i18n } from "../../src/i18n";
import { tr } from "../../src/i18n/locales/tr";
import { en } from "../../src/i18n/locales/en";

// Turkish is the shape every other locale is checked against (ADR-0004). A key
// only one locale has is the partial translation this feature has to avoid: it
// shows up on screen as a raw "step3.approve", which no type check would catch.

/** Every key of a locale, as `t()` addresses it: "step3.ruleFairnessTitle". */
const keysOf = (resource: object, prefix = ""): string[] =>
  Object.entries(resource).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : keysOf(value as object, `${prefix}${key}.`)
  );

/** The {{placeholders}} a message expects, in the order they first appear. */
const placeholdersOf = (text: string): string[] =>
  [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]))].sort();

const valueAt = (resource: object, key: string): string =>
  key.split(".").reduce<any>((level, part) => level[part], resource);

/**
 * The key a message belongs to, with any plural variant folded away:
 * "step3.openSlots_one" and "step3.openSlots_other" are both "step3.openSlots".
 * Turkish does not inflect a noun after a numeral, so it needs one form where
 * English needs two.
 */
const baseKey = (key: string): string => key.replace(/_(one|other)$/, "");

describe("the English locale", () => {
  const turkishKeys = [...new Set(keysOf(tr).map(baseKey))].sort();
  const englishKeys = [...new Set(keysOf(en).map(baseKey))].sort();

  it("has exactly the keys Turkish has", () => {
    expect(englishKeys.filter((key) => !turkishKeys.includes(key)), "keys English has and Turkish does not").toEqual([]);
    expect(turkishKeys.filter((key) => !englishKeys.includes(key)), "keys Turkish has and English does not").toEqual([]);
  });

  it("says something in every one of them", () => {
    expect(keysOf(en).filter((key) => valueAt(en, key).trim() === "")).toEqual([]);
  });

  it("gives a plural form whenever it gives a singular one", () => {
    const singulars = keysOf(en).filter((key) => key.endsWith("_one"));
    const missingPlural = singulars.filter((key) => !keysOf(en).includes(key.replace(/_one$/, "_other")));

    expect(missingPlural).toEqual([]);
  });

  it("counts things the way English does", async () => {
    const inEnglish = i18n.getFixedT("en");

    expect(inEnglish("step3.openSlots", { count: 1 })).toBe("1 open slot");
    expect(inEnglish("step3.openSlots", { count: 3 })).toBe("3 open slots");
    expect(inEnglish("drawer.teacherCount", { count: 1 })).toBe("1 teacher");
    expect(inEnglish("groups.days", { count: 1 })).toBe("1 day");
    // Turkish does not inflect after a numeral, and must not start.
    expect(i18n.getFixedT("tr")("step3.openSlots", { count: 1 })).toBe("1 boş slot");
    expect(i18n.getFixedT("tr")("step3.openSlots", { count: 3 })).toBe("3 boş slot");
  });

  it("is actually translated, not the Turkish text copied over", () => {
    // A handful of keys are the same in both languages on purpose: file-name
    // fragments, an emoji-only label, a proper noun.
    // A language is named in its own language, whichever locale is reading.
    const sameOnPurpose = new Set(["app.languageTr", "app.languageEn", "app.light", "app.dark", "app.textScale"]);
    const copied = englishKeys.filter(
      (key) => !sameOnPurpose.has(key) && valueAt(en, key) === valueAt(tr, key) && /[a-zçğıöşü]/i.test(valueAt(tr, key))
    );

    expect(copied).toEqual([]);
  });

  // The incomplete-schedule warning is built from five fragments joined with a
  // space each, so a fragment that starts with punctuation reads as "3 days .".
  it("joins the incomplete-schedule warning without stranding punctuation", () => {
    const joined = ["app.monthMissingDays", "app.missingDays", "app.missingEnd", "app.missingSlots", "app.missingTail", "app.shortGroups", "app.shortGroupsTail"];

    for (const locale of [tr, en]) {
      const stranded = joined.filter((key) => /^[.,;:!?]/.test(valueAt(locale, key)));
      expect(stranded).toEqual([]);
    }
  });

  it("keeps each message's placeholders, so nothing interpolates into a gap", () => {
    const mismatched = turkishKeys
      .map((key) => ({ key, tr: placeholdersOf(valueAt(tr, key)), en: placeholdersOf(valueAt(en, key)) }))
      // The Turkish possessive suffix is Turkish-only: English uses the plain number.
      .filter(({ key, tr: trPlaceholders, en: enPlaceholders }) =>
        key === "step3.groupShortfall"
          ? !enPlaceholders.every((p) => ["names", "goal", "placed"].includes(p))
          : JSON.stringify(trPlaceholders) !== JSON.stringify(enPlaceholders)
      )
      .map(({ key, tr: trPlaceholders, en: enPlaceholders }) => `${key}: tr ${trPlaceholders} vs en ${enPlaceholders}`);

    expect(mismatched).toEqual([]);
  });
});
