---
id: ADR-0002
title: A hand-written TypeScript constraint solver, not a solver library
status: accepted
created: 2026-09-08
---

## Context

Assigning teachers to duty days under availability constraints, monthly
targets and fairness rules is a textbook constraint satisfaction problem. The
obvious instinct is to reach for a real solver.

The established options all pull the problem out of the browser:

- **OR-Tools / GLPK and similar.** Genuinely powerful, and the right answer at
  a scale this application does not have. They are native libraries, so using
  one means either bundling native binaries per platform or standing up a
  backend service to call it — reintroducing exactly the server this
  application exists to avoid.
- **JavaScript constraint libraries.** No native dependency, but they are a
  mixed and often unmaintained field, and adopting one means expressing the
  problem in that library's vocabulary. When a roster proves impossible — the
  common case in practice — the failure comes back in the library's terms, and
  turning that into a sentence a principal can act on is its own project.

The problem's actual size matters here. A month is at most 31 days, a school
has 25–30 teachers, and each day needs one or two of them. This is small.

## Decision

Write the solver directly, in TypeScript, as a pure module with no
dependencies: backtracking search guided by two standard heuristics —
**minimum remaining values** (attempt the most constrained day first) and
**least constraining value** (prefer the teacher whose assignment leaves others
the most room).

Just as importantly, when the search exhausts, it raises a **structured error
naming the specific date and the teachers involved**, so the interface can
explain which day could not be filled and why.

## Consequences

**Easier.** No native dependency, no backend, no build complexity — the solver
runs anywhere the app does, including in a browser if the app is ever hosted.
It is a few hundred lines of ordinary code that can be read, unit-tested
directly with plain objects, and stepped through in a debugger. Above all, the
failure path produces domain-specific diagnostics, which is the difference
between a tool a principal can use and one they abandon.

**Harder.** This is a bespoke implementation with no upstream: correctness is
the test suite's responsibility alone, and it is not general — a substantially
different scheduling rule may mean extending the search rather than adjusting
a declarative model. Performance guarantees are empirical rather than
theoretical.

**Before reversing.** The trigger would be constraints this search genuinely
cannot express, or a real deployment where it becomes slow. Watch for
backtracking time growing non-linearly as constraints tighten. If that day
comes, the solver's isolation — no React, no database, no I/O — is what makes
it replaceable behind the same interface.
