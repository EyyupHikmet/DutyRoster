---
id: ADR-0005
title: A month's setup is saved independently of solving it
status: accepted
created: 2026-09-08
---

## Context

Originally a month was written to the database only after a roster was
successfully generated, because generating was assumed to be the end of the
workflow.

It is not. A principal planning a term configures several months in a sitting —
marking holidays, pulling in weekends, adjusting how many teachers each day
needs — and does not necessarily solve any of them at that moment. Because the
month switcher reloaded the target month unconditionally, moving from one month
to the next silently discarded everything configured in the month being left.
No warning, no recovery: the work was simply gone.

Three responses were considered:

- **Autosave on every change.** Never loses work, but writes to the database
  constantly and, worse, gives the user no way to abandon an experiment. Having
  tried a configuration and disliked it, they would have no way back.
- **Block navigation while unsaved.** Trivial to implement and hostile — the
  user is prevented from doing the thing they asked to do.
- **Ask.** Save, discard, or stay.

## Decision

Saving a month's configuration is decoupled from solving it: a month can be
written with an empty assignments map, as a draft (see ADR-0003).

Changes are tracked against the state loaded for the current month, and if the
user navigates away with unsaved changes they are asked, with exactly three
outcomes: **save and continue**, **continue without saving** — which leaves the
stored month exactly as it was, rather than clearing it — or **cancel**, which
stays put.

The dirty check compares against the state actually loaded for that month, not
against emptiness. A freshly opened month is pre-populated with sensible
defaults, so treating "not empty" as "modified" would prompt on every
navigation and train the user to dismiss the prompt without reading it.

Successfully generating a roster still saves, exactly as before. This adds a
path, it does not replace one.

## Consequences

**Easier.** Multi-month planning works. Nothing is lost silently, and the user
keeps an explicit way to abandon changes — the discard path leaves the stored
month untouched rather than wiping it.

**Harder.** The application now carries an in-memory baseline of the loaded
month and compares against it, which is state that can drift from reality if a
new configuration field is added and not included in the comparison. The
comparison is order-independent, so toggling a day off and back on correctly
registers as unchanged — a subtlety worth preserving when editing it.

**Before reversing.** Only if navigation prompts became frequent enough to
annoy, which would more likely indicate a bug in the dirty check than a fault
in the approach.
