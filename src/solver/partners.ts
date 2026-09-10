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
