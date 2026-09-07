# Decision records

Short documents recording the significant technical choices in DutyRoster, why
they were made, and what was considered instead.

They exist because the *reasoning* behind a decision outlives the decision
itself. Knowing only what was chosen leaves a future reader — quite possibly a
future you — unable to judge whether it still applies when circumstances
change. Each record therefore states the alternatives that were rejected, and
what would justify revisiting the choice.

| | Decision |
|---|---|
| [ADR-0001](ADR-0001-tauri-react-sqlite.md) | Tauri + React + SQLite for a local-first desktop app |
| [ADR-0002](ADR-0002-hand-written-solver.md) | A hand-written TypeScript constraint solver, not a solver library |
| [ADR-0003](ADR-0003-one-row-per-month.md) | A month is one row, with its configuration stored as JSON |
| [ADR-0004](ADR-0004-turkish-first-plain-language.md) | Turkish-first interface, with no technical vocabulary |
| [ADR-0005](ADR-0005-drafts-persist-independently.md) | A month's setup is saved independently of solving it |

These were written when the project was opened to the public, and document
decisions taken during its initial development rather than at the moment each
was made. They are accurate about *what* was decided and *why*; they are
reconstructions only in the sense that they were not written the same day.

To add one: copy the shape of an existing record — Context, Decision,
Consequences — take the next number, and add a row above. A record is not
edited to reflect a changed mind; a new one supersedes it, so the history of
the thinking survives.
