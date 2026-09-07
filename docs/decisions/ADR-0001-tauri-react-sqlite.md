---
id: ADR-0001
title: Tauri + React + SQLite for a local-first desktop app
status: accepted
created: 2026-09-08
---

## Context

The users are school principals working on school-issued Windows machines.
They need to produce a duty roster for a month, print or mail it, and keep the
teacher list from year to year. They do not need to share it live with anyone,
and the data — staff names and their working preferences — is exactly the kind
of thing a school should not be uploading anywhere without a reason.

That rules out a hosted web app as the primary form: it would need accounts,
a server, a privacy story, and someone to pay for and maintain all three, in
exchange for collaboration nobody asked for.

Three desktop options were considered:

- **Electron.** Familiar and well-documented, but ships a full Chromium with
  every copy: a 100 MB+ download and hundreds of MB of RAM for what is a form,
  a calendar grid and a solver.
- **A native Windows app** (C#/WPF or similar). Smallest and fastest, but locks
  the entire codebase to one platform, and the scheduling logic — the actual
  hard part and the part most worth reusing — would be trapped inside it.
- **Tauri.** Uses the operating system's existing webview instead of bundling
  a browser, with a small Rust host around it. Installers come out in single-
  digit megabytes and idle memory is tens of megabytes rather than hundreds.

## Decision

Build the UI in React and TypeScript, host it in Tauri, and persist to a local
SQLite file through Tauri's SQL plugin.

The decisive factor is not the size saving on its own — it is that the
application logic stays ordinary TypeScript running in a webview. The
scheduling engine, the calendar, the Excel handling and the entire UI are
platform-agnostic web code. Tauri is a shell around them, not a framework they
are written against.

## Consequences

**Easier.** Small installers and low memory use on machines that may not be
new. macOS and Linux are largely a build-target question rather than a rewrite.
Because the logic is plain web code, a hosted version later would mean
replacing the persistence layer, not rewriting the application.

**Harder.** Contributors need a Rust toolchain installed to run the app at all,
even to change a button label — a real barrier for a project whose code is
otherwise 99% TypeScript. Rendering depends on the host's webview, so behaviour
can differ subtly across platforms in a way bundled-Chromium apps do not
suffer. And anything crossing into the native layer — the database, file
dialogs — cannot be exercised by the plain Vite dev server or by the test
suite, so a class of bugs is only reachable by running the real app.

**Before reversing.** The trigger would be genuinely needing multi-user or
remote access, at which point the question is whether to keep the desktop app
and add sync, or move to hosting. Note that the pieces that would survive
either way — solver, UI, Excel handling — were kept independent of the shell
precisely so that choice stays open.
