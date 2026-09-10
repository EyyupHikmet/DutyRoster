/**
 * Turkish 3rd-person possessive suffix ("iyelik eki") for a number written as
 * a numeral, e.g. "3'ü", "2'si", "10'u" — the partitive idiom used for
 * "X out of Y placed" (bu ayki nöbet grubu uyarısı: "2 günün 1'i yerleştirildi").
 *
 * Vowel harmony follows how the number is actually PRONOUNCED (its last
 * spoken syllable), not its final digit. That distinction matters for the
 * "tens" class of numbers: 10 ("on"), 20 ("yirmi"), 30 ("otuz"), 40 ("kırk"),
 * 50 ("elli"), 60 ("altmış"), 70 ("yetmiş"), 80 ("seksen"), 90 ("doksan") and
 * 100 ("yüz") each take a suffix from their OWN word's last vowel, not from
 * digit 0's ("sıfır" -> ...ı). A leading "s" buffers the suffix onto a word
 * that itself already ends in a vowel ("iki" -> "iki'si"), so two vowels are
 * never juxtaposed.
 *
 * Only 0-999 is modeled (this app's own inputs — goalDays/placed — never
 * exceed the roster's small day counts), but the algorithm degrades
 * gracefully rather than throwing outside that range.
 *
 * Pure presentation logic: no solver/business meaning attaches to a suffix,
 * so this deliberately lives in utils, not src/solver/.
 */

const ONES = ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];

const FRONT_UNROUNDED = new Set(["e", "i"]);
const FRONT_ROUNDED = new Set(["ö", "ü"]);
const BACK_ROUNDED = new Set(["o", "u"]);
const VOWELS = new Set(["a", "e", "ı", "i", "o", "ö", "u", "ü"]);

/** The last word of the number's Turkish pronunciation (e.g. 23 -> "üç", 40 -> "kırk"). */
function lastSpokenWord(n: number): string {
  const abs = Math.floor(Math.abs(n));
  if (abs === 0) return ONES[0];
  const hundredsDigit = Math.floor(abs / 100) % 10;
  const remainder = abs % 100;
  const tensDigit = Math.floor(remainder / 10);
  const onesDigit = remainder % 10;
  if (onesDigit !== 0) return ONES[onesDigit];
  if (tensDigit !== 0) return TENS[tensDigit];
  if (hundredsDigit !== 0) return "yüz";
  return ONES[0];
}

export function turkishPossessiveSuffix(n: number): string {
  const word = lastSpokenWord(n);
  const chars = [...word];
  const lastVowel = [...chars].reverse().find((ch) => VOWELS.has(ch)) ?? "ı";
  const endsInVowel = VOWELS.has(chars[chars.length - 1]);

  let base: string;
  if (FRONT_UNROUNDED.has(lastVowel)) base = "i";
  else if (FRONT_ROUNDED.has(lastVowel)) base = "ü";
  else if (BACK_ROUNDED.has(lastVowel)) base = "u";
  else base = "ı"; // back unrounded (a, ı)

  return endsInVowel ? `'s${base}` : `'${base}`;
}
