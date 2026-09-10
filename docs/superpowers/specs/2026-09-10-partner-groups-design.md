# Partner Groups — Design

Status: approved (brainstorming, 2026-09-10)

## Problem

A principal often needs specific teachers on duty *together*. Today the roster
has no way to express that: every teacher is scheduled independently, so a pair
who must share a duty day can only be forced together by pinning every one of
their days by hand.

This adds **partner groups**: sets of teachers with a monthly goal for how many
duty days they serve together. A group's goal is independent of any member's
individual duty target, and a member is free to serve their remaining duties
alone. If Ali's target is 2, Can's is 4, and the group (Ali, Can) has a goal of
2, then two of Can's days are with Ali and the other two are solo.

## Scope of the change

Partner groups are **per month**, and — because a group's goal only makes sense
against a monthly duty target — **duty targets become per month too**.

Both live in the existing `schedules.config` blob for that month. No new table,
no migration.

## Data model

```ts
export interface PartnerGroup {
  id: string;          // UUID
  memberIds: string[]; // >= 2 teacher ids
  goalDays: number;    // >= 1 days this month the members serve together
}
```

`schedules.config` gains two optional keys:

| Key | Type | Meaning |
|---|---|---|
| `partnerGroups` | `PartnerGroup[]` | This month's groups |
| `monthlyTargets` | `Record<string, number>` | teacherId to this month's duty target |

`teachers.target_hours` keeps its column and its meaning — the teacher's *usual*
monthly target — and becomes the fallback when the month has no override:

```ts
effectiveTarget(teacherId) = monthlyTargets[teacherId] ?? teacher.target_hours
```

One shared helper computes this. The solver, the roster warnings and the Excel
report all call it, so they cannot disagree about what a teacher's target is.

Months saved before this feature have neither key. They load with no groups and
no overrides, and therefore behave **exactly** as they do today. That property is
non-negotiable and has a test of its own.

Both keys join `ScheduleSnapshot` in `useScheduleState`, so editing a group or a
monthly target marks the month dirty and triggers the existing unsaved-changes
prompt on navigation.

### Copying between months

An unplanned month starts with no groups and no target overrides. A
**"Başka aydan kopyala"** control on the roster screen copies another month's
`partnerGroups` and `monthlyTargets` into the current one as a starting point.
Copies are independent: editing April's groups never touches March's. Copied
groups get freshly generated ids, so the two months never share a `PartnerGroup.id`
and editing one cannot be mistaken for editing the other. Members who no longer
exist in the roster are dropped on copy, and a group left with fewer than 2
members is not copied at all.

## Rules

### Day capacity

A duty day's headcount is:

```
max(requiredOn(date), number of distinct teachers placed by groups on that date)
```

- `required = 1`, group `(X, Y, Z)` — the day holds exactly those 3. The day
  expands; other days keep their normal count.
- `required = 3`, group `(Ali, Can)` — the day holds Ali, Can and one more
  teacher chosen by the ordinary search.
- `required = 4`, groups `(A, B)` and `(C, D)` — both fit; the day holds all 4.
- `required = 3`, groups `(A, B)` and `(C, D)` — does not fit; only one is placed.

### Sharing a day

Two groups may share a duty day **only if they have no member in common.**
Overlapping groups need distinct days — otherwise a shared member's single day
would be credited twice and duty totals would stop adding up.

Given groups `g1 = (Ali, Can)` goal 1 and `g2 = (Ayşe, Can)` goal 2, Can serves
3 duty days: one with Ali, two with Ayşe.

### Credit is derived from the finished schedule

A group counts a day when **all** its members are on duty that day, subject to
the no-shared-member rule above. Credit is computed from the final schedule, not
from what the placement phase intended. So if the ordinary search fills a
leftover slot with a teacher who happens to complete another group, that day
counts for them. Free wins are kept, not discarded.

A group may therefore end up credited with *more* days than its goal. That is
allowed and is not reported as a problem: the goal is a floor the placement
phase aims at, not a ceiling the search must respect. Only shortfalls are
reported.

### Interaction with existing behaviour

- **`respectTargets`** — a group day counts toward every member's effective
  monthly target, like any other duty.
- **`avoidConsecutiveDays`** — a group day blocks each member from the adjacent
  calendar days, like any other duty.
- **Pins** — a day already pinned with all of a group's members counts as one of
  that group's days; the solver then places only the remainder.
- **Failure** — a goal that cannot be fully placed yields a partial schedule plus
  a named warning. Never a hard error. This matches how `respectTargets` and
  `avoidConsecutiveDays` already degrade.

## Validation

One pure function is the single source of truth, used both to gate saving and to
render warnings:

```ts
validatePartnerGroups(groups, teachers, monthlyTargets) -> ValidationIssue[]
```

Rules:

1. A group has at least 2 members and `goalDays >= 1`.
2. **Over-commitment is blocked.** For every teacher,
   the sum of `goalDays` over groups containing them must be at most
   `effectiveTarget(teacher)`. A save that breaks this is refused, naming the
   teacher and both numbers.
3. Lowering a teacher's monthly target below their existing commitments is
   refused the same way. Because target and groups now live in the same month's
   row, this never has to inspect another month.
4. Deleting a teacher removes them from every group in every saved month; a
   group left with fewer than 2 members is deleted with it.
5. Two groups with an identical member set are refused — that is one group with
   a larger goal.

## Solver

Approach: **two-phase.** The existing backtracking search is not modified. Two
new pure functions live in `src/solver/`, and `solve()` orchestrates:

```ts
placePartnerGroups(dates, groups, teachers, availabilities, requiredOn, pinned)
  -> Record<string, string[]>         // date to groupIds placed there

creditPartnerGroups(schedule, groups)
  -> Record<string, number>           // groupId to days credited
```

### Phase 1 — placement

Runs before the backtracker. For each group, find days where:

- every member is available (status is not `unavailable`),
- no group already placed on that day shares a member with it,
- the day has room under the capacity rule above.

Groups are placed **most-constrained-first** — fewest feasible days relative to
goal — with backtracking *between groups*, so a group with two possible days
does not lose them to a group that had ten options.

Days already pinned with a group's full membership are counted first, reducing
what has to be placed.

Placed members are written into `assignments` exactly the way pinned assignments
are today. That is what lets the rest of the pipeline work unchanged.

### Phase 2 — the existing search

Runs untouched. Because group members are already in `assignments`:

- `assignmentCounts` includes them,
- `respectTargets` counts them against the effective monthly target,
- `hasAdjacentDuty` sees them as duties blocking neighbouring days.

One addition to value ordering: while a group is still short of its goal,
candidates who would complete it sort first. This is what makes the
"credit is derived" rule useful rather than accidental.

### Phase 3 — crediting and reporting

Reads the finished schedule. Per day, greedily matches fully-present groups
under the no-shared-member rule, largest group first, and totals per group.
Shortfalls are returned on `SolverResult`:

```ts
unfilledGroups?: { groupId: string; goal: number; placed: number }[];
```

alongside today's `unfilled`.

### Why two-phase

The alternative — one unified CSP whose day domains hold group-blocks as well as
individual teachers — can backtrack out of a bad group placement, but it rewrites
the core of a solver that currently works, forces every heuristic and both hard
toggles to be re-derived against composite values, and makes the failure
diagnostics much harder to phrase.

The cost of two-phase is that the phases do not backtrack into each other: a
group placement that boxes in the main search yields open days rather than a
smarter re-placement. Those open days are already a first-class, reported
outcome in this app, so the failure mode is one a principal has seen before.

## UI

### Roster screen (Step 1)

- New `PartnerGroups` card in the right sidebar, below `TeacherForm`. Lists this
  month's groups ("Ali + Can — 1 gün") with edit and delete, plus an add form
  with a member multi-select and a goal-days field. Its header names the selected
  month, because these are that month's groups.
- **"Başka aydan kopyala"** control for pulling another month's groups and
  targets in.
- Blocked saves render inline, in Turkish, naming the teacher and the numbers.
- `TeacherList` rows show the effective monthly target, with a warning marker
  when a teacher is fully committed to groups.
- `TeacherForm`'s target field edits **the month's** target, with a note when it
  differs from the teacher's usual value.

### Plan screen (Step 3)

- Group days carry a partner badge on the day cell.
- `unfilledGroups` renders in the existing warning area:
  "Ali + Can: 2 günün 1'i yerleştirildi. Kalan günlerde ikisi birden uygun değil."

### Excel export

Unchanged in shape — the duty sheet stays a list of names, since that is what
gets printed and handed out. The teacher report's "Hedef" column starts reading
the effective monthly target, otherwise the report contradicts the plan it
describes.

### Where the code goes

`src/App.tsx` is already 1175 lines. New month-scoped state goes into
`useScheduleState`; new UI goes into its own components. `App.tsx` does not grow
beyond wiring.

## Testing

TDD throughout, following the repo's existing split: pure logic tested directly
on plain objects, components and hooks tested against the real React tree with
`db.ts` and the Tauri plugins mocked.

Solver and validation (pure, no React, no db):

- A group's goal met exactly.
- A group larger than the day's required count expands that day.
- Disjoint groups share a day; both are credited.
- Overlapping groups are forced onto distinct days.
- A filler that completes a group is credited.
- A pinned day holding a full group counts toward its goal.
- An unplaceable goal reports a shortfall and still returns a schedule.
- Group days count toward `respectTargets` and block adjacent days under
  `avoidConsecutiveDays`.
- **A month with no `partnerGroups`/`monthlyTargets` produces output identical to
  the current solver.**
- Every validation rule, including each blocked-save path.

Components and hooks:

- Creating, editing and deleting a group; blocked-save messages.
- Deleting a teacher cascades into groups; a group under 2 members is removed.
- Editing a group or a monthly target marks the month dirty.
- Copy-from-month.
- Effective monthly target shown in `TeacherList` and edited in `TeacherForm`.

What tests cannot cover here is unchanged: anything crossing into the native
layer. No part of this feature touches it — there are no new plugin calls and no
new capability grants.
