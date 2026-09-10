import type { AvailabilityStatus } from "./index";
import { shiftDate } from "../utils/dateUtils";

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

/**
 * How many joint duty days a teacher is committed to across every group that
 * contains them, this month. The single source of truth for that sum —
 * `validatePartnerGroups`, `useTeachers`, `PartnerGroups` and `TeacherList`
 * all need the exact same number, and only dedupe+clamp gets it right:
 * a teacher listed twice in one group's `memberIds` must not double-count
 * that group's goal, and a non-finite/negative `goalDays` (which shouldn't
 * happen, but nothing upstream guarantees it) must not corrupt the total.
 *
 * Pure: no React, no database, no I/O.
 */
export function committedGroupDays(teacherId: string, groups: PartnerGroup[]): number {
  let total = 0;
  for (const group of groups) {
    if (!new Set(group.memberIds).has(teacherId)) continue;
    total += Number.isFinite(group.goalDays) ? Math.max(0, group.goalDays) : 0;
  }
  return total;
}

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
      if (group.memberIds.length === 0) continue;
      const allPresent = group.memberIds.every((m) => present.has(m));
      if (!allPresent) continue;
      if (creditedToday.some((other) => groupsOverlap(group, other))) continue;
      creditedToday.push(group);
      credit[group.id]++;
    }
  }

  return credit;
}

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
 * When `avoidConsecutiveDays` is on, a group day is a normal duty for each of
 * its members: it blocks that member from an adjacent CALENDAR day (via
 * `shiftDate`, so a weekend or holiday in between is still a real rest gap),
 * exactly as `hasAdjacentDuty` does for the main search in `index.ts`. Pinned
 * days carry the same asymmetry the main search already has for pins: a pin
 * is never removed by this rule, but it DOES block a group from being placed
 * on either side of it — placement can only be refused here, never undone,
 * since this phase runs before the backtracking search and writes straight
 * into `assignments` the same way pins do.
 *
 * Pure: no React, no database, no I/O.
 */
export function placePartnerGroups(
  dates: string[],
  groups: PartnerGroup[],
  availabilities: Record<string, Record<string, AvailabilityStatus>>,
  requiredOn: (date: string) => number,
  pinnedAssignments: Record<string, string[]>,
  avoidConsecutiveDays: boolean = false
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
  // member with it, exactly as if the group had been placed there. Sort order
  // doesn't depend on `date`, so it's computed once outside the loop below
  // rather than re-sorted on every pinned date.
  const reservedByPins: Record<string, string[]> = {};
  const orderedByGroupSize = [...groups].sort(
    (a, b) => b.memberIds.length - a.memberIds.length || a.id.localeCompare(b.id)
  );
  for (const [date, assigned] of Object.entries(pinnedOnDutyDays)) {
    const present = new Set(assigned);
    const here: string[] = [];
    for (const group of orderedByGroupSize) {
      if (group.memberIds.length === 0) continue;
      if (!group.memberIds.every((m) => present.has(m))) continue;
      if (here.some((id) => groupsOverlap(group, byId.get(id)!))) continue;
      here.push(group.id);
    }
    if (here.length > 0) reservedByPins[date] = here;
  }

  const remaining = new Map<string, number>();
  for (const group of groups) {
    placed[group.id] = preCredited[group.id] ?? 0;
    // A group with no members can never be "placed" — there is no one to put
    // on duty together. Without this, every check below (availability,
    // overlap, capacity) is vacuously satisfied for zero members, so the
    // search would otherwise happily place a phantom group up to its
    // goalDays. Forcing its remaining need to 0 keeps it out of the main
    // loop's selection entirely, matching creditPartnerGroups, which never
    // credits an empty group a single day.
    remaining.set(
      group.id,
      group.memberIds.length === 0 ? 0 : Math.max(0, group.goalDays - placed[group.id])
    );
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

  // Is this member already on duty on `date` — pinned there directly, or a
  // member of a group already placed there? Reads the live `groupsOnDay`
  // state, so it stays correct as placements accumulate.
  const teacherOnDuty = (memberId: string, date: string): boolean => {
    if ((pinnedAssignments[date] ?? []).includes(memberId)) return true;
    for (const id of groupsOnDay[date] ?? []) {
      if (byId.get(id)!.memberIds.includes(memberId)) return true;
    }
    return false;
  };

  const canPlace = (group: PartnerGroup, date: string): boolean => {
    if ((groupsOnDay[date] ?? []).includes(group.id)) return false;

    for (const memberId of group.memberIds) {
      if (availabilities[memberId]?.[date] === "unavailable") return false;
    }

    // A group day is a normal duty day for each member: with the toggle on,
    // it can't be adjacent (on the calendar) to another day that member is
    // already on duty, in either direction.
    if (avoidConsecutiveDays) {
      const before = shiftDate(date, -1);
      const after = shiftDate(date, 1);
      for (const memberId of group.memberIds) {
        if (teacherOnDuty(memberId, before) || teacherOnDuty(memberId, after)) return false;
      }
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
      // On a slack tie, prefer the group with fewer absolute feasible days:
      // otherwise a flexible group (many feasible days, large need) keeps
      // winning ties by array order and can spend down the one day a truly
      // cornered group (few feasible days, small need) depends on.
      if (slack < bestSlack || (slack === bestSlack && days.length < bestDays.length)) {
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
