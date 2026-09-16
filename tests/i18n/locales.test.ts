import { describe, it, expect } from "vitest";
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

describe("the English locale", () => {
  const turkishKeys = keysOf(tr).sort();
  const englishKeys = keysOf(en).sort();

  it("has exactly the keys Turkish has", () => {
    expect(englishKeys.filter((key) => !turkishKeys.includes(key)), "keys English has and Turkish does not").toEqual([]);
    expect(turkishKeys.filter((key) => !englishKeys.includes(key)), "keys Turkish has and English does not").toEqual([]);
  });

  it("says something in every one of them", () => {
    expect(englishKeys.filter((key) => valueAt(en, key).trim() === "")).toEqual([]);
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
