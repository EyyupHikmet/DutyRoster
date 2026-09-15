/**
 * Folding for forgiving matches: search boxes and Excel column headers. Ignores
 * case, extra whitespace and Turkish marks, so "kasim" finds "Kasım" and
 * "ÖĞRETMEN ADI" matches "Öğretmen Adı".
 *
 * Never use this to decide whether two teacher names are the same: it folds
 * "Şule" and "Sule" together. See AGENTS.md, "Turkish text".
 *
 * Turkish needs the explicit i/ı/İ mapping: NFD does not decompose the dotless
 * i, and "İSİM".toLowerCase() produces a combining dot rather than a plain "i".
 */
export const foldForSearch = (value: unknown): string =>
  String(value)
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Folding for identity: whether two teacher names are the same. Trims,
 * collapses inner whitespace and lower-cases with the Turkish locale, so
 * "ÇAĞLAR" and "Çağlar" match but "Şule" and "Sule" stay two names.
 */
export const foldName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");
