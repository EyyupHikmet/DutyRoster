import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { i18n, LANGUAGES, Language } from "./i18n";
import { useTeachers } from "./hooks/useTeachers";
import { useAvailabilities } from "./hooks/useAvailabilities";
import { useScheduleState } from "./hooks/useScheduleState";
import { parseExcelRoster, exportScheduleToExcel, exportDutyReport, ExportScheduleResult } from "./utils/excelUtils";
import { freezeScheduleReport, openDays, openSlotCount, sameReport, ScheduleReport } from "./utils/scheduleReport";
import { gatherAllPostsReports } from "./utils/allPostsReport";
import { approvedCopyFor, earlierInSchoolYear, formatApprovalDate } from "./utils/approvedSchedules";
import { creditPartnerGroups } from "./solver/partners";
import { splitImportByName } from "./utils/teacherNames";
import { useApprovedSchedules, ApprovedSchedule } from "./hooks/useApprovedSchedules";
import { useDutyPosts } from "./hooks/useDutyPosts";
import { getDutyDates, findUnfilledDays, monthName } from "./utils/dateUtils";
import { effectiveTarget } from "./utils/targets";
import { solve, Teacher, SolverConfig, SolverResult } from "./solver";
import { saveTeacher, resetDb, getLastPostId, setLastPostId, getAllSchedules, getLanguage, setLanguage } from "./db";
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
  const { t } = useTranslation();
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
  // One report for every duty post (#28), and what the last such export
  // gathered while its warning is open.
  const [includeAllPosts, setIncludeAllPosts] = useState<boolean>(false);
  const [allPostsExport, setAllPostsExport] = useState<{
    reports: ScheduleReport[];
    skippedPosts: string[];
    gaps: { postName: string; days: number; slots: number }[];
  } | null>(null);
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

  // On a narrow window the header's side buttons keep only their icons, so the
  // wizard steps are never covered. Measured in the app's own text scale (the
  // header row is the window less the page padding): larger text compacts
  // sooner. JS rather than a CSS container query, because containing the header
  // would trap its dropdowns and dialogs inside it.
  const [windowWidth, setWindowWidth] = useState<number>(() => window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const compactHeader = windowWidth - 48 < 47.5 * 16 * fontSizeFactor;

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

  const monthLabel = `${monthName(selectedMonth)} ${selectedYear}`;

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
    setLastPostId(postId).catch((err) => console.error("Could not remember the selected duty post:", err));
  };

  const duplicatePostMessage = (name: string) => t("app.postNameTaken", { name });

  // Resolves to the message the dialog shows when the name is refused.
  const handleAddPost = async (name: string): Promise<string | null> => {
    const result = await addPost(name);
    if (result.status === "duplicate") return duplicatePostMessage(result.existing.name);
    if (result.status === "empty") return t("app.postNameEmpty");
    if (result.status === "error") return t("app.postAddFailed");
    requestPostChange(result.post.id);
    return null;
  };

  const handleRenamePost = async (name: string): Promise<string | null> => {
    if (!selectedPostId) return null;
    const result = await renamePost(selectedPostId, name);
    if (result.status === "duplicate") return duplicatePostMessage(result.existing.name);
    if (result.status === "empty") return t("app.postNameEmpty");
    if (result.status === "error") return t("app.postRenameFailed");
    return null;
  };

  // The menu deletes the post on screen. Its unsaved changes go with it, so
  // nothing is asked before moving to a post that remains.
  const handleDeletePost = async () => {
    if (!selectedPostId) return;
    const name = selectedPost?.name ?? "";
    const result = await removePost(selectedPostId);
    if (result.status !== "deleted") {
      setExportErrorMessage(t("app.postDeleteFailed"));
      setTimeout(() => setExportErrorMessage(null), 5000);
      return;
    }
    const remaining = await loadPosts();
    if (remaining.length > 0) switchPost(remaining[0].id);
    await loadApprovedSchedules();
    setSuccessMessage(t("app.postDeleted", { name }));
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleCopyDaySettings = async (sourcePostId: string) => {
    const sourceName = posts.find((p) => p.id === sourcePostId)?.name ?? "";
    if (await copyDaySettingsFromPost(sourcePostId)) {
      setSuccessMessage(t("app.daySettingsCopied", { name: sourceName }));
      setTimeout(() => setSuccessMessage(null), 4000);
    } else {
      setExportErrorMessage(t("app.daySettingsMissing", { name: sourceName }));
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
  // The language the principal chose last time. main.tsx applies it before the
  // first paint; this covers a render that did not go through main.tsx.
  useEffect(() => {
    async function applySavedLanguage() {
      try {
        const saved = await getLanguage();
        if (saved && saved !== i18n.language) await i18n.changeLanguage(saved);
      } catch (err) {
        console.error("Could not read the saved language:", err);
      }
    }
    applySavedLanguage();
  }, []);

  useEffect(() => {
    async function openLastPost() {
      try {
        await loadPosts();
        setSelectedPostId(await getLastPostId());
      } catch (err) {
        console.error("Could not load the duty posts:", err);
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
        console.error("Could not load the database:", err);
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
          alert(t("app.importNoTeachers"));
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
            ? t("app.importSkipped", { count: skipped.length, names: skipped.join(", ") })
            : "";
        if (added.length === 0) {
          setSuccessMessage(t("app.importNoneAdded", { skipped: skippedNote }));
        } else if (skipped.length === 0) {
          setSuccessMessage(t("app.importAdded", { count: added.length }));
        } else {
          setSuccessMessage(t("app.importAddedWithSkipped", { count: added.length, skipped: skippedNote }));
        }
        // A list of skipped names needs longer on screen to be read.
        setTimeout(() => setSuccessMessage(null), skipped.length > 0 ? 8000 : 4000);
      } catch (err) {
        console.error("Could not import the roster:", err);
        alert(t("app.importFailed"));
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
  // A report for every post adds every post's earlier approved schedules.
  const exportsAllPosts = includeAllPosts && posts.length > 1;
  const earlierApprovedAllPosts = posts.flatMap((post) =>
    earlierInSchoolYear(namedApproved, post.id, selectedYear, selectedMonth)
  );

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
      setSolverError(t("app.noDutyDays"));
      return;
    }

    if (teachers.length === 0) {
      setSolverError(t("app.noTeachers"));
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
          ? t("app.generatedWithGaps", { count: gapCount })
          : t("app.generated")
      );
      setTimeout(() => setSuccessMessage(null), 3000);
    } else {
      // The solver reports what stopped it; the sentence is the interface's.
      setSolverError(
        result.error_code
          ? t(`solverError.${result.error_code}`, {
              date: result.error_date
                ? new Date(result.error_date).toLocaleDateString(i18n.language, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
                : t("solverError.someDay"),
            })
          : t("solverError.unknown")
      );
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
    setAllPostsExport(null);
    if (exportsAllPosts) {
      await handleExportAllPosts();
      return;
    }
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

  // One report for every duty post: the schedule on screen, every other post's
  // saved schedule for the month, and earlier approved ones when included.
  // Posts with gaps and posts left out are named first, like a single post's gaps.
  const handleExportAllPosts = async () => {
    let schedules;
    try {
      schedules = await getAllSchedules();
    } catch (err) {
      showExportResult({ status: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    const { reports, skippedPosts } = gatherAllPostsReports({
      posts,
      screenPostId: selectedPostId ?? "",
      screenReport: workingReport,
      schedules,
      teachers: allTeachers,
      earlierCopies: includeEarlierApproved ? earlierApprovedAllPosts : [],
    });
    const gaps = reports
      .filter((r) => r.year === selectedYear && r.month === selectedMonth)
      .map((r) => ({ postName: r.postName ?? "", days: openDays(r).length, slots: openSlotCount(r) }))
      .filter((gap) => gap.days > 0)
      .sort((a, b) => a.postName.localeCompare(b.postName, "tr"));

    if (gaps.length > 0 || skippedPosts.length > 0) {
      setAllPostsExport({ reports, skippedPosts, gaps });
      setIncompleteAction("export");
      setIsIncompleteExportConfirmOpen(true);
      return;
    }
    await performExportAllPosts(reports);
  };

  const performExportAllPosts = async (reports: ScheduleReport[]) => {
    setExportErrorMessage(null);
    showExportResult(await exportDutyReport(reports, {}, { allPosts: true }));
  };

  // Switching the interface language: live, and remembered for next time.
  const chooseLanguage = async (language: Language) => {
    if (language === i18n.language) return;
    await i18n.changeLanguage(language);
    try {
      await setLanguage(language);
    } catch (err) {
      console.error("Could not save the language:", err);
    }
  };

  // What every export shows for its outcome.
  const showExportResult = (result: ExportScheduleResult) => {
    if (result.status === "saved") {
      setExportToast({ path: result.path, filename: result.filename });
    } else if (result.status === "error") {
      console.error("Could not export to Excel:", result.message);
      setExportErrorMessage(t("app.exportFailed"));
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
      setSuccessMessage(t("app.approved", { month: monthLabel }));
      setTimeout(() => setSuccessMessage(null), 4000);
    } else {
      setExportErrorMessage(t("app.approveFailed"));
      setTimeout(() => setExportErrorMessage(null), 5000);
    }
  };

  const handleConfirmDeleteApproved = async () => {
    if (!approvedToDelete) return;
    const label = `${monthName(approvedToDelete.month)} ${approvedToDelete.year}`;
    const id = approvedToDelete.id;
    setApprovedToDelete(null);
    if (await remove(id)) {
      setSuccessMessage(t("app.approvedDeleted", { label }));
      setTimeout(() => setSuccessMessage(null), 4000);
    } else {
      setExportErrorMessage(t("app.approvedDeleteFailed"));
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
      console.error("Could not open the file:", err);
      setExportErrorMessage(
        t("app.openFileFailed", { path: exportToast.path })
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
      console.error("Could not open the folder:", err);
      setExportErrorMessage(
        t("app.openFolderFailed", { path: exportToast.path })
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
      console.error("Could not open the project page:", err);
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
      
      setSuccessMessage(t("app.dbReset"));
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Could not reset the database:", err);
      alert(t("app.dbResetFailed"));
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
        <h1 className="sr-only">{t("app.title")}</h1>

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
                compact={compactHeader}
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
              title={t("app.approvedDrawer")}
              aria-label={t("app.approvedDrawer")}
              aria-expanded={isApprovedDrawerOpen}
              aria-controls="approved-schedules-drawer"
            >
              <span aria-hidden="true">📚</span>
              {!compactHeader && <span>{t("app.approvedDrawer")}</span>}
            </button>

        <div style={{ position: "relative" }} ref={settingsWrapperRef}>
          <button
            ref={settingsToggleBtnRef}
            className="settings-toggle-btn"
            onClick={() => setIsSettingsOpen(prev => !prev)}
            title={t("app.settings")}
            aria-label={t("app.settings")}
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
              role="group"
              aria-label={t("app.settings")}
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
                  {t("app.textScale")}
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: "600" }}>
                    <label htmlFor="font-scale-slider">{t("app.scale")}</label>
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
                    aria-valuetext={t("app.scaleValue", { percent: Math.round(fontSizeFactor * 100) })}
                    style={{ width: "100%", cursor: "pointer", accentColor: "var(--primary)" }}
                  />
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "4px 8px", fontSize: "0.7rem", width: "100%", marginTop: "2px" }}
                    onClick={() => setFontSizeFactor(1)}
                  >
                    {t("app.resetTextSize")}
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
                <span style={{ fontSize: "0.82rem", fontWeight: "700", color: "var(--text-secondary)" }}>{t("app.theme")}</span>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: "6px 12px", fontSize: "0.75rem", height: "28px", minWidth: "110px", fontWeight: "bold" }}
                  onClick={() => setTheme(prev => prev === "light" ? "dark" : "light")}
                  title={t(theme === "light" ? "app.toDark" : "app.toLight")}
                >
                  {t(theme === "light" ? "app.light" : "app.dark")}
                </button>
              </div>

              {/* Section 2b: Interface language. Each language is named in
                  its own language, so the control reads the same whichever
                  one is active. */}
              <div
                style={{
                  borderTop: "1.5px solid var(--border)",
                  paddingTop: "12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "0.82rem", fontWeight: "700", color: "var(--text-secondary)" }}>{t("app.language")}</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  {LANGUAGES.map((code) => (
                    <button
                      key={code}
                      className={`btn ${i18n.language === code ? "btn-primary" : "btn-secondary"}`}
                      style={{ padding: "6px 10px", fontSize: "0.75rem", height: "28px", fontWeight: "bold" }}
                      aria-pressed={i18n.language === code}
                      onClick={() => chooseLanguage(code)}
                    >
                      {t(code === "tr" ? "app.languageTr" : "app.languageEn")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section 3: Danger Zone Reset All DB */}
              <div style={{ borderTop: "1.5px solid var(--border)", paddingTop: "12px", marginTop: "2px" }}>
                <button
                  ref={resetDangerBtnRef}
                  className="btn btn-danger"
                  style={{ padding: "8px 12px", fontSize: "0.75rem", width: "100%" }}
                  onClick={handleResetAllDatabase}
                >
                  {t("app.resetDb")}
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
                  title={t("app.projectTitle")}
                >
                  <span aria-hidden="true">🌐</span> {t("app.project")}
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
            earlierApprovedCount={exportsAllPosts ? earlierApprovedAllPosts.length : earlierApproved.length}
            includeEarlierApproved={includeEarlierApproved}
            setIncludeEarlierApproved={setIncludeEarlierApproved}
            postName={selectedPost?.name}
            availabilities={availabilities}
            monthlyTargets={monthlyTargets}
            postCount={posts.length}
            includeAllPosts={includeAllPosts}
            setIncludeAllPosts={setIncludeAllPosts}
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
            <span>{t("app.exportSaved")} <strong>{exportToast.filename}</strong></span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.78rem" }}
                onClick={handleOpenExportedFile}
              >
                {t("app.openFile")}
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.78rem" }}
                onClick={handleOpenExportedFolder}
              >
                {t("app.openFolder")}
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.78rem" }}
                onClick={handleDismissExportToast}
                aria-label={t("app.dismiss")}
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
                {t("app.resetTitle")}
              </h3>
            </div>

            <p id="reset-confirm-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
              {t("app.resetBody")}
            </p>
            {/* Approved schedules are official records: kept unless asked. */}
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.88rem", fontWeight: 600, color: "var(--text-primary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={resetIncludesApproved}
                onChange={(e) => setResetIncludesApproved(e.target.checked)}
                style={{ accentColor: "var(--danger)" }}
              />
              {t("app.resetIncludeApproved")}
            </label>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              {resetIncludesApproved
                ? t("app.resetApprovedGone")
                : t("app.resetApprovedKept")}
            </p>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--danger)", fontWeight: "700" }}>
              {t("app.resetConfirmQuestion")}
            </p>

            <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
              <button
                className="btn btn-secondary"
                style={{ flexGrow: 1 }}
                onClick={() => setIsResetConfirmOpen(false)}
              >
                {t("app.cancelAction")}
              </button>
              <button
                className="btn btn-danger"
                style={{ flexGrow: 1 }}
                onClick={async () => {
                  setIsResetConfirmOpen(false);
                  await handleResetAllDatabaseDirect();
                }}
              >
                {t("app.resetConfirm")}
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
                {t("app.incompleteTitle")}
              </h3>
            </div>

            {incompleteAction === "export" && allPostsExport ? (
              <>
                <p id="incomplete-export-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
                  {t("app.allPostsIncomplete", { month: monthName(selectedMonth), year: selectedYear })}
                </p>
                <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4rem", maxHeight: "160px", overflowY: "auto" }}>
                  {allPostsExport.gaps.map((gap) => (
                    <li key={`gap-${gap.postName}`}>{t("app.postGap", { post: gap.postName, days: gap.days, slots: gap.slots })}</li>
                  ))}
                  {allPostsExport.skippedPosts.map((name) => (
                    <li key={`skipped-${name}`}>{t("app.postSkipped", { post: name })}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p id="incomplete-export-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
                  {unfilledDays.length > 0 ? (
                    <>
                      {t("app.monthMissingDays", { month: monthName(selectedMonth), year: selectedYear })}{" "}
                      <strong style={{ color: "var(--text-primary)" }}>{t("app.missingDays", { count: unfilledDays.length })}</strong>{" "}
                      {t("app.missingEnd")}{" "}
                      <strong style={{ color: "var(--text-primary)" }}>
                        {t("app.missingSlots", { count: unfilledDays.reduce((sum, g) => sum + (g.required - g.assigned), 0) })}
                      </strong>{" "}
                      {t("app.missingTail")}
                    </>
                  ) : (
                    <>{t("app.monthComplete", { month: monthName(selectedMonth), year: selectedYear })}</>
                  )}
                  {incompleteAction === "approve" && shortGroupCount > 0 && (
                    <>
                      {" "}
                      <strong style={{ color: "var(--text-primary)" }}>{t("app.shortGroups", { count: shortGroupCount })}</strong> {t("app.shortGroupsTail")}
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
                      {t("app.gapLine", { filled: `${gap.assigned}/${gap.required}` })}
                    </li>
                  ))}
                  {unfilledDays.length > 8 && (
                    <li style={{ fontStyle: "italic" }}>{t("app.andMoreDays", { count: unfilledDays.length - 8 })}</li>
                  )}
                </ul>
              </>
            )}

            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-primary)", fontWeight: "700" }}>
              {incompleteAction === "approve"
                ? t("app.approveAnyway")
                : t("app.exportAnyway")}
            </p>

            <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
              <button
                className="btn btn-secondary"
                style={{ flexGrow: 1 }}
                onClick={() => setIsIncompleteExportConfirmOpen(false)}
              >
                {t("dialog.cancel")}
              </button>
              <button
                className="btn btn-primary"
                style={{ flexGrow: 1 }}
                onClick={async () => {
                  setIsIncompleteExportConfirmOpen(false);
                  if (incompleteAction === "approve") {
                    confirmReplaceOrApprove();
                  } else if (allPostsExport) {
                    await performExportAllPosts(allPostsExport.reports);
                  } else {
                    await performExportSchedule();
                  }
                }}
              >
                {t(incompleteAction === "approve" ? "app.approveAnywayAction" : "app.exportAnywayAction")}
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
                {t("app.unsavedTitle")}
              </h3>
            </div>

            <p id="unsaved-nav-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
              {t("app.unsavedBody", { month: monthName(selectedMonth), year: selectedYear })}
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
              <button
                className="btn btn-success"
                style={{ width: "100%" }}
                onClick={handleSaveUnsavedNav}
              >
                {t("app.saveAndGo")}
              </button>
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  className="btn btn-secondary"
                  style={{ flexGrow: 1 }}
                  onClick={handleCancelUnsavedNav}
                >
                  {t("app.cancelAction")}
                </button>
                <button
                  className="btn btn-danger"
                  style={{ flexGrow: 1 }}
                  onClick={handleDiscardUnsavedNav}
                >
                  {t("app.discardAndGo")}
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
          title={t("app.replaceApprovedTitle")}
          icon="✅"
          onCancel={() => setIsReplaceApprovedOpen(false)}
        >
          <p id="replace-approved-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
            <Trans
              i18nKey="app.replaceApprovedBody"
              values={{ month: monthLabel, date: formatApprovalDate(currentApproved.approved_at) }}
              components={{ 1: <strong style={{ color: "var(--text-primary)" }} /> }}
            />
          </p>
          <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
            <button className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={() => setIsReplaceApprovedOpen(false)}>
              {t("dialog.cancel")}
            </button>
            <button
              className="btn btn-primary"
              style={{ flexGrow: 1 }}
              onClick={async () => {
                setIsReplaceApprovedOpen(false);
                await performApproveSchedule();
              }}
            >
              {t("app.replace")}
            </button>
          </div>
        </ModalDialog>
      )}

      {approvedToDelete && (
        <DeleteApprovedDialog
          label={`${monthName(approvedToDelete.month)} ${approvedToDelete.year}`}
          postName={approvedToDelete.postName}
          approvedAt={approvedToDelete.approved_at}
          onCancel={() => setApprovedToDelete(null)}
          onConfirm={handleConfirmDeleteApproved}
        />
      )}
    </div>
  );
}
