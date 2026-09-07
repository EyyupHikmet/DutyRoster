# Contributing

Thanks for considering it. This is a small project with a real user base —
school principals who use it to plan a month of teacher duty — so the bar is
"does this work for them", not "is this clever".

## Getting it running

You need three things:

| | |
|---|---|
| Node.js | 20 or newer |
| Rust toolchain | stable, via [rustup](https://rustup.rs) |
| WebView2 runtime | Windows only; already present on Windows 11 |

Rust is required even for a one-line UI change, because Tauri compiles a
native host around the frontend. There is no way around it.

```bash
npm install
npm run tauri dev
```

**Do not develop against `npm run dev` alone.** It serves the frontend in a
plain browser with no Tauri bridge, so the database, the file dialogs and the
Excel export all fail. It is useful for pure styling work and nothing else.

## Before you open a pull request

```bash
npx tsc --noEmit      # must be clean
npm test              # must be green
```

If your change touches persistence, file dialogs, or anything else that
crosses into the native layer, **run the real app and say in the PR what you
actually exercised.** The test suite mocks the Tauri plugin layer, so it
cannot catch a broken database call or a missing capability grant. A PR that
says "tests pass" for a change tests structurally cannot cover is not telling
us much.

## About the codebase's provenance

Much of this code, including its comments and the decision records, was written
by AI agents under human direction — see the note in the README. Read it as you
would any other code, and with one specific suspicion: **if a comment claims a
reason the code does not actually implement, that is a bug worth reporting**,
not a comment worth trusting. A few such mismatches have already been found and
fixed.

## Things that are easy to get wrong here

**Capability grants fail silently.** Every Tauri plugin command must be
allowed in `src-tauri/capabilities/default.json`. Miss one and the call
rejects at runtime with no build error and no failing test. Do not assume a
plugin's `default` permission set covers what you need — several deliberately
exclude the broader commands. Check that plugin's own `permissions/`
definitions.

**The interface is Turkish, the code is English.** User-visible strings are
Turkish; identifiers, comments, commit messages and technical documentation
are English.

The README is the exception — it exists in both, as `README.md` (Turkish,
the default) and `README.en.md` (English). **If you change one, change the
other in the same pull request.** Bilingual documentation drifts the moment
someone updates only the half they read.

If you are adding user-facing text and do not read Turkish, say so in the PR
and propose the English — we will sort the wording out together. That is not a
reason to avoid contributing.

**No technical vocabulary in the interface.** The engine does backtracking
search with heuristics; the user reads about distributing duties fairly. See
[ADR-0004](docs/decisions/ADR-0004-turkish-first-plain-language.md).

**Keep the solver pure.** `src/solver/index.ts` has no React, no database and
no I/O, which is what makes it directly testable. Please keep it that way.

**Accessibility is not optional.** The app has been through a WCAG 2.2 AA
pass: interactive controls are real focusable elements with proper roles and
labels, not click handlers on `div`s. New UI is expected to keep that
standard.

## Making a significant change

If you are changing something structural — the storage model, the solver's
approach, the shell — please open an issue first so the approach can be
discussed before you spend time on it. Substantial decisions get written up in
[docs/decisions/](docs/decisions/); see the README there for the format.

## Where help is most wanted

- **Internationalisation.** Every user-facing string is currently a hard-coded
  Turkish literal. Introducing an i18n framework, extracting the strings, and
  adding an English locale — with Turkish staying the default — is the single
  highest-value contribution available. Note that the solver *composes* some
  of its diagnostic messages, including formatted dates, so extraction is not
  purely mechanical.
- **macOS and Linux.** Nothing in the code is Windows-specific, but neither
  platform has been tested. Even a report of what breaks is useful.
- **Design tokens.** Most colours are CSS custom properties; a few are still
  hard-coded in components, which makes theming harder than it should be.
