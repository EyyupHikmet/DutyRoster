---
id: ADR-0006
title: Approved schedules are frozen copies, stored apart from the working month
status: accepted
created: 2026-09-15
---

## Context

A principal approves a month's schedule to make it official, and later exports
it again — alone, or together with the other approved schedules of the school
year and a running total of each teacher's duties.

Between approving a month and exporting it again, the staff changes: teachers
are renamed, leave and are deleted, have their usual target changed. The month
setup itself keeps changing too, because approving does not lock a month.

Two shapes were considered:

- **A live link.** Mark the working month's row as approved and build its
  report from the current staff at export time. No data is duplicated, but a
  past official schedule would silently change: a renamed teacher shows the new
  name, a deleted one becomes "Bilinmeyen Öğretmen", a changed usual target
  rewrites the difference column. Making that trustworthy would need a durable,
  de-duplicated identity for every teacher — the kind of thing only a serial
  number, national id or phone number provides. That is personal data this app
  deliberately does not hold.
- **A frozen copy.** At approval, write a separate record holding everything
  the duty report needs: assignments, teacher names, effective targets, extra
  duty days and non-duty days.

A further pressure: the next planned feature is parallel schedules — several
schedules for the same month (two dormitories, several buildings), each with
its own teachers. The working-month table is keyed on `(year, month)`
(ADR-0003) and will have to change for that; approved schedules should not have
to change with it.

## Decision

Approved schedules are **frozen copies in their own table**, not a flag on the
`schedules` row. A copy stores everything its duty report needs, including
teacher names, so it never reads from `teachers` again.

A copy belongs to **the schedule it was approved from**, not merely to a
`(year, month)`. Each schedule has at most one approved copy; approving again
replaces it. Once parallel schedules exist, one month may therefore have several
approved copies without any change to this table's shape.

A running total recognises the same teacher across copies **by name**. The
internal id was considered and rejected: it is created fresh every time a
teacher is added, so a principal who re-imports the staff from Excel each term
would see one teacher split into several rows. Names are therefore required to
be unique within the staff, and the principal is asked to tell apart two
teachers who share one. The known cost is that a teacher renamed between
approvals appears as two rows in the running total.

## Consequences

**Easier.** An official schedule cannot drift. Deleting a teacher, which
already rewrites every month setup (see `deleteTeacher`), needs no special case
for approved schedules. Parallel schedules can reuse the table as it is.

**Harder.** Teacher names are stored twice, and a copy is only as good as the
fields it froze: adding a column to the duty report later means old copies
won't have it, so reading copies must tolerate missing fields. The "changed
since approval" check has to compare the working month against a copy field by
field, and must be kept in step with what the copy stores.

**Before reversing.** Only if the app gains a real teacher identity — a
managed staff register with durable, unique entries — would a live link become
safe. That is a separate feature with privacy costs of its own.
