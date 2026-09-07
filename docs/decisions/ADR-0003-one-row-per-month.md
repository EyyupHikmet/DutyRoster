---
id: ADR-0003
title: A month is one row, with its configuration stored as JSON
status: accepted
created: 2026-09-08
---

## Context

A generated roster is not just the assignment of teachers to days. Reproducing
or amending it later also requires the inputs: which days counted as duty days,
which holidays were excluded, which weekends were pulled in, how many teachers
each day needed, which assignments were pinned by hand, and which strategy was
used.

The normalised design would give each of these its own table — duty days,
holidays, pinned assignments, per-day counts — keyed back to a month.

The access pattern argues against it. This data is only ever read or written as
a complete month: the app loads everything for one `(year, month)` when the
user navigates to it, and writes the whole thing back when they save. Nothing
queries across months, filters by holiday, or aggregates by pinned teacher.

An earlier iteration also allowed multiple rows per month, which produced
duplicate rows that silently shadowed each other.

## Decision

One row per `(year, month)` in a `schedules` table, protected by a **unique
index on `(year, month)`** and written with `INSERT OR REPLACE`, so saving a
month replaces its row rather than adding another.

The assignments map and the configuration are stored as JSON in TEXT columns.

Separately, **a row is valid with an empty assignments map.** A month that has
been configured but never solved is a legitimate draft, not an incomplete
record — see ADR-0005.

`teachers` and `availabilities` remain properly normalised: those *are* queried
across dates and joined against, so the same reasoning points the other way.

## Consequences

**Easier.** Loading or saving a month is a single row read or write. Adding a
new configuration option means adding a field to the config object, not a
migration. The unique index makes duplicate months unrepresentable rather than
merely discouraged.

**Harder.** The JSON columns are opaque to SQL — no querying, no constraints,
no referential integrity inside them. In particular, a teacher id inside a
pinned-assignments blob is not a foreign key, so deleting a teacher can leave a
stale reference that code, not the database, has to tolerate. Schema changes
inside the JSON have to be handled by version-tolerant parsing.

**Before reversing.** The trigger is a genuine need to query across months —
"how many duties did this teacher have this year", or reporting across a term.
That is a real possibility for a feature like annual fairness, and at that
point the assignments map specifically is the piece worth normalising; the
configuration blob would still be better off as it is.
