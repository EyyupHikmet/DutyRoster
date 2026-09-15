import { useCallback, useEffect, useRef, useState } from "react";
import { useTeachers } from "./hooks/useTeachers";
import { useAvailabilities } from "./hooks/useAvailabilities";
import { useScheduleState } from "./hooks/useScheduleState";
import { parseExcelRoster, exportScheduleToExcel, exportDutyReport, ExportScheduleResult } from "./utils/excelUtils";
import { freezeScheduleReport, sameReport } from "./utils/scheduleReport";
import { approvedCopyFor, earlierInSchoolYear, formatApprovalDate } from "./utils/approvedSchedules";
import { creditPartnerGroups } from "./solver/partners";
import { splitImportByName } from "./utils/teacherNames";
import { useApprovedSchedules, ApprovedSchedule } from "./hooks/useApprovedSchedules";
import { useDutyPosts } from "./hooks/useDutyPosts";
import { getDutyDates, findUnfilledDays, MONTHS_TR } from "./utils/dateUtils";
import { effectiveTarget } from "./utils/targets";
import { solve, Teacher, SolverConfig, SolverResult } from "./solver";
import { saveTeacher, resetDb, getLastPostId, setLastPostId } from "./db";
import { openPath, revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";

// Where users can find the project itself. Surfaced at the bottom of the
// settings menu.
const PROJECT_URL = "https://github.com/EyyupHikmet/DutyRoster";

// Components
import { WizardNav } from "./components/WizardNav";
import { Step1Roster } from "./components/Step1Roster";
import { Step2ActiveDays } from "./components/Step2ActiveDays";
import { Step3Solver } from "./components/Step3Solver";
import { ApprovedSchedulesDrawer } from "./components/ApprovedSchedulesDrawer";
import { DeleteApprovedDialog } from "./components/DeleteApprovedDialog";
import { ModalDialog } from "./components/ModalDialog";
import { PostMenu } from "./components/PostMenu";

export default function App() {
  const [activeStep, setActiveStep] = useState<number>(1);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [fontSizeFactor, setFontSizeFactor] = useState<number>(1); // 0.8 to 1.6 scale range
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState<boolean>(false);
  const settingsWrapperRef = useRef<HTMLDivElement>(null);
  const settingsToggleBtnRef = useRef<HTMLButtonElement>(null);
  const resetDangerBtnRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Month/year navigation interception when the current month has
  // unsaved changes. pendingNav holds the target the user tried to switch to
  // (captured at the moment their year/month selector fired) so it can be
  // applied after Save/Discard, or thrown away on Cancel.
  const [pendingNav, setPendingNav] = useState<
    { type: "year" | "month"; value: number } | { type: "post"; value: string } | null
  >(null);
  const [isUnsavedConfirmOpen, setIsUnsavedConfirmOpen] = useState<boolean>(false);
  const unsavedModalRef = useRef<HTMLDivElement>(null);

  // Post-save confirmation toast for the Excel export (path +
  // suggested filename of the file that was just written), plus a separate
  // slot for a write-failure message. Kept apart from the generic
  // successMessage/setSuccessMessage above because this toast carries two
  // action buttons ("Dosyayı Aç"/"Klasörü Aç"), not just plain text.
  const [exportToast, setExportToast] = useState<{ path: string; filename: string } | null>(null);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);

  // Confirmation before exporting a month that still has open duty slots.
  // Exporting an incomplete roster is legitimate — a principal may well want
  // the partial sheet to fill in by hand — so this warns rather than blocks.
  const [isIncompleteExportConfirmOpen, setIsIncompleteExportConfirmOpen] = useState<boolean>(false);
  const incompleteExportModalRef = useRef<HTMLDivElement>(null);
  // What accepting that confirmation goes on to do.
  const [incompleteAction, setIncompleteAction] = useState<"export" | "approve">("export");

  // Approved schedules: the header drawer, the export checkbox, and the
  // confirmations before an official copy is replaced or deleted.
  const [isApprovedDrawerOpen, setIsApprovedDrawerOpen] = useState<boolean>(false);
  const [includeEarlierApproved, setIncludeEarlierApproved] = useState<boolean>(true);
  const [isReplaceApprovedOpen, setIsReplaceApprovedOpen] = useState<boolean>(false);
  const [approvedToDelete, setApprovedToDelete] = useState<ApprovedSchedule | null>(null);
  const [resetIncludesApproved, setResetIncludesApproved] = useState<boolean>(false);

  // Close the settings popover on outside click or Escape —
  // matches the click-outside behavior CustomSelect already had; a popover
  // that only closes by re-clicking its own toggle is a minor but real
  // usability/keyboard gap once you can Tab away from it.
  useEffect(() => {
    if (!isSettingsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsWrapperRef.current && !settingsWrapperRef.current.contains(event.target as Node)) {
        setIsSettingsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
        settingsToggleBtnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isSettingsOpen]);

  // Reset-confirmation modal: WCAG 2.2 AA 4.1.2 (Name, Role, Value) requires
  // a dialog to expose role="dialog"/aria-modal and an accessible name, and
  // 2.4.3 (Focus Order) is best served here by a focus trap (Tab/Shift+Tab
  // cycle within the dialog rather than escaping to the page behind it) plus
  // moving focus INTO the dialog on open and back to the button that opened
  // it on close — none of which this had before the accessibility pass.
  useEffect(() => {
    if (!isResetConfirmOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsResetConfirmOpen(false);
        return;
      }
      if (event.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Found via the live keyboard walkthrough: `handleResetAllDatabase`
      // sets isSettingsOpen(false) and isResetConfirmOpen(true) in the same batch, so
      // the settings dropdown (and its danger button, `resetDangerBtnRef`) is ALREADY
      // unmounted by the time this cleanup runs — `previouslyFocused` captured above
      // is therefore never really that button, and `document.activeElement` never
      // returns null (it falls back to <body> once its target is removed), so a plain
      // `previouslyFocused ?? resetDangerBtnRef.current` always kept the falsy-but-
      // truthy <body> and never reached the ref fallback. Explicitly check the
      // captured element is still connected to the document (and isn't just body)
      // before trusting it; otherwise land on the always-present settings toggle
      // button, which is the closest still-existing thing to "where this came from".
      const stillUsable =
        previouslyFocused &&
        previouslyFocused !== document.body &&
        document.body.contains(previouslyFocused);
      (stillUsable ? previouslyFocused : settingsToggleBtnRef.current)?.focus();
    };
  }, [isResetConfirmOpen]);

  // Unsaved-changes confirmation modal: same role="dialog"/
  // aria-modal/focus-trap/focus-return pattern as the DB-reset modal above,
  // deliberately preserving the accessibility behaviour established there.
  // Unlike the reset modal, the control that opened this one (a CustomSelect
  // year/month picker in Step1Roster or Step2ActiveDays) stays mounted the
  // whole time — closing the modal doesn't unmount it — so `previouslyFocused`
  // should almost always still be a valid, connected element; the fallback
  // (the currently-selected wizard step tab) exists only for the unlikely
  // case it isn't.
  useEffect(() => {
    if (!isUnsavedConfirmOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    unsavedModalRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Escape mirrors the least-destructive outcome: stay put, same as
        // clicking "İptal Et" below — never silently discard or save.
        setIsUnsavedConfirmOpen(false);
        setPendingNav(null);
        return;
      }
      if (event.key === "Tab" && unsavedModalRef.current) {
        const focusable = unsavedModalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const stillUsable =
        previouslyFocused &&
        previouslyFocused !== document.body &&
        document.body.contains(previouslyFocused);
      const fallback = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      (stillUsable ? previouslyFocused : fallback)?.focus();
    };
  }, [isUnsavedConfirmOpen]);

  // Incomplete-export confirmation modal: the same role="dialog"/aria-modal/
  // focus-trap/focus-return contract as the two modals above. The control that
  // opens it ("Excel'e Aktar") stays mounted throughout, so focus returns
  // straight to it; the wizard-tab fallback is only for the unlikely case that
  // element is gone by the time the dialog closes.
  useEffect(() => {
    if (!isIncompleteExportConfirmOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    incompleteExportModalRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Escape is the least-destructive outcome: cancel the export, write
        // nothing. It must never fall through to exporting the partial file.
        setIsIncompleteExportConfirmOpen(false);
        return;
      }
      if (event.key === "Tab" && incompleteExportModalRef.current) {
        const focusable = incompleteExportModalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const stillUsable =
        previouslyFocused &&
        previouslyFocused !== document.body &&
        document.body.contains(previouslyFocused);
      const fallback = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      (stillUsable ? previouslyFocused : fallback)?.focus();
    };
  }, [isIncompleteExportConfirmOpen]);

  // Synchronize data-theme attribute on documentElement for CSS mapping
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Synchronize root font-size for proportional dynamic text scaling (Accessibility zoom)
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * fontSizeFactor}px`;
  }, [fontSizeFactor]);

  // Load state and action managers via custom hooks
  const {
    selectedYear,
    setSelectedYear,
    selectedMonth,
    setSelectedMonth,
    holidays,
    weekendDutyDays,
    extraDays,
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
    isDirty,
    partnerGroups,
    setPartnerGroups,
    monthlyTargets,
    setMonthlyTargets,
    copyPartnersFromMonth,
    availablePartnerMonths,
    pruneTeacherFromMonth,
    scheduleId,
    selectedPostId,
    setSelectedPostId,
    copyDaySettingsFromPost,
    postsWithMonthSetup
  } = useScheduleState();

  const {
    teachers,
    loadTeachers,
    selectedTeacherId,
    setSelectedTeacherId,
    editingTeacherId,
    setEditingTeacherId,
    teacherName,
    setTeacherName,
    teacherTarget,
    setTeacherTarget,
    teacherPriority,
    setTeacherPriority,
    teacherError,
    setTeacherError,
    handleSaveTeacherSubmit,
    handleEditTeacherClick,
    handleDeleteTeacherClick,
    allTeachers,
    teacherPostId,
    setTeacherPostId
  } = useTeachers(selectedPostId);

  const {
    availabilities,
    loadAvailabilities,
    handleCycleAvailability
  } = useAvailabilities();


  const { approvedSchedules, loadApprovedSchedules, approve, remove } = useApprovedSchedules();

  const { posts, loadPosts, addPost, renamePost, removePost } = useDutyPosts();
  const selectedPost = posts.find((p) => p.id === selectedPostId) ?? null;
  // Other posts with a saved setup for this month, offered on step 2 to copy
  // day settings from. Named from `posts` at render, so a rename shows at once.
  const [copyPostIds, setCopyPostIds] = useState<string[]>([]);
  const copyPosts = posts.filter((p) => copyPostIds.includes(p.id));
  // Copies approved before duty posts existed have no frozen post name; they
  // belong to the post existing data moved into, so show its current name.
  const namedApproved = approvedSchedules.map((copy) =>
    copy.postName ? copy : { ...copy, postName: posts.find((p) => p.id === copy.post_id)?.name ?? "" }
  );

  // Months (other than the one currently selected) that already have partner
  // groups defined, offered in the PartnerGroups card's "copy from another
  // month" control. Refreshed alongside the rest of the month's data below,
  // since it depends on the whole schedules table, not just (selectedYear,
  // selectedMonth).
  const [copyMonths, setCopyMonths] = useState<{ year: number; month: number }[]>([]);

  const monthLabel = `${MONTHS_TR[selectedMonth - 1]} ${selectedYear}`;

  const handleCopyPartnersFromMonth = async (year: number, month: number) => {
    await copyPartnersFromMonth(year, month, teachers.map((t) => t.id));
  };

  // Context Task 9's handleSaveTeacherSubmit needs to enforce the monthly
  // target-vs-group-commitment rule; wrapped into the Step1Roster call site
  // below rather than changing Step1Roster's own (still single-argument)
  // prop type, which is Task 10's wiring to do.
  const saveTeacherContext = {
    partnerGroups,
    monthlyTargets,
    pruneTeacherFromMonth,
    applyMonthlyTarget: (teacherId: string, target: number) =>
      setMonthlyTargets((prev) => ({ ...prev, [teacherId]: target })),
  };

  // Intercept the year/month selectors (shared by Step1's
  // availability calendar and Step2's active-days calendar) when the month
  // being left has unsaved changes, instead of letting the load effect below
  // silently discard them. These wrapped setters are what actually get
  // passed down as `setSelectedYear`/`setSelectedMonth` to the step
  // components — the raw hook setters are only ever called from here, after
  // the user's choice (or immediately, when there's nothing to lose).
  const requestYearChange = (newYear: number) => {
    if (newYear === selectedYear) return;
    if (isDirty) {
      setPendingNav({ type: "year", value: newYear });
      setIsUnsavedConfirmOpen(true);
    } else {
      setSelectedYear(newYear);
    }
  };

  const requestMonthChange = (newMonth: number) => {
    if (newMonth === selectedMonth) return;
    if (isDirty) {
      setPendingNav({ type: "month", value: newMonth });
      setIsUnsavedConfirmOpen(true);
    } else {
      setSelectedMonth(newMonth);
    }
  };

  // Duty posts (ADR-0007). Switching post is navigation, like switching month
  // (ADR-0005): the month being left may have unsaved changes.
  const requestPostChange = (postId: string) => {
    if (postId === selectedPostId) return;
    if (isDirty) {
      setPendingNav({ type: "post", value: postId });
      setIsUnsavedConfirmOpen(true);
    } else {
      switchPost(postId);
    }
  };

  const switchPost = (postId: string) => {
    // Teachers belong to one post, so a selection or an open edit cannot carry over.
    setSelectedTeacherId(null);
    setEditingTeacherId(null);
    setTeacherPostId(null);
    setTeacherError(null);
    setSelectedPostId(postId);
    setLastPostId(postId).catch((err) => console.error("Seçili nöbet yeri kaydedilemedi:", err));
  };

  const duplicatePostMessage = (name: string) => `“${name}” adında bir nöbet yeri zaten var.`;

  // Resolves to the message the dialog shows when the name is refused.
  const handleAddPost = async (name: string): Promise<string | null> => {
    const result = await addPost(name);
    if (result.status === "duplicate") return duplicatePostMessage(result.existing.name);
    if (result.status === "empty") return "Nöbet yerinin adını yazın.";
    if (result.status === "error") return "Nöbet yeri eklenemedi. Lütfen tekrar deneyin.";
    requestPostChange(result.post.id);
    return null;
  };

  const handleRenamePost = async (name: string): Promise<string | null> => {
    if (!selectedPostId) return null;
    const result = await renamePost(selectedPostId, name);
    if (result.status === "duplicate") return duplicatePostMessage(result.existing.name);
    if (result.status === "empty") return "Nöbet yerinin adını yazın.";
    if (result.status === "error") return "Nöbet yerinin adı değiştirilemedi. Lütfen tekrar deneyin.";
    return null;
  };

  // The menu deletes the post on screen. Its unsaved changes go with it, so
  // nothing is asked before moving to a post that remains.
  const handleDeletePost = async () => {
    if (!selectedPostId) return;
    const name = selectedPost?.name ?? "";
    const result = await removePost(selectedPostId);
    if (result.status !== "deleted") {
      setExportErrorMessage("Nöbet yeri silinemedi. Lütfen tekrar deneyin.");
      setTimeout(() => setExportErrorMessage(null), 5000);
      return;
    }
    const remaining = await loadPosts();
    if (remaining.length > 0) switchPost(remaining[0].id);
    await loadApprovedSchedules();
    setSuccessMessage(`${name} nöbet yeri silindi.`);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleCopyDaySettings = async (sourcePostId: string) => {
    const sourceName = posts.find((p) => p.id === sourcePostId)?.name ?? "";
    if (await copyDaySettingsFromPost(sourcePostId)) {
      setSuccessMessage(`${sourceName} nöbet yerinin gün ayarları bu aya kopyalandı.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } else {
      setExportErrorMessage(`${sourceName} nöbet yerinin bu ay için kaydedilmiş gün ayarı yok.`);
      setTimeout(() => setExportErrorMessage(null), 5000);
    }
  };

  const applyPendingNav = () => {
    if (pendingNav) {
      if (pendingNav.type === "post") switchPost(pendingNav.value);
      else if (pendingNav.type === "year") setSelectedYear(pendingNav.value);
      else setSelectedMonth(pendingNav.value);
    }
    setPendingNav(null);
  };

  // Cancel: stay put, no navigation, nothing persisted.
  const handleCancelUnsavedNav = () => {
    setIsUnsavedConfirmOpen(false);
    setPendingNav(null);
  };

  // Discard: switch without saving — the DB row (if any) for the month being
  // left is never touched by this path, so it stays exactly as it was.
  const handleDiscardUnsavedNav = () => {
    setIsUnsavedConfirmOpen(false);
    applyPendingNav();
  };

  // Save: persist the current month's draft (with or without a generated
  // schedule), then switch.
  const handleSaveUnsavedNav = async () => {
    setIsUnsavedConfirmOpen(false);
    await saveDraftToDb();
    applyPendingNav();
  };

  // Open on the duty post the principal last worked on (ADR-0007).
  useEffect(() => {
    async function openLastPost() {
      try {
        await loadPosts();
        setSelectedPostId(await getLastPostId());
      } catch (err) {
        console.error("Nöbet yerleri yüklenemedi:", err);
      }
    }
    openLastPost();
  }, []);

  // Load the selected post's month from SQLite
  useEffect(() => {
    if (!selectedPostId) return;
    const postId = selectedPostId;
    async function loadData() {
      try {
        await loadTeachers();
        await loadAvailabilities();
        await loadScheduleData(postId, selectedYear, selectedMonth);
        setCopyMonths(await availablePartnerMonths());
        setCopyPostIds(await postsWithMonthSetup());
        await loadApprovedSchedules();
      } catch (err) {
        console.error("Veritabanı yüklenirken hata oluştu:", err);
      }
    }
    loadData();
  }, [selectedPostId, selectedYear, selectedMonth]);

  // Handle Excel File Roster Import
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const data = event.target?.result;
      if (!data) return;

      try {
        const imported = parseExcelRoster(data as string);
        if (imported.length === 0) {
          alert("Excel dosyasında geçerli öğretmen bilgisi bulunamadı.");
          return;
        }

        // A name already in the staff, or repeated earlier in the file, is
        // skipped rather than saved as a second teacher (see teacherNames.ts).
        const { added, skipped } = splitImportByName(imported, allTeachers);
        for (const t of added) {
          // Imported teachers join the staff of the post on screen.
          await saveTeacher({ ...t, post_id: selectedPostId ?? "" });
        }
        await loadTeachers();

        const skippedNote =
          skipped.length > 0
            ? ` ${skipped.length} isim zaten kadroda olduğu için atlandı: ${skipped.join(", ")}.`
            : "";
        if (added.length === 0) {
          setSuccessMessage(`Yeni öğretmen eklenmedi.${skippedNote}`);
        } else if (skipped.length === 0) {
          setSuccessMessage(`${added.length} öğretmen başarıyla yüklendi.`);
        } else {
          setSuccessMessage(`${added.length} öğretmen yüklendi.${skippedNote}`);
        }
        // A list of skipped names needs longer on screen to be read.
        setTimeout(() => setSuccessMessage(null), skipped.length > 0 ? 8000 : 4000);
      } catch (err) {
        console.error("İçe aktarma sırasında hata oluştu:", err);
        alert("Dosya okunurken bir hata oluştu. Lütfen dosya formatını kontrol edin.");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = ""; // Clear input
  };

  // Duty days of the currently selected month that came out short. Recomputed
  // from live state (not cached from the last solve) so it stays honest after
  // a pin is cleared, a day's required count is raised, or a saved month is
  // loaded from disk. Drives both the Step 3 warning and the export dialog.
  // A month with no schedule at all isn't "full of gaps", it's just not
  // planned yet — same condition that gates the export button, so the two
  // stay consistent.
  const unfilledDays =
    Object.keys(generatedSchedule).length === 0
      ? []
      : findUnfilledDays(
          getDutyDates(selectedYear, selectedMonth, holidays, weekendDutyDays),
          generatedSchedule,
          (dateStr) => daySpecificTeachers[dateStr] ?? Number(teachersPerDay)
        );

  // The schedule on screen as its duty report shows it: the same shape an
  // approved schedule freezes, so the two can be compared.
  const workingReport = freezeScheduleReport(
    { year: selectedYear, month: selectedMonth, postName: selectedPost?.name, generatedSchedule, holidays, weekendDutyDays, extraDays, teachersPerDay, daySpecificTeachers, monthlyTargets },
    teachers
  );
  const currentApproved = approvedCopyFor(approvedSchedules, scheduleId);
  const approval = currentApproved
    ? { approvedAt: currentApproved.approved_at, changed: !sameReport(currentApproved.report, workingReport) }
    : null;
  const earlierApproved = earlierInSchoolYear(approvedSchedules, selectedPostId ?? "", selectedYear, selectedMonth);

  // Partner groups short of their group goal, counted as Step 3 counts them.
  const groupCredit = creditPartnerGroups(generatedSchedule, partnerGroups);
  const shortGroupCount = partnerGroups.filter((group) => (groupCredit[group.id] ?? 0) < group.goalDays).length;

  // Generate Schedule Action
  const handleGenerateSchedule = async () => {
    setSolverError(null);

    // Weekdays (excluding holidays) + weekend duty days. Shared with the
    // pre-export gap check so the two can never disagree about which days
    // were supposed to be covered.
    const targetDates = getDutyDates(selectedYear, selectedMonth, holidays, weekendDutyDays);

    if (targetDates.length === 0) {
      setSolverError("Planlanacak hiç nöbet günü seçilmedi! Lütfen Adım 2'ye giderek aktif günleri seçin.");
      return;
    }

    if (teachers.length === 0) {
      setSolverError("Planlama başlatılamadı çünkü sistemde hiç kayıtlı öğretmen yok. Lütfen önce öğretmen ekleyin.");
      return;
    }

    // The solver must see THIS month's target — a monthlyTargets override, or
    // the teacher's usual target_hours if this month has none — never the
    // bare teachers.target_hours, or a month-specific override set via
    // TeacherForm/PartnerGroups would be silently ignored at generation time.
    const solverTeachers: Teacher[] = teachers.map((t) => ({
      id: t.id,
      name: t.name,
      target_hours: effectiveTarget(t, monthlyTargets),
      priority: t.priority
    }));

    // Build day-specific teacher count map for solver
    const solverTeachersPerDay: Record<string, number> = {};
    for (const d of targetDates) {
      solverTeachersPerDay[d] = daySpecificTeachers[d] ?? Number(teachersPerDay);
    }

    const config: SolverConfig = {
      mode: solverMode,
      teachersPerDay: solverTeachersPerDay,
      pinnedAssignments: pinnedAssignments,
      respectTargets: respectTargets,
      avoidConsecutiveDays: avoidConsecutiveDays,
      partnerGroups: partnerGroups
    };

    const result: SolverResult = solve(targetDates, solverTeachers, availabilities, config);

    if (result.success && result.schedule) {
      setGeneratedSchedule(result.schedule);
      await saveGeneratedScheduleToDb(result.schedule);
      // A partly filled month is a success, not a failure — but say so plainly
      // rather than reporting an unqualified "başarıyla oluşturuldu" over a
      // sheet with holes in it. The detail lives in Step3Solver's warning.
      const gapCount = result.unfilled?.length ?? 0;
      setSuccessMessage(
        gapCount > 0
          ? `Nöbet çizelgesi oluşturuldu, ancak ${gapCount} gün boş kaldı.`
          : "Nöbet çizelgesi başarıyla oluşturuldu."
      );
      setTimeout(() => setSuccessMessage(null), 3000);
    } else {
      setSolverError(result.error_message || "Çizelge planlanırken bilinmeyen bir hata oluştu.");
    }
  };

  // Excel Export Trigger: opens a native Save-As dialog and
  // writes the real .xlsx bytes to the chosen path. Handles all three
  // outcomes explicitly rather than assuming success:
  //  - saved: show the confirmation toast with "Dosyayı Aç"/"Klasörü Aç".
  //  - canceled (user dismissed the dialog): no error, no toast, no
  //    side effects — just leave everything exactly as it was (AC5).
  //  - error (e.g. disk write failure): surface a Turkish error message,
  //    never a false "saved" confirmation.
  const handleExportSchedule = async () => {
    // Warn before writing a sheet that still has open duty slots. Derived from
    // the schedule itself rather than from the solver's last run, so it is
    // equally right for gaps the solver never produced — days emptied by
    // pinning, or a month whose schedule was loaded from disk and never
    // regenerated. Exporting anyway is a valid choice, so this asks.
    if (unfilledDays.length > 0) {
      setIncompleteAction("export");
      setIsIncompleteExportConfirmOpen(true);
      return;
    }
    await performExportSchedule();
  };

  // The actual write. Split out of handleExportSchedule so both the
  // no-gaps path and the "Yine de Aktar" confirmation reach identical
  // behavior — there is one export implementation, not two.
  const performExportSchedule = async () => {
    setExportErrorMessage(null);
    const result = await exportScheduleToExcel(
      selectedYear,
      selectedMonth,
      generatedSchedule,
      teachers,
      holidays,
      weekendDutyDays,
      extraDays,
      {},
      monthlyTargets,
      includeEarlierApproved ? earlierApproved.map((copy) => copy.report) : []
    );
    showExportResult(result);
  };

  // What every export shows for its outcome.
  const showExportResult = (result: ExportScheduleResult) => {
    if (result.status === "saved") {
      setExportToast({ path: result.path, filename: result.filename });
    } else if (result.status === "error") {
      console.error("Excel dışa aktarma sırasında hata oluştu:", result.message);
      setExportErrorMessage("Rapor kaydedilirken bir hata oluştu. Lütfen tekrar deneyin.");
      setTimeout(() => setExportErrorMessage(null), 5000);
    }
    // status === "canceled": intentionally a no-op.
  };

  // Exports one approved schedule on its own, from the drawer.
  const handleExportApproved = async (copy: ApprovedSchedule) => {
    setExportErrorMessage(null);
    showExportResult(await exportDutyReport([copy.report]));
  };

  // Approving (Onayla). A schedule with open slots or short partner groups
  // can still be made official, but only after the same warning an incomplete
  // export gets; a schedule that already has an approved copy asks before
  // replacing it.
  const handleApproveSchedule = () => {
    if (unfilledDays.length > 0 || shortGroupCount > 0) {
      setIncompleteAction("approve");
      setIsIncompleteExportConfirmOpen(true);
      return;
    }
    confirmReplaceOrApprove();
  };

  const confirmReplaceOrApprove = () => {
    if (currentApproved) {
      setIsReplaceApprovedOpen(true);
      return;
    }
    void performApproveSchedule();
  };

  // Saves the month (so the copy points at a saved schedule) and keeps a
  // frozen copy of exactly what is on screen.
  const performApproveSchedule = async () => {
    const report = workingReport;
    const savedId = await saveGeneratedScheduleToDb(generatedSchedule);
    const approved = savedId ? await approve(savedId, selectedPostId ?? "", report) : false;
    if (approved) {
      setSuccessMessage(`${monthLabel} çizelgesi onaylandı.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } else {
      setExportErrorMessage("Çizelge onaylanırken bir hata oluştu. Lütfen tekrar deneyin.");
      setTimeout(() => setExportErrorMessage(null), 5000);
    }
  };

  const handleConfirmDeleteApproved = async () => {
    if (!approvedToDelete) return;
    const label = `${MONTHS_TR[approvedToDelete.month - 1]} ${approvedToDelete.year}`;
    const id = approvedToDelete.id;
    setApprovedToDelete(null);
    if (await remove(id)) {
      setSuccessMessage(`${label} onaylı çizelgesi silindi.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } else {
      setExportErrorMessage("Onaylı çizelge silinirken bir hata oluştu. Lütfen tekrar deneyin.");
      setTimeout(() => setExportErrorMessage(null), 5000);
    }
  };

  const handleCloseApprovedDrawer = useCallback(() => setIsApprovedDrawerOpen(false), []);


  // Opens the just-exported file in its OS default handler.
  //
  // A rejection here MUST reach the user. These two handlers used to swallow
  // the error into console.error, and in a release build there is no console
  // anyone will look at -- so a failure looked exactly like a button that was
  // never wired up, which is how it was reported. The file was written and the
  // path is on screen, so the fallback advice ("open it yourself from the
  // folder") is genuinely actionable.
  const handleOpenExportedFile = async () => {
    if (!exportToast) return;
    setExportErrorMessage(null);
    try {
      await openPath(exportToast.path);
    } catch (err) {
      console.error("Dosya açılırken hata oluştu:", err);
      setExportErrorMessage(
        `Dosya açılamadı. Raporu şu konumdan kendiniz açabilirsiniz: ${exportToast.path}`
      );
      setTimeout(() => setExportErrorMessage(null), 8000);
    }
  };

  // Reveals the just-exported file in its containing folder.
  const handleOpenExportedFolder = async () => {
    if (!exportToast) return;
    setExportErrorMessage(null);
    try {
      await revealItemInDir(exportToast.path);
    } catch (err) {
      console.error("Klasör açılırken hata oluştu:", err);
      setExportErrorMessage(
        `Klasör açılamadı. Rapor şu konuma kaydedildi: ${exportToast.path}`
      );
      setTimeout(() => setExportErrorMessage(null), 8000);
    }
  };

  const handleDismissExportToast = () => setExportToast(null);

  // Wrapped Cycle Availability handler passing selected teacher id
  const handleCycleAvailabilityWrapper = async (dateStr: string) => {
    if (!selectedTeacherId) return;
    await handleCycleAvailability(selectedTeacherId, dateStr);
  };

  // Open custom React modal for DB reset confirmation
  // Opens the project page in the user's default browser. Uses the opener
  // plugin rather than a plain <a href>: inside the webview a link would
  // navigate the app itself away from its own UI, with no way back. The
  // opener plugin's default permission set already covers https:// urls
  // (allow-open-url + allow-default-urls), so this needs no extra capability
  // grant in capabilities/default.json.
  const handleOpenProjectPage = async () => {
    try {
      await openUrl(PROJECT_URL);
      setIsSettingsOpen(false);
    } catch (err) {
      console.error("Proje sayfası açılamadı:", err);
    }
  };

  const handleResetAllDatabase = () => {
    setIsSettingsOpen(false); // Close dropdown
    setResetIncludesApproved(false);
    setIsResetConfirmOpen(true); // Open custom modal
  };

  // Directly executes the SQLite DB wipe & dynamic state resetting
  const handleResetAllDatabaseDirect = async () => {
    try {
      await resetDb({ includeApproved: resetIncludesApproved });
      await loadApprovedSchedules();
      
      // Wipe all teachers states
      setSelectedTeacherId(null);
      setEditingTeacherId(null);
      setTeacherName("");
      setTeacherTarget(1);
      setTeacherPriority(1);
      
      // Reset leaves one new, empty post (ADR-0007): open it.
      await loadPosts();
      setTeacherPostId(null);
      const postId = await getLastPostId();
      if (postId === selectedPostId) {
        await loadTeachers();
        await loadAvailabilities();
        await loadScheduleData(postId, selectedYear, selectedMonth);
      } else {
        setSelectedPostId(postId);
      }
      
      setSuccessMessage("Veritabanı başarıyla sıfırlandı.");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Veritabanı sıfırlanırken hata oluştu:", err);
      alert("Sıfırlama işlemi gerçekleştirilirken bir hata oluştu.");
    }
  };

  return (
    <div className="app-container" style={{ position: "relative" }}>
      {/* <header> landmark wraps the page <h1>, the wizard nav, and the
          settings dropdown (axe "region" rule): every part of the
          page needs to live inside a landmark region, and this content sits
          above/outside <main> — it isn't part of any wizard step. */}
      <header>
        {/* Exactly one visually-hidden <h1> per screen (axe
            page-has-heading-one). This is a single-page app whose "screens"
            are really wizard steps within one document, so one fixed,
            always-present <h1> naming the whole app — rather than promoting
            a step title, which would either duplicate across re-renders or
            have to change on every step and stop being a stable page title —
            is the right fit here; the step titles correctly stay <h2> as the
            actual visible heading hierarchy already has them. */}
        <h1 className="sr-only">Öğretmen Nöbet Çizelgesi Hazırlayıcı</h1>

        {/* One row: the duty post menu (left), the wizard steps
            (centre), and approved schedules with settings (right). A grid
            rather than absolutely positioned buttons, so the side buttons can
            never cover the steps on a narrow window. */}
        <div className="app-header-row">
          <div className="app-header-side app-header-side--left">
            {/* On every step, like Onaylı Çizelgeler: switching post from
                step 2 or 3 asks about unsaved changes as switching month does. */}
            {posts.length > 0 && (
              <PostMenu
                posts={posts}
                selectedPostId={selectedPostId}
                onSelectPost={requestPostChange}
                onAddPost={handleAddPost}
                onRenamePost={handleRenamePost}
                onDeletePost={handleDeletePost}
              />
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <WizardNav activeStep={activeStep} setActiveStep={setActiveStep} />
          </div>

          <div className="app-header-side app-header-side--right">
            {/* Approved schedules. Not a wizard step: the list can be opened
                from any step. */}
            <button
              className="header-pill-btn"
              onClick={() => setIsApprovedDrawerOpen((open) => !open)}
              title="Onaylı Çizelgeler"
              aria-label="Onaylı Çizelgeler"
              aria-expanded={isApprovedDrawerOpen}
              aria-controls="approved-schedules-drawer"
            >
              <span aria-hidden="true">📚</span>
              Onaylı Çizelgeler
            </button>

        <div style={{ position: "relative" }} ref={settingsWrapperRef}>
          <button
            ref={settingsToggleBtnRef}
            className="settings-toggle-btn"
            onClick={() => setIsSettingsOpen(prev => !prev)}
            title="Sistem ve Erişilebilirlik Ayarları"
            aria-label="Sistem ve Erişilebilirlik Ayarları"
            aria-haspopup="true"
            aria-expanded={isSettingsOpen}
            aria-controls="settings-dropdown-panel"
          >
            <span aria-hidden="true">⚙️</span>
          </button>

          {/* Unified Settings Dropdown Card */}
          {isSettingsOpen && (
            <div
              id="settings-dropdown-panel"
              className="card surface-solid"
              style={{
                position: "absolute",
                top: "48px",
                right: "0",
                width: "250px",
                padding: "16px",
                borderRadius: "12px",
                border: "1.5px solid var(--border)",
                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                zIndex: 200
              }}
            >
              {/* Section 1: Accessibility Title & Slider */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {/* h2, not h4: this renders (when open) right after the page's
                    only h1 with no h2/h3 in between anywhere in the DOM at that
                    point (WizardNav has no headings) — h4 here was a heading-
                    order skip (axe "heading-order"), fixed by matching the
                    level of the step titles it's a structural sibling of.
                    Visual size is unaffected since it's controlled by the
                    inline fontSize, not the tag. */}
                <h2 id="font-scale-heading" style={{ margin: 0, fontSize: "0.85rem", fontWeight: "800", color: "var(--text-primary)" }}>
                  ♿ Erişilebilirlik (Yazı Ölçeği)
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: "600" }}>
                    <label htmlFor="font-scale-slider">Ölçek:</label>
                    <span aria-hidden="true">%{Math.round(fontSizeFactor * 100)}</span>
                  </div>
                  <input
                    type="range"
                    id="font-scale-slider"
                    min="0.8"
                    max="1.6"
                    step="0.05"
                    value={fontSizeFactor}
                    onChange={(e) => setFontSizeFactor(Number(e.target.value))}
                    aria-valuetext={`Yüzde ${Math.round(fontSizeFactor * 100)}`}
                    style={{ width: "100%", cursor: "pointer", accentColor: "var(--primary)" }}
                  />
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "4px 8px", fontSize: "0.7rem", width: "100%", marginTop: "2px" }}
                    onClick={() => setFontSizeFactor(1)}
                  >
                    Yazı Boyutunu Sıfırla
                  </button>
                </div>
              </div>

              {/* Section 2: Dark/Light Mode Row Switcher */}
              <div 
                style={{ 
                  borderTop: "1.5px solid var(--border)", 
                  paddingTop: "12px", 
                  display: "flex", 
                  justifyContent: "space-between", 
                  alignItems: "center" 
                }}
              >
                <span style={{ fontSize: "0.82rem", fontWeight: "700", color: "var(--text-secondary)" }}>Tema Görünümü:</span>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: "6px 12px", fontSize: "0.75rem", height: "28px", minWidth: "110px", fontWeight: "bold" }}
                  onClick={() => setTheme(prev => prev === "light" ? "dark" : "light")}
                  title={theme === "light" ? "Karanlık temaya geçmek için tıklayın" : "Aydınlık temaya geçmek için tıklayın"}
                >
                  {theme === "light" ? "☀️ Aydınlık" : "🌙 Karanlık"}
                </button>
              </div>

              {/* Section 3: Danger Zone Reset All DB */}
              <div style={{ borderTop: "1.5px solid var(--border)", paddingTop: "12px", marginTop: "2px" }}>
                <button
                  ref={resetDangerBtnRef}
                  className="btn btn-danger"
                  style={{ padding: "8px 12px", fontSize: "0.75rem", width: "100%" }}
                  onClick={handleResetAllDatabase}
                >
                  ⚠️ Veritabanını Sıfırla
                </button>
              </div>

              {/* Section 4: Project home, so anyone using the app can find the
                  source, report a problem, or contribute. Deliberately last:
                  it is the least urgent control here, and keeping it below the
                  destructive action avoids it being clicked by accident. */}
              <div style={{ borderTop: "1.5px solid var(--border)", paddingTop: "12px", marginTop: "2px" }}>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "8px 12px", fontSize: "0.75rem", width: "100%" }}
                  onClick={handleOpenProjectPage}
                  title="Projenin GitHub sayfasını tarayıcınızda açar"
                >
                  <span aria-hidden="true">🌐</span> Proje Sayfası (GitHub)
                </button>
              </div>
            </div>
          )}
        </div>
          </div>
        </div>
      </header>

      <main className="content-area">
        {activeStep === 1 && (
          <Step1Roster
            teachers={teachers}
            selectedTeacherId={selectedTeacherId}
            setSelectedTeacherId={setSelectedTeacherId}
            editingTeacherId={editingTeacherId}
            setEditingTeacherId={setEditingTeacherId}
            teacherName={teacherName}
            setTeacherName={setTeacherName}
            teacherTarget={teacherTarget}
            setTeacherTarget={setTeacherTarget}
            teacherPriority={teacherPriority}
            setTeacherPriority={setTeacherPriority}
            handleSaveTeacher={(e) => handleSaveTeacherSubmit(e, saveTeacherContext)}
            handleEditTeacherClick={(t) => handleEditTeacherClick(t, monthlyTargets)}
            handleDeleteTeacher={(id) => handleDeleteTeacherClick(id, { pruneTeacherFromMonth })}
            teacherError={teacherError}
            setTeacherError={setTeacherError}
            handleFileImport={handleFileImport}
            selectedYear={selectedYear}
            setSelectedYear={requestYearChange}
            selectedMonth={selectedMonth}
            setSelectedMonth={requestMonthChange}
            availabilities={availabilities}
            handleCycleAvailability={handleCycleAvailabilityWrapper}
            monthLabel={monthLabel}
            partnerGroups={partnerGroups}
            monthlyTargets={monthlyTargets}
            onChangeGroups={setPartnerGroups}
            copyMonths={copyMonths}
            onCopyFromMonth={handleCopyPartnersFromMonth}
            posts={posts}
            selectedPostId={selectedPostId}
            teacherPostId={teacherPostId}
            setTeacherPostId={setTeacherPostId}
          />
        )}

        {activeStep === 2 && (
          <Step2ActiveDays
            selectedYear={selectedYear}
            setSelectedYear={requestYearChange}
            selectedMonth={selectedMonth}
            setSelectedMonth={requestMonthChange}
            holidays={holidays}
            weekendDutyDays={weekendDutyDays}
            extraDays={extraDays}
            handleToggleExtraDay={handleToggleExtraDay}
            handleToggleDayEligibility={handleToggleDayEligibility}
            postName={selectedPost?.name}
            copyPosts={copyPosts}
            onCopyFromPost={handleCopyDaySettings}
          />
        )}

        {activeStep === 3 && (
          <Step3Solver
            teachers={teachers}
            selectedYear={selectedYear}
            selectedMonth={selectedMonth}
            holidays={holidays}
            weekendDutyDays={weekendDutyDays}
            solverMode={solverMode}
            setSolverMode={setSolverMode}
            teachersPerDay={teachersPerDay}
            setTeachersPerDay={setTeachersPerDay}
            pinnedAssignments={pinnedAssignments}
            setPinnedAssignments={setPinnedAssignments}
            daySpecificTeachers={daySpecificTeachers}
            setDaySpecificTeachers={setDaySpecificTeachers}
            generatedSchedule={generatedSchedule}
            solverError={solverError}
            handleClearPins={handleClearPins}
            respectTargets={respectTargets}
            avoidConsecutiveDays={avoidConsecutiveDays}
            setAvoidConsecutiveDays={setAvoidConsecutiveDays}
            setRespectTargets={setRespectTargets}
            unfilledDays={unfilledDays}
            handleGenerateSchedule={handleGenerateSchedule}
            handleExportSchedule={handleExportSchedule}
            partnerGroups={partnerGroups}
            handleApproveSchedule={handleApproveSchedule}
            approval={approval}
            earlierApprovedCount={earlierApproved.length}
            includeEarlierApproved={includeEarlierApproved}
            setIncludeEarlierApproved={setIncludeEarlierApproved}
            postName={selectedPost?.name}
          />
        )}
      </main>

      {/* Floating status stack. These three banners used to render here,
          between the header and <main>, in normal flow -- so each one
          pushed the whole wizard down as it appeared and let it snap back
          as it went. They now sit in one viewport-fixed stack at the
          bottom, closer to where attention already is after pressing a
          button, and the layout no longer moves.

          It MUST stay outside <main>: .content-area carries a
          backdrop-filter, which creates a containing block for fixed
          descendants and would pin the stack inside the wizard pane
          instead of the viewport.

          Roles are unchanged -- role="status" (polite) for the two
          success banners, role="alert" (assertive) for the failure -- and
          the toast's buttons are still plain <button>s in normal tab
          order, so moving them costs nothing in accessibility terms. */}
      <div className="toast-stack">

        {/* role="status" (implicit aria-live="polite") — WCAG 2.2 AA 4.1.3
            Status Messages. This is used for import success, schedule
            generation success, and DB reset success, none of which previously
            had any non-visual announcement. */}
        {successMessage && (
          <div className="alert alert-success" role="status">{successMessage}</div>
        )}

        {/* Post-save export confirmation, replacing the old silent
            browser-style download. role="status" (implicit aria-live="polite"),
            matching the pattern above — announced to screen-reader users
            without needing focus to move here, and the two action buttons are
            plain, natively-focusable <button>s so they're keyboard-reachable
            via normal Tab order. */}
        {exportToast && (
          <div className="alert alert-success" role="status">
            <span>📥 Nöbet raporu kaydedildi: <strong>{exportToast.filename}</strong></span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.78rem" }}
                onClick={handleOpenExportedFile}
              >
                Dosyayı Aç
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.78rem" }}
                onClick={handleOpenExportedFolder}
              >
                Klasörü Aç
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.78rem" }}
                onClick={handleDismissExportToast}
                aria-label="Bildirimi kapat"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Write-failure feedback (e.g. disk error). role="alert" (implicit
            aria-live="assertive"), matching Step3Solver's solverError pattern,
            since this is an unexpected-failure message the user needs to
            notice promptly. */}
        {exportErrorMessage && (
          <div className="alert alert-danger" role="alert">{exportErrorMessage}</div>
        )}
      </div>

      {/* Custom React Dialog Box Modal for Database Reset Confirmation */}
      {isResetConfirmOpen && (
        <div 
          style={{ 
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999
          }}
        >
          <div
            ref={modalRef}
            className="card surface-solid"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-confirm-title"
            aria-describedby="reset-confirm-desc"
            tabIndex={-1}
            style={{
              width: "100%",
              maxWidth: "400px",
              padding: "24px",
              borderRadius: "16px",
              border: "1.5px solid var(--border)",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              display: "flex",
              flexDirection: "column",
              gap: "16px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", borderBottom: "1.5px solid var(--border)", paddingBottom: "12px" }}>
              <span style={{ fontSize: "1.5rem" }} aria-hidden="true">⚠️</span>
              <h3 id="reset-confirm-title" style={{ margin: 0, color: "var(--danger)", fontWeight: "850", fontSize: "1.15rem" }}>
                Sistemi ve Veritabanını Sıfırla
              </h3>
            </div>

            <p id="reset-confirm-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
              Tüm öğretmen kayıtları, nöbet uygunluk tercihleri ve kaydedilmiş tüm aylık çizelgeler veritabanından kalıcı olarak silinecektir.
            </p>
            {/* Approved schedules are official records: kept unless asked. */}
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.88rem", fontWeight: 600, color: "var(--text-primary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={resetIncludesApproved}
                onChange={(e) => setResetIncludesApproved(e.target.checked)}
                style={{ accentColor: "var(--danger)" }}
              />
              Onaylı çizelgeleri de sil
            </label>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              {resetIncludesApproved
                ? "Onaylı çizelgeler de kalıcı olarak silinecek."
                : "Onaylı çizelgeler korunacak."}
            </p>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--danger)", fontWeight: "700" }}>
              Bu işlem kesinlikle geri alınamaz! Onaylıyor musunuz?
            </p>

            <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
              <button
                className="btn btn-secondary"
                style={{ flexGrow: 1 }}
                onClick={() => setIsResetConfirmOpen(false)}
              >
                İptal Et
              </button>
              <button
                className="btn btn-danger"
                style={{ flexGrow: 1 }}
                onClick={async () => {
                  setIsResetConfirmOpen(false);
                  await handleResetAllDatabaseDirect();
                }}
              >
                Evet, Tümünü Sıfırla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incomplete-export confirmation. Same role="dialog"/aria-modal/
          accessible-name/focus-trap contract as the two modals around it.
          Two outcomes only: export the partial sheet anyway, or back out and
          write nothing. Never silently exports a roster with holes in it. */}
      {isIncompleteExportConfirmOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999
          }}
        >
          <div
            ref={incompleteExportModalRef}
            className="card surface-solid"
            role="dialog"
            aria-modal="true"
            aria-labelledby="incomplete-export-title"
            aria-describedby="incomplete-export-desc"
            tabIndex={-1}
            style={{
              width: "100%",
              maxWidth: "440px",
              padding: "24px",
              borderRadius: "16px",
              border: "1.5px solid var(--border)",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              display: "flex",
              flexDirection: "column",
              gap: "16px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", borderBottom: "1.5px solid var(--border)", paddingBottom: "12px" }}>
              <span style={{ fontSize: "1.5rem" }} aria-hidden="true">📋</span>
              <h3 id="incomplete-export-title" style={{ margin: 0, color: "var(--warning-text)", fontWeight: "850", fontSize: "1.15rem" }}>
                Çizelge Eksik
              </h3>
            </div>

            <p id="incomplete-export-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
              {unfilledDays.length > 0 ? (
                <>
                  {MONTHS_TR[selectedMonth - 1]} {selectedYear} çizelgesinde{" "}
                  <strong style={{ color: "var(--text-primary)" }}>{unfilledDays.length} gün</strong> eksik.
                  Toplam{" "}
                  <strong style={{ color: "var(--text-primary)" }}>
                    {unfilledDays.reduce((sum, g) => sum + (g.required - g.assigned), 0)} nöbet yeri
                  </strong>{" "}
                  doldurulamadı.
                </>
              ) : (
                <>{MONTHS_TR[selectedMonth - 1]} {selectedYear} çizelgesinde bütün nöbet günleri dolu.</>
              )}
              {incompleteAction === "approve" && shortGroupCount > 0 && (
                <>
                  {" "}
                  <strong style={{ color: "var(--text-primary)" }}>{shortGroupCount} nöbet grubu</strong> ortak nöbet günü hedefine ulaşamadı.
                </>
              )}
            </p>

            {/* The specific dates, so the principal can act on them without
                hunting through the calendar. Capped at 8 with a "+N more"
                tail: a fully open month would otherwise push the buttons off
                the screen. */}
            <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4rem", maxHeight: "160px", overflowY: "auto" }}>
              {unfilledDays.slice(0, 8).map((gap) => (
                <li key={gap.date}>
                  {new Date(gap.date).toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}
                  {" — "}
                  {gap.assigned}/{gap.required} nöbetçi
                </li>
              ))}
              {unfilledDays.length > 8 && (
                <li style={{ fontStyle: "italic" }}>ve {unfilledDays.length - 8} gün daha…</li>
              )}
            </ul>

            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-primary)", fontWeight: "700" }}>
              {incompleteAction === "approve"
                ? "Eksik hâliyle onaylamak istiyor musunuz?"
                : "Eksik hâliyle Excel'e aktarmak istiyor musunuz?"}
            </p>

            <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
              <button
                className="btn btn-secondary"
                style={{ flexGrow: 1 }}
                onClick={() => setIsIncompleteExportConfirmOpen(false)}
              >
                Vazgeç
              </button>
              <button
                className="btn btn-primary"
                style={{ flexGrow: 1 }}
                onClick={async () => {
                  setIsIncompleteExportConfirmOpen(false);
                  if (incompleteAction === "approve") {
                    confirmReplaceOrApprove();
                  } else {
                    await performExportSchedule();
                  }
                }}
              >
                {incompleteAction === "approve" ? "Yine de Onayla" : "Yine de Aktar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom React Dialog Box Modal for Unsaved Month-Draft Navigation.
          Same role="dialog"/aria-modal/accessible-name/focus-trap
          pattern as the DB-reset modal above — exactly three outcomes: Save,
          Discard, Cancel. */}
      {isUnsavedConfirmOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999
          }}
        >
          <div
            ref={unsavedModalRef}
            className="card surface-solid"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-nav-title"
            aria-describedby="unsaved-nav-desc"
            tabIndex={-1}
            style={{
              width: "100%",
              maxWidth: "420px",
              padding: "24px",
              borderRadius: "16px",
              border: "1.5px solid var(--border)",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              display: "flex",
              flexDirection: "column",
              gap: "16px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", borderBottom: "1.5px solid var(--border)", paddingBottom: "12px" }}>
              <span style={{ fontSize: "1.5rem" }} aria-hidden="true">💾</span>
              <h3 id="unsaved-nav-title" style={{ margin: 0, color: "var(--text-primary)", fontWeight: "850", fontSize: "1.15rem" }}>
                Kaydedilmemiş Değişiklikler
              </h3>
            </div>

            <p id="unsaved-nav-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
              {MONTHS_TR[selectedMonth - 1]} {selectedYear} için yaptığınız değişiklikler henüz kaydedilmedi.
              Başka bir aya ya da nöbet yerine geçmeden önce ne yapmak istersiniz?
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
              <button
                className="btn btn-success"
                style={{ width: "100%" }}
                onClick={handleSaveUnsavedNav}
              >
                Kaydet ve Devam Et
              </button>
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  className="btn btn-secondary"
                  style={{ flexGrow: 1 }}
                  onClick={handleCancelUnsavedNav}
                >
                  İptal Et
                </button>
                <button
                  className="btn btn-danger"
                  style={{ flexGrow: 1 }}
                  onClick={handleDiscardUnsavedNav}
                >
                  Kaydetmeden Devam Et
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Approved schedules drawer, opened from the header on any step. */}
      {isApprovedDrawerOpen && (
        <ApprovedSchedulesDrawer
          approvedSchedules={namedApproved}
          onClose={handleCloseApprovedDrawer}
          onExport={handleExportApproved}
          onDelete={setApprovedToDelete}
        />
      )}

      {/* Approving a schedule that already has an approved copy replaces it,
          so say which copy and ask first. */}
      {isReplaceApprovedOpen && currentApproved && (
        <ModalDialog
          titleId="replace-approved-title"
          describedById="replace-approved-desc"
          title="Onaylı Çizelgeyi Değiştir"
          icon="✅"
          onCancel={() => setIsReplaceApprovedOpen(false)}
        >
          <p id="replace-approved-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
            {monthLabel} için <strong style={{ color: "var(--text-primary)" }}>{formatApprovalDate(currentApproved.approved_at)}</strong> tarihinde
            onaylanmış çizelge, ekrandaki çizelgeyle değiştirilecek.
          </p>
          <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
            <button className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={() => setIsReplaceApprovedOpen(false)}>
              Vazgeç
            </button>
            <button
              className="btn btn-primary"
              style={{ flexGrow: 1 }}
              onClick={async () => {
                setIsReplaceApprovedOpen(false);
                await performApproveSchedule();
              }}
            >
              Değiştir
            </button>
          </div>
        </ModalDialog>
      )}

      {approvedToDelete && (
        <DeleteApprovedDialog
          label={`${MONTHS_TR[approvedToDelete.month - 1]} ${approvedToDelete.year}`}
          postName={approvedToDelete.postName}
          approvedAt={approvedToDelete.approved_at}
          onCancel={() => setApprovedToDelete(null)}
          onConfirm={handleConfirmDeleteApproved}
        />
      )}
    </div>
  );
}
