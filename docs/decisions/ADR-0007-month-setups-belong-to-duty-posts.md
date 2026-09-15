---
id: ADR-0007
title: A month setup belongs to a duty post, and each post has its own staff
status: accepted
created: 2026-09-15
supersedes: ADR-0003
---

## Context

A school may supervise more than one place overnight: two dormitories, or
several buildings on one campus. Each of these **duty posts** needs its own
schedule every month, planned and saved on its own.

ADR-0003 stores a month as one row per `(year, month)`, protected by a unique
index. That makes a second schedule for the same month unrepresentable. Its
other reasoning still holds: a month setup is read and written whole, so its
configuration stays a JSON blob.

The main alternative concerned who can be on duty where:

- **One shared staff.** Every post draws on the same teachers. Realistic for
  some schools, but the same teacher must then never be on duty at two posts on
  the same night, so the posts of a month can no longer be planned one at a
  time: the solver would have to plan them together, and a change to one post's
  schedule could invalidate another's.
- **Separate staffs.** Each post has its own teachers, and a teacher belongs to
  exactly one post. The posts of a month are independent.

Duty posts could also have been created per month. They were not: dormitories
do not change from month to month, and approved schedules and the export of
earlier approved schedules are grouped by post across the school year.

## Decision

- **Duty posts are a lasting list.** Every post has a name, unique among posts
  under the identity rule in AGENTS.md ("Turkish text").
- **Each post has its own staff.** A teacher belongs to exactly one post and can
  be moved to another. A teacher's availability belongs to the teacher and moves
  with them.
- **Teacher names are unique across every post**, not only within one: moving a
  teacher must not create two teachers with the same name, and a report covering
  several posts matches teachers by name (ADR-0006).
- **A month setup belongs to a post:** one row per `(post, year, month)`,
  replacing ADR-0003's `(year, month)` uniqueness. Everything that describes how
  a place is run in a month (duty days, extra duty days, required counts, pins,
  partner groups, monthly targets, distribution rule, hard rules) lives in that
  row.
- **Existing data becomes a post named "Yurt"**, which the principal can rename:
  every existing teacher, month setup and approved schedule belongs to it.
- **An approved schedule freezes its post's name** along with everything else
  its duty report needs, and still belongs to the schedule it came from (and so
  to the post).
- The last selected post is remembered in the database.

## Consequences

**Easier.** The solver is unchanged: it plans one post's month exactly as it
plans a month today. Posts can be approved, exported and edited independently.
A school with one dormitory keeps working as before, inside a single post.

**Harder.** Existing databases need a migration: a posts table, a post on every
teacher and month setup, and a new unique index. Moving a teacher between posts
must clean them out of the old post's month setups, the same cleanup as
deleting a teacher. Deleting a post removes its teachers, their availability and
its month setups, while its approved schedules survive as frozen records.

**Before reversing.** The trigger is a school whose teachers genuinely serve
several posts. Supporting that means a cross-post constraint (never two posts on
the same night) and planning a month's posts together, which touches the solver
(ADR-0002) as well as this data model.
