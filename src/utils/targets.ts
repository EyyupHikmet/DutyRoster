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
