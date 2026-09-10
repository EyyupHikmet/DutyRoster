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
