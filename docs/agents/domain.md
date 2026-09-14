# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/decisions/`**: read ADRs that touch the area you're about to work in. `docs/decisions/README.md` indexes them with a one-line summary each.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a single-context repo:

```
/
├── CONTEXT.md
├── docs/decisions/
│   ├── README.md                          ← index table of all records
│   ├── ADR-0001-tauri-react-sqlite.md
│   └── ADR-0002-hand-written-solver.md
└── src/
```

## Writing a new ADR

Follow the conventions in `docs/decisions/README.md`:

- Copy the shape of an existing record: frontmatter (`id`, `title`, `status`, `created`), then **Context**, **Decision**, **Consequences**.
- Take the next number and name the file `ADR-NNNN-short-kebab-slug.md`.
- Add a row for it to the table in `docs/decisions/README.md`.
- Never edit a record to reflect a changed mind; write a new one that supersedes it, so the history of the thinking survives.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (one row per month), but worth reopening because…_
