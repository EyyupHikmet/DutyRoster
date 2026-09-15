import { DbTeacher } from "../db";
import { findUnfilledDays, getDutyDates } from "./dateUtils";
import { effectiveTarget } from "./targets";

/** A teacher as a duty report shows them: frozen name and effective target. */
export interface ReportTeacher {
  id: string;
  name: string;
  target: number;
}

/**
 * Everything one schedule's duty report needs, independent of the staff and
 * month setup it was made from. An approved schedule stores exactly this
 * (ADR-0006), and the working month is turned into one before exporting, so
 * both go through the same report.
 */
export interface ScheduleReport {
  year: number;
  month: number;
  /**
   * The duty post's name when the report was made (ADR-0007). Schedules
   * approved before duty posts existed have none.
   */
  postName?: string;
  /** In Turkish alphabetical order. */
  teachers: ReportTeacher[];
  assignments: Record<string, string[]>;
  holidays: string[];
  weekendDutyDays: string[];
  extraDays: string[];
  /** Required count of every duty day, and of no other date. */
  requiredCounts: Record<string, number>;
}

/** The parts of a month setup a duty report is built from. */
export interface MonthForReport {
  year: number;
  month: number;
  postName?: string;
  generatedSchedule: Record<string, string[]>;
  holidays: string[];
  weekendDutyDays: string[];
  extraDays: string[];
  teachersPerDay: number;
  daySpecificTeachers: Record<string, number>;
  monthlyTargets: Record<string, number>;
}

/** Copies what the duty report needs, so later edits cannot reach it. */
export function freezeScheduleReport(month: MonthForReport, teachers: DbTeacher[]): ScheduleReport {
  const requiredCounts: Record<string, number> = {};
  for (const date of getDutyDates(month.year, month.month, month.holidays, month.weekendDutyDays)) {
    requiredCounts[date] = month.daySpecificTeachers[date] ?? Number(month.teachersPerDay);
  }

  const assignments: Record<string, string[]> = {};
  for (const [date, ids] of Object.entries(month.generatedSchedule)) {
    assignments[date] = [...ids];
  }

  return {
    year: month.year,
    month: month.month,
    postName: month.postName,
    teachers: teachers
      .map((t) => ({ id: t.id, name: t.name, target: effectiveTarget(t, month.monthlyTargets) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr")),
    assignments,
    holidays: [...month.holidays],
    weekendDutyDays: [...month.weekendDutyDays],
    extraDays: [...month.extraDays],
    requiredCounts,
  };
}

/** Slots no teacher fills, summed over the month's duty days. */
export function openSlotCount(report: ScheduleReport): number {
  return findUnfilledDays(
    Object.keys(report.requiredCounts),
    report.assignments,
    (date) => report.requiredCounts[date]
  ).reduce((sum, day) => sum + (day.required - day.assigned), 0);
}

/**
 * Whether two reports would produce the same duty report. The order days,
 * teachers or assigned ids happen to be listed in does not count, and neither
 * does the post's name: renaming a post does not change its schedule.
 */
export function sameReport(a: ScheduleReport, b: ScheduleReport): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(report: ScheduleReport) {
  const sortedRecord = <T>(record: Record<string, T>, value: (v: T) => unknown) =>
    Object.keys(record)
      .sort()
      .map((key) => [key, value(record[key])]);

  return {
    year: report.year,
    month: report.month,
    teachers: [...report.teachers]
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      .map((t) => [t.id, t.name, t.target]),
    // A day with nobody assigned and a day missing from the map read the same.
    assignments: sortedRecord(
      Object.fromEntries(Object.entries(report.assignments).filter(([, ids]) => ids.length > 0)),
      (ids) => [...ids].sort()
    ),
    holidays: [...report.holidays].sort(),
    weekendDutyDays: [...report.weekendDutyDays].sort(),
    extraDays: [...report.extraDays].sort(),
    requiredCounts: sortedRecord(report.requiredCounts, (n) => n),
  };
}
