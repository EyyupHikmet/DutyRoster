import { useState } from "react";
import { getSchedule, saveSchedule, getAllSchedules, DbSchedule } from "../db";
import { getDaysInMonth, formatDateYYYYMMDD } from "../utils/dateUtils";
import { PartnerGroup } from "../solver/partners";

// Snapshot of every field that makes up "this month's draft" for
// dirty-tracking. Captured once right after loadScheduleData()/a successful save,
// then compared against the live in-memory values to decide whether navigating
// away from the current (year, month) should prompt the user.
interface ScheduleSnapshot {
  holidays: string[];
  weekendDutyDays: string[];
  extraDays: string[];
  daySpecificTeachers: Record<string, number>;
  solverMode: "fairness" | "priority" | "strict" | "random";
  respectTargets: boolean;
  avoidConsecutiveDays: boolean;
  teachersPerDay: number;
  pinnedAssignments: Record<string, string[]>;
  generatedSchedule: Record<string, string[]>;
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
}

// Order-independent deep canonicalization so toggling a day off and back on
// (which re-appends it at the end of an array) or adding/removing/re-adding a
// pinned/day-specific-count key (which reorders object key insertion order)
// doesn't register as "dirty" when the actual CONTENT is unchanged from the
// baseline. Arrays are sorted by their own canonical JSON representation;
// object keys are sorted alphabetically.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function snapshotsEqual(a: ScheduleSnapshot, b: ScheduleSnapshot): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

export function useScheduleState() {
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1); // 1-indexed

  // Schedule Dates and Configuration States
  const [holidays, setHolidays] = useState<string[]>([]); // list of YYYY-MM-DD excluded from duty
  const [weekendDutyDays, setWeekendDutyDays] = useState<string[]>([]); // list of weekend YYYY-MM-DD included in duty
  const [extraDays, setExtraDays] = useState<string[]>([]);
  const [daySpecificTeachers, setDaySpecificTeachers] = useState<Record<string, number>>({});

  // Solver Configuration State
  const [solverMode, setSolverMode] = useState<"fairness" | "priority" | "strict" | "random">("fairness");
  // Hard-cap toggle: when on, no teacher is assigned past their monthly duty
  // target, even if that leaves days open. Orthogonal to solverMode, which
  // only decides the order candidates are considered in.
  const [respectTargets, setRespectTargets] = useState<boolean>(false);
  // Second hard rule: when on, no teacher is given duty on two adjacent
  // calendar days. Orthogonal to both solverMode and respectTargets.
  const [avoidConsecutiveDays, setAvoidConsecutiveDays] = useState<boolean>(false);
  const [teachersPerDay, setTeachersPerDay] = useState<number>(1);
  const [pinnedAssignments, setPinnedAssignments] = useState<Record<string, string[]>>({}); // date -> teacherIds
  // Teachers who must share duty days this month, and how many days they share.
  // Month-scoped on purpose: a pairing that makes sense in March may not in April.
  const [partnerGroups, setPartnerGroups] = useState<PartnerGroup[]>([]);
  // This month's duty target overrides. A teacher absent from this map keeps
  // their usual `teachers.target_hours` — resolve it via effectiveTarget(), never
  // by reading this map directly.
  const [monthlyTargets, setMonthlyTargets] = useState<Record<string, number>>({});

  // Schedule Result
  const [generatedSchedule, setGeneratedSchedule] = useState<Record<string, string[]>>({});
  const [solverError, setSolverError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Dirty-tracking baseline: the snapshot of the fields above as of
  // the last successful load or save for the CURRENTLY selected (year, month).
  // null means "nothing loaded yet" (e.g. before the first loadScheduleData
  // call), in which case isDirty is always false.
  const [baseline, setBaseline] = useState<ScheduleSnapshot | null>(null);

  const isDirty = baseline !== null && !snapshotsEqual(baseline, {
    holidays,
    weekendDutyDays,
    extraDays,
    daySpecificTeachers,
    solverMode,
    respectTargets,
    avoidConsecutiveDays,
    teachersPerDay,
    pinnedAssignments,
    generatedSchedule,
    partnerGroups,
    monthlyTargets,
  });

  const loadScheduleData = async (year: number, month: number) => {
    try {
      const savedSched = await getSchedule(year, month);
      const daysInMonth = getDaysInMonth(year, month);
      const defaultWeekends = daysInMonth
        .filter(d => d.getDay() === 0 || d.getDay() === 6)
        .map(d => formatDateYYYYMMDD(d));

      if (savedSched) {
        const loadedSchedule = JSON.parse(savedSched.assignments);
        const loadedHolidays = JSON.parse(savedSched.holidays);
        const loadedWeekendDutyDays = JSON.parse(savedSched.weekend_duty_days);
        const configObj = JSON.parse(savedSched.config);
        const loadedSolverMode = configObj.mode || "fairness";
        // Months saved before the hard cap existed have no such key; they must
        // keep behaving exactly as they did, so the default is off.
        const loadedRespectTargets = configObj.respectTargets ?? false;
        // Same reasoning as respectTargets: months saved before this rule
        // existed have no such key and must keep behaving as they did.
        const loadedAvoidConsecutiveDays = configObj.avoidConsecutiveDays ?? false;
        const loadedTeachersPerDay = configObj.teachersPerDay || 1;
        const loadedPinnedAssignments = configObj.pinnedAssignments || {};
        const loadedExtraDays = configObj.extraDays || defaultWeekends;
        const loadedDaySpecificTeachers = configObj.daySpecificTeachers || {};
        // Months saved before partner groups/monthly targets existed have
        // neither key; they must keep loading as [] / {}, exactly as before.
        const loadedPartnerGroups: PartnerGroup[] = configObj.partnerGroups || [];
        const loadedMonthlyTargets: Record<string, number> = configObj.monthlyTargets || {};

        setGeneratedSchedule(loadedSchedule);
        setHolidays(loadedHolidays);
        setWeekendDutyDays(loadedWeekendDutyDays);
        setSolverMode(loadedSolverMode);
        setRespectTargets(loadedRespectTargets);
        setAvoidConsecutiveDays(loadedAvoidConsecutiveDays);
        setTeachersPerDay(loadedTeachersPerDay);
        setPinnedAssignments(loadedPinnedAssignments);
        setExtraDays(loadedExtraDays);
        setDaySpecificTeachers(loadedDaySpecificTeachers);
        setPartnerGroups(loadedPartnerGroups);
        setMonthlyTargets(loadedMonthlyTargets);

        // Baseline is built from the values just READ, not from the hook's
        // own state variables (those won't reflect the setState calls above
        // until the next render) — this is the exact loaded/saved state for
        // this (year, month), which is what "unsaved changes" must be
        // measured against.
        setBaseline({
          holidays: loadedHolidays,
          weekendDutyDays: loadedWeekendDutyDays,
          extraDays: loadedExtraDays,
          daySpecificTeachers: loadedDaySpecificTeachers,
          solverMode: loadedSolverMode,
          respectTargets: loadedRespectTargets,
          avoidConsecutiveDays: loadedAvoidConsecutiveDays,
          teachersPerDay: loadedTeachersPerDay,
          pinnedAssignments: loadedPinnedAssignments,
          generatedSchedule: loadedSchedule,
          partnerGroups: loadedPartnerGroups,
          monthlyTargets: loadedMonthlyTargets,
        });

        return savedSched;
      } else {
        setGeneratedSchedule({});
        setHolidays([]);
        setWeekendDutyDays([]);
        setPinnedAssignments({});
        setExtraDays(defaultWeekends);
        setDaySpecificTeachers({});
        setPartnerGroups([]);
        setMonthlyTargets({});
        // Note: solverMode/teachersPerDay are deliberately NOT reset here —
        // that matches this function's pre-existing behavior (they carry
        // over from whatever month was last active) and is out of this
        // task's scope to change. The baseline below uses their current
        // (unchanged) closure values so dirty-tracking stays accurate for
        // that existing behavior instead of falsely treating a fresh,
        // never-saved month as already dirty.
        setBaseline({
          holidays: [],
          weekendDutyDays: [],
          extraDays: defaultWeekends,
          daySpecificTeachers: {},
          solverMode,
          respectTargets,
          avoidConsecutiveDays,
          teachersPerDay,
          pinnedAssignments: {},
          generatedSchedule: {},
          partnerGroups: [],
          monthlyTargets: {},
        });
        return null;
      }
    } catch (err) {
      console.error("Çizelge verileri yüklenemedi:", err);
      return null;
    }
  };

  const handleToggleExtraDay = (dateStr: string) => {
    setExtraDays((prev) => {
      if (prev.includes(dateStr)) {
        return prev.filter((d) => d !== dateStr);
      } else {
        return [...prev, dateStr];
      }
    });
  };

  const handleToggleDayEligibility = (dateStr: string, isWeekend: boolean) => {
    if (isWeekend) {
      setWeekendDutyDays((prev) => {
        if (prev.includes(dateStr)) {
          return prev.filter((d) => d !== dateStr);
        } else {
          return [...prev, dateStr];
        }
      });
    } else {
      setHolidays((prev) => {
        if (prev.includes(dateStr)) {
          return prev.filter((d) => d !== dateStr);
        } else {
          return [...prev, dateStr];
        }
      });
    }
  };

  const handleClearPins = (dateStr: string) => {
    setPinnedAssignments((prev) => {
      const updated = { ...prev };
      delete updated[dateStr];
      return updated;
    });
  };

  const saveGeneratedScheduleToDb = async (scheduleResult: Record<string, string[]>) => {
    try {
      const scheduleToSave: DbSchedule = {
        id: crypto.randomUUID(),
        year: selectedYear,
        month: selectedMonth,
        assignments: JSON.stringify(scheduleResult),
        holidays: JSON.stringify(holidays),
        weekend_duty_days: JSON.stringify(weekendDutyDays),
        config: JSON.stringify({
          mode: solverMode,
          respectTargets: respectTargets,
          avoidConsecutiveDays: avoidConsecutiveDays,
          teachersPerDay: teachersPerDay,
          pinnedAssignments: pinnedAssignments,
          extraDays: extraDays,
          daySpecificTeachers: daySpecificTeachers,
          partnerGroups: partnerGroups,
          monthlyTargets: monthlyTargets
        })
      };
      await saveSchedule(scheduleToSave);
      // Successful save is also a new baseline: whatever the in-session
      // edits were, they are now what's persisted for this (year, month),
      // so they're no longer "unsaved changes" (AC2/AC6 — this must hold
      // whether this was called from the generate flow or the new draft-save
      // path below, without changing what's actually persisted).
      setBaseline({
        holidays,
        weekendDutyDays,
        extraDays,
        daySpecificTeachers,
        solverMode,
        respectTargets,
        avoidConsecutiveDays,
        teachersPerDay,
        pinnedAssignments,
        generatedSchedule: scheduleResult,
        partnerGroups,
        monthlyTargets,
      });
      return true;
    } catch (err) {
      console.error("Çizelge veritabanına kaydedilemedi:", err);
      return false;
    }
  };

  // Decouples "save this month's configuration" from "successfully
  // generate a schedule." Persists the CURRENT in-memory generatedSchedule
  // (which may be {} if nothing has ever been solved for this month) plus
  // holidays/weekendDutyDays/extraDays/daySpecificTeachers/solverMode/
  // teachersPerDay/pinnedAssignments, reusing the exact same upsert path
  // (and UNIQUE(year, month) semantics) as the post-generate auto-save —
  // there is only one place that ever writes the `schedules` table.
  const saveDraftToDb = async () => {
    return saveGeneratedScheduleToDb(generatedSchedule);
  };

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

  return {
    selectedYear,
    setSelectedYear,
    selectedMonth,
    setSelectedMonth,
    holidays,
    setHolidays,
    weekendDutyDays,
    setWeekendDutyDays,
    extraDays,
    setExtraDays,
    daySpecificTeachers,
    setDaySpecificTeachers,
    solverMode,
    setSolverMode,
    respectTargets,
    setRespectTargets,
    avoidConsecutiveDays,
    setAvoidConsecutiveDays,
    teachersPerDay,
    setTeachersPerDay,
    pinnedAssignments,
    setPinnedAssignments,
    generatedSchedule,
    setGeneratedSchedule,
    partnerGroups,
    setPartnerGroups,
    monthlyTargets,
    setMonthlyTargets,
    solverError,
    setSolverError,
    successMessage,
    setSuccessMessage,
    loadScheduleData,
    handleToggleExtraDay,
    handleToggleDayEligibility,
    handleClearPins,
    saveGeneratedScheduleToDb,
    saveDraftToDb,
    copyPartnersFromMonth,
    availablePartnerMonths,
    isDirty
  };
}
