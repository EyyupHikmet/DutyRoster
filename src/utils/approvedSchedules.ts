import { monthName } from "./dateUtils";
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
 * included: those of the same duty post, for months before the working month
 * in its school year, latest first. The working month's own copy is never
 * among them; its schedule always comes from the screen.
 */
export function earlierInSchoolYear<T extends MonthKey & { post_id: string }>(
  copies: T[],
  postId: string,
  year: number,
  month: number
): T[] {
  const start = schoolYearStart(year, month);
  const working = monthIndex({ year, month });
  return copies
    .filter(
      (c) => c.post_id === postId && schoolYearStart(c.year, c.month) === start && monthIndex(c) < working
    )
    .sort((a, b) => monthIndex(b) - monthIndex(a));
}

/**
 * Approved schedules whose post name, month name and year match the search,
 * forgivingly. The post name is the one frozen at approval.
 */
export function searchApprovedSchedules<T extends MonthKey & { postName?: string }>(copies: T[], query: string): T[] {
  const folded = foldForSearch(query);
  if (!folded) return copies;
  return copies.filter((c) =>
    foldForSearch(`${c.postName ?? ""} ${monthName(c.month)} ${c.year}`).includes(folded)
  );
}

/**
 * The approved schedule of the working schedule, if it has one. A copy belongs
 * to the schedule it was approved from, so a month that has never been saved
 * has none: matching by month alone would find another post's copy.
 */
export function approvedCopyFor<T extends { schedule_id: string }>(copies: T[], scheduleId: string | null): T | undefined {
  return scheduleId ? copies.find((c) => c.schedule_id === scheduleId) : undefined;
}
