---
id: ADR-0004
title: Turkish-first interface, with no technical vocabulary
status: accepted
created: 2026-09-08
---

## Context

The intended user is a Turkish school principal with an administrative job to
finish, not a technical one. They are not choosing this tool from a market of
alternatives and will not persist through a confusing interface; the realistic
competition is a spreadsheet and an afternoon.

Two constraints followed, and both were treated as requirements rather than
polish:

- The interface is **in Turkish** — every label, month name, day name, message
  and tooltip. Not a translation layer over English, which tends to leave
  English fragments in error messages and generated output.
- The interface contains **no technical vocabulary**. The engine performs
  backtracking search with MRV and LCV heuristics over a constraint
  satisfaction problem. None of those words appear anywhere a user can see.
  Strategies are named for what they achieve — distribute duties evenly, use
  seniority, pin a teacher to a day, fill the rest randomly — with a
  plain-language explanation next to each.

The same principle governs failure. "No solution found" is useless; naming the
date that could not be filled and what to change about it is actionable.

## Decision

Turkish is the interface language and the default. Technical vocabulary is
excluded from user-visible text, including error messages, tooltips and
exported spreadsheets.

**This does not mean Turkish-only forever.** The original scope deliberately
excluded other languages to keep the first version focused. Now that the
project is open source, an internationalisation layer with an English locale
is planned, with **Turkish remaining the default**, since the users it was
built for have not changed.

Code, comments, commit messages and technical documentation are in
**English**, so that contributors who do not read Turkish can still work on the
project.

The README is the deliberate exception: it exists in both languages, with
Turkish as `README.md` and English as `README.en.md`. The README is the
front door for *users*, and this application's users are Turkish, so the
default a visitor lands on should be theirs. ARCHITECTURE, CONTRIBUTING and
these decision records address contributors instead, and stay English-only.

## Consequences

**Easier.** The people it was built for can use it without training. Keeping
the domain vocabulary in the interface — duty, availability, seniority —
rather than solver vocabulary also keeps discussions with users grounded in
their problem.

**Harder.** Until the i18n layer lands, user-facing strings are hard-coded
Turkish literals scattered across components, which is a real barrier to
contributors who do not read Turkish, and the strings must be extracted before
any second language is possible. Some are generated rather than static — the
solver composes diagnostic sentences including formatted dates — so extraction
is not purely mechanical.

**Before reversing.** Turkish-as-default should only change if the user base
actually changes. Adding languages is not a reversal of this decision; it is
the planned continuation of it.
