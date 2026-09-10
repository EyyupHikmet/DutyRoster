# Partner Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a principal require specific teachers to share duty days, by defining per-month partner groups with a goal for how many days they serve together.

**Architecture:** Two new pure modules under `src/solver/` hold group placement, crediting and validation. `solve()` gains a placement phase in front of the existing backtracking search and a crediting phase after it; the search itself is not modified. Partner groups and per-month duty targets both ride in the existing `schedules.config` JSON blob, so there is no new table and no migration.

**Tech Stack:** React 19 + TypeScript, Tauri 2, SQLite via `@tauri-apps/plugin-sql`, vitest + @testing-library/react, xlsx.

**Spec:** `docs/superpowers/specs/2026-09-10-partner-groups-design.md`

## Global Constraints

- **All user-facing copy is Turkish.** Match the tone of the existing strings — plain language for school principals, no scheduler jargon. See `docs/decisions/ADR-0004-turkish-first-plain-language.md`.
- **The solver never imports React or `db.ts`.** Pure functions over plain objects only. See `ARCHITECTURE.md`.
- **`src/db.ts` is the only module that issues SQL.**
- **Backward compatibility is non-negotiable.** A month whose `config` has neither `partnerGroups` nor `monthlyTargets` must produce exactly today's behaviour. Every new config key is optional and defaults to empty.
- **Test commands:** `npm test` runs the whole suite with coverage. A single file: `npx vitest run tests/<file>`. A single test: `npx vitest run tests/<file> -t "<name>"`.
- **Test file layout mirrors `src/`:** `tests/solver.test.ts`, `tests/components/<Name>.test.tsx`, `tests/hooks/<name>.test.ts`.
- Component and hook tests mock `db.ts` wholesale (`vi.mock("../../src/db")`). Solver and util tests mock nothing.
- **Effective monthly target** is always `monthlyTargets[teacherId] ?? teacher.target_hours`, computed only via the `effectiveTarget` helper from Task 1. Never inline this expression anywhere else.
- Do not grow `src/App.tsx` beyond wiring — it is already 1175 lines. New state goes in `useScheduleState`; new UI goes in its own component file.

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `src/utils/targets.ts` | **Create.** `effectiveTarget` — the one place a monthly target is resolved. | 1 |
| `src/solver/partners.ts` | **Create.** `PartnerGroup` type, `creditPartnerGroups`, `placePartnerGroups`. Pure. | 2, 3, 4 |
| `src/solver/validation.ts` | **Create.** `validatePartnerGroups` — the one source of truth for group rules. Pure. | 2 |
| `src/solver/index.ts` | **Modify.** New `partnerGroups` config key, placement + crediting phases, `unfilledGroups` result field. | 5 |
| `src/db.ts` | **Modify.** `getAllSchedules`; `deleteTeacher` cascades into every month's groups and targets. | 6 |
| `src/hooks/useScheduleState.ts` | **Modify.** `partnerGroups` / `monthlyTargets` state, load, save, snapshot, copy-from-month. | 7 |
| `src/components/PartnerGroups.tsx` | **Create.** The roster-screen card: list, add/edit form, copy-from-month. | 8 |
| `src/hooks/useTeachers.ts` | **Modify.** The target field edits the month's target; blocked when it drops below commitments. | 9 |
| `src/components/TeacherList.tsx` | **Modify.** Show effective monthly target and a commitment marker. | 9 |
| `src/components/TeacherForm.tsx` | **Modify.** Label the target as this month's, note when it differs from the usual value. | 9 |
| `src/components/Step1Roster.tsx` | **Modify.** Mount `PartnerGroups` in the right sidebar. | 10 |
| `src/App.tsx` | **Modify.** Wiring only: pass groups/targets down, feed the solver, resolve effective targets. | 10 |
| `src/components/Step3Solver.tsx` | **Modify.** Partner badge on group days, `unfilledGroups` warning. | 11 |
| `src/utils/excelUtils.ts` | **Modify.** Teacher report reads the effective monthly target. | 12 |

Tasks 1–5 are the pure core and must land in order. Tasks 6–12 depend on 1–5 but only loosely on each other.

---

### Task 1: Effective monthly target helper

The whole feature rests on one rule: a teacher's target for a month is the month's override if there is one, otherwise their usual `target_hours`. Putting it in one function is what stops the solver, the roster warnings and the Excel report from disagreeing.

**Files:**
- Create: `src/utils/targets.ts`
- Test: `tests/targets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `effectiveTarget(teacher: { id: string; target_hours: number }, monthlyTargets: Record<string, number>): number`

- [ ] **Step 1: Write the failing test**

Create `tests/targets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { effectiveTarget } from "../src/utils/targets";

describe("effectiveTarget", () => {
  it("ay için özel hedef yoksa öğretmenin genel hedefini döndürür", () => {
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, {})).toBe(4);
  });

  it("ay için tanımlı hedef genel hedefin yerine geçer", () => {
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, { T1: 6 })).toBe(6);
  });

  it("başka bir öğretmenin aylık hedefi bu öğretmeni etkilemez", () => {
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, { T2: 6 })).toBe(4);
  });

  it("sıfır geçerli bir aylık hedeftir ve genel hedefin yerine geçer", () => {
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, { T1: 0 })).toBe(0);
  });

  it("sayı olmayan bir değer yok sayılır ve genel hedefe düşülür", () => {
    const broken = { T1: undefined } as unknown as Record<string, number>;
    expect(effectiveTarget({ id: "T1", target_hours: 4 }, broken)).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/targets.test.ts`
Expected: FAIL — cannot resolve `../src/utils/targets`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/targets.ts`:

```ts
/**
 * A teacher's duty target for ONE month.
 *
 * `teachers.target_hours` is the teacher's usual monthly target and lives in the
 * teachers table. A month may override it, and that override lives in that
 * month's `schedules.config.monthlyTargets`. Every consumer — the solver, the
 * roster warnings, the Excel report — must resolve the number through here, or
 * they will eventually disagree about what a teacher's target is.
 *
 * Zero is a legitimate override (a teacher excused for the month), so the check
 * is for a finite number rather than a truthy one.
 */
export function effectiveTarget(
  teacher: { id: string; target_hours: number },
  monthlyTargets: Record<string, number>
): number {
  const override = monthlyTargets[teacher.id];
  return typeof override === "number" && Number.isFinite(override)
    ? override
    : teacher.target_hours;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/targets.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/targets.ts tests/targets.test.ts
git commit -m "feat(targets): resolve a teacher's monthly duty target in one place"
```

---

### Task 2: PartnerGroup type and validation rules

**Files:**
- Create: `src/solver/partners.ts`
- Create: `src/solver/validation.ts`
- Test: `tests/solver/validation.test.ts`

**Interfaces:**
- Consumes: `effectiveTarget` (Task 1).
- Produces:
  - `interface PartnerGroup { id: string; memberIds: string[]; goalDays: number }` from `src/solver/partners.ts`
  - `type ValidationCode = "too_few_members" | "invalid_goal" | "unknown_member" | "duplicate_group" | "over_committed"`
  - `interface ValidationIssue { code: ValidationCode; message: string; groupId?: string; teacherId?: string }`
  - `validatePartnerGroups(groups: PartnerGroup[], teachers: { id: string; name: string; target_hours: number }[], monthlyTargets: Record<string, number>): ValidationIssue[]`

- [ ] **Step 1: Write the failing test**

Create `tests/solver/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PartnerGroup } from "../../src/solver/partners";
import { validatePartnerGroups } from "../../src/solver/validation";

const teachers = [
  { id: "T1", name: "Ali", target_hours: 4 },
  { id: "T2", name: "Ayşe", target_hours: 2 },
  { id: "T3", name: "Can", target_hours: 3 },
];

const g = (id: string, memberIds: string[], goalDays: number): PartnerGroup => ({
  id,
  memberIds,
  goalDays,
});

describe("validatePartnerGroups", () => {
  it("kuralara uyan gruplar için sorun bildirmez", () => {
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 2)];
    expect(validatePartnerGroups(groups, teachers, {})).toEqual([]);
  });

  it("tek üyeli grubu reddeder", () => {
    const issues = validatePartnerGroups([g("g1", ["T1"], 1)], teachers, {});
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("too_few_members");
    expect(issues[0].groupId).toBe("g1");
  });

  it("sıfır veya negatif ortak gün hedefini reddeder", () => {
    const issues = validatePartnerGroups([g("g1", ["T1", "T2"], 0)], teachers, {});
    expect(issues.map((i) => i.code)).toContain("invalid_goal");
  });

  it("kadroda olmayan bir öğretmen içeren grubu reddeder", () => {
    const issues = validatePartnerGroups([g("g1", ["T1", "TX"], 1)], teachers, {});
    expect(issues.map((i) => i.code)).toContain("unknown_member");
  });

  it("aynı öğretmenlerden oluşan ikinci grubu reddeder (sıra farkı önemsiz)", () => {
    const groups = [g("g1", ["T1", "T2"], 1), g("g2", ["T2", "T1"], 1)];
    const issues = validatePartnerGroups(groups, teachers, {});
    expect(issues.map((i) => i.code)).toContain("duplicate_group");
  });

  it("aylık hedefini aşan taahhüdü reddeder ve öğretmeni adıyla bildirir", () => {
    // Can'ın hedefi 3; 2 + 2 = 4 ortak gün taahhüdü fazla.
    const groups = [g("g1", ["T1", "T3"], 2), g("g2", ["T2", "T3"], 2)];
    const issues = validatePartnerGroups(groups, teachers, {});
    const over = issues.find((i) => i.code === "over_committed");
    expect(over).toBeDefined();
    expect(over!.teacherId).toBe("T3");
    expect(over!.message).toContain("Can");
    expect(over!.message).toContain("4");
    expect(over!.message).toContain("3");
  });

  it("taahhüt tam hedefe eşitse kabul eder", () => {
    // Can: 1 + 2 = 3, hedefi de 3.
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 2)];
    expect(validatePartnerGroups(groups, teachers, {})).toEqual([]);
  });

  it("aylık hedef ezmesini dikkate alır", () => {
    // Ayşe'nin genel hedefi 2 ama bu ay 1; 2 günlük grup artık fazla.
    const groups = [g("g1", ["T2", "T3"], 2)];
    expect(validatePartnerGroups(groups, teachers, {})).toEqual([]);
    const issues = validatePartnerGroups(groups, teachers, { T2: 1 });
    expect(issues.map((i) => i.code)).toContain("over_committed");
  });

  it("grup yoksa sorun bildirmez", () => {
    expect(validatePartnerGroups([], teachers, {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/solver/validation.test.ts`
Expected: FAIL — cannot resolve `../../src/solver/partners`.

- [ ] **Step 3: Write the implementation**

Create `src/solver/partners.ts`:

```ts
/**
 * A set of teachers who serve duty together, and how many days this month they
 * are meant to do so. Groups are per-month: they live in that month's
 * `schedules.config.partnerGroups`, not in a table of their own.
 *
 * `goalDays` is independent of any member's own duty target. A member is free
 * to serve their remaining duties alone.
 */
export interface PartnerGroup {
  id: string;
  memberIds: string[];
  goalDays: number;
}

/** Two groups may share a duty day only when they have no member in common. */
export function groupsOverlap(a: PartnerGroup, b: PartnerGroup): boolean {
  return a.memberIds.some((m) => b.memberIds.includes(m));
}

/** Stable key for "these exact people", so member order can't create a duplicate. */
export function memberSetKey(group: PartnerGroup): string {
  return [...new Set(group.memberIds)].sort().join("|");
}
```

Create `src/solver/validation.ts`:

```ts
import { effectiveTarget } from "../utils/targets";
import { PartnerGroup, memberSetKey } from "./partners";

export type ValidationCode =
  | "too_few_members"
  | "invalid_goal"
  | "unknown_member"
  | "duplicate_group"
  | "over_committed";

export interface ValidationIssue {
  code: ValidationCode;
  /** Turkish, shown to the principal verbatim. */
  message: string;
  groupId?: string;
  teacherId?: string;
}

/**
 * The single source of truth for partner-group rules. The roster screen calls
 * this to gate saving AND to render its warnings, so a rule can never be
 * enforced in one place and forgotten in the other.
 *
 * Pure: no React, no database, no I/O.
 */
export function validatePartnerGroups(
  groups: PartnerGroup[],
  teachers: { id: string; name: string; target_hours: number }[],
  monthlyTargets: Record<string, number>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(teachers.map((t) => [t.id, t]));

  // Per-group shape rules.
  const seenMemberSets = new Map<string, string>();
  for (const group of groups) {
    const uniqueMembers = new Set(group.memberIds);
    if (uniqueMembers.size < 2) {
      issues.push({
        code: "too_few_members",
        groupId: group.id,
        message: "Bir nöbet grubunda en az 2 öğretmen bulunmalıdır.",
      });
    }

    if (!Number.isFinite(group.goalDays) || group.goalDays < 1) {
      issues.push({
        code: "invalid_goal",
        groupId: group.id,
        message: "Ortak nöbet gün sayısı en az 1 olmalıdır.",
      });
    }

    for (const memberId of uniqueMembers) {
      if (!byId.has(memberId)) {
        issues.push({
          code: "unknown_member",
          groupId: group.id,
          teacherId: memberId,
          message: "Grupta kadroda bulunmayan bir öğretmen var. Lütfen grubu güncelleyin.",
        });
      }
    }

    const key = memberSetKey(group);
    const previous = seenMemberSets.get(key);
    if (previous !== undefined) {
      const names = [...uniqueMembers]
        .map((id) => byId.get(id)?.name ?? id)
        .join(" + ");
      issues.push({
        code: "duplicate_group",
        groupId: group.id,
        message: `${names} için zaten bir grup tanımlı. Aynı öğretmenlerden ikinci bir grup oluşturmak yerine mevcut grubun gün sayısını artırın.`,
      });
    } else {
      seenMemberSets.set(key, group.id);
    }
  }

  // Over-commitment: a teacher can't owe more joint days than their month allows.
  const committed = new Map<string, number>();
  for (const group of groups) {
    const goal = Number.isFinite(group.goalDays) ? Math.max(0, group.goalDays) : 0;
    for (const memberId of new Set(group.memberIds)) {
      committed.set(memberId, (committed.get(memberId) ?? 0) + goal);
    }
  }

  for (const [teacherId, total] of committed) {
    const teacher = byId.get(teacherId);
    if (!teacher) continue; // already reported as unknown_member
    const target = effectiveTarget(teacher, monthlyTargets);
    if (total > target) {
      issues.push({
        code: "over_committed",
        teacherId,
        message: `${teacher.name}: gruplarda toplam ${total} ortak nöbet günü tanımlı, bu ayki nöbet hedefi ise ${target}. Grubun gün sayısını azaltın veya hedefi yükseltin.`,
      });
    }
  }

  return issues;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/solver/validation.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/solver/partners.ts src/solver/validation.ts tests/solver/validation.test.ts
git commit -m "feat(partners): add PartnerGroup type and group validation rules"
```

---

### Task 3: Credit groups from a finished schedule

Group credit is **derived**: a group counts a day when all its members are on duty that day. That means a day the ordinary search happened to fill with the right person still counts. Two groups can only both be credited for the same day when they share no member — otherwise one teacher's single day would be counted twice and the duty totals would stop adding up.

**Files:**
- Modify: `src/solver/partners.ts`
- Test: `tests/solver/partners.test.ts`

**Interfaces:**
- Consumes: `PartnerGroup`, `groupsOverlap` (Task 2).
- Produces: `creditPartnerGroups(schedule: Record<string, string[]>, groups: PartnerGroup[]): Record<string, number>` — groupId to the number of days credited.

- [ ] **Step 1: Write the failing test**

Create `tests/solver/partners.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PartnerGroup, creditPartnerGroups } from "../../src/solver/partners";

const g = (id: string, memberIds: string[], goalDays: number): PartnerGroup => ({
  id,
  memberIds,
  goalDays,
});

describe("creditPartnerGroups", () => {
  it("üyelerin tamamı aynı gündeyse o günü gruba sayar", () => {
    const schedule = { "2026-10-01": ["T1", "T2"], "2026-10-02": ["T3"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 1)])).toEqual({ g1: 1 });
  });

  it("üyelerden biri eksikse o günü saymaz", () => {
    const schedule = { "2026-10-01": ["T1", "T3"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 1)])).toEqual({ g1: 0 });
  });

  it("birden fazla günü toplar", () => {
    const schedule = {
      "2026-10-01": ["T1", "T2"],
      "2026-10-02": ["T1", "T2"],
      "2026-10-05": ["T1"],
    };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 2)])).toEqual({ g1: 2 });
  });

  it("ortak üyesi olmayan iki grup aynı günü birlikte alabilir", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3", "T4"] };
    const groups = [g("g1", ["T1", "T2"], 1), g("g2", ["T3", "T4"], 1)];
    expect(creditPartnerGroups(schedule, groups)).toEqual({ g1: 1, g2: 1 });
  });

  it("ortak üyesi olan iki grup aynı günden yalnızca biri sayılır", () => {
    // T3 her iki gruptaysa, tek bir gün iki kez sayılamaz.
    const schedule = { "2026-10-01": ["T1", "T2", "T3"] };
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 1)];
    const credit = creditPartnerGroups(schedule, groups);
    expect(credit.g1 + credit.g2).toBe(1);
  });

  it("çakışma durumunda daha kalabalık grup önceliklidir", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3"] };
    const groups = [g("small", ["T1", "T2"], 1), g("big", ["T1", "T2", "T3"], 1)];
    expect(creditPartnerGroups(schedule, groups)).toEqual({ big: 1, small: 0 });
  });

  it("üç kişilik bir grubu tam kadro olduğunda sayar", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3"], "2026-10-02": ["T1", "T2"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2", "T3"], 2)])).toEqual({ g1: 1 });
  });

  it("grup yoksa boş bir sonuç döndürür", () => {
    expect(creditPartnerGroups({ "2026-10-01": ["T1"] }, [])).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/solver/partners.test.ts`
Expected: FAIL — `creditPartnerGroups` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/solver/partners.ts`:

```ts
/**
 * How many days each group actually served together, read off a FINISHED
 * schedule rather than off what the placement phase intended.
 *
 * That choice is deliberate: if the ordinary search fills a leftover slot with
 * a teacher who happens to complete another group, that day counts for them.
 * Free wins are kept rather than discarded.
 *
 * Per day, groups are matched greedily, largest first (ties broken by id so the
 * result is deterministic), and a group is only credited when it shares no
 * member with a group already credited for that same day. Without that rule a
 * single teacher's one duty day would be counted toward two different groups
 * and the totals would stop matching the number of days actually served.
 */
export function creditPartnerGroups(
  schedule: Record<string, string[]>,
  groups: PartnerGroup[]
): Record<string, number> {
  const credit: Record<string, number> = {};
  for (const group of groups) {
    credit[group.id] = 0;
  }
  if (groups.length === 0) return credit;

  const ordered = [...groups].sort(
    (a, b) => b.memberIds.length - a.memberIds.length || a.id.localeCompare(b.id)
  );

  for (const assigned of Object.values(schedule)) {
    const present = new Set(assigned);
    const creditedToday: PartnerGroup[] = [];

    for (const group of ordered) {
      const allPresent = group.memberIds.every((m) => present.has(m));
      if (!allPresent) continue;
      if (creditedToday.some((other) => groupsOverlap(group, other))) continue;
      creditedToday.push(group);
      credit[group.id]++;
    }
  }

  return credit;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/solver/partners.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/solver/partners.ts tests/solver/partners.test.ts
git commit -m "feat(partners): credit groups from the finished schedule"
```

---

### Task 4: Place group days

This is the phase that runs *before* the existing backtracking search. It decides which duty days host which groups, and its output is fed into the assignments map the same way pinned assignments already are.

**Day capacity is the subtle rule here.** A day's headcount is `max(requiredOn(date), largest group placed on that date)`, and the total number of distinct teachers on the day may not exceed it. So a group of 3 expands a 1-teacher day to 3; a group of 2 on a 3-teacher day leaves one slot for the ordinary search; two groups of 2 fit a 4-teacher day but not a 3-teacher one.

**Files:**
- Modify: `src/solver/partners.ts`
- Test: `tests/solver/partners.test.ts` (add a second `describe`)

**Interfaces:**
- Consumes: `PartnerGroup`, `groupsOverlap`, `creditPartnerGroups` (Tasks 2–3); `AvailabilityStatus` from `src/solver/index`.
- Produces:

```ts
interface PlacementResult {
  placements: Record<string, string[]>;  // date -> groupIds placed on it
  placed: Record<string, number>;        // groupId -> days secured (placed + pre-credited pins)
}

placePartnerGroups(
  dates: string[],
  groups: PartnerGroup[],
  availabilities: Record<string, Record<string, AvailabilityStatus>>,
  requiredOn: (date: string) => number,
  pinnedAssignments: Record<string, string[]>
): PlacementResult
```

- [ ] **Step 1: Write the failing test**

Append to `tests/solver/partners.test.ts`:

```ts
import { placePartnerGroups } from "../../src/solver/partners";
import { AvailabilityStatus } from "../../src/solver/index";

const DATES = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"];

function allAvailable(
  ids: string[]
): Record<string, Record<string, AvailabilityStatus>> {
  const out: Record<string, Record<string, AvailabilityStatus>> = {};
  for (const id of ids) {
    out[id] = {};
    for (const d of DATES) out[id][d] = "available";
  }
  return out;
}

const membersOn = (
  result: { placements: Record<string, string[]> },
  date: string
): string[] => result.placements[date] ?? [];

describe("placePartnerGroups", () => {
  it("hedef kadar gün yerleştirir", () => {
    const groups = [g("g1", ["T1", "T2"], 2)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2"]),
      () => 1,
      {}
    );
    expect(result.placed.g1).toBe(2);
    const days = DATES.filter((d) => membersOn(result, d).includes("g1"));
    expect(days).toHaveLength(2);
  });

  it("üyelerden biri uygun değilse o günü kullanmaz", () => {
    const avail = allAvailable(["T1", "T2"]);
    avail["T2"]["2026-10-01"] = "unavailable";
    avail["T2"]["2026-10-02"] = "unavailable";
    avail["T2"]["2026-10-05"] = "unavailable";
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 2)],
      avail,
      () => 1,
      {}
    );
    expect(result.placed.g1).toBe(2);
    expect(membersOn(result, "2026-10-01")).toEqual([]);
    expect(membersOn(result, "2026-10-02")).toEqual([]);
    expect(membersOn(result, "2026-10-05")).toEqual([]);
  });

  it("yerleştirilemeyen günleri eksik olarak bildirir", () => {
    const avail = allAvailable(["T1", "T2"]);
    for (const d of DATES.slice(1)) avail["T2"][d] = "unavailable";
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 3)],
      avail,
      () => 1,
      {}
    );
    expect(result.placed.g1).toBe(1);
  });

  it("günlük nöbetçi sayısından kalabalık grup için günü genişletir", () => {
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2", "T3"], 1)],
      allAvailable(["T1", "T2", "T3"]),
      () => 1,
      {}
    );
    expect(result.placed.g1).toBe(1);
  });

  it("ortak üyesi olmayan iki grup aynı güne sığabilir", () => {
    const groups = [g("g1", ["T1", "T2"], 5), g("g2", ["T3", "T4"], 5)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2", "T3", "T4"]),
      () => 4,
      {}
    );
    expect(result.placed.g1).toBe(5);
    expect(result.placed.g2).toBe(5);
    const shared = DATES.filter((d) => membersOn(result, d).length === 2);
    expect(shared).toHaveLength(5);
  });

  it("gün kapasitesi yetmiyorsa iki grup aynı güne konmaz", () => {
    const groups = [g("g1", ["T1", "T2"], 5), g("g2", ["T3", "T4"], 5)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2", "T3", "T4"]),
      () => 3,
      {}
    );
    for (const d of DATES) {
      expect(membersOn(result, d).length).toBeLessThanOrEqual(1);
    }
  });

  it("ortak üyesi olan iki grup aynı güne konmaz", () => {
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 2)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2", "T3"]),
      () => 4,
      {}
    );
    expect(result.placed.g1).toBe(1);
    expect(result.placed.g2).toBe(2);
    for (const d of DATES) {
      expect(membersOn(result, d).length).toBeLessThanOrEqual(1);
    }
  });

  it("sabitlenmiş bir gün grubun tamamını içeriyorsa hedeften düşer", () => {
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 2)],
      allAvailable(["T1", "T2"]),
      () => 2,
      { "2026-10-01": ["T1", "T2"] }
    );
    expect(result.placed.g1).toBe(2);
    // Sabitlenen gün zaten sayıldığı için yalnızca 1 gün daha yerleştirilir.
    const placedDays = DATES.filter((d) => membersOn(result, d).includes("g1"));
    expect(placedDays).toHaveLength(1);
    expect(placedDays).not.toContain("2026-10-01");
  });

  it("en kısıtlı gruba öncelik verir", () => {
    // g1 yalnızca 1 günde mümkün; g2 her gün mümkün. İkisi de yerleşmeli.
    const avail = allAvailable(["T1", "T2", "T3", "T4"]);
    for (const d of DATES.slice(1)) avail["T2"][d] = "unavailable";
    const groups = [g("g2", ["T3", "T4"], 5), g("g1", ["T1", "T2"], 1)];
    const result = placePartnerGroups(DATES, groups, avail, () => 2, {});
    expect(result.placed.g1).toBe(1);
  });

  it("grup yoksa boş sonuç döndürür", () => {
    const result = placePartnerGroups(DATES, [], allAvailable(["T1"]), () => 1, {});
    expect(result.placements).toEqual({});
    expect(result.placed).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/solver/partners.test.ts`
Expected: FAIL — `placePartnerGroups` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/solver/partners.ts`. Add this import at the top of the file:

```ts
import type { AvailabilityStatus } from "./index";
```

**`import type`, not a plain import, is required here.** `index.ts` imports `placePartnerGroups` from this file as a value, so a plain import would close a genuine runtime cycle between the two modules. `import type` is erased at compile time, leaving the cycle type-only and harmless.

```ts
export interface PlacementResult {
  /** date -> ids of the groups deliberately placed on that date. */
  placements: Record<string, string[]>;
  /** groupId -> days secured, counting days already pinned with the full group. */
  placed: Record<string, number>;
}

/**
 * Decide which duty days host which groups. Runs BEFORE the main backtracking
 * search; its output is written into the assignments map the same way pinned
 * assignments are, which is what lets the rest of the pipeline stay unchanged.
 *
 * A day's headcount is max(requiredOn(date), largest group placed there), and
 * the distinct teachers on the day may not exceed it. So one group of 3 expands
 * a 1-teacher day, a group of 2 on a 3-teacher day leaves a slot for the
 * ordinary search, and two groups of 2 fit a 4-teacher day but not a 3.
 *
 * Groups are tried most-constrained-first — fewest feasible days relative to
 * what they still need — so a group with two possible days doesn't lose them to
 * a group that had ten options. When a group runs out of feasible days it is
 * simply left short: a partial answer plus a reported shortfall is far more use
 * to a principal than no answer at all, which is the same trade `respectTargets`
 * and `avoidConsecutiveDays` already make in the main search.
 *
 * Pure: no React, no database, no I/O.
 */
export function placePartnerGroups(
  dates: string[],
  groups: PartnerGroup[],
  availabilities: Record<string, Record<string, AvailabilityStatus>>,
  requiredOn: (date: string) => number,
  pinnedAssignments: Record<string, string[]>
): PlacementResult {
  const placements: Record<string, string[]> = {};
  const placed: Record<string, number> = {};
  if (groups.length === 0) return { placements, placed };

  const byId = new Map(groups.map((gr) => [gr.id, gr]));

  // Days the principal already pinned with a group's full membership count
  // toward that group before anything is placed — they made that choice by hand.
  const pinnedOnDutyDays: Record<string, string[]> = {};
  for (const date of dates) {
    if (pinnedAssignments[date]) pinnedOnDutyDays[date] = pinnedAssignments[date];
  }
  const preCredited = creditPartnerGroups(pinnedOnDutyDays, groups);

  // Days consumed by a pin-credited group are off limits to groups sharing a
  // member with it, exactly as if the group had been placed there.
  const reservedByPins: Record<string, string[]> = {};
  for (const [date, assigned] of Object.entries(pinnedOnDutyDays)) {
    const present = new Set(assigned);
    const here: string[] = [];
    const ordered = [...groups].sort(
      (a, b) => b.memberIds.length - a.memberIds.length || a.id.localeCompare(b.id)
    );
    for (const group of ordered) {
      if (!group.memberIds.every((m) => present.has(m))) continue;
      if (here.some((id) => groupsOverlap(group, byId.get(id)!))) continue;
      here.push(group.id);
    }
    if (here.length > 0) reservedByPins[date] = here;
  }

  const remaining = new Map<string, number>();
  for (const group of groups) {
    placed[group.id] = preCredited[group.id] ?? 0;
    remaining.set(group.id, Math.max(0, group.goalDays - placed[group.id]));
  }

  // Live state, mutated as groups are placed.
  const groupsOnDay: Record<string, string[]> = {};
  for (const [date, ids] of Object.entries(reservedByPins)) {
    groupsOnDay[date] = [...ids];
  }

  const teachersOnDay = (date: string): Set<string> => {
    const present = new Set(pinnedAssignments[date] ?? []);
    for (const id of groupsOnDay[date] ?? []) {
      for (const m of byId.get(id)!.memberIds) present.add(m);
    }
    return present;
  };

  const canPlace = (group: PartnerGroup, date: string): boolean => {
    if ((groupsOnDay[date] ?? []).includes(group.id)) return false;

    for (const memberId of group.memberIds) {
      if (availabilities[memberId]?.[date] === "unavailable") return false;
    }

    for (const otherId of groupsOnDay[date] ?? []) {
      if (groupsOverlap(group, byId.get(otherId)!)) return false;
    }

    const present = teachersOnDay(date);
    for (const m of group.memberIds) present.add(m);

    let largestGroup = group.memberIds.length;
    for (const otherId of groupsOnDay[date] ?? []) {
      largestGroup = Math.max(largestGroup, byId.get(otherId)!.memberIds.length);
    }

    return present.size <= Math.max(requiredOn(date), largestGroup);
  };

  const feasibleDays = (group: PartnerGroup): string[] =>
    dates.filter((d) => canPlace(group, d));

  // One (group, day) placement at a time. The most constrained group goes
  // first; within it, the least contested day goes first, so a day that only
  // one group can use isn't spent by a group with alternatives.
  for (;;) {
    let bestGroup: PartnerGroup | null = null;
    let bestDays: string[] = [];
    let bestSlack = Infinity;

    for (const group of groups) {
      const need = remaining.get(group.id)!;
      if (need <= 0) continue;
      const days = feasibleDays(group);
      const slack = days.length - need;
      if (slack < bestSlack) {
        bestSlack = slack;
        bestGroup = group;
        bestDays = days;
      }
    }

    if (!bestGroup) break;

    if (bestDays.length === 0) {
      // Nothing left for this group; leave it short and move on to the others.
      remaining.set(bestGroup.id, 0);
      continue;
    }

    const contention = (date: string): number =>
      groups.filter((other) => (remaining.get(other.id) ?? 0) > 0 && canPlace(other, date))
        .length;

    const chosen = [...bestDays].sort(
      (a, b) => contention(a) - contention(b) || a.localeCompare(b)
    )[0];

    groupsOnDay[chosen] = [...(groupsOnDay[chosen] ?? []), bestGroup.id];
    placements[chosen] = [...(placements[chosen] ?? []), bestGroup.id];
    placed[bestGroup.id]++;
    remaining.set(bestGroup.id, remaining.get(bestGroup.id)! - 1);
  }

  return { placements, placed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/solver/partners.test.ts`
Expected: PASS, 18 tests (8 from Task 3 plus 10 here).

- [ ] **Step 5: Commit**

```bash
git add src/solver/partners.ts tests/solver/partners.test.ts
git commit -m "feat(partners): place group duty days before the main search"
```

---

### Task 5: Wire partner groups into solve()

**Files:**
- Modify: `src/solver/index.ts`
- Test: `tests/solver.test.ts` (add a new `describe` at the end)

**Interfaces:**
- Consumes: `placePartnerGroups`, `creditPartnerGroups`, `PartnerGroup` (Tasks 2–4).
- Produces:
  - `SolverConfig.partnerGroups?: PartnerGroup[]`
  - `SolverResult.unfilledGroups?: { groupId: string; goal: number; placed: number }[]` — present only when the month has groups.
  - `src/solver/index.ts` re-exports `PartnerGroup`.

- [ ] **Step 1: Write the failing test**

Append to `tests/solver.test.ts`:

```ts
describe("Nöbet grupları (partner groups)", () => {
  it("grup üyelerini aynı günlere birlikte yerleştirir", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    const together = mockDates.filter(
      (d) => schedule[d].includes("T1") && schedule[d].includes("T2")
    );
    expect(together.length).toBeGreaterThanOrEqual(2);
    expect(result.unfilledGroups).toEqual([]);
  });

  it("günlük nöbetçi sayısı 1 olsa da üç kişilik grup birlikte görev alır", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2", "T4"], goalDays: 1 }],
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    const groupDays = mockDates.filter((d) => schedule[d].length === 3);
    expect(groupDays).toHaveLength(1);
    expect(schedule[groupDays[0]].sort()).toEqual(["T1", "T2", "T4"]);
    // Diğer günler tek nöbetçiyle kalır.
    for (const d of mockDates) {
      if (d !== groupDays[0]) expect(schedule[d]).toHaveLength(1);
    }
  });

  it("yerleştirilemeyen ortak günleri bildirir ama çizelgeyi yine de üretir", () => {
    // T2 yalnızca tek bir günde uygun; 3 ortak gün mümkün değil.
    for (const d of mockDates.slice(1)) {
      mockAvailabilities["T2"][d] = "unavailable";
    }

    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 3 }],
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    expect(result.schedule).toBeDefined();
    expect(result.unfilledGroups).toEqual([{ groupId: "g1", goal: 3, placed: 1 }]);
  });

  it("sabitlenmiş tam kadro bir gün grubun hedefinden düşer", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 2,
      pinnedAssignments: { "2026-10-01": ["T1", "T2"] },
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }],
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    expect(result.unfilledGroups).toEqual([]);
    const schedule = result.schedule!;
    const together = mockDates.filter(
      (d) => schedule[d].includes("T1") && schedule[d].includes("T2")
    );
    expect(together).toContain("2026-10-01");
  });

  it("grup günleri üst üste iki gün kuralına tabidir", () => {
    const config: SolverConfig = {
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }],
      avoidConsecutiveDays: true,
    };

    const result = solve(mockDates, mockTeachers, mockAvailabilities, config);

    expect(result.success).toBe(true);
    const schedule = result.schedule!;
    for (const teacherId of ["T1", "T2", "T3", "T4"]) {
      for (const d of mockDates) {
        if (!schedule[d].includes(teacherId)) continue;
        expect(schedule[shiftDate(d, 1)]?.includes(teacherId) ?? false).toBe(false);
      }
    }
  });

  it("grup tanımlı olmayan bir ay eskisiyle birebir aynı sonucu verir", () => {
    const base: SolverConfig = {
      mode: "strict",
      teachersPerDay: 1,
      pinnedAssignments: {},
    };

    const without = solve(mockDates, mockTeachers, mockAvailabilities, base);
    const withEmpty = solve(mockDates, mockTeachers, mockAvailabilities, {
      ...base,
      partnerGroups: [],
    });

    expect(without.schedule).toEqual(withEmpty.schedule);
    expect(without.unfilledGroups).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/solver.test.ts`
Expected: FAIL — `partnerGroups` is not a valid `SolverConfig` property.

- [ ] **Step 3: Write the implementation**

In `src/solver/index.ts`:

Add near the top, after the existing import:

```ts
import {
  PartnerGroup,
  placePartnerGroups,
  creditPartnerGroups,
} from "./partners";

export type { PartnerGroup } from "./partners";
```

Add to `SolverConfig`, after `avoidConsecutiveDays`:

```ts
  // Teachers who must share duty days, and how many days this month they are
  // meant to share. Placed BEFORE the main search — see placePartnerGroups —
  // so by the time the backtracker runs they are ordinary entries in
  // `assignments` and every existing rule applies to them unchanged. Absent on
  // months saved before this feature, which therefore behave exactly as before.
  partnerGroups?: PartnerGroup[];
```

Add to `SolverResult`, after `unfilled`:

```ts
  // Groups that could not serve together as many days as they were meant to.
  // Only present when the month actually has groups, so a month without them
  // returns the exact same shape it always has.
  unfilledGroups?: { groupId: string; goal: number; placed: number }[];
```

In the destructuring of `config`, add `partnerGroups = []`.

Immediately after the loop that populates `assignmentCounts` from pinned assignments, and before `const requiredOn = ...`, move `requiredOn` up (it is needed by placement) and add the placement phase:

```ts
  const requiredOn = (date: string): number =>
    typeof teachersPerDay === "number" ? teachersPerDay : (teachersPerDay[date] ?? 1);

  // Phase 1: partner groups. Their members are written into `assignments` the
  // same way pinned assignments are, which is the whole trick — the backtracking
  // search below needs no changes at all. Their duties are already in
  // `assignmentCounts`, so `respectTargets` counts them; they are already in
  // `assignments`, so `hasAdjacentDuty` sees them.
  const groupById = new Map(partnerGroups.map((gr) => [gr.id, gr]));
  if (partnerGroups.length > 0) {
    const { placements } = placePartnerGroups(
      dates,
      partnerGroups,
      availabilities,
      requiredOn,
      pinnedAssignments
    );

    for (const [date, groupIds] of Object.entries(placements)) {
      for (const groupId of groupIds) {
        for (const memberId of groupById.get(groupId)!.memberIds) {
          if (assignments[date].includes(memberId)) continue;
          assignments[date].push(memberId);
          if (assignmentCounts[memberId] !== undefined) assignmentCounts[memberId]++;
        }
      }
    }
  }
```

Delete the now-duplicated original `const requiredOn = ...` declaration further down.

Add a helper just below `hasAdjacentDuty`:

```ts
  // Would putting this teacher on this day complete a group that is still short?
  // Group credit is read off the FINISHED schedule, so a filler who happens to
  // reunite a group counts for it. This nudge is what makes that a deliberate
  // win rather than a coincidence. It only reorders candidates — it never makes
  // an illegal assignment legal.
  const shortGroups = (): PartnerGroup[] => {
    const credited = creditPartnerGroups(assignments, partnerGroups);
    return partnerGroups.filter((gr) => (credited[gr.id] ?? 0) < gr.goalDays);
  };
  const pendingGroups = partnerGroups.length > 0 ? shortGroups() : [];

  const completesGroup = (teacherId: string, date: string): boolean =>
    pendingGroups.some(
      (gr) =>
        gr.memberIds.includes(teacherId) &&
        gr.memberIds.every((m) => m === teacherId || assignments[date].includes(m))
    );
```

In the sort comparator inside `backtrack()`, insert this as the FIRST comparison, before the `preferred` check:

```ts
        if (pendingGroups.length > 0) {
          const aCompletes = completesGroup(a.id, dateToAssign);
          const bCompletes = completesGroup(b.id, dateToAssign);
          if (aCompletes !== bCompletes) return aCompletes ? -1 : 1;
        }
```

Finally, in the `if (success)` branch, after building `unfilled` and before the return:

```ts
    if (partnerGroups.length === 0) {
      return { success: true, schedule: assignments, unfilled };
    }

    const credited = creditPartnerGroups(assignments, partnerGroups);
    const unfilledGroups = partnerGroups
      .filter((gr) => (credited[gr.id] ?? 0) < gr.goalDays)
      .map((gr) => ({
        groupId: gr.id,
        goal: gr.goalDays,
        placed: credited[gr.id] ?? 0,
      }));

    return { success: true, schedule: assignments, unfilled, unfilledGroups };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/solver.test.ts`
Expected: PASS — the 6 new tests plus every pre-existing solver test still green. If any pre-existing test fails, the backward-compatibility promise is broken; fix that before moving on.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/solver/index.ts tests/solver.test.ts
git commit -m "feat(solver): place and credit partner groups around the main search"
```

---

### Task 6: Database support for per-month groups and the delete cascade

Deleting a teacher must not leave their id dangling inside another month's `partnerGroups` or `monthlyTargets`. Because `db.ts` is the only module allowed to issue SQL, the cascade lives there.

**Files:**
- Modify: `src/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `getAllSchedules(): Promise<DbSchedule[]>`
  - `deleteTeacher(id)` additionally rewrites every schedule row's config: the teacher is removed from `monthlyTargets` and from every group's `memberIds`, and a group left with fewer than 2 members is dropped.

- [ ] **Step 1: Write the failing test**

Read `tests/db.test.ts` first to match its existing mocking style for `@tauri-apps/plugin-sql`, then append:

```ts
describe("öğretmen silindiğinde aylık gruplar ve hedefler temizlenir", () => {
  it("silinen öğretmeni gruplardan ve aylık hedeflerden çıkarır", async () => {
    const config = JSON.stringify({
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [
        { id: "g1", memberIds: ["T1", "T2", "T3"], goalDays: 2 },
        { id: "g2", memberIds: ["T1", "T2"], goalDays: 1 },
      ],
      monthlyTargets: { T1: 5, T2: 3 },
    });

    mockSelect.mockResolvedValue([
      { id: "s1", year: 2026, month: 10, assignments: "{}", holidays: "[]", weekend_duty_days: "[]", config },
    ]);

    await deleteTeacher("T1");

    const rewrite = mockExecute.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("UPDATE schedules")
    );
    expect(rewrite).toBeDefined();
    const written = JSON.parse(rewrite![1][0] as string);

    // g1 iki üyeyle ayakta kalır, g2 tek üye kaldığı için silinir.
    expect(written.partnerGroups).toEqual([
      { id: "g1", memberIds: ["T2", "T3"], goalDays: 2 },
    ]);
    expect(written.monthlyTargets).toEqual({ T2: 3 });
  });

  it("grubu olmayan aylara dokunmaz", async () => {
    const config = JSON.stringify({ mode: "fairness", teachersPerDay: 1, pinnedAssignments: {} });
    mockSelect.mockResolvedValue([
      { id: "s1", year: 2026, month: 10, assignments: "{}", holidays: "[]", weekend_duty_days: "[]", config },
    ]);

    await deleteTeacher("T1");

    const rewrite = mockExecute.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("UPDATE schedules")
    );
    expect(rewrite).toBeUndefined();
  });
});
```

If `tests/db.test.ts` does not already expose `mockSelect` / `mockExecute` handles, create them in this describe block using the same `vi.mock("@tauri-apps/plugin-sql", ...)` factory the file already uses, rather than restructuring the existing tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — no `UPDATE schedules` statement is issued.

- [ ] **Step 3: Write the implementation**

In `src/db.ts`, add after `getSchedule`:

```ts
export async function getAllSchedules(): Promise<DbSchedule[]> {
  const db = await getDb();
  const rows = await db.select<DbSchedule[]>(
    "SELECT * FROM schedules ORDER BY year ASC, month ASC"
  );
  return rows || [];
}
```

Replace `deleteTeacher` with:

```ts
export async function deleteTeacher(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM teachers WHERE id = $1", [id]);
  await db.execute("DELETE FROM availabilities WHERE teacher_id = $1", [id]);

  // Partner groups and monthly duty targets live inside each month's config
  // blob, so a deleted teacher would otherwise linger there as a dangling id
  // and reappear as a phantom member the next time that month is opened. A
  // group left with fewer than two members is no longer a group, so it goes too.
  const schedules = await getAllSchedules();
  for (const row of schedules) {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(row.config);
    } catch {
      continue; // an unreadable config is not this function's problem to fix
    }

    const groups = Array.isArray(config.partnerGroups)
      ? (config.partnerGroups as { id: string; memberIds: string[]; goalDays: number }[])
      : [];
    const targets = (config.monthlyTargets ?? {}) as Record<string, number>;

    const touchesGroups = groups.some((gr) => gr.memberIds.includes(id));
    const touchesTargets = Object.prototype.hasOwnProperty.call(targets, id);
    if (!touchesGroups && !touchesTargets) continue;

    const nextGroups = groups
      .map((gr) => ({ ...gr, memberIds: gr.memberIds.filter((m) => m !== id) }))
      .filter((gr) => gr.memberIds.length >= 2);

    const nextTargets = { ...targets };
    delete nextTargets[id];

    const nextConfig = JSON.stringify({
      ...config,
      partnerGroups: nextGroups,
      monthlyTargets: nextTargets,
    });

    await db.execute("UPDATE schedules SET config = $1 WHERE id = $2", [
      nextConfig,
      row.id,
    ]);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS — the 2 new tests plus every pre-existing db test.

- [ ] **Step 5: Commit**

```bash
git add src/db.ts tests/db.test.ts
git commit -m "feat(db): cascade teacher deletion into every month's groups and targets"
```

---

### Task 7: Month-scoped groups and targets in useScheduleState

**Files:**
- Modify: `src/hooks/useScheduleState.ts`
- Test: `tests/hooks/useScheduleState.test.ts`

**Interfaces:**
- Consumes: `PartnerGroup` (Task 2), `getAllSchedules` (Task 6).
- Produces, on the hook's return value:
  - `partnerGroups: PartnerGroup[]`, `setPartnerGroups`
  - `monthlyTargets: Record<string, number>`, `setMonthlyTargets`
  - `copyPartnersFromMonth(year: number, month: number, teacherIds: string[]): Promise<boolean>`
  - `availablePartnerMonths(): Promise<{ year: number; month: number }[]>`

- [ ] **Step 1: Write the failing test**

Append to `tests/hooks/useScheduleState.test.ts`, matching the file's existing `renderHook` + `vi.mock("../../src/db")` setup:

```ts
describe("aylık nöbet grupları ve hedefleri", () => {
  it("kaydedilmiş aydan grupları ve hedefleri yükler", async () => {
    vi.mocked(getSchedule).mockResolvedValue({
      id: "s1",
      year: 2026,
      month: 10,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: JSON.stringify({
        mode: "fairness",
        teachersPerDay: 1,
        pinnedAssignments: {},
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
        monthlyTargets: { T1: 5 },
      }),
    });

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    expect(result.current.partnerGroups).toEqual([
      { id: "g1", memberIds: ["T1", "T2"], goalDays: 2 },
    ]);
    expect(result.current.monthlyTargets).toEqual({ T1: 5 });
  });

  it("bu anahtarları içermeyen eski ayları boş olarak yükler", async () => {
    vi.mocked(getSchedule).mockResolvedValue({
      id: "s1",
      year: 2026,
      month: 10,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: JSON.stringify({ mode: "fairness", teachersPerDay: 1, pinnedAssignments: {} }),
    });

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    expect(result.current.partnerGroups).toEqual([]);
    expect(result.current.monthlyTargets).toEqual({});
  });

  it("grup eklemek ayı değişmiş sayar", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setPartnerGroups([{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }]);
    });
    expect(result.current.isDirty).toBe(true);
  });

  it("aylık hedef değiştirmek ayı değişmiş sayar", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    act(() => {
      result.current.setMonthlyTargets({ T1: 3 });
    });
    expect(result.current.isDirty).toBe(true);
  });

  it("grupları ve hedefleri ay kaydına yazar", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
    });

    act(() => {
      result.current.setPartnerGroups([{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }]);
      result.current.setMonthlyTargets({ T1: 3 });
    });
    await act(async () => {
      await result.current.saveDraftToDb();
    });

    const saved = vi.mocked(saveSchedule).mock.calls.at(-1)![0];
    const config = JSON.parse(saved.config);
    expect(config.partnerGroups).toEqual([{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }]);
    expect(config.monthlyTargets).toEqual({ T1: 3 });
  });

  it("başka bir aydan grupları yeni kimliklerle kopyalar", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    vi.mocked(getAllSchedules).mockResolvedValue([
      {
        id: "s1",
        year: 2026,
        month: 9,
        assignments: "{}",
        holidays: "[]",
        weekend_duty_days: "[]",
        config: JSON.stringify({
          partnerGroups: [{ id: "old", memberIds: ["T1", "T2"], goalDays: 2 }],
          monthlyTargets: { T1: 5 },
        }),
      },
    ]);

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
      await result.current.copyPartnersFromMonth(2026, 9, ["T1", "T2"]);
    });

    expect(result.current.partnerGroups).toHaveLength(1);
    expect(result.current.partnerGroups[0].memberIds).toEqual(["T1", "T2"]);
    expect(result.current.partnerGroups[0].goalDays).toBe(2);
    expect(result.current.partnerGroups[0].id).not.toBe("old");
    expect(result.current.monthlyTargets).toEqual({ T1: 5 });
  });

  it("kopyalarken kadroda olmayan üyeleri atar ve tek üye kalan grubu almaz", async () => {
    vi.mocked(getSchedule).mockResolvedValue(null);
    vi.mocked(getAllSchedules).mockResolvedValue([
      {
        id: "s1",
        year: 2026,
        month: 9,
        assignments: "{}",
        holidays: "[]",
        weekend_duty_days: "[]",
        config: JSON.stringify({
          partnerGroups: [
            { id: "old1", memberIds: ["T1", "TX"], goalDays: 2 },
            { id: "old2", memberIds: ["T1", "T2", "TX"], goalDays: 1 },
          ],
          monthlyTargets: { T1: 5, TX: 9 },
        }),
      },
    ]);

    const { result } = renderHook(() => useScheduleState());
    await act(async () => {
      await result.current.loadScheduleData(2026, 10);
      await result.current.copyPartnersFromMonth(2026, 9, ["T1", "T2"]);
    });

    expect(result.current.partnerGroups).toHaveLength(1);
    expect(result.current.partnerGroups[0].memberIds).toEqual(["T1", "T2"]);
    expect(result.current.monthlyTargets).toEqual({ T1: 5 });
  });
});
```

Add `getAllSchedules` to the file's existing `vi.mock("../../src/db")` factory and to its imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hooks/useScheduleState.test.ts`
Expected: FAIL — `result.current.partnerGroups` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/hooks/useScheduleState.ts`:

Update the imports:

```ts
import { getSchedule, saveSchedule, getAllSchedules, DbSchedule } from "../db";
import { PartnerGroup } from "../solver/partners";
```

Add to `ScheduleSnapshot`:

```ts
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
```

Add the state, next to `pinnedAssignments`:

```ts
  // Teachers who must share duty days this month, and how many days they share.
  // Month-scoped on purpose: a pairing that makes sense in March may not in April.
  const [partnerGroups, setPartnerGroups] = useState<PartnerGroup[]>([]);
  // This month's duty target overrides. A teacher absent from this map keeps
  // their usual `teachers.target_hours` — resolve it via effectiveTarget(), never
  // by reading this map directly.
  const [monthlyTargets, setMonthlyTargets] = useState<Record<string, number>>({});
```

Add both to the `isDirty` comparison object, to both `setBaseline` calls in `loadScheduleData`, and to the `setBaseline` call in `saveGeneratedScheduleToDb`.

In the `savedSched` branch of `loadScheduleData`, read them (defaulting to empty, which is what keeps pre-feature months behaving as they always did):

```ts
        const loadedPartnerGroups: PartnerGroup[] = configObj.partnerGroups || [];
        const loadedMonthlyTargets: Record<string, number> = configObj.monthlyTargets || {};
        setPartnerGroups(loadedPartnerGroups);
        setMonthlyTargets(loadedMonthlyTargets);
```

In the `else` branch, reset both:

```ts
        setPartnerGroups([]);
        setMonthlyTargets({});
```

with `partnerGroups: []` and `monthlyTargets: {}` in that branch's baseline.

Add both keys to the `config` object in `saveGeneratedScheduleToDb`:

```ts
          partnerGroups: partnerGroups,
          monthlyTargets: monthlyTargets,
```

Add the copy helpers before the `return`:

```ts
  /** Months that already have partner groups defined, newest first. */
  const availablePartnerMonths = async (): Promise<{ year: number; month: number }[]> => {
    try {
      const rows = await getAllSchedules();
      return rows
        .filter((row) => {
          try {
            const config = JSON.parse(row.config);
            return Array.isArray(config.partnerGroups) && config.partnerGroups.length > 0;
          } catch {
            return false;
          }
        })
        .map((row) => ({ year: row.year, month: row.month }))
        .sort((a, b) => b.year - a.year || b.month - a.month);
    } catch (err) {
      console.error("Gruplu aylar okunamadı:", err);
      return [];
    }
  };

  /**
   * Seed this month from another one. Copies are independent: the groups get
   * fresh ids so the two months can never be confused for each other, and
   * members who have since left the roster are dropped (a group left with fewer
   * than 2 members is not copied at all).
   */
  const copyPartnersFromMonth = async (
    year: number,
    month: number,
    teacherIds: string[]
  ): Promise<boolean> => {
    try {
      const rows = await getAllSchedules();
      const source = rows.find((row) => row.year === year && row.month === month);
      if (!source) return false;

      const config = JSON.parse(source.config);
      const sourceGroups: PartnerGroup[] = config.partnerGroups || [];
      const sourceTargets: Record<string, number> = config.monthlyTargets || {};

      const known = new Set(teacherIds);
      const copied = sourceGroups
        .map((group) => ({
          id: crypto.randomUUID(),
          memberIds: group.memberIds.filter((m) => known.has(m)),
          goalDays: group.goalDays,
        }))
        .filter((group) => group.memberIds.length >= 2);

      const targets: Record<string, number> = {};
      for (const [teacherId, value] of Object.entries(sourceTargets)) {
        if (known.has(teacherId)) targets[teacherId] = value;
      }

      setPartnerGroups(copied);
      setMonthlyTargets(targets);
      return true;
    } catch (err) {
      console.error("Gruplar kopyalanamadı:", err);
      return false;
    }
  };
```

Add all five names to the hook's returned object: `partnerGroups`, `setPartnerGroups`, `monthlyTargets`, `setMonthlyTargets`, `copyPartnersFromMonth`, `availablePartnerMonths`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hooks/useScheduleState.test.ts`
Expected: PASS — the 7 new tests plus every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useScheduleState.ts tests/hooks/useScheduleState.test.ts
git commit -m "feat(schedule-state): hold partner groups and monthly targets per month"
```

---

### Task 8: The PartnerGroups roster card

**Files:**
- Create: `src/components/PartnerGroups.tsx`
- Test: `tests/components/PartnerGroups.test.tsx`

**Interfaces:**
- Consumes: `PartnerGroup` (Task 2), `validatePartnerGroups` (Task 2), `effectiveTarget` (Task 1).
- Produces:

```ts
interface PartnerGroupsProps {
  teachers: DbTeacher[];
  monthLabel: string;                       // e.g. "Ekim 2026"
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
  onChangeGroups: (groups: PartnerGroup[]) => void;
  copyMonths: { year: number; month: number }[];
  onCopyFromMonth: (year: number, month: number) => void;
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/components/PartnerGroups.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartnerGroups } from "../../src/components/PartnerGroups";
import { DbTeacher } from "../../src/db";

const teachers: DbTeacher[] = [
  { id: "T1", name: "Ali", target_hours: 4, priority: 1 },
  { id: "T2", name: "Ayşe", target_hours: 2, priority: 1 },
  { id: "T3", name: "Can", target_hours: 3, priority: 1 },
];

function renderCard(overrides: Partial<React.ComponentProps<typeof PartnerGroups>> = {}) {
  const onChangeGroups = vi.fn();
  const onCopyFromMonth = vi.fn();
  render(
    <PartnerGroups
      teachers={teachers}
      monthLabel="Ekim 2026"
      partnerGroups={[]}
      monthlyTargets={{}}
      onChangeGroups={onChangeGroups}
      copyMonths={[]}
      onCopyFromMonth={onCopyFromMonth}
      {...overrides}
    />
  );
  return { onChangeGroups, onCopyFromMonth };
}

describe("PartnerGroups", () => {
  it("hangi aya ait olduğunu başlıkta gösterir", () => {
    renderCard();
    expect(screen.getByText(/Ekim 2026/)).toBeInTheDocument();
  });

  it("grup yokken açıklayıcı bir mesaj gösterir", () => {
    renderCard();
    expect(screen.getByText(/henüz nöbet grubu tanımlanmadı/i)).toBeInTheDocument();
  });

  it("tanımlı grupları üye adları ve gün sayısıyla listeler", () => {
    renderCard({
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T3"], goalDays: 2 }],
    });
    expect(screen.getByText(/Ali \+ Can/)).toBeInTheDocument();
    expect(screen.getByText(/2 gün/)).toBeInTheDocument();
  });

  it("iki öğretmen ve gün sayısı seçilince yeni grup ekler", async () => {
    const user = userEvent.setup();
    const { onChangeGroups } = renderCard();

    await user.click(screen.getByRole("checkbox", { name: /Ali/ }));
    await user.click(screen.getByRole("checkbox", { name: /Can/ }));
    const goal = screen.getByLabelText(/Ortak nöbet günü/i);
    await user.clear(goal);
    await user.type(goal, "2");
    await user.click(screen.getByRole("button", { name: /Grubu Kaydet/i }));

    expect(onChangeGroups).toHaveBeenCalledTimes(1);
    const saved = onChangeGroups.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].memberIds.sort()).toEqual(["T1", "T3"]);
    expect(saved[0].goalDays).toBe(2);
  });

  it("tek öğretmenle grup kaydettirmez", async () => {
    const user = userEvent.setup();
    const { onChangeGroups } = renderCard();

    await user.click(screen.getByRole("checkbox", { name: /Ali/ }));
    await user.click(screen.getByRole("button", { name: /Grubu Kaydet/i }));

    expect(onChangeGroups).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/en az 2 öğretmen/i);
  });

  it("aylık hedefi aşan grubu kaydetmez ve öğretmeni adıyla uyarır", async () => {
    const user = userEvent.setup();
    // Ayşe'nin hedefi 2; 3 günlük bir grup fazla.
    const { onChangeGroups } = renderCard();

    await user.click(screen.getByRole("checkbox", { name: /Ali/ }));
    await user.click(screen.getByRole("checkbox", { name: /Ayşe/ }));
    const goal = screen.getByLabelText(/Ortak nöbet günü/i);
    await user.clear(goal);
    await user.type(goal, "3");
    await user.click(screen.getByRole("button", { name: /Grubu Kaydet/i }));

    expect(onChangeGroups).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Ayşe/);
  });

  it("grubu siler", async () => {
    const user = userEvent.setup();
    const { onChangeGroups } = renderCard({
      partnerGroups: [
        { id: "g1", memberIds: ["T1", "T3"], goalDays: 2 },
        { id: "g2", memberIds: ["T2", "T3"], goalDays: 1 },
      ],
    });

    await user.click(screen.getAllByRole("button", { name: /Grubu Sil/i })[0]);

    expect(onChangeGroups).toHaveBeenCalledWith([
      { id: "g2", memberIds: ["T2", "T3"], goalDays: 1 },
    ]);
  });

  it("kopyalanacak ay yoksa kopyalama seçeneğini göstermez", () => {
    renderCard({ copyMonths: [] });
    expect(screen.queryByRole("button", { name: /kopyala/i })).not.toBeInTheDocument();
  });

  it("seçilen aydan kopyalamayı tetikler", async () => {
    const user = userEvent.setup();
    const { onCopyFromMonth } = renderCard({ copyMonths: [{ year: 2026, month: 9 }] });

    await user.click(screen.getByRole("button", { name: /kopyala/i }));

    expect(onCopyFromMonth).toHaveBeenCalledWith(2026, 9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/PartnerGroups.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/PartnerGroups`.

- [ ] **Step 3: Write the implementation**

Create `src/components/PartnerGroups.tsx`:

```tsx
import React, { useState } from "react";
import { DbTeacher } from "../db";
import { PartnerGroup } from "../solver/partners";
import { validatePartnerGroups } from "../solver/validation";
import { effectiveTarget } from "../utils/targets";
import { MONTHS_TR } from "../utils/dateUtils";

interface PartnerGroupsProps {
  teachers: DbTeacher[];
  /** e.g. "Ekim 2026" — groups belong to one month, so the card says which. */
  monthLabel: string;
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
  onChangeGroups: (groups: PartnerGroup[]) => void;
  copyMonths: { year: number; month: number }[];
  onCopyFromMonth: (year: number, month: number) => void;
}

export const PartnerGroups: React.FC<PartnerGroupsProps> = ({
  teachers,
  monthLabel,
  partnerGroups,
  monthlyTargets,
  onChangeGroups,
  copyMonths,
  onCopyFromMonth,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [goalDays, setGoalDays] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [copySelection, setCopySelection] = useState<string>(
    copyMonths.length > 0 ? `${copyMonths[0].year}-${copyMonths[0].month}` : ""
  );

  const nameOf = (id: string) => teachers.find((t) => t.id === id)?.name ?? id;

  // How many joint days each teacher is already committed to this month. Shown
  // next to their checkbox so the principal can see why a save would be refused
  // before they attempt it, rather than only after.
  const committedDays = (teacherId: string): number =>
    partnerGroups
      .filter((group) => group.memberIds.includes(teacherId))
      .reduce((sum, group) => sum + group.goalDays, 0);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const candidate: PartnerGroup = {
      id: crypto.randomUUID(),
      memberIds: [...selectedIds],
      goalDays: Number(goalDays),
    };

    // Validate the whole month, not just this group: over-commitment is a
    // property of every group a teacher belongs to, so it can only be judged
    // against the full set. Only issues this group is responsible for are
    // reported back, though — the principal is trying to save THIS group.
    const issues = validatePartnerGroups(
      [...partnerGroups, candidate],
      teachers,
      monthlyTargets
    );
    const blocking = issues.find(
      (issue) =>
        issue.groupId === candidate.id ||
        (issue.teacherId !== undefined && candidate.memberIds.includes(issue.teacherId))
    );

    if (blocking) {
      setError(blocking.message);
      return;
    }

    onChangeGroups([...partnerGroups, candidate]);
    setSelectedIds([]);
    setGoalDays(1);
  };

  const handleDelete = (id: string) => {
    setError(null);
    onChangeGroups(partnerGroups.filter((group) => group.id !== id));
  };

  const handleCopy = () => {
    const [year, month] = copySelection.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;
    setError(null);
    onCopyFromMonth(year, month);
  };

  return (
    <div className="card" style={{ marginBottom: "20px" }}>
      <h3
        style={{
          margin: "0 0 4px 0",
          color: "var(--primary)",
          fontWeight: "800",
          fontSize: "1.1rem",
        }}
      >
        Nöbet Grupları
      </h3>
      <p style={{ margin: "0 0 14px 0", fontSize: "0.78rem", color: "var(--slate-500)" }}>
        {monthLabel} için birlikte nöbet tutacak öğretmenler.
      </p>

      {partnerGroups.length === 0 ? (
        <div className="alert alert-info" style={{ margin: "0 0 14px 0", fontSize: "0.8rem" }}>
          {monthLabel} için henüz nöbet grubu tanımlanmadı.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 14px 0", padding: 0 }}>
          {partnerGroups.map((group) => (
            <li
              key={group.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                padding: "8px 10px",
                marginBottom: "6px",
                borderRadius: "8px",
                border: "1px solid var(--slate-200)",
                backgroundColor: "var(--bg-content)",
              }}
            >
              <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>
                {group.memberIds.map(nameOf).join(" + ")}
              </span>
              <span style={{ fontSize: "0.78rem", color: "var(--slate-500)" }}>
                {group.goalDays} gün
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                onClick={() => handleDelete(group.id)}
              >
                Grubu Sil
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit}>
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px 0" }}>
          <legend style={{ fontSize: "0.82rem", fontWeight: 700, padding: 0 }}>
            Gruba girecek öğretmenler
          </legend>
          <div style={{ maxHeight: "160px", overflowY: "auto", marginTop: "6px" }}>
            {teachers.map((teacher) => {
              const committed = committedDays(teacher.id);
              const target = effectiveTarget(teacher, monthlyTargets);
              return (
                <label
                  key={teacher.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "0.8rem",
                    padding: "3px 0",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(teacher.id)}
                    onChange={() => toggleMember(teacher.id)}
                  />
                  <span>{teacher.name}</span>
                  <span style={{ marginLeft: "auto", color: "var(--slate-500)" }}>
                    {committed}/{target}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="form-group">
          <label htmlFor="partner-goal-days-input">Ortak nöbet günü sayısı</label>
          <input
            type="number"
            id="partner-goal-days-input"
            className="form-control"
            min="1"
            max="20"
            value={goalDays}
            onChange={(e) => setGoalDays(Number(e.target.value))}
            required
          />
        </div>

        {error && (
          <div
            className="alert alert-danger"
            role="alert"
            style={{ margin: "0 0 12px 0", fontSize: "0.78rem" }}
          >
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
          Grubu Kaydet
        </button>
      </form>

      {copyMonths.length > 0 && (
        <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--slate-200)" }}>
          <div className="form-group" style={{ marginBottom: "8px" }}>
            <label htmlFor="partner-copy-month-select">Başka aydan kopyala</label>
            <select
              id="partner-copy-month-select"
              className="form-control"
              value={copySelection}
              onChange={(e) => setCopySelection(e.target.value)}
            >
              {copyMonths.map(({ year, month }) => (
                <option key={`${year}-${month}`} value={`${year}-${month}`}>
                  {MONTHS_TR[month - 1]} {year}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: "100%" }}
            onClick={handleCopy}
          >
            Seçilen aydan kopyala
          </button>
        </div>
      )}
    </div>
  );
};
```

Two things worth understanding rather than just copying. The submit handler validates `[...partnerGroups, candidate]` — the whole month — because over-commitment is a property of *every* group a teacher belongs to and cannot be judged from one group alone; it then filters down to issues this group is responsible for, since that is what the principal is trying to save. And every control is its own focusable element with no nesting, matching the deliberate accessibility structure documented in `TeacherList.tsx`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/PartnerGroups.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Check accessibility**

Run: `npx vitest run tests/formControlStyling.test.tsx`
Expected: PASS. If that suite scans all components for form-control conventions, fix any violation it reports in the new card.

- [ ] **Step 6: Commit**

```bash
git add src/components/PartnerGroups.tsx tests/components/PartnerGroups.test.tsx
git commit -m "feat(roster): add the partner groups card"
```

---

### Task 9: Monthly targets in the teacher form and list

**Files:**
- Modify: `src/hooks/useTeachers.ts`
- Modify: `src/components/TeacherForm.tsx`
- Modify: `src/components/TeacherList.tsx`
- Modify: `src/App.tsx` — **call sites only.** Changing `handleSaveTeacherSubmit`'s and `handleEditTeacherClick`'s signatures breaks `App.tsx` the moment this task lands, and Task 10 is too late to fix it. Update the two call sites here so the tree type-checks at this task boundary; Task 10 does the rest of the wiring.
- Test: `tests/hooks/useTeachers.test.ts`, `tests/components/TeacherForm.test.tsx`, `tests/components/TeacherList.test.tsx`

**Interfaces:**
- Consumes: `effectiveTarget` (Task 1), `PartnerGroup` (Task 2).
- Produces:
  - `handleSaveTeacherSubmit(e, ctx)` where `ctx: { partnerGroups: PartnerGroup[]; monthlyTargets: Record<string, number>; applyMonthlyTarget: (teacherId: string, target: number) => void }`. Returns `false` and sets `teacherError` when the new target drops below the teacher's group commitments for this month.
  - `teacherError: string | null` on the hook's return value.
  - `TeacherForm` gains `monthLabel: string` and `usualTarget: number | null`.
  - `TeacherList` gains `monthlyTargets: Record<string, number>` and `partnerGroups: PartnerGroup[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hooks/useTeachers.test.ts`:

```ts
describe("aylık nöbet hedefi", () => {
  const ctx = (overrides = {}) => ({
    partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 3 }],
    monthlyTargets: {},
    applyMonthlyTarget: vi.fn(),
    ...overrides,
  });

  it("kaydederken hedefi bu aya yazar", async () => {
    vi.mocked(getTeachers).mockResolvedValue([
      { id: "T1", name: "Ali", target_hours: 4, priority: 1 },
    ]);
    const { result } = renderHook(() => useTeachers());
    await act(async () => { await result.current.loadTeachers(); });

    act(() => {
      result.current.handleEditTeacherClick({ id: "T1", name: "Ali", target_hours: 4, priority: 1 });
      result.current.setTeacherTarget(5);
    });

    const context = ctx();
    await act(async () => {
      await result.current.handleSaveTeacherSubmit(undefined, context);
    });

    expect(context.applyMonthlyTarget).toHaveBeenCalledWith("T1", 5);
  });

  it("grup taahhüdünün altına inen hedefi reddeder", async () => {
    vi.mocked(getTeachers).mockResolvedValue([
      { id: "T1", name: "Ali", target_hours: 4, priority: 1 },
      { id: "T2", name: "Ayşe", target_hours: 4, priority: 1 },
    ]);
    const { result } = renderHook(() => useTeachers());
    await act(async () => { await result.current.loadTeachers(); });

    act(() => {
      result.current.handleEditTeacherClick({ id: "T1", name: "Ali", target_hours: 4, priority: 1 });
      result.current.setTeacherTarget(2); // g1 3 gün istiyor
    });

    const context = ctx();
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.handleSaveTeacherSubmit(undefined, context);
    });

    expect(saved).toBe(false);
    expect(context.applyMonthlyTarget).not.toHaveBeenCalled();
    expect(result.current.teacherError).toMatch(/Ali/);
  });
});
```

Append to `tests/components/TeacherForm.test.tsx`:

```tsx
it("hedef alanının hangi aya ait olduğunu belirtir", () => {
  renderForm({ monthLabel: "Ekim 2026", usualTarget: 4 });
  expect(screen.getByText(/Ekim 2026/)).toBeInTheDocument();
});

it("aylık hedef genel hedeften farklıysa bunu belirtir", () => {
  renderForm({ monthLabel: "Ekim 2026", usualTarget: 4, teacherTarget: 6 });
  expect(screen.getByText(/genel hedefi 4/i)).toBeInTheDocument();
});
```

(Extend the file's existing render helper with the two new props, defaulting `monthLabel` to `"Ekim 2026"` and `usualTarget` to `null`.)

Append to `tests/components/TeacherList.test.tsx`:

```tsx
it("öğretmenin bu aya ait hedefini gösterir", () => {
  renderList({
    teachers: [{ id: "T1", name: "Ali", target_hours: 4, priority: 1 }],
    monthlyTargets: { T1: 6 },
    partnerGroups: [],
  });
  expect(screen.getByText(/Hedef: 6/)).toBeInTheDocument();
});

it("hedefi gruplara tamamen bağlanmış öğretmeni işaretler", () => {
  renderList({
    teachers: [{ id: "T1", name: "Ali", target_hours: 2, priority: 1 }],
    monthlyTargets: {},
    partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
  });
  expect(screen.getByTitle(/tamamı gruplara ayrılmış/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hooks/useTeachers.test.ts tests/components/TeacherForm.test.tsx tests/components/TeacherList.test.tsx`
Expected: FAIL on all three files.

- [ ] **Step 3: Write the implementation**

`src/hooks/useTeachers.ts`:

```ts
import { effectiveTarget } from "../utils/targets";
import { PartnerGroup } from "../solver/partners";

export interface SaveTeacherContext {
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
  applyMonthlyTarget: (teacherId: string, target: number) => void;
}
```

Add `const [teacherError, setTeacherError] = useState<string | null>(null);` and return it.

Rewrite `handleSaveTeacherSubmit` to take the context and enforce the rule:

```ts
  const handleSaveTeacherSubmit = async (
    e: React.FormEvent | undefined,
    ctx: SaveTeacherContext
  ) => {
    if (e) e.preventDefault();
    setTeacherError(null);
    if (!teacherName.trim()) return false;

    const id = editingTeacherId || crypto.randomUUID();
    const target = Number(teacherTarget);

    // The month's target is a ceiling on what this teacher has already been
    // committed to in groups. Lowering it below that would leave the month
    // over-committed the moment it is saved, which is exactly what creating
    // such a group is refused for — so refuse it here too, symmetrically.
    const committed = ctx.partnerGroups
      .filter((group) => group.memberIds.includes(id))
      .reduce((sum, group) => sum + group.goalDays, 0);

    if (committed > target) {
      setTeacherError(
        `${teacherName.trim()}: bu ay gruplarda toplam ${committed} ortak nöbet günü tanımlı, hedefi ${target} yapamazsınız. Önce grupların gün sayısını azaltın.`
      );
      return false;
    }

    const newTeacher: DbTeacher = {
      id,
      name: teacherName.trim(),
      // The teachers table keeps the teacher's USUAL target. A brand new teacher
      // adopts what was typed; an existing one keeps theirs, because the field
      // on this screen edits the selected month, not the general default.
      target_hours: editingTeacherId
        ? teachers.find((t) => t.id === id)?.target_hours ?? target
        : target,
      priority: Number(teacherPriority),
    };

    try {
      await saveTeacher(newTeacher);
      ctx.applyMonthlyTarget(id, target);
      await loadTeachers();
      if (!selectedTeacherId) setSelectedTeacherId(newTeacher.id);
      setEditingTeacherId(null);
      setTeacherName("");
      setTeacherTarget(4);
      setTeacherPriority(1);
      return true;
    } catch (err) {
      console.error("Öğretmen kaydedilemedi:", err);
      setTeacherError("Öğretmen kaydedilemedi. Lütfen tekrar deneyin.");
      return false;
    }
  };
```

`handleEditTeacherClick` must load the **month's** target, so give it the same context shape:

```ts
  const handleEditTeacherClick = (t: DbTeacher, monthlyTargets: Record<string, number> = {}) => {
    setEditingTeacherId(t.id);
    setTeacherName(t.name);
    setTeacherTarget(effectiveTarget(t, monthlyTargets));
    setTeacherPriority(t.priority);
  };
```

`src/components/TeacherForm.tsx`: add `monthLabel: string` and `usualTarget: number | null` to the props. Change the target label to read `Aylık Nöbet Hedefi ({monthLabel})` and, when `usualTarget !== null && usualTarget !== teacherTarget`, render a small note below the input: `Bu öğretmenin genel hedefi {usualTarget}. Girdiğiniz değer yalnızca {monthLabel} için geçerlidir.`

`src/components/TeacherList.tsx`: add `monthlyTargets` and `partnerGroups` props. Replace `Hedef: {t.target_hours} Nöbet` with `Hedef: {effectiveTarget(t, monthlyTargets)} Nöbet`. When the teacher's summed group goals equal their effective target, append a marker span with `title="Bu ayki nöbetlerinin tamamı gruplara ayrılmış"` (and matching visible text, so it is not title-only).

`src/App.tsx` — the minimum to keep the tree compiling. Add, next to the other `useScheduleState` destructuring:

```ts
  const saveTeacherContext = {
    partnerGroups,
    monthlyTargets,
    applyMonthlyTarget: (teacherId: string, target: number) =>
      setMonthlyTargets((prev) => ({ ...prev, [teacherId]: target })),
  };
```

(pulling `partnerGroups`, `monthlyTargets` and `setMonthlyTargets` out of `useScheduleState`, which Task 7 already added), and pass it at the `handleSaveTeacherSubmit` call site. Pass `monthlyTargets` as the second argument at the `handleEditTeacherClick` call site. Nothing else in `App.tsx` changes here — Task 10 does the rest.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hooks/useTeachers.test.ts tests/components/TeacherForm.test.tsx tests/components/TeacherList.test.tsx`
Expected: PASS, including every pre-existing test in those files. Pre-existing tests that call `handleSaveTeacherSubmit` need the new context argument — update those call sites rather than restoring the old signature.

- [ ] **Step 5: Type-check the whole tree**

Run: `npx tsc --noEmit`
Expected: no errors. This is what catches a missed `App.tsx` call site.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useTeachers.ts src/components/TeacherForm.tsx src/components/TeacherList.tsx src/App.tsx tests/hooks/useTeachers.test.ts tests/components/TeacherForm.test.tsx tests/components/TeacherList.test.tsx
git commit -m "feat(roster): edit and display duty targets per month"
```

---

### Task 10: Mount the card and wire App

**Files:**
- Modify: `src/components/Step1Roster.tsx`
- Modify: `src/App.tsx`
- Test: `tests/components/Step1Roster.test.tsx`, `tests/App.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces: `Step1Roster` gains `partnerGroups`, `monthlyTargets`, `onChangeGroups`, `copyMonths`, `onCopyFromMonth`, `monthLabel`, and forwards them to `PartnerGroups`, `TeacherList` and `TeacherForm`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/Step1Roster.test.tsx`:

```tsx
it("nöbet grupları kartını yan sütunda gösterir", () => {
  renderStep1({ partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }] });
  expect(screen.getByText(/Nöbet Grupları/i)).toBeInTheDocument();
  expect(screen.getByText(/2 gün/)).toBeInTheDocument();
});
```

Append to `tests/App.test.tsx`:

```tsx
it("çizelge üretilirken ayın gruplarını çözücüye iletir", async () => {
  // Bu ayın kaydında bir grup var.
  vi.mocked(getSchedule).mockResolvedValue({
    id: "s1",
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    assignments: "{}",
    holidays: "[]",
    weekend_duty_days: "[]",
    config: JSON.stringify({
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }],
      monthlyTargets: { T1: 6 },
    }),
  });

  render(<App />);
  await screen.findByText(/Adım 1/);

  // Kaydedilen config gruplarla birlikte geri yazılmalı.
  await waitFor(() => {
    const saved = vi.mocked(saveSchedule).mock.calls.at(-1);
    if (!saved) throw new Error("henüz kaydedilmedi");
    const config = JSON.parse(saved[0].config);
    expect(config.partnerGroups).toHaveLength(1);
  });
});
```

Match the file's existing helpers and mocks; do not restructure them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/Step1Roster.test.tsx tests/App.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/components/Step1Roster.tsx`: add the new props to the interface, import `PartnerGroups`, and render it in the right-hand sidebar **below** `TeacherForm` and above `ExcelImport`:

```tsx
        <PartnerGroups
          teachers={teachers}
          monthLabel={monthLabel}
          partnerGroups={partnerGroups}
          monthlyTargets={monthlyTargets}
          onChangeGroups={onChangeGroups}
          copyMonths={copyMonths}
          onCopyFromMonth={onCopyFromMonth}
        />
```

Forward `monthlyTargets` and `partnerGroups` to `TeacherList`, and `monthLabel` plus `usualTarget` to `TeacherForm` (`usualTarget` is `teachers.find(t => t.id === editingTeacherId)?.target_hours ?? null`).

`src/App.tsx` — wiring only:

- Pull `partnerGroups`, `setPartnerGroups`, `monthlyTargets`, `setMonthlyTargets`, `copyPartnersFromMonth`, `availablePartnerMonths` out of `useScheduleState`.
- Hold `const [copyMonths, setCopyMonths] = useState<{ year: number; month: number }[]>([])` and refresh it from `availablePartnerMonths()` in the effect that already loads schedule data.
- Build `monthLabel` as `` `${MONTHS_TR[selectedMonth - 1]} ${selectedYear}` ``.
- Pass `partnerGroups: partnerGroups` into the `SolverConfig` in `handleGenerateSchedule`.
- Resolve targets through the helper when building `solverTeachers`:

```ts
    const solverTeachers: Teacher[] = teachers.map((t) => ({
      id: t.id,
      name: t.name,
      target_hours: effectiveTarget(t, monthlyTargets),
      priority: t.priority
    }));
```

- Supply the save context to `useTeachers`:

```ts
  const saveTeacherContext = {
    partnerGroups,
    monthlyTargets,
    applyMonthlyTarget: (teacherId: string, target: number) =>
      setMonthlyTargets((prev) => ({ ...prev, [teacherId]: target })),
  };
```

and pass it at both `handleSaveTeacher` and `handleEditTeacherClick` call sites.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/Step1Roster.test.tsx tests/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Step1Roster.tsx src/App.tsx tests/components/Step1Roster.test.tsx tests/App.test.tsx
git commit -m "feat(roster): mount partner groups and feed them to the solver"
```

---

### Task 11: Surface group days on the plan screen

**Files:**
- Modify: `src/components/Step3Solver.tsx`
- Modify: `src/App.tsx` (pass `partnerGroups` and the shortfall list down)
- Test: `tests/components/Step3Solver.test.tsx`

**Interfaces:**
- Consumes: `PartnerGroup` (Task 2), `creditPartnerGroups` (Task 3).
- Produces: `Step3Solver` gains `partnerGroups: PartnerGroup[]`. It derives group days and shortfalls itself from `generatedSchedule` — the same live-recompute discipline `unfilledDays` already follows in `App.tsx`, so the badge stays honest after a pin is cleared or a saved month is loaded.

- [ ] **Step 1: Write the failing test**

Append to `tests/components/Step3Solver.test.tsx`:

```tsx
it("grup günlerini takvimde işaretler", () => {
  renderStep3({
    partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }],
    generatedSchedule: { "2026-10-01": ["T1", "T2"], "2026-10-02": ["T3"] },
  });
  expect(screen.getAllByTitle(/nöbet grubu/i)).toHaveLength(1);
});

it("eksik kalan grup günlerini uyarı olarak bildirir", () => {
  renderStep3({
    partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
    generatedSchedule: { "2026-10-01": ["T1", "T2"], "2026-10-02": ["T3"] },
  });
  const warning = screen.getByText(/2 günün 1'i/);
  expect(warning).toBeInTheDocument();
  expect(warning.textContent).toMatch(/Ahmet|T1|Ali/);
});

it("grup tanımlı değilse grup uyarısı göstermez", () => {
  renderStep3({
    partnerGroups: [],
    generatedSchedule: { "2026-10-01": ["T1"] },
  });
  expect(screen.queryByText(/nöbet grubu/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/Step3Solver.test.tsx`
Expected: FAIL — `partnerGroups` is not a prop.

- [ ] **Step 3: Write the implementation**

In `src/components/Step3Solver.tsx`:

Add `partnerGroups: PartnerGroup[]` to the props interface (defaulting to `[]` at the call site in `App.tsx`), and import `PartnerGroup` and `creditPartnerGroups` from `../solver/partners`.

Derive both pieces of state near the existing `requiredCount` computation:

```tsx
  // Recomputed from the live schedule rather than cached from the last solve,
  // for the same reason `unfilledDays` is: a pin cleared or a saved month
  // loaded must not leave a stale badge behind.
  const groupCredit = creditPartnerGroups(generatedSchedule, partnerGroups);

  const unfilledGroups = partnerGroups
    .filter((group) => (groupCredit[group.id] ?? 0) < group.goalDays)
    .map((group) => ({
      group,
      placed: groupCredit[group.id] ?? 0,
      names: group.memberIds
        .map((id) => teachers.find((t) => t.id === id)?.name ?? id)
        .join(" + "),
    }));

  const isGroupDay = (dateStr: string): boolean => {
    const present = new Set(generatedSchedule[dateStr] ?? []);
    return partnerGroups.some(
      (group) => group.memberIds.length > 0 && group.memberIds.every((m) => present.has(m))
    );
  };
```

In the calendar cell render, when `isGroupDay(dateStr)`, add a badge element before the assigned names:

```tsx
                    {isGroupDay(dateStr) && (
                      <span
                        className="partner-day-badge"
                        title="Bu gün bir nöbet grubu birlikte görevli"
                        style={{ fontSize: "0.7rem" }}
                      >
                        👥
                      </span>
                    )}
```

Below the existing `unfilledDays` warning, add the group warning, using `role="status"` for the same WCAG 4.1.3 reason the comment there already explains:

```tsx
          {unfilledGroups.length > 0 && (
            <div className="alert alert-warning" role="status" style={{ padding: "10px 14px", fontSize: "0.78rem", margin: 0 }}>
              <strong>Bazı nöbet grupları eksik kaldı.</strong>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px" }}>
                {unfilledGroups.map(({ group, placed, names }) => (
                  <li key={group.id}>
                    {names}: {group.goalDays} günün {placed}'i yerleştirildi. Kalan
                    günlerde üyelerin tamamı birden uygun değil.
                  </li>
                ))}
              </ul>
            </div>
          )}
```

Add a `.partner-day-badge` rule to `src/App.css` alongside the other calendar-cell styles.

In `src/App.tsx`, pass `partnerGroups={partnerGroups}` to `<Step3Solver />`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/Step3Solver.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/components/Step3Solver.tsx src/App.tsx src/App.css tests/components/Step3Solver.test.tsx
git commit -m "feat(plan): mark partner days and warn about short groups"
```

---

### Task 12: Excel report reads the monthly target

The duty sheet stays exactly as it is — it gets printed and handed out, and a marker column would only clutter it. But the teacher report's "Hedef" column must show the month's target, or the report contradicts the plan it describes.

**Files:**
- Modify: `src/utils/excelUtils.ts`
- Modify: `src/App.tsx` (pass `monthlyTargets` to the export call)
- Test: `tests/excelUtils.test.ts`

**Interfaces:**
- Consumes: `effectiveTarget` (Task 1).
- Produces: `exportScheduleToExcel(year, month, generatedSchedule, teachers, holidays, weekendDutyDays, extraDays, deps?, monthlyTargets?)` — the new parameter goes **after** `deps` and defaults to `{}`, which keeps every existing call site and test valid.

- [ ] **Step 1: Write the failing test**

The function writes through an injectable `deps.xlsxWriter`, which is how the existing suite inspects its output. Append to `tests/excelUtils.test.ts`, inside the existing `describe("excelUtils — exportScheduleToExcel (save dialog + fs write)")` block so it inherits that block's mock setup:

```ts
it("öğretmen raporunda ayın hedefini kullanır", async () => {
  const teachers: DbTeacher[] = [{ id: "T1", name: "Ali", target_hours: 4, priority: 1 }];
  let captured: XLSX.WorkBook | null = null;

  await exportScheduleToExcel(
    2026,
    10,
    { "2026-10-01": ["T1"] },
    teachers,
    [],
    [],
    [],
    {
      saveDialog: async () => "C:/tmp/test.xlsx",
      writeFile: async () => {},
      xlsxWriter: {
        write: (wb) => {
          captured = wb;
          return new Uint8Array();
        },
      },
    },
    { T1: 6 }
  );

  const rows = XLSX.utils.sheet_to_json(
    captured!.Sheets["Öğretmen Analiz Raporu"],
    { header: 1 }
  ) as unknown[][];
  const aliRow = rows.find((r) => r[0] === "Ali")!;
  expect(aliRow[1]).toBe(6); // Hedef — ayın hedefi
  expect(aliRow[2]).toBe(1); // Toplam
  expect(aliRow[6]).toBe(5); // Fark = 6 - 1
});

it("ay için hedef tanımlı değilse genel hedefi kullanır", async () => {
  const teachers: DbTeacher[] = [{ id: "T1", name: "Ali", target_hours: 4, priority: 1 }];
  let captured: XLSX.WorkBook | null = null;

  await exportScheduleToExcel(
    2026,
    10,
    { "2026-10-01": ["T1"] },
    teachers,
    [],
    [],
    [],
    {
      saveDialog: async () => "C:/tmp/test.xlsx",
      writeFile: async () => {},
      xlsxWriter: {
        write: (wb) => {
          captured = wb;
          return new Uint8Array();
        },
      },
    },
    {}
  );

  const rows = XLSX.utils.sheet_to_json(
    captured!.Sheets["Öğretmen Analiz Raporu"],
    { header: 1 }
  ) as unknown[][];
  expect(rows.find((r) => r[0] === "Ali")![1]).toBe(4);
});
```

Column indices reflect the current `exportRows2` order: `name, target, total, weekday, weekend, extra, difference`. If the existing describe block already builds a reusable `deps` helper, use it instead of repeating the object above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/excelUtils.test.ts`
Expected: FAIL — the target column still shows 4.

- [ ] **Step 3: Write the implementation**

In `src/utils/excelUtils.ts`, import `effectiveTarget`, add `monthlyTargets: Record<string, number> = {}` as the ninth parameter of `exportScheduleToExcel` (after `deps`), and replace both uses of `t.target_hours` in the teacher-report loop:

```ts
    const target = effectiveTarget(t, monthlyTargets);
    const difference = target - totalAssigned;

    exportRows2.push([
      t.name,
      target,
      totalAssigned,
      weekdayDuties,
      weekendDuties,
      extraDutiesCount,
      difference
    ]);
```

In `src/App.tsx`, pass `monthlyTargets` at the export call site.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/excelUtils.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Run the whole suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Update the architecture documentation**

Add a short section to `ARCHITECTURE.md` under "The solver" describing the placement/credit phases, and extend the `schedules` bullet in "Data model" to mention `partnerGroups` and `monthlyTargets` in the config blob. Keep the existing prose voice.

- [ ] **Step 7: Commit**

```bash
git add src/utils/excelUtils.ts src/App.tsx ARCHITECTURE.md tests/excelUtils.test.ts
git commit -m "feat(export): report each teacher's target for the month being exported"
```

---

## Verification

After Task 12, before considering the feature done:

- [ ] `npm test` — full suite green, coverage report produced.
- [ ] `npx tsc --noEmit` — no type errors.
- [ ] `npm run build` — production build succeeds.
- [ ] Manual check via `npm run tauri dev`, since the SQLite bridge cannot be tested any other way: create two groups on the roster screen (one overlapping pair, one trio), confirm a blocked over-commit message, generate a schedule, confirm the group days carry the badge and the members appear together, navigate to another month and back, and confirm the groups persisted.
