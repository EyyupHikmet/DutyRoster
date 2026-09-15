import { DbTeacher } from "../db";
import { AvailabilityStatus } from "../solver";
import { effectiveTarget } from "./targets";

/** A teacher pinned to more days than their target for the month allows. */
export interface OverTargetPin {
  id: string;
  name: string;
  pinned: number;
  target: number;
}

/** A pin on a day its teacher marked Uygun Değil. */
export interface UnavailablePin {
  id: string;
  name: string;
  date: string;
}

export interface PinWarnings {
  overTarget: OverTargetPin[];
  unavailable: UnavailablePin[];
}

export interface PinWarningsInput {
  teachers: DbTeacher[];
  pinnedAssignments: Record<string, string[]>;
  monthlyTargets: Record<string, number>;
  availabilities: Record<string, Record<string, AvailabilityStatus>>;
}

/**
 * Pins that break a limit. A pin always wins — the solver never drops one and
 * these warnings never block anything (#18); they exist so the principal knows
 * what they asked for. Pins of teachers who have left the staff are ignored,
 * the same way the solver ignores them.
 */
export function pinWarnings({ teachers, pinnedAssignments, monthlyTargets, availabilities }: PinWarningsInput): PinWarnings {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "tr");
  const staff = new Map(teachers.map((t) => [t.id, t]));
  const pinnedDays = new Map<string, number>();
  const unavailable: UnavailablePin[] = [];

  for (const [date, ids] of Object.entries(pinnedAssignments)) {
    for (const id of new Set(ids)) {
      const teacher = staff.get(id);
      if (!teacher) continue;
      pinnedDays.set(id, (pinnedDays.get(id) ?? 0) + 1);
      if (availabilities[id]?.[date] === "unavailable") {
        unavailable.push({ id, name: teacher.name, date });
      }
    }
  }

  const overTarget: OverTargetPin[] = [];
  for (const [id, pinned] of pinnedDays) {
    const teacher = staff.get(id)!;
    const target = effectiveTarget(teacher, monthlyTargets);
    if (pinned > target) overTarget.push({ id, name: teacher.name, pinned, target });
  }

  return {
    overTarget: overTarget.sort(byName),
    unavailable: unavailable.sort((a, b) => byName(a, b) || a.date.localeCompare(b.date)),
  };
}
