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
}

export interface SolverResult {
  success: boolean;
  schedule?: Record<string, string[]>; // date (YYYY-MM-DD) -> list of teacher IDs
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
    return { success: true, schedule: {} };
  }

  if (teachers.length === 0) {
    return {
      success: false,
      error_message: "Kadroda kayıtlı öğretmen bulunmamaktadır. Lütfen öncelikle öğretmen ekleyin veya içe aktarın.",
    };
  }

  const { mode, teachersPerDay, pinnedAssignments } = config;

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

  // Diagnostic tracking for finding bottlenecks
  let deepestFailureDate: string | null = null;
  let deepestFailureLevel = -1;

  // The backtracking recursive function
  function backtrack(): boolean {
    // Find unassigned dates (dates that need more teachers)
    const unassignedDates = dates.filter(
      (d) => assignments[d].length < (typeof teachersPerDay === "number" ? teachersPerDay : (teachersPerDay[d] ?? 1))
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
    return { success: true, schedule: assignments };
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
