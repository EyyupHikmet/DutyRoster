import { Trans, useTranslation } from "react-i18next";
import React, { useState } from "react";
import { DbTeacher } from "../db";
import { AvailabilityStatus } from "../solver";
import { monthName, monthNames, shortDayNames, getMonthDatesWithPadding, formatDateYYYYMMDD } from "../utils/dateUtils";
import { CustomSelect } from "./CustomSelect";

interface AvailabilityCalendarProps {
  teachers: DbTeacher[];
  selectedTeacherId: string | null;
  availabilities: Record<string, Record<string, AvailabilityStatus>>;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  selectedMonth: number;
  setSelectedMonth: (m: number) => void;
  onCycleAvailability: (dateStr: string) => void;
}

export const AvailabilityCalendar: React.FC<AvailabilityCalendarProps> = ({
  teachers,
  selectedTeacherId,
  availabilities,
  selectedYear,
  setSelectedYear,
  selectedMonth,
  setSelectedMonth,
  onCycleAvailability
}) => {
  const teacherName = teachers.find((t) => t.id === selectedTeacherId)?.name || "";
  const paddedDates = getMonthDatesWithPadding(selectedYear, selectedMonth);

  // Screen-reader announcement for cycling a day's availability
  // (WCAG 2.2 AA 4.1.3 Status Messages). Clicking/activating a cell only ever
  // changed a badge's text and border color visually — a screen-reader user
  // got no confirmation the click did anything. `onCycleAvailability` is
  // fire-and-forget (its actual state update happens async, one level up in
  // useAvailabilities), but the 3-state cycle itself
  // (available -> preferred -> unavailable -> available) is a pure, known
  // function of the CURRENT status already in `availabilities`, so the
  // announcement is computed synchronously at click/keydown time rather than
  // trying to diff before/after state.
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState("");
  const statusLabel = (s: AvailabilityStatus) =>
    t(s === "preferred" ? "availability.preferred" : s === "unavailable" ? "availability.unavailable" : "availability.available");
  const nextStatus = (s: AvailabilityStatus): AvailabilityStatus =>
    s === "available" ? "preferred" : s === "preferred" ? "unavailable" : "available";

  const activateCell = (dateStr: string, date: Date, currentStatus: AvailabilityStatus) => {
    const upcoming = nextStatus(currentStatus);
    setAnnouncement(
      t("availability.marked", { day: date.getDate(), month: monthName(date.getMonth() + 1), status: statusLabel(upcoming) })
    );
    onCycleAvailability(dateStr);
  };

  return (
    <div className="fill-column" style={{ marginTop: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px", flexShrink: 0 }}>
        <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: "800" }}>
          <Trans i18nKey="availability.heading" values={{ name: teacherName }} components={{ 1: <span style={{ color: "var(--primary)" }} /> }} />
        </h3>
        
        {/* Inline Color Guides */}
        <div className="color-guide" style={{ margin: 0, gap: "14px" }}>
          <div className="color-guide-item">
            <div className="color-box" style={{ width: "12px", height: "12px", backgroundColor: "var(--bg-content)", border: "1px solid var(--border)" }}></div>
            <span style={{ fontSize: "0.78rem" }}>Uygun</span>
          </div>
          <div className="color-guide-item">
            {/* --success/--danger are accent tokens (measured via axe-core at
                only 3.2:1 here) — --success-text/--danger-text are the
                theme-tuned "safe for small text on this surface" variants
                already used by .alert-success/.alert-danger. */}
            <span style={{ fontSize: "0.78rem", fontWeight: "bold", color: "var(--success-text)" }}>🟢 {t("availability.legendPreferred")}</span>
          </div>
          <div className="color-guide-item">
            <span style={{ fontSize: "0.78rem", fontWeight: "bold", color: "var(--danger-text)" }}>🔴 {t("availability.legendUnavailable")}</span>
          </div>
        </div>
      </div>

      {/* Calendar Grid UI */}
      <div className="calendar-wrapper card" style={{ padding: "16px" }}>
        
        {/* Center top selectors using CustomSelect */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px", justifyContent: "center", flexShrink: 0 }}>
          <CustomSelect
            options={[
              { value: "2026", label: "2026" },
              { value: "2027", label: "2027" },
              { value: "2028", label: "2028" }
            ]}
            value={String(selectedYear)}
            onChange={(val) => setSelectedYear(Number(val))}
            style={{ width: "110px" }}
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

        {/* Live region: announces the result of cycling a day's availability
            status to screen-reader users (see activateCell above). Visually
            hidden, aria-live="polite" so it doesn't interrupt whatever the
            user is doing, role="status" for the implicit polite live-region
            semantics screen readers recognize. */}
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>

        <div className="calendar-header-grid" style={{ flexShrink: 0, fontSize: "0.85rem", marginBottom: "8px" }}>
          {shortDayNames().map((d) => <div key={d}>{d}</div>)}
        </div>

        <div
          className="calendar-grid"
          style={{ "--weeks": Math.ceil(paddedDates.length / 7), "--row-min": "3.5rem" } as React.CSSProperties}
        >
          {paddedDates.map((date, idx) => {
            if (!date) return <div key={`empty-${idx}`} className="calendar-cell-empty" />;
            
            const dateStr = formatDateYYYYMMDD(date);
            const status = availabilities[selectedTeacherId!]?.[dateStr] || "available";
            
            let cellClass = "avail-available";
            let statusText: string = t("availability.legendAvailable");

            if (status === "preferred") {
              cellClass = "avail-preferred";
              statusText = t("availability.legendPreferred");
            } else if (status === "unavailable") {
              cellClass = "avail-unavailable";
              statusText = t("availability.legendUnavailable");
            }

            return (
              <div
                key={dateStr}
                className={`calendar-cell ${cellClass}`}
                style={{ position: "relative", justifyContent: "flex-start", padding: "8px", cursor: "pointer" }}
                role="button"
                tabIndex={0}
                aria-label={t("availability.cell", { day: date.getDate(), month: monthName(date.getMonth() + 1), status: statusText })}
                onClick={() => activateCell(dateStr, date, status)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activateCell(dateStr, date, status);
                  }
                }}
              >
                <span style={{ fontSize: "0.95rem", fontWeight: "bold" }}>{date.getDate()}</span>
                <span className={`cell-badge ${status === 'preferred' ? 'cell-badge-pref' : status === 'unavailable' ? 'cell-badge-unavail' : 'cell-badge-avail'}`} style={{ marginTop: "auto" }}>
                  {statusText}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
