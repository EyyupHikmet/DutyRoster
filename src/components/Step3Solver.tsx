import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DbTeacher } from "../db";
import { shortDayNames, getMonthDatesWithPadding, formatDateYYYYMMDD, formatDateLong } from "../utils/dateUtils";
import { CustomSelect } from "./CustomSelect";
import { PartnerGroup, creditPartnerGroups } from "../solver/partners";
import { AvailabilityStatus } from "../solver";
import { pinWarnings } from "../utils/pinWarnings";
import { turkishPossessiveSuffix } from "../utils/turkishNumberSuffix";
import { formatApprovalDate } from "../utils/approvedSchedules";

interface Step3SolverProps {
  teachers: DbTeacher[];
  selectedYear: number;
  selectedMonth: number;
  holidays: string[];
  weekendDutyDays: string[];
  solverMode: "fairness" | "priority" | "strict" | "random";
  setSolverMode: (m: "fairness" | "priority" | "strict" | "random") => void;
  respectTargets: boolean;
  setRespectTargets: (v: boolean) => void;
  avoidConsecutiveDays: boolean;
  setAvoidConsecutiveDays: (v: boolean) => void;
  teachersPerDay: number;
  setTeachersPerDay: (n: number) => void;
  pinnedAssignments: Record<string, string[]>;
  setPinnedAssignments: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  daySpecificTeachers: Record<string, number>;
  setDaySpecificTeachers: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  generatedSchedule: Record<string, string[]>;
  solverError: string | null;
  handleClearPins: (dateStr: string) => void;
  handleGenerateSchedule: () => void;
  handleExportSchedule: () => void;
  unfilledDays: Array<{ date: string; required: number; assigned: number }>;
  partnerGroups: PartnerGroup[];
  /** Approves the schedule on screen. Without it, no Onayla button is shown. */
  handleApproveSchedule?: () => void;
  /** Set when the working schedule has an approved copy. */
  approval?: { approvedAt: string; changed: boolean } | null;
  /** Earlier approved schedules of the school year an export can include. */
  earlierApprovedCount?: number;
  includeEarlierApproved?: boolean;
  setIncludeEarlierApproved?: (include: boolean) => void;
  /** The duty post whose month this is, named next to the title. */
  postName?: string;
  /** How many duty posts there are; an export can include them all when there are several. */
  postCount?: number;
  includeAllPosts?: boolean;
  setIncludeAllPosts?: (include: boolean) => void;
  /** Who is Uygun Değil or Tercihli on which day, for the pin warnings. */
  availabilities?: Record<string, Record<string, AvailabilityStatus>>;
  /** This month's target overrides, which the pin warnings measure against. */
  monthlyTargets?: Record<string, number>;
}

// The hard rules that sit under the four distribution modes. Deliberately
// checkboxes and not extra radios: each one is orthogonal to the modes (which
// only ORDER candidates) and to each other, so every combination is valid and
// they must all be independently toggleable. Real <input type="checkbox">
// elements rather than ARIA-annotated <div>s, so native keyboard, focus and
// screen-reader behavior comes for free.
const HardRuleCheckbox: React.FC<{
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
  isFirst: boolean;
}> = ({ id, checked, onChange, title, description, isFirst }) => (
  <div
    style={{
      marginTop: isFirst ? "12px" : "10px",
      paddingTop: isFirst ? "12px" : 0,
      borderTop: isFirst ? "1.5px solid var(--border)" : undefined,
      display: "flex",
      alignItems: "flex-start",
      gap: "8px"
    }}
  >
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      style={{ marginTop: "2px", width: "15px", height: "15px", cursor: "pointer", flexShrink: 0 }}
      aria-describedby={`${id}-desc`}
    />
    <label htmlFor={id} style={{ cursor: "pointer" }}>
      <div style={{ fontSize: "0.82rem", fontWeight: "700", color: "var(--text-primary)" }}>
        {title}
      </div>
      <div
        id={`${id}-desc`}
        style={{ fontSize: "0.72rem", lineHeight: "1.05rem", color: "var(--text-secondary)", marginTop: "2px" }}
      >
        {description}
      </div>
    </label>
  </div>
);

export const Step3Solver: React.FC<Step3SolverProps> = ({
  teachers,
  selectedYear,
  selectedMonth,
  holidays,
  weekendDutyDays,
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
  daySpecificTeachers,
  setDaySpecificTeachers,
  generatedSchedule,
  solverError,
  handleClearPins,
  handleGenerateSchedule,
  handleExportSchedule,
  unfilledDays,
  partnerGroups,
  handleApproveSchedule,
  approval = null,
  earlierApprovedCount = 0,
  includeEarlierApproved = true,
  setIncludeEarlierApproved,
  postName,
  postCount = 1,
  includeAllPosts = false,
  setIncludeAllPosts,
  availabilities = {},
  monthlyTargets = {}
}) => {
  const { t } = useTranslation();
  const paddedDates = getMonthDatesWithPadding(selectedYear, selectedMonth);

  // State to track which day is currently being configured in the Sidebar
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);

  // Accessible radio-group behavior for the 4 solver-mode cards:
  // these were plain onClick-only <div>s with no keyboard access and no ARIA
  // role at all. They're a mutually-exclusive single choice, i.e. exactly a
  // radio group, so they get role="radiogroup"/role="radio" + aria-checked +
  // the native roving-tabindex + arrow-key behavior real <input type="radio">
  // groups have (arrow keys both move focus AND change the selection).
  const solverModeOrder: Array<"fairness" | "priority" | "strict" | "random"> = [
    "fairness", "priority", "strict", "random"
  ];
  const modeCardRefs = useRef<Array<HTMLDivElement | null>>([]);

  const handleModeCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, idx: number) => {
    const currentIdx = solverModeOrder.indexOf(solverMode);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSolverMode(solverModeOrder[idx]);
      return;
    }
    let nextIdx: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      nextIdx = (currentIdx + 1) % solverModeOrder.length;
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      nextIdx = (currentIdx - 1 + solverModeOrder.length) % solverModeOrder.length;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      setSolverMode(solverModeOrder[nextIdx]);
      modeCardRefs.current[nextIdx]?.focus();
    }
  };

  // Find details of the selected date for the Sidebar
  const getSelectedDateDetails = () => {
    if (!selectedDateStr) return null;
    const dateObj = new Date(selectedDateStr);
    const dateFriendly = formatDateLong(dateObj, { day: "numeric", month: "long", year: "numeric", weekday: "long" });
    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
    return { dateFriendly, isWeekend };
  };

  // Which hard rules are currently narrowing the search. Used to word the
  // open-day warning honestly: before the second rule existed the banner always
  // blamed the target cap, which is wrong when the cap is off (a day can also
  // be left open by pinning alone).
  const activeHardRules: string[] = [];
  if (respectTargets) activeHardRules.push(t("step3.capQuoted"));
  if (avoidConsecutiveDays) activeHardRules.push(t("step3.consecutiveQuoted"));

  const selectedDateDetails = getSelectedDateDetails();
  const requiredCount = selectedDateStr ? (daySpecificTeachers[selectedDateStr] ?? teachersPerDay) : teachersPerDay;
  const pinnedIds = selectedDateStr ? (pinnedAssignments[selectedDateStr] || []) : [];

  // Recomputed from the live schedule rather than cached from the last solve,
  // for the same reason `unfilledDays` is: a pin cleared or a saved month
  // loaded must not leave a stale badge or warning behind.
  const groupCredit = creditPartnerGroups(generatedSchedule, partnerGroups);

  const unfilledGroups = partnerGroups
    .filter((group) => (groupCredit[group.id] ?? 0) < group.goalDays)
    .map((group) => ({
      group,
      placed: groupCredit[group.id] ?? 0,
      names: group.memberIds
        .map((id) => teachers.find((t) => t.id === id)?.name ?? id)
        .join(" + "),
    }));

  // Pins that break a limit. They never block planning: a pin is the
  // principal's decision and always wins, so this only tells them what they
  // asked for (#18).
  const pins = pinWarnings({ teachers, pinnedAssignments, monthlyTargets, availabilities });
  const dayOfMonth = (dateStr: string) =>
    formatDateLong(dateStr, { day: "numeric", month: "long" });

  const isGroupDay = (dateStr: string): boolean => {
    const present = new Set(generatedSchedule[dateStr] ?? []);
    return partnerGroups.some(
      (group) => group.memberIds.length > 0 && group.memberIds.every((m) => present.has(m))
    );
  };

  return (
    <div className="fill-column">
      <h2 className="step-title" style={{ margin: "0 0 12px 0", flexShrink: 0 }}>
        <span>{postName ? t("step3.titleWithPost", { post: postName }) : t("step3.title")}</span>
        <div className="tooltip-container tooltip-container--title">
          <span className="tooltip-icon">?</span>
          <div className="tooltip-content">
            {t("step3.help")}
          </div>
        </div>
      </h2>

      {/* Modern Three-Pane Desktop Dashboard Layout (Zero Scrolling!) */}
      <div className="desktop-split-layout">

        {/* Pane 1 (Left - 1): Solver Options, Rule Selection & Action Buttons (width ~300px) */}
        <div className="scrollable-column solver-options-column" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          
          {/* Rule Selection Card */}
          <div className="card" style={{ padding: "16px" }}>
            <h3 style={{ margin: "0 0 12px 0", color: "var(--text-primary)", fontWeight: "800", fontSize: "1.05rem" }}>{t("step3.rulesHeading")}</h3>

            <div role="radiogroup" aria-label={t("step3.rulesHeading")}>
              {([
                { mode: "fairness" as const, title: t("step3.ruleFairnessTitle"), desc: t("step3.ruleFairnessDesc") },
                { mode: "priority" as const, title: t("step3.rulePriorityTitle"), desc: t("step3.rulePriorityDesc") },
                { mode: "strict" as const, title: t("step3.ruleStrictTitle"), desc: t("step3.ruleStrictDesc") },
                { mode: "random" as const, title: t("step3.ruleRandomTitle"), desc: t("step3.ruleRandomDesc") }
              ]).map((opt, idx) => {
                const isSelected = solverMode === opt.mode;
                return (
                  <div
                    key={opt.mode}
                    ref={(el) => { modeCardRefs.current[idx] = el; }}
                    className={`mode-option-card ${isSelected ? 'selected' : ''}`}
                    style={{ padding: "10px 14px", marginBottom: idx < 3 ? "8px" : 0, borderRadius: "10px" }}
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => setSolverMode(opt.mode)}
                    onKeyDown={(e) => handleModeCardKeyDown(e, idx)}
                  >
                    <div className="mode-option-title" style={{ fontSize: "0.85rem", marginBottom: "2px" }}>{opt.title}</div>
                    <div className="mode-option-desc" style={{ fontSize: "0.75rem", lineHeight: "1.1rem" }}>{opt.desc}</div>
                  </div>
                );
              })}
            </div>

            <p style={{ margin: "8px 0 0 0", fontSize: "0.72rem", lineHeight: "1.05rem", color: "var(--text-secondary)" }}>
              {t("step3.sharedOrder")}
            </p>

            <HardRuleCheckbox
              id="respect-targets-checkbox"
              checked={respectTargets}
              onChange={setRespectTargets}
              title={t("step3.capTitle")}
              description={t("step3.capDesc")}
              isFirst
            />

            <HardRuleCheckbox
              id="avoid-consecutive-days-checkbox"
              checked={avoidConsecutiveDays}
              onChange={setAvoidConsecutiveDays}
              title={t("step3.consecutiveTitle")}
              description={t("step3.consecutiveDesc")}
              isFirst={false}
            />
          </div>

          {/* Configuration Card */}
          <div className="card" style={{ padding: "16px" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="teachers-per-day-input" style={{ fontSize: "0.82rem" }}>{t("step3.defaultPerDay")}</label>
              <input
                type="number"
                id="teachers-per-day-input"
                className="form-control"
                style={{ padding: "8px 12px", fontSize: "0.88rem", height: "34px" }}
                min="1"
                max="5"
                value={teachersPerDay}
                onChange={(e) => setTeachersPerDay(Number(e.target.value))}
                required
              />
            </div>
          </div>

          {/* Trigger Buttons Card */}
          <div className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* Pins that break a limit. Planning goes ahead either way: the pin
                is the principal's decision, this only makes sure they know. */}
            {(pins.overTarget.length > 0 || pins.unavailable.length > 0) && (
              <div className="alert alert-warning" style={{ margin: 0, padding: "8px 12px", fontSize: "0.76rem" }}>
                <strong>{t("step3.pinWarningTitle")}</strong>
                <ul style={{ margin: "4px 0 0 0", paddingLeft: "18px", lineHeight: "1.15rem" }}>
                  {pins.overTarget.map((pin) => (
                    <li key={`over-${pin.id}`}>{t("step3.pinOverTarget", { name: pin.name, pinned: pin.pinned, target: pin.target })}</li>
                  ))}
                  {pins.unavailable.map((pin) => (
                    <li key={`unavailable-${pin.id}-${pin.date}`}>
                      {t("step3.pinUnavailable", { name: pin.name, date: dayOfMonth(pin.date) })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={handleGenerateSchedule}
              className="btn btn-success"
              style={{ width: "100%", padding: "10px 16px", fontSize: "0.92rem", borderRadius: "8px" }}
            >
              {t("step3.generate")}
            </button>
            
            {Object.keys(generatedSchedule).length > 0 && (
              <>
                {/* Onayla makes the schedule official by keeping a frozen copy
                    of it (ADR-0006). The month stays editable afterwards. */}
                {handleApproveSchedule && (
                  <button
                    onClick={handleApproveSchedule}
                    className="btn btn-secondary"
                    style={{ width: "100%", padding: "10px 16px", fontSize: "0.92rem", borderRadius: "8px" }}
                  >
                    <span aria-hidden="true">✅</span> {t("step3.approve")}
                  </button>
                )}

                {approval && (
                  <div
                    className={approval.changed ? "alert alert-warning" : "alert alert-success"}
                    style={{ margin: 0, padding: "8px 12px", fontSize: "0.76rem" }}
                  >
                    {approval.changed
                      ? t("step3.approvedChanged", { date: formatApprovalDate(approval.approvedAt) })
                      : t("step3.approvedOn", { date: formatApprovalDate(approval.approvedAt) })}
                  </div>
                )}

                <button
                  onClick={handleExportSchedule}
                  className="btn btn-primary"
                  style={{ width: "100%", padding: "10px 16px", fontSize: "0.92rem", borderRadius: "8px" }}
                >
                  {t("step3.export")}
                </button>

                {/* Earlier approved schedules of the school year can go into
                    the same workbook, with a running total. */}
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      color: earlierApprovedCount > 0 ? "var(--text-primary)" : "var(--text-secondary)",
                      cursor: earlierApprovedCount > 0 ? "pointer" : "not-allowed",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={earlierApprovedCount > 0 && includeEarlierApproved}
                      disabled={earlierApprovedCount === 0}
                      onChange={(e) => setIncludeEarlierApproved?.(e.target.checked)}
                      aria-describedby="include-earlier-approved-hint"
                      style={{ accentColor: "var(--primary)" }}
                    />
                    {t("step3.includeEarlier")}
                  </label>
                  <span id="include-earlier-approved-hint" style={{ fontSize: "0.72rem", color: "var(--text-secondary)", paddingLeft: "24px" }}>
                    {earlierApprovedCount === 0
                      ? t("step3.earlierNone")
                      : includeEarlierApproved
                        ? t("step3.earlierWillAdd", { count: earlierApprovedCount })
                        : t("step3.earlierWontAdd", { count: earlierApprovedCount })}
                  </span>
                </div>

                {/* Every duty post's schedules can go into one workbook (#28). */}
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      color: postCount > 1 ? "var(--text-primary)" : "var(--text-secondary)",
                      cursor: postCount > 1 ? "pointer" : "not-allowed",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={postCount > 1 && includeAllPosts}
                      disabled={postCount <= 1}
                      onChange={(e) => setIncludeAllPosts?.(e.target.checked)}
                      aria-describedby="include-all-posts-hint"
                      style={{ accentColor: "var(--primary)" }}
                    />
                    {t("step3.includeAllPosts")}
                  </label>
                  <span id="include-all-posts-hint" style={{ fontSize: "0.72rem", color: "var(--text-secondary)", paddingLeft: "24px" }}>
                    {postCount <= 1
                      ? t("step3.allPostsNone")
                      : includeAllPosts
                        ? t("step3.allPostsWill", { count: postCount })
                        : t("step3.allPostsOnlyThis")}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Error alerts inside the column. role="alert" is an implicit
              aria-live="assertive" region — WCAG 2.2 AA 4.1.3 (Status
              Messages) requires this kind of solver-outcome message be
              announced to screen-reader users without needing focus to move
              here; before the accessibility pass this text only ever appeared visually. */}
          {solverError && (
            <div className="alert alert-danger" role="alert" style={{ padding: "10px 14px", fontSize: "0.78rem", margin: 0 }}>
              <strong>{t("step3.stuckError")}</strong>
              {solverError}
            </div>
          )}

          {/* Open days are a normal, expected outcome once the hard cap is on,
              so this is a warning and not the red "Sıkışma Hatası" above — the
              schedule is usable, it is just incomplete. role="status" (a polite
              live region) announces it to screen-reader users after a generate
              without stealing focus, per WCAG 2.2 AA 4.1.3. */}
          {unfilledDays.length > 0 && (
            <div className="alert alert-warning" role="status" style={{ padding: "10px 14px", fontSize: "0.78rem", margin: 0 }}>
              <strong>{t("step3.openDaysTitle", { days: unfilledDays.length })}</strong>{" "}
              {t("step3.openDaysBody", { slots: unfilledDays.reduce((sum, g) => sum + (g.required - g.assigned), 0) })}
              {respectTargets ? t("step3.openDaysTargets") : ""}
              {activeHardRules.length > 0
                ? t("step3.openDaysRules", {
                    rules: activeHardRules.join(` ${t("common.and")} `),
                    word: activeHardRules.length > 1 ? t("step3.openDaysRulesWord") : t("step3.openDaysRuleWord"),
                  })
                : t("step3.openDaysPins")}
            </div>
          )}

          {/* A group falling short of its goal is a normal, expected outcome
              (usually tight availability), not a solver error — same
              alert-warning treatment as the open-day summary above, and the
              same role="status" (polite live region) so screen-reader users
              hear it after a generate without focus being stolen, per WCAG
              2.2 AA 4.1.3. */}
          {unfilledGroups.length > 0 && (
            <div className="alert alert-warning" role="status" style={{ padding: "10px 14px", fontSize: "0.78rem", margin: 0 }}>
              <strong>{t("step3.groupsShortTitle")}</strong>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px" }}>
                {unfilledGroups.map(({ group, placed, names }) => (
                  <li key={group.id}>
                    {t("step3.groupShortfall", {
                      names,
                      goal: group.goalDays,
                      placed,
                      placedOrdinal: `${placed}${turkishPossessiveSuffix(placed)}`,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Pane 2 (Middle - 2): Central Big Calendar Grid */}
        <div className="fill-column split-pane-main">
          <div className="calendar-wrapper card" style={{ margin: 0, padding: "16px" }}>
            
            <div className="calendar-header-grid" style={{ flexShrink: 0 }}>
              {shortDayNames().map((d) => <div key={d}>{d}</div>)}
            </div>

            <div
              className="calendar-grid"
              // Taller floor than step 1: a day lists its teachers.
              style={{ "--weeks": Math.ceil(paddedDates.length / 7), "--row-min": "5rem" } as React.CSSProperties}
            >
              {paddedDates.map((date, idx) => {
                if (!date) return <div key={`empty-${idx}`} className="calendar-cell-empty" />;
                
                const dateStr = formatDateYYYYMMDD(date);
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                let isIncluded = !isWeekend; // default: weekdays in, weekends out
                if (!isWeekend && holidays.includes(dateStr)) {
                  isIncluded = false; // weekday marked as holiday
                } else if (isWeekend && weekendDutyDays.includes(dateStr)) {
                  isIncluded = true; // weekend marked as duty day
                }

                const assignedIds = generatedSchedule[dateStr] || [];
                const pinnedIds = pinnedAssignments[dateStr] || [];
                const customCount = daySpecificTeachers[dateStr];
                const finalCount = customCount ?? teachersPerDay;
                const isSelected = selectedDateStr === dateStr;
                // A day short of teachers is not an empty day: one of two
                // slots filled still has somebody on duty.
                const openSlots = Math.max(finalCount - assignedIds.length, 0);
                const assignedNames = assignedIds
                  .map((id) => teachers.find((t) => t.id === id)?.name)
                  .filter(Boolean);
                const cellAriaLabel = isIncluded
                  ? t("step3.cellLabel", {
                      day: date.getDate(),
                      summary: [assignedNames.join(", "), openSlots > 0 ? t("step3.openSlots", { count: openSlots }) : ""]
                        .filter(Boolean)
                        .join(", "),
                    })
                  : undefined;

                return (
                  <div
                    key={dateStr}
                    className={`calendar-cell schedule-calendar-cell ${isIncluded ? 'included' : 'excluded'} ${isSelected ? 'selected' : ''}`}
                    style={{
                      justifyContent: "flex-start",
                      gap: "3px",
                      padding: "6px",
                      borderColor: isSelected ? "var(--primary)" : "",
                      backgroundColor: isSelected ? "var(--primary-light)" : "",
                      boxShadow: isSelected ? "0 0 0 3px var(--primary-light)" : ""
                    }}
                    role={isIncluded ? "button" : undefined}
                    tabIndex={isIncluded ? 0 : undefined}
                    aria-pressed={isIncluded ? isSelected : undefined}
                    aria-label={cellAriaLabel}
                    onClick={() => isIncluded && setSelectedDateStr(dateStr)}
                    onKeyDown={(e) => {
                      if (isIncluded && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setSelectedDateStr(dateStr);
                      }
                    }}
                  >
                    {/* Wraps so the required-count chip drops under the day number in a
                        narrow cell (small window, larger text) instead of spilling out. */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px", justifyContent: "space-between", alignItems: "center", width: "100%", flexShrink: 0 }}>
                      <span style={{ fontSize: "0.88rem", color: isSelected ? "var(--primary)" : "var(--text-primary)", fontWeight: "bold" }}>
                        {date.getDate()}
                      </span>
                      {isIncluded && (
                        <span
                          style={{
                            fontSize: "0.62rem",
                            fontWeight: "bold",
                            // --text-muted on --slate-100 measured via axe-core at
                            // 4.34:1 (light) / 3.08:1 (dark) — both fail 4.5:1.
                            // --text-secondary is the same neutral hue tuned
                            // darker/lighter per theme specifically for
                            // legible text, and passes comfortably in both.
                            color: customCount !== undefined ? "var(--primary)" : "var(--text-secondary)",
                            backgroundColor: customCount !== undefined ? "var(--primary-light)" : "var(--slate-100)",
                            padding: "1px 3px",
                            borderRadius: "4px"
                          }}
                        >
                          👤 {finalCount}
                        </span>
                      )}
                    </div>

                    {isIncluded ? (
                      <div className="schedule-assignments-list" style={{ marginTop: "2px" }}>
                        {isGroupDay(dateStr) && (
                          <span
                            className="partner-day-badge"
                            title={t("step3.groupDay")}
                            aria-label={t("step3.groupDay")}
                            style={{ fontSize: "0.7rem" }}
                          >
                            👥
                          </span>
                        )}
                        {assignedIds.map((id, assignedIdx) => {
                          const teacher = teachers.find(t => t.id === id);
                          const isPinned = pinnedIds[assignedIdx] === id;
                          return (
                            <div 
                              key={`${id}-${assignedIdx}`} 
                              className="schedule-assignment-tag"
                              style={{ 
                                backgroundColor: isPinned ? "var(--warning-light)" : "var(--primary-light)",
                                borderColor: isPinned ? "var(--warning)" : "var(--primary)",
                                color: isPinned ? "var(--warning)" : "var(--primary)",
                                fontSize: "0.62rem",
                                padding: "1px 3px",
                                borderRadius: "3px",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                overflow: "hidden"
                              }}
                              title={t(isPinned ? "step3.pinnedTitle" : "step3.assignedTitle", { name: teacher?.name ?? "" })}
                            >
                              {isPinned ? "📌 " : ""} {teacher ? teacher.name : t("step3.emptySlot")}
                            </div>
                          );
                        })}
                        {openSlots > 0 && (
                          // --text-muted measured (axe-core) at 3.62:1 against this
                          // cell's background in dark theme — --text-secondary passes.
                          <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", fontStyle: "italic", textAlign: "center", display: "block", marginTop: assignedIds.length === 0 ? "8px" : "2px" }}>
                            {t("step3.openSlots", { count: openSlots })}
                          </span>
                        )}
                      </div>
                    ) : (
                      // --text-muted measured (axe-core) at 4.39:1 (light) / 3.47:1
                      // (dark) on this excluded cell's background — both fail
                      // 4.5:1; --text-secondary passes in both themes.
                      <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", fontStyle: "italic", textAlign: "center", width: "100%", margin: "auto 0" }}>
                        {t("step3.noDuty")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        </div>

        {/* Pane 3 (Right - 1): Modern Day Configurator Sidebar (width ~320px) */}
        <div className="card scrollable-column solver-day-config-column" style={{ padding: "20px", display: "flex", flexDirection: "column", backgroundColor: "var(--bg-content)" }}>
          {selectedDateStr && selectedDateDetails ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ borderBottom: "1.5px solid var(--border)", paddingBottom: "10px" }}>
                <span style={{ fontSize: "0.7rem", textTransform: "uppercase", fontWeight: "700", color: "var(--primary)" }}>{t("step3.daySettings")}</span>
                <h3 style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontWeight: "800", fontSize: "1.05rem" }}>
                  📅 {selectedDateDetails.dateFriendly}
                </h3>
              </div>

              {/* Day-specific teacher count override counter */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: "700", color: "var(--text-secondary)" }}>{t("step3.requiredTeachers")}</label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "var(--slate-50)", padding: "6px 12px", borderRadius: "8px", border: "1.5px solid var(--border)", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{t("step3.guardCount")}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      className="btn"
                      style={{ border: "none", backgroundColor: "var(--slate-200)", color: "var(--text-primary)", borderRadius: "4px", width: "22px", height: "24px", padding: 0, cursor: "pointer", fontWeight: "bold" }}
                      onClick={() => {
                        const cur = daySpecificTeachers[selectedDateStr] ?? teachersPerDay;
                        if (cur > 1) {
                          setDaySpecificTeachers(prev => ({ ...prev, [selectedDateStr]: cur - 1 }));
                        }
                      }}
                    >
                      -
                    </button>
                    <span style={{ fontSize: "0.9rem", fontWeight: "bold", width: "12px", textAlign: "center", color: "var(--text-primary)" }}>{requiredCount}</span>
                    <button
                      className="btn"
                      style={{ border: "none", backgroundColor: "var(--slate-200)", color: "var(--text-primary)", borderRadius: "4px", width: "22px", height: "24px", padding: 0, cursor: "pointer", fontWeight: "bold" }}
                      onClick={() => {
                        const cur = daySpecificTeachers[selectedDateStr] ?? teachersPerDay;
                        if (cur < 5) {
                          setDaySpecificTeachers(prev => ({ ...prev, [selectedDateStr]: cur + 1 }));
                        }
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Multi-slot Pinning Select Dropdowns */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: "700", color: "var(--text-secondary)" }}>{t("step3.pinTeachers")}</label>
                
                {Array.from({ length: requiredCount }).map((_, slotIdx) => (
                  <div key={slotIdx} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: "600" }}>{t("step3.guardSlot", { n: slotIdx + 1 })}</span>
                    <CustomSelect
                      // Teachers who marked this day Uygun Değil stay in the
                      // list — a pin may still be the right call — but say so.
                      options={teachers.map((teacher) => ({
                        value: teacher.id,
                        label:
                          availabilities[teacher.id]?.[selectedDateStr] === "unavailable"
                            ? t("step3.unavailableOption", { name: teacher.name })
                            : teacher.name,
                      }))}
                      value={pinnedIds[slotIdx] || ""}
                      placeholder={t("step3.pinPlaceholder")}
                      variant="pinned"
                      ariaLabel={t("step3.pinSlotAria", { n: slotIdx + 1 })}
                      onChange={(newPin) => {
                        setPinnedAssignments(prev => {
                          const current = prev[selectedDateStr!] ? [...prev[selectedDateStr!]] : [];
                          const updated = [...current];
                          if (!newPin) {
                            updated.splice(slotIdx, 1);
                          } else {
                            updated[slotIdx] = newPin;
                          }
                          return { ...prev, [selectedDateStr!]: updated.filter(Boolean) };
                        });
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: "10px", marginTop: "8px", borderTop: "1.5px solid var(--border)", paddingTop: "10px" }}>
                <button
                  className="btn btn-secondary"
                  style={{ flexGrow: 1, padding: "6px 10px", fontSize: "0.78rem" }}
                  onClick={() => handleClearPins(selectedDateStr)}
                >
                  {t("step3.reset")}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flexGrow: 1, padding: "6px 10px", fontSize: "0.78rem" }}
                  onClick={() => setSelectedDateStr(null)}
                >
                  {t("step3.close")}
                </button>
              </div>
            </div>
          ) : (
            // --text-muted measured (axe-core) at 3.73:1 in dark theme for the
            // <p> below (inherited from here) — --text-secondary passes.
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "250px", color: "var(--text-secondary)", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", marginBottom: "8px" }} aria-hidden="true">📅</div>
              <h4 style={{ fontWeight: "800", color: "var(--text-primary)", margin: "0 0 4px 0", fontSize: "0.95rem" }}>{t("step3.noDaySelected")}</h4>
              <p style={{ fontSize: "0.78rem", margin: 0, lineHeight: "1.15rem" }}>
                {t("step3.noDaySelectedHelp")}
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
