import { MONTHS_TR } from "./dateUtils";
import { foldForSearch } from "./turkishText";

interface MonthKey {
  year: number;
  month: number;
}

/** An approval date as the interface shows it, e.g. "3 Aralık 2026". */
export function formatApprovalDate(approvedAt: string): string {
  return new Date(approvedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

/** The calendar year a school year starts in: the months from Eylül to the following Ağustos. */
export function schoolYearStart(year: number, month: number): number {
  return month >= 9 ? year : year - 1;
}

const monthIndex = ({ year, month }: MonthKey) => year * 12 + month;

/**
 * The approved schedules a duty report adds when earlier schedules are
 * included: those of months before the working month in its school year,
 * latest first. The working month's own copy is never among them; its schedule
 * always comes from the screen.
 */
export function earlierInSchoolYear<T extends MonthKey>(copies: T[], year: number, month: number): T[] {
  const start = schoolYearStart(year, month);
  const working = monthIndex({ year, month });
  return copies
    .filter((c) => schoolYearStart(c.year, c.month) === start && monthIndex(c) < working)
    .sort((a, b) => monthIndex(b) - monthIndex(a));
}

/** Approved schedules whose month name and year match the search, forgivingly. */
export function searchApprovedSchedules<T extends MonthKey>(copies: T[], query: string): T[] {
  const folded = foldForSearch(query);
  if (!folded) return copies;
  return copies.filter((c) => foldForSearch(`${MONTHS_TR[c.month - 1]} ${c.year}`).includes(folded));
}

/**
 * The approved schedule of the working schedule, if it has one. A month that
 * has not been saved yet has no id; it can still have a copy left over from
 * before a reset, which saving the month will take back (see saveSchedule).
 */
export function approvedCopyFor<T extends MonthKey & { schedule_id: string }>(
  copies: T[],
  scheduleId: string | null,
  year: number,
  month: number
): T | undefined {
  if (scheduleId) return copies.find((c) => c.schedule_id === scheduleId);
  return copies.find((c) => c.year === year && c.month === month);
}
