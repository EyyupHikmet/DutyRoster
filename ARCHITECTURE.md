# Architecture

DutyRoster is a React/TypeScript application hosted inside a Tauri (Rust)
desktop shell, persisting to a local SQLite file. Essentially all the logic —
including the scheduling engine — is TypeScript running in the webview. The
Rust side is a thin host: it owns the window, the database bridge, and the
native file dialogs, and contains no business logic.

```
┌───────────────────────────────────────────────┐
│  Tauri host (Rust)                            │
│  window · SQLite bridge · dialogs · opener    │
│  ┌─────────────────────────────────────────┐  │
│  │  WebView (React + TypeScript)           │  │
│  │  UI · state hooks · solver · xlsx I/O   │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
                      │
              local SQLite file
```

## The user's path through the app

The whole app is a three-step wizard, and that structure is deliberate: the
users are school principals, not schedulers, and the wizard is what keeps the
domain jargon out of their way.

1. **Roster and availability** — maintain the teacher list (name, monthly duty
   target, priority weight) and mark each teacher's per-date availability as
   preferred, available, or unavailable. Rosters can be imported from Excel.
2. **Month shape** — pick a year and month, then click days to toggle weekends
   and holidays in or out of duty, and optionally set a different number of
   teachers for specific days.
3. **Solve and export** — pick a strategy, generate, review the result, and
   export to Excel.

## Code layout

| Path | Responsibility |
|---|---|
| `src/App.tsx` | Wizard orchestration, month navigation, modals, toasts |
| `src/components/` | Presentational and interactive UI, one file per unit |
| `src/hooks/` | State and persistence: teachers, availabilities, schedule state |
| `src/solver/index.ts` | The scheduling engine. Pure, no I/O, no React |
| `src/db.ts` | Every SQL statement in the app; the only module that talks to the database |
| `src/utils/` | Date helpers and Excel import/export |
| `src-tauri/` | Rust host: plugin registration and capability permissions |
| `tests/` | vitest suites mirroring the `src/` layout |

Two boundaries are worth preserving because they are what make the code
testable: **the solver never touches React or the database**, and **`db.ts` is
the only module that issues SQL**. Tests exercise the solver directly with
plain objects, and mock `db.ts` wholesale to test everything above it.

## The solver

`src/solver/index.ts` treats a month as a constraint satisfaction problem:
each duty day is a variable, and the teachers eligible that day are its domain.
It searches with backtracking, guided by two classic heuristics — **minimum
remaining values** (fill the most constrained day first, so dead ends surface
early) and **least constraining value** (prefer the teacher whose assignment
removes the fewest options elsewhere).

For a real school — roughly 25–30 teachers over one month — this settles in
milliseconds, which is why no external solver library is needed.

When no valid roster exists the solver does not simply fail. It raises a
structured error identifying the specific date and the teachers involved, and
the UI turns that into a plain-language sentence naming the day that could not
be filled. This matters more than it sounds: an unsolvable roster is the normal
case when a principal has over-restricted availability, and "it didn't work" is
useless to them.

Four strategies are exposed: distribute evenly, weight by seniority, honour
manually pinned assignments, and random fill. They change the order in which
candidates are considered, not the correctness of the result.

## Data model

Three tables, all local:

- **`teachers`** — `id` (UUID), `name`, `target_hours`, `priority`.
- **`availabilities`** — `teacher_id`, `date` (`YYYY-MM-DD`), `status`
  (`preferred` / `available` / `unavailable`).
- **`schedules`** — one row per `(year, month)`, holding the generated
  `assignments` map plus everything needed to reproduce it: `holidays`,
  `weekend_duty_days`, and a `config` blob (strategy, teachers per day, pinned
  assignments, extra days, day-specific counts).

`schedules` has a **unique index on `(year, month)`** and is written with
`INSERT OR REPLACE`, so a month has exactly one row that is replaced in place.

A month's row is written whether or not a roster has been generated — an empty
`assignments` map is a valid draft. That is what lets a principal configure
several months before solving any of them, rather than losing the setup by
navigating away.

The JSON-in-TEXT columns are a deliberate trade: this data is always read and
written as a whole month, never queried across months, so normalising it would
buy nothing and cost joins on every read.

## The Rust host

`src-tauri/src/lib.rs` registers the plugins the frontend calls: SQL, dialog,
filesystem and opener. Tauri denies plugin commands by default, so each one
must also be granted in `src-tauri/capabilities/default.json`.

**Capability strings fail silently.** A missing grant surfaces as a rejected
promise at runtime, and because the tests mock the plugin layer, no test will
catch it. When adding a plugin call, check the permission you need against that
plugin's own `permissions/` definitions rather than assuming the plugin's
`default` set covers it — several defaults deliberately exclude the
broader-reaching commands.

## Testing approach

Unit tests cover the solver and the pure helpers. Component and hook tests run
against the real React tree with only `db.ts` and the Tauri plugins mocked, so
they exercise genuine rendering and state flow rather than a simulation of it.

What tests **cannot** cover here is anything that crosses into the native
layer: the SQLite bridge, the Save-As dialog, capability grants. Those need the
real app via `npm run tauri dev`, and changes touching them should say what was
actually exercised.
