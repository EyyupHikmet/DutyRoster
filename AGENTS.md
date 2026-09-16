# Agents

## Coding standards

### User-visible text

Every user-visible string lives in a locale, never in a component (ADR-0008).

- Add a new string to **both** `src/i18n/locales/tr.ts` and `en.ts`, under the area it belongs to. A key in only one of them fails `tests/i18n/locales.test.ts`, and a key missing from Turkish is a type error.
- Read it with `t("area.key")` — `useTranslation()` in a component, the exported `t` in a plain module.
- A placeholder called `count` must hold a number: i18next reserves it for pluralisation.
- Modules that must stay pure (the solver, the validators) return a **code**, never a sentence. The interface words it.
- Dates come from `Intl` against the active language (`monthName`, `shortDayNames` in `dateUtils.ts`), never from a hardcoded table.
- `tests/i18n/noHardcodedStrings.test.ts` fails on a Turkish literal anywhere in `src` outside the locales, the folding tables, the Excel column headers an import must keep matching, and the duty post a fresh database starts with.

### Turkish text

The app speaks Turkish by default (ADR-0004), and teacher and duty post names are Turkish **whatever language the interface is in** (ADR-0008). Every piece of code that touches them must respect Turkish letters.

- **Sorting** user-visible text uses Turkish collation: `a.localeCompare(b, "tr")` or `Intl.Collator("tr")`. Never rely on default `.sort()` or `ORDER BY` on a text column; both put Ç Ğ İ Ö Ş Ü after Z.
- **Changing case** uses `toLocaleLowerCase("tr")` / `toLocaleUpperCase("tr")`. Plain `toLowerCase()` turns `İ` into `i̇` and `I` into `i` instead of `ı`.
- **Three matching rules, deliberately different. Do not unify them:**
  - *Identity* (is this the same teacher name?): trim, collapse inner whitespace, Turkish lower-case. Marks stay significant: "Şule" ≠ "Sule".
  - *Search* (does this row match what the user typed?): also ignore Turkish marks, so "kasim" finds "Kasım".
  - *Excel header matching*: as forgiving as search (`foldHeader`). Never reuse it for identity.
- **File names** and sheet names use Turkish letters, not ASCII substitutes.
- These rules do **not** follow the interface language. Switching to English must never reorder the staff or stop "sule" matching "Şule"; only interface text is translated, and a teacher's or duty post's name is data.
- Tests for any of the above include names such as Çağlar, Cengiz, Ilgın, İsmail, Şule and Sule.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for EyyupHikmet/DutyRoster, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, with ADRs in `docs/decisions/`. See `docs/agents/domain.md`.
