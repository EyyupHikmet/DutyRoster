import { shiftDate } from "../utils/dateUtils";
import {
  PartnerGroup,
  placePartnerGroups,
  creditPartnerGroups,
} from "./partners";

export type { PartnerGroup } from "./partners";

export interface Teacher {
  id: string;
  name: string;
  target_hours: number; // monthly target number of duties
  priority: number;     // priority weight (e.g. seniority)
}

export type AvailabilityStatus = "preferred" | "available" | "unavailable";

export interface SolverConfig {
  mode: "fairness" | "priority" | "strict" | "random";
  teachersPerDay: number | Record<string, number>;
  pinnedAssignments: Record<string, string[]>; // date (YYYY-MM-DD) -> list of teacher IDs
  // When true, `target_hours` stops being a mere sort key and becomes a hard
  // constraint: nobody is assigned beyond their monthly target, even if that
  // means a duty day goes unfilled. Off (the default) preserves the original
  // all-or-nothing behavior exactly, so previously saved months are unaffected.
  respectTargets?: boolean;
  // When true, a teacher may never be on duty on two ADJACENT CALENDAR days.
  // Adjacency is measured on the calendar, not on the duty list, so a weekend
  // or a holiday in between counts as a real rest gap (Friday→Monday stays
  // legal). Orthogonal to `respectTargets`; both can be on at once. Off by
  // default, so previously saved months are unaffected.
  avoidConsecutiveDays?: boolean;
  // Teachers who must share duty days, and how many days this month they are
  // meant to share. Placed BEFORE the main search — see placePartnerGroups —
  // so by the time the backtracker runs they are ordinary entries in
  // `assignments` and every existing rule applies to them unchanged. Absent on
  // months saved before this feature, which therefore behave exactly as before.
  partnerGroups?: PartnerGroup[];
}

// One duty day that ended up with fewer teachers than it asked for.
export interface UnfilledSlot {
  date: string;     // YYYY-MM-DD
  required: number; // teachers the day asked for
  assigned: number; // teachers it actually got
}

export interface SolverResult {
  success: boolean;
  schedule?: Record<string, string[]>; // date (YYYY-MM-DD) -> list of teacher IDs
  // Days left short. Empty on a fully filled month; only ever non-empty when
  // `respectTargets` or `avoidConsecutiveDays` is on, since otherwise the
  // solver fails rather than returning a partial answer.
  unfilled?: UnfilledSlot[];
  // Groups that could not serve together as many days as they were meant to.
  // Only present when the month actually has groups, so a month without them
  // returns the exact same shape it always has.
  unfilledGroups?: { groupId: string; goal: number; placed: number }[];
  error_message?: string;
  error_date?: string;
}

// Helper to shuffle array in-place for "random" mode
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function solve(
  dates: string[],
  teachers: Teacher[],
  availabilities: Record<string, Record<string, AvailabilityStatus>>, // teacher_id -> date -> status
  config: SolverConfig
): SolverResult {
  if (dates.length === 0) {
    return { success: true, schedule: {}, unfilled: [] };
  }

  if (teachers.length === 0) {
    return {
      success: false,
      error_message: "Kadroda kayıtlı öğretmen bulunmamaktadır. Lütfen öncelikle öğretmen ekleyin veya içe aktarın.",
    };
  }

  const {
    mode,
    teachersPerDay,
    pinnedAssignments,
    respectTargets = false,
    avoidConsecutiveDays = false,
    partnerGroups = [],
  } = config;

  // Initialize assignments map
  const assignments: Record<string, string[]> = {};
  for (const date of dates) {
    assignments[date] = pinnedAssignments[date] ? [...pinnedAssignments[date]] : [];
  }

  // Keep track of total assignments per teacher
  const assignmentCounts: Record<string, number> = {};
  for (const t of teachers) {
    assignmentCounts[t.id] = 0;
  }

  // Populate initial counts from pinned assignments
  for (const date of dates) {
    for (const tId of assignments[date]) {
      if (assignmentCounts[tId] !== undefined) {
        assignmentCounts[tId]++;
      }
    }
  }

  const requiredOn = (date: string): number =>
    typeof teachersPerDay === "number" ? teachersPerDay : (teachersPerDay[date] ?? 1);

  // Phase 1: partner groups. Their members are written into `assignments` the
  // same way pinned assignments are, which is the whole trick — the backtracking
  // search below needs no changes at all. Their duties are already in
  // `assignmentCounts`, so `respectTargets` counts them; they are already in
  // `assignments`, so `hasAdjacentDuty` sees them.
  const groupById = new Map(partnerGroups.map((gr) => [gr.id, gr]));
  if (partnerGroups.length > 0) {
    const { placements } = placePartnerGroups(
      dates,
      partnerGroups,
      availabilities,
      requiredOn,
      pinnedAssignments,
      avoidConsecutiveDays
    );

    for (const [date, groupIds] of Object.entries(placements)) {
      for (const groupId of groupIds) {
        for (const memberId of groupById.get(groupId)!.memberIds) {
          if (assignments[date].includes(memberId)) continue;
          assignments[date].push(memberId);
          if (assignmentCounts[memberId] !== undefined) assignmentCounts[memberId]++;
        }
      }
    }
  }

  // Is this teacher already on duty the calendar day before or after `date`?
  // Reads the live `assignments` map rather than a precomputed index, so it
  // stays correct as the backtracker pushes and pops candidates. Both
  // directions are checked because MRV visits dates out of chronological
  // order. Neighbouring days that aren't duty days at all (weekends, holidays,
  // the adjacent month) simply have no entry, so they never conflict.
  const hasAdjacentDuty = (teacherId: string, date: string): boolean =>
    (assignments[shiftDate(date, -1)] ?? []).includes(teacherId) ||
    (assignments[shiftDate(date, 1)] ?? []).includes(teacherId);

  // Would putting this teacher on this day complete a group that is still short?
  // Group credit is read off the FINISHED schedule, so a filler who happens to
  // reunite a group counts for it. This nudge is what makes that a deliberate
  // win rather than a coincidence. It only reorders candidates — it never makes
  // an illegal assignment legal.
  const shortGroups = (): PartnerGroup[] => {
    const credited = creditPartnerGroups(assignments, partnerGroups);
    return partnerGroups.filter((gr) => (credited[gr.id] ?? 0) < gr.goalDays);
  };
  const pendingGroups = partnerGroups.length > 0 ? shortGroups() : [];

  const completesGroup = (teacherId: string, date: string): boolean =>
    pendingGroups.some(
      (gr) =>
        gr.memberIds.includes(teacherId) &&
        gr.memberIds.every((m) => m === teacherId || assignments[date].includes(m))
    );

  // Diagnostic tracking for finding bottlenecks
  let deepestFailureDate: string | null = null;
  let deepestFailureLevel = -1;

  // Dates the search has given up on because no teacher is left eligible —
  // every remaining one has hit their monthly target, or is on duty the day
  // before or after. Only ever populated when one of the two hard rules is on;
  // it is what turns an unsolvable month into a partly filled one instead of
  // no answer at all.
  const skipped = new Set<string>();

  // The backtracking recursive function
  function backtrack(): boolean {
    // Find unassigned dates (dates that need more teachers)
    const unassignedDates = dates.filter(
      (d) => !skipped.has(d) && assignments[d].length < requiredOn(d)
    );

    // Base case: all slots are filled
    if (unassignedDates.length === 0) {
      return true;
    }

    // MRV (Minimum Remaining Values): Find the date with the fewest options
    let bestDate: string | null = null;
    let minOptionCount = Infinity;
    let bestDateOptions: Teacher[] = [];

    for (const date of unassignedDates) {
      // Find valid teachers for this specific date
      const validTeachersForDate = teachers.filter((t) => {
        // 1. Can't assign the same teacher twice on the same day
        if (assignments[date].includes(t.id)) return false;

        // 2. Can't assign if they are marked unavailable
        const status = availabilities[t.id]?.[date] || "available";
        if (status === "unavailable") return false;

        // 3. With respectTargets on, the monthly target is a ceiling, not a
        //    preference. Pinned assignments are exempt because they are
        //    already in `assignments` before the search starts — an explicit
        //    pin is the principal's decision, and the cap only stops the
        //    solver from adding MORE duties on top of it.
        if (respectTargets && assignmentCounts[t.id] >= t.target_hours) return false;

        // 4. With avoidConsecutiveDays on, back-to-back duties are forbidden.
        //    Pinned assignments are exempt in the same sense the cap exempts
        //    them: they are already in `assignments` and are never removed,
        //    but they DO block the solver from adding a duty on either side.
        if (avoidConsecutiveDays && hasAdjacentDuty(t.id, date)) return false;

        return true;
      });

      if (validTeachersForDate.length < minOptionCount) {
        minOptionCount = validTeachersForDate.length;
        bestDate = date;
        bestDateOptions = validTeachersForDate;
      }
    }

    if (!bestDate) {
      return false;
    }

    // If a date has 0 valid options, we reached an unsolvable constraint
    if (minOptionCount === 0) {
      // Under either hard rule, running out of eligible teachers is the
      // expected outcome, not an error: leave this day short and carry on
      // filling the rest. The gap is reported back so the UI can warn.
      if (respectTargets || avoidConsecutiveDays) {
        skipped.add(bestDate);
        if (backtrack()) return true;
        skipped.delete(bestDate);
      }

      const level = dates.length - unassignedDates.length;
      if (level > deepestFailureLevel) {
        deepestFailureLevel = level;
        deepestFailureDate = bestDate;
      }
      return false;
    }

    const dateToAssign = bestDate;
    let orderedTeachers = [...bestDateOptions];

    // Order values (LCV & Mode Specific)
    if (mode === "random") {
      orderedTeachers = shuffleArray(orderedTeachers);
    } else {
      orderedTeachers.sort((a, b) => {
        if (pendingGroups.length > 0) {
          const aCompletes = completesGroup(a.id, dateToAssign);
          const bCompletes = completesGroup(b.id, dateToAssign);
          if (aCompletes !== bCompletes) return aCompletes ? -1 : 1;
        }

        const aStatus = availabilities[a.id]?.[dateToAssign] || "available";
        const bStatus = availabilities[b.id]?.[dateToAssign] || "available";

        // In all non-random modes, ALWAYS prefer "preferred" over "available"
        if (aStatus === "preferred" && bStatus !== "preferred") return -1;
        if (bStatus === "preferred" && aStatus !== "preferred") return 1;

        if (mode === "fairness") {
          // "Görevleri Eşit Dağıt" (Fairness First)
          // 1. Prioritize teachers with fewer total assignments so far
          const countDiff = assignmentCounts[a.id] - assignmentCounts[b.id];
          if (countDiff !== 0) return countDiff;

          // 2. Prioritize teachers who are further below their target
          const aTargetDiff = a.target_hours - assignmentCounts[a.id];
          const bTargetDiff = b.target_hours - assignmentCounts[b.id];
          if (aTargetDiff !== bTargetDiff) return bTargetDiff - aTargetDiff; // higher difference first

          // 3. Fallback to priority weight
          return b.priority - a.priority;
        } else if (mode === "priority") {
          // "Kıdem Önceliği Kullan" (Priority Listing)
          // 1. Prioritize teachers with higher priority weights (seniority)
          const priorityDiff = b.priority - a.priority;
          if (priorityDiff !== 0) return priorityDiff;

          // 2. Prioritize teachers who have more remaining targets
          const aTargetDiff = a.target_hours - assignmentCounts[a.id];
          const bTargetDiff = b.target_hours - assignmentCounts[b.id];
          if (aTargetDiff !== bTargetDiff) return bTargetDiff - aTargetDiff;

          // 3. Fallback to fewer assignments
          return assignmentCounts[a.id] - assignmentCounts[b.id];
        } else {
          // "strict" or standard: Balance remaining targets
          const aTargetDiff = a.target_hours - assignmentCounts[a.id];
          const bTargetDiff = b.target_hours - assignmentCounts[b.id];
          if (aTargetDiff !== bTargetDiff) return bTargetDiff - aTargetDiff;

          return assignmentCounts[a.id] - assignmentCounts[b.id];
        }
      });
    }

    // Try assigning teachers
    for (const t of orderedTeachers) {
      // Soft constraint guard: If not random/fairness, try not to exceed target_hours
      // unless there are no other options. If a teacher is at or above target, we can
      // still assign them, but we let them be explored.
      
      // Apply assignment
      assignments[dateToAssign].push(t.id);
      assignmentCounts[t.id]++;

      if (backtrack()) {
        return true;
      }

      // Backtrack
      assignments[dateToAssign].pop();
      assignmentCounts[t.id]--;
    }

    // If we tried all valid teachers and none led to a solution, we fail at this level
    const level = dates.length - unassignedDates.length;
    if (level > deepestFailureLevel) {
      deepestFailureLevel = level;
      deepestFailureDate = dateToAssign;
    }

    return false;
  }

  const success = backtrack();

  if (success) {
    const unfilled: UnfilledSlot[] = [];
    for (const date of dates) {
      const required = requiredOn(date);
      const assigned = assignments[date].length;
      if (assigned < required) {
        unfilled.push({ date, required, assigned });
      }
    }

    if (partnerGroups.length === 0) {
      return { success: true, schedule: assignments, unfilled };
    }

    const credited = creditPartnerGroups(assignments, partnerGroups);
    const unfilledGroups = partnerGroups
      .filter((gr) => (credited[gr.id] ?? 0) < gr.goalDays)
      .map((gr) => ({
        groupId: gr.id,
        goal: gr.goalDays,
        placed: credited[gr.id] ?? 0,
      }));

    return { success: true, schedule: assignments, unfilled, unfilledGroups };
  } else {
    // Formulate a very helpful diagnostic error message in Turkish
    let friendlyDateStr = deepestFailureDate || "bir gün";
    if (deepestFailureDate) {
      try {
        const dateObj = new Date(deepestFailureDate);
        const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        friendlyDateStr = dateObj.toLocaleDateString('tr-TR', options);
      } catch (e) {
        friendlyDateStr = deepestFailureDate;
      }
    }

    return {
      success: false,
      error_date: deepestFailureDate || undefined,
      error_message: `${friendlyDateStr} günü için görevlendirilecek uygun öğretmen bulunamadı. \n\nOlası nedenler:\n1. O gün için tüm öğretmenler "Uygun Değil" (Kırmızı) olarak işaretlenmiş olabilir.\n2. Öğretmenlerin aylık hedef saatleri dolmuş ve sistem diğer günleri planlarken sıkışmış olabilir.\n\nÖneri: Lütfen o gün için en az birkaç öğretmeni "Uygun" (Sarı) veya "Tercih Edilen" (Yeşil) olarak işaretleyip tekrar deneyin!`,
    };
  }
}
