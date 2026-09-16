import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Every user-visible string belongs to a locale, not to a component. A literal
// carrying Turkish marks anywhere outside the exempt files below means a string
// escaped the locale — the partial migration this feature has to avoid.
//
// This is a heuristic: it only sees strings with Turkish letters in them, so it
// is a safety net under review, not a substitute for it. Comments are stripped
// first, since they are English prose about Turkish text and may quote it.

/** Files whose Turkish literals are data or input matching, not messages. */
const EXEMPT = new Set([
  // The locales themselves.
  "src/i18n/locales/tr.ts",
  "src/i18n/locales/en.ts",
  // Folding and suffix tables: Turkish letters as data, never shown as text.
  "src/utils/turkishText.ts",
  "src/utils/turkishNumberSuffix.ts",
  // Column headers read from imported spreadsheets. They must keep matching
  // what Turkish principals' files actually say, whatever the interface speaks.
  "src/utils/excelUtils.ts",
  // The duty post a fresh database starts with: stored data, not a label.
  "src/db.ts",
]);

const TURKISH_MARKS = /[çğıöşüÇĞİÖŞÜ]/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path.replace(/\\/g, "/")] : [];
  });

/** The path as this repository refers to it, e.g. "src/components/PostMenu.tsx". */
const repoPath = (file: string): string => file.slice(file.indexOf("src/"));

/** Source with line and block comments removed, so quoted Turkish in prose does not count. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** String and template literals in the source, with their line numbers. */
const literalsOf = (source: string): { line: number; text: string }[] => {
  const found: { line: number; text: string }[] = [];
  const pattern = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\]*)`/g;
  for (const match of source.matchAll(pattern)) {
    const text = match[1] ?? match[2] ?? match[3] ?? "";
    found.push({ line: source.slice(0, match.index).split("\n").length, text });
  }
  return found;
};

describe("no user-visible string is written into the app", () => {
  const files = sourceFiles(resolve(process.cwd(), "src")).filter((file) => !EXEMPT.has(repoPath(file)));

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s reads its text from the locale", (file) => {
    const source = withoutComments(readFileSync(file, "utf8"));

    const leftBehind = literalsOf(source)
      .filter(({ text }) => TURKISH_MARKS.test(text))
      .map(({ line, text }) => `${repoPath(file)}:${line} ${JSON.stringify(text)}`);

    expect(leftBehind).toEqual([]);
  });
});
