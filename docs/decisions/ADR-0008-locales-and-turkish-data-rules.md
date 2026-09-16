---
id: ADR-0008
title: One locale per language, and data rules that stay Turkish
status: accepted
created: 2026-09-16
---

## Context

Until now every user-visible string was a Turkish literal in the component that
showed it (ADR-0004 anticipated this and called the extraction out as the debt
it created). That made the app unusable outside Turkey and made most of the
interface untouchable for a contributor who does not read Turkish.

Adding a second language raises three questions that outlive it: where the
strings live, what follows the chosen language, and what deliberately does not.

## Decision

**The interface reads from a locale, never from a component.** `i18next` with
`react-i18next` holds one resource per language — `src/i18n/locales/tr.ts` and
`en.ts` — bundled at build time. The app is offline: there is nothing to fetch,
and no language detection to run.

**Turkish is the default and the shape of every other locale.** `tr.ts` is
declared `as const`, and i18next's `CustomTypeOptions` is typed from it, so
`t()` rejects a key Turkish does not have. `en.ts` is typed as `Locale`, the
same key structure with `string` values, so a missing or misspelled key is a
compile error rather than a raw `step3.approve` on screen. A test asserts the
two locales have exactly the same keys and the same `{{placeholders}}`.

**Modules that must stay pure return codes, not sentences.** The solver returns
`error_code` and the date it got stuck on; the partner-group validator returns
a code and the values its message needs. The interface words them. Neither
module knows what language anything is in.

**Dates follow the language, through `Intl`.** There is no month or day table
in the code; in Turkish `Intl` produces exactly the names the app used to hard
code.

**The language is stored in SQLite** (`app_settings`), beside the last selected
duty post, and applied before the first paint. It is not in the webview's
storage, which is cleared more casually than a database file and is per-profile
rather than per-installation.

**What does NOT follow the language: teacher and duty post names.** They are
Turkish data whatever the interface speaks, so sorting stays
`localeCompare(…, "tr")`, and `foldName` / `foldForSearch` keep their Turkish
rules (AGENTS.md, "Turkish text"). Switching to English must never reorder the
staff — English collation puts Ç after Z — nor stop "sule" matching "Şule".

The boundary between the two is what the string *is*, not where it appears:
a **month name** is interface text and is translated, a **duty post's name** is
data and is not. Searching the approved schedules therefore matches the month
as it is displayed, and the post's name with Turkish folding, in either
language.

## Consequences

**Easier.** A third language is a locale file; no component changes. A
contributor who does not read Turkish can now work on any component, since the
Turkish is in one file with English keys around it.

**Harder.** Every new string costs an entry in both locales, and a translation
can drift in meaning without any test noticing — only the keys and the
placeholders are checked mechanically. The Excel export's column headers and
sheet names now follow the language, so two exports of the same month in
different languages produce different files; that is intended, since the
workbook is for the person who exported it.

**Watch for.** i18next reserves `count` for pluralisation: a placeholder called
`count` must be a number, and a locale that needs real plural forms adds
`_one` / `_other` variants rather than new keys.

**Before reversing.** Turkish remains the default (ADR-0004). Dropping the
locale layer would mean giving up every language but one again, and the
type-checked keys that now catch a missing string at compile time.
