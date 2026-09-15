import { DbSchedule } from "../db";
import { formatDateYYYYMMDD, getDaysInMonth } from "./dateUtils";

/** The part of a month setup that describes its days, shared between duty posts by copying. */
export interface DaySettings {
  holidays: string[];
  weekendDutyDays: string[];
  extraDays: string[];
  teachersPerDay: number;
  daySpecificTeachers: Record<string, number>;
}

/** A month's weekend dates, which are extra duty days until the principal says otherwise. */
export function weekendsOf(year: number, month: number): string[] {
  return getDaysInMonth(year, month)
    .filter((d) => d.getDay() === 0 || d.getDay() === 6)
    .map((d) => formatDateYYYYMMDD(d));
}

/**
 * The day settings of a saved month setup: non-duty days, extra duty days and
 * required counts. "Başka nöbet yerinden kopyala" copies exactly these; pins,
 * partner groups and monthly targets belong to a post's own teachers and are
 * never copied. Settings the month never saved fall back to the defaults a new
 * month starts with. Returns null when the saved data cannot be read.
 */
export function daySettingsOf(row: DbSchedule): DaySettings | null {
  try {
    const config = JSON.parse(row.config);
    return {
      holidays: JSON.parse(row.holidays),
      weekendDutyDays: JSON.parse(row.weekend_duty_days),
      extraDays: config.extraDays || weekendsOf(row.year, row.month),
      teachersPerDay: config.teachersPerDay || 1,
      daySpecificTeachers: config.daySpecificTeachers || {},
    };
  } catch {
    return null;
  }
}
