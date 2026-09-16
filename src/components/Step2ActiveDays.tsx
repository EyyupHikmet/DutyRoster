import { useTranslation } from "react-i18next";
import React, { useState } from "react";
import { monthNames, shortDayNames, getMonthDatesWithPadding, formatDateYYYYMMDD } from "../utils/dateUtils";
import { CustomSelect } from "./CustomSelect";

interface Step2ActiveDaysProps {
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  selectedMonth: number;
  setSelectedMonth: (m: number) => void;
  holidays: string[];
  weekendDutyDays: string[];
  extraDays: string[];
  handleToggleExtraDay: (dateStr: string) => void;
  handleToggleDayEligibility: (dateStr: string, isWeekend: boolean) => void;
  /** The duty post whose month this is, named next to the title. */
  postName?: string;
  /** Other posts with a saved setup for this month, to copy day settings from. */
  copyPosts?: { id: string; name: string }[];
  onCopyFromPost?: (postId: string) => void;
}

export const Step2ActiveDays: React.FC<Step2ActiveDaysProps> = ({
  selectedYear,
  setSelectedYear,
  selectedMonth,
  setSelectedMonth,
  holidays,
  weekendDutyDays,
  extraDays,
  handleToggleExtraDay,
  handleToggleDayEligibility,
  postName,
  copyPosts = [],
  onCopyFromPost
}) => {
  const { t } = useTranslation();
  const paddedDates = getMonthDatesWithPadding(selectedYear, selectedMonth);
  const [copySource, setCopySource] = useState<string>("");
  // Falls back to the first offered post until one is picked, and after the
  // picked one stops being offered (another month, or it was deleted).
  const source = copyPosts.some((p) => p.id === copySource) ? copySource : copyPosts[0]?.id ?? "";

  return (
    <div className="fill-column">
      {/* Sleek, Compact Control Bar (Horizontal layout to prevent vertical scrolling!) */}
      <div 
        style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between", 
          gap: "20px", 
          marginBottom: "16px", 
          flexWrap: "wrap",
          flexShrink: 0,
          backgroundColor: "var(--slate-50)",
          padding: "12px 20px",
          borderRadius: "12px",
          border: "1px solid var(--slate-200)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h2 className="step-title" style={{ margin: 0, fontSize: "1.15rem", fontWeight: "800" }}>
            {postName ? t("step2.titleWithPost", { post: postName }) : t("step2.title")}
          </h2>
          
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <CustomSelect
              options={[
                { value: "2026", label: "2026" },
                { value: "2027", label: "2027" },
                { value: "2028", label: "2028" }
              ]}
              value={String(selectedYear)}
              onChange={(val) => setSelectedYear(Number(val))}
              style={{ width: "100px" }}
              ariaLabel={t("availability.yearSelect")}
            />

            <CustomSelect
              options={monthNames().map((m, idx) => ({ value: String(idx + 1), label: m }))}
              value={String(selectedMonth)}
              onChange={(val) => setSelectedMonth(Number(val))}
              style={{ width: "140px" }}
              ariaLabel={t("availability.monthSelect")}
            />
          </div>

          {/* Day settings are often the same across posts (a bayram closes
              every dormitory), so another post's can be copied into this
              month. Only non-duty days, extra days and required counts. */}
          {copyPosts.length > 0 && onCopyFromPost && (
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <select
                className="form-control"
                aria-label={t("step2.copySource")}
                value={source}
                onChange={(e) => setCopySource(e.target.value)}
                style={{ width: "auto", minWidth: "150px", padding: "6px 10px", fontSize: "0.85rem" }}
              >
                {copyPosts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                onClick={() => source && onCopyFromPost(source)}
              >
                {t("step2.copyAction")}
              </button>
            </div>
          )}
        </div>

        {/* Compact Color Guides inline */}
        <div className="color-guide" style={{ margin: 0, gap: "16px", alignItems: "center" }}>
          <div className="color-guide-item" style={{ gap: "6px" }}>
            <div 
              style={{ 
                width: "16px", 
                height: "16px", 
                backgroundColor: "var(--bg-content)", 
                border: "1px solid var(--border)", 
                borderTop: "3.5px solid var(--primary)",
                borderRadius: "3px" 
              }}
            ></div>
            <span style={{ fontSize: "0.78rem", fontWeight: "700" }}>{t("step2.legendDutyDay")}</span>
          </div>
          <div className="color-guide-item" style={{ gap: "6px" }}>
            <div 
              style={{ 
                width: "16px", 
                height: "16px", 
                backgroundColor: "var(--bg-card)", 
                border: "1px solid var(--border)", 
                borderTop: "3.5px solid var(--border)",
                borderRadius: "3px",
                opacity: 0.65
              }}
            ></div>
            <span style={{ fontSize: "0.78rem", fontWeight: "700" }}>Tatil</span>
          </div>
          <div className="color-guide-item" style={{ gap: "6px" }}>
            <span 
              style={{ 
                padding: "2px 6px", 
                borderRadius: "4px", 
                backgroundColor: "#edd8fd", 
                color: "#6b46c1", 
                border: "1px solid #b794f4", 
                fontSize: "0.72rem", 
                fontWeight: "bold" 
              }}
            >
              {t("step2.extra")}
            </span>
            <span style={{ fontSize: "0.78rem", fontWeight: "700" }}>{t("step2.legendExtra")}</span>
          </div>
        </div>
      </div>

      {/* Main Calendar Grid Area (Fills remaining height with massive typography!) */}
      <div className="step2-calendar-wrapper card">
        <div className="calendar-header-grid" style={{ flexShrink: 0, marginBottom: "16px", fontSize: "0.95rem" }}>
          {shortDayNames().map((d) => <div key={d}>{d}</div>)}
        </div>

        <div
          className="step2-calendar-grid"
          style={{ "--weeks": Math.ceil(paddedDates.length / 7) } as React.CSSProperties}
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

            const isExtra = extraDays.includes(dateStr);

            const dayToggleLabel = t(isIncluded ? "step2.toggleToOff" : "step2.toggleToDuty", { day: date.getDate() });
            const extraToggleLabel = t(isExtra ? "step2.extraToStandard" : "step2.standardToExtra");

            // The day-toggle control and the Standart/Ekstra badge are two
            // independent actions that used to be rendered as parent/child
            // (badge nested inside the day-toggle div, with stopPropagation
            // to keep clicks separate). Once the day-toggle became a real
            // interactive control (role="button"/tabIndex), that nesting
            // became an axe "nested-interactive" violation: a focusable
            // descendant inside a widget is exactly the "assistive tech
            // can't tell what activates on Enter" ambiguity that check
            // exists for (ARIA's button role disallows focusable content).
            // Fix: render them as SIBLINGS instead — a <button> covering the
            // whole cell for the day toggle, and the extra-day badge
            // absolutely positioned on top of it in the same visual spot,
            // both children of a plain (non-interactive) wrapper div. Since
            // both are `position: absolute`, DOM order (badge after button)
            // decides paint order, so the badge stays on top and independently
            // clickable without needing stopPropagation any more.
            return (
              <div
                key={dateStr}
                className={`calendar-cell step2-calendar-cell ${isIncluded ? 'included' : 'excluded'}`}
                style={{ position: "relative", padding: 0 }}
              >
                <button
                  type="button"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-start",
                    padding: "14px",
                    background: "none",
                    border: "none",
                    font: "inherit",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer"
                  }}
                  aria-label={dayToggleLabel}
                  onClick={() => handleToggleDayEligibility(dateStr, isWeekend)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: "4px" }}>
                    <span style={{ fontSize: "1.45rem", fontWeight: "850", color: isIncluded ? "var(--slate-900)" : "var(--danger-text)" }}>
                      {date.getDate()}
                    </span>
                  </div>
                  <span className={`cell-badge step2-cell-badge ${isIncluded ? 'cell-badge-pref' : 'cell-badge-excluded'}`}>
                    {isIncluded ? t("step2.dutyDay") : t("step2.offDay")}
                  </span>
                </button>

                {isIncluded && (
                  <span
                    // Styled in App.css, which also compacts it in cramped cells.
                    className={`step2-extra-badge${isExtra ? " is-extra" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label={extraToggleLabel}
                    onClick={() => handleToggleExtraDay(dateStr)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleToggleExtraDay(dateStr);
                      }
                    }}
                    title={t(isExtra ? "step2.extraToStandardTitle" : "step2.standardToExtraTitle")}
                  >
                    {isExtra ? t("step2.extra") : t("step2.standard")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
