import { useState } from "react";
import { getSchedule, saveSchedule, DbSchedule } from "../db";
import { getDaysInMonth, formatDateYYYYMMDD } from "../utils/dateUtils";

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
  teachersPerDay: number;
  pinnedAssignments: Record<string, string[]>;
  generatedSchedule: Record<string, string[]>;
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
  const [teachersPerDay, setTeachersPerDay] = useState<number>(1);
  const [pinnedAssignments, setPinnedAssignments] = useState<Record<string, string[]>>({}); // date -> teacherIds

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
    teachersPerDay,
    pinnedAssignments,
    generatedSchedule,
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
        const loadedTeachersPerDay = configObj.teachersPerDay || 1;
        const loadedPinnedAssignments = configObj.pinnedAssignments || {};
        const loadedExtraDays = configObj.extraDays || defaultWeekends;
        const loadedDaySpecificTeachers = configObj.daySpecificTeachers || {};

        setGeneratedSchedule(loadedSchedule);
        setHolidays(loadedHolidays);
        setWeekendDutyDays(loadedWeekendDutyDays);
        setSolverMode(loadedSolverMode);
        setRespectTargets(loadedRespectTargets);
        setTeachersPerDay(loadedTeachersPerDay);
        setPinnedAssignments(loadedPinnedAssignments);
        setExtraDays(loadedExtraDays);
        setDaySpecificTeachers(loadedDaySpecificTeachers);

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
          teachersPerDay: loadedTeachersPerDay,
          pinnedAssignments: loadedPinnedAssignments,
          generatedSchedule: loadedSchedule,
        });

        return savedSched;
      } else {
        setGeneratedSchedule({});
        setHolidays([]);
        setWeekendDutyDays([]);
        setPinnedAssignments({});
        setExtraDays(defaultWeekends);
        setDaySpecificTeachers({});
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
          teachersPerDay,
          pinnedAssignments: {},
          generatedSchedule: {},
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
          teachersPerDay: teachersPerDay,
          pinnedAssignments: pinnedAssignments,
          extraDays: extraDays,
          daySpecificTeachers: daySpecificTeachers
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
        teachersPerDay,
        pinnedAssignments,
        generatedSchedule: scheduleResult,
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
    teachersPerDay,
    setTeachersPerDay,
    pinnedAssignments,
    setPinnedAssignments,
    generatedSchedule,
    setGeneratedSchedule,
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
    isDirty
  };
}
