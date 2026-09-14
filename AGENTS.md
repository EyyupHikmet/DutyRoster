# Agents

## Coding standards

### Turkish text

The app speaks Turkish (ADR-0004), and every piece of code that touches user-visible text must respect Turkish letters.

- **Sorting** user-visible text uses Turkish collation: `a.localeCompare(b, "tr")` or `Intl.Collator("tr")`. Never rely on default `.sort()` or `ORDER BY` on a text column; both put Ç Ğ İ Ö Ş Ü after Z.
- **Changing case** uses `toLocaleLowerCase("tr")` / `toLocaleUpperCase("tr")`. Plain `toLowerCase()` turns `İ` into `i̇` and `I` into `i` instead of `ı`.
- **Three matching rules, deliberately different. Do not unify them:**
  - *Identity* (is this the same teacher name?): trim, collapse inner whitespace, Turkish lower-case. Marks stay significant: "Şule" ≠ "Sule".
  - *Search* (does this row match what the user typed?): also ignore Turkish marks, so "kasim" finds "Kasım".
  - *Excel header matching*: as forgiving as search (`foldHeader`). Never reuse it for identity.
- **File names** and sheet names use Turkish letters, not ASCII substitutes.
- Tests for any of the above include names such as Çağlar, Cengiz, Ilgın, İsmail, Şule and Sule.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for EyyupHikmet/DutyRoster, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, with ADRs in `docs/decisions/`. See `docs/agents/domain.md`.
