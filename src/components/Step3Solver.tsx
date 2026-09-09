import React, { useRef, useState } from "react";
import { DbTeacher } from "../db";
import { DAYS_TR, getMonthDatesWithPadding, formatDateYYYYMMDD } from "../utils/dateUtils";
import { CustomSelect } from "./CustomSelect";

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
  unfilledDays
}) => {
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
    const dateFriendly = dateObj.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" });
    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
    return { dateFriendly, isWeekend };
  };

  // Which hard rules are currently narrowing the search. Used to word the
  // open-day warning honestly: before the second rule existed the banner always
  // blamed the target cap, which is wrong when the cap is off (a day can also
  // be left open by pinning alone).
  const activeHardRules: string[] = [];
  if (respectTargets) activeHardRules.push("“Aylık hedefleri kesinlikle aşma”");
  if (avoidConsecutiveDays) activeHardRules.push("“Aynı öğretmene üst üste iki gün verme”");

  const selectedDateDetails = getSelectedDateDetails();
  const requiredCount = selectedDateStr ? (daySpecificTeachers[selectedDateStr] ?? teachersPerDay) : teachersPerDay;
  const pinnedIds = selectedDateStr ? (pinnedAssignments[selectedDateStr] || []) : [];

  return (
    <div className="fill-column">
      <h2 className="step-title" style={{ margin: "0 0 12px 0", flexShrink: 0 }}>
        <span>Adım 3: Planlama Seçenekleri & Çizelge Hazırlama</span>
        <div className="tooltip-container tooltip-container--title">
          <span className="tooltip-icon">?</span>
          <div className="tooltip-content">
            Soldan planlama kuralını seçip Programı Hazırla butonuna basın. Ortadaki takvimden günlere tıklayarak özel sabitlemeler yapabilirsiniz.
          </div>
        </div>
      </h2>

      {/* Modern Three-Pane Desktop Dashboard Layout (Zero Scrolling!) */}
      <div className="desktop-split-layout">

        {/* Pane 1 (Left - 1): Solver Options, Rule Selection & Action Buttons (width ~300px) */}
        <div className="scrollable-column solver-options-column" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          
          {/* Rule Selection Card */}
          <div className="card" style={{ padding: "16px" }}>
            <h3 style={{ margin: "0 0 12px 0", color: "var(--text-primary)", fontWeight: "800", fontSize: "1.05rem" }}>Dağıtım Kuralı</h3>

            <div role="radiogroup" aria-label="Dağıtım Kuralı">
              {([
                { mode: "fairness" as const, title: "Eşit Dağıt (Adalet)", desc: "Aylık nöbet yüklerini tüm kadroya olabildiğince eşit paylaştırır." },
                { mode: "priority" as const, title: "Kıdem Öncelikli", desc: "Yüksek kıdemli öğretmenlerin izin ve tercihlerini öncelikli korur." },
                { mode: "strict" as const, title: "Dengeli (Hedef Odaklı)", desc: "Her öğretmenin belirlediği aylık nöbet hedefini yakalamaya çalışır." },
                { mode: "random" as const, title: "Rastgele Doldur", desc: "Belirtilen kısıtlar altında boş günleri tamamen rastgele dağıtır." }
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

            <HardRuleCheckbox
              id="respect-targets-checkbox"
              checked={respectTargets}
              onChange={setRespectTargets}
              title="Aylık hedefleri kesinlikle aşma"
              description="Hiçbir öğretmene aylık nöbet hedefinden fazla görev verilmez. Kadro yetmezse günler boş bırakılır."
              isFirst
            />

            <HardRuleCheckbox
              id="avoid-consecutive-days-checkbox"
              checked={avoidConsecutiveDays}
              onChange={setAvoidConsecutiveDays}
              title="Aynı öğretmene üst üste iki gün verme"
              description="Bir öğretmen arka arkaya gelen iki takvim gününde nöbet tutmaz. Araya hafta sonu veya tatil girdiğinde Cuma–Pazartesi gibi günler serbest kalır."
              isFirst={false}
            />
          </div>

          {/* Configuration Card */}
          <div className="card" style={{ padding: "16px" }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="teachers-per-day-input" style={{ fontSize: "0.82rem" }}>Varsayılan Nöbetçi Sayısı</label>
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
            <button 
              onClick={handleGenerateSchedule}
              className="btn btn-success"
              style={{ width: "100%", padding: "10px 16px", fontSize: "0.92rem", borderRadius: "8px" }}
            >
              ⚡ Programı Hazırla
            </button>
            
            {Object.keys(generatedSchedule).length > 0 && (
              <button 
                onClick={handleExportSchedule}
                className="btn btn-primary"
                style={{ width: "100%", padding: "10px 16px", fontSize: "0.92rem", borderRadius: "8px" }}
              >
                📥 Excel'e Aktar
              </button>
            )}
          </div>

          {/* Error alerts inside the column. role="alert" is an implicit
              aria-live="assertive" region — WCAG 2.2 AA 4.1.3 (Status
              Messages) requires this kind of solver-outcome message be
              announced to screen-reader users without needing focus to move
              here; before the accessibility pass this text only ever appeared visually. */}
          {solverError && (
            <div className="alert alert-danger" role="alert" style={{ padding: "10px 14px", fontSize: "0.78rem", margin: 0 }}>
              <strong>Sıkışma Hatası:</strong>
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
              <strong>{unfilledDays.length} gün boş kaldı.</strong>{" "}
              Toplam {unfilledDays.reduce((sum, g) => sum + (g.required - g.assigned), 0)} nöbet
              yeri doldurulamadı. Kadroya öğretmen ekleyebilir, öğretmenlerin uygunluk
              işaretlerini gözden geçirebilir
              {respectTargets ? ", aylık nöbet hedeflerini yükseltebilir" : ""}
              {activeHardRules.length > 0
                ? ` veya ${activeHardRules.join(" ve ")} ${activeHardRules.length > 1 ? "kurallarını" : "kuralını"} kapatabilirsiniz.`
                : " veya günlere sabitlediğiniz öğretmenleri değiştirebilirsiniz."}
            </div>
          )}
        </div>

        {/* Pane 2 (Middle - 2): Central Big Calendar Grid */}
        <div className="fill-column split-pane-main">
          <div className="calendar-wrapper card" style={{ margin: 0, padding: "16px" }}>
            
            <div className="calendar-header-grid" style={{ flexShrink: 0 }}>
              {DAYS_TR.map(d => <div key={d}>{d}</div>)}
            </div>

            <div className="calendar-grid" style={{ flexGrow: 1, height: "100%" }}>
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
                const assignedNames = assignedIds
                  .map((id) => teachers.find((t) => t.id === id)?.name)
                  .filter(Boolean);
                const cellAriaLabel = isIncluded
                  ? `${date.getDate()}: ${assignedNames.length > 0 ? assignedNames.join(", ") : "Boş Gün"}. Nöbet günü ayarlarını açmak için etkinleştirin.`
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexShrink: 0 }}>
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
                              title={isPinned ? `Manuel sabitlenen: ${teacher?.name}` : `Sistem tarafından atanan: ${teacher?.name}`}
                            >
                              {isPinned ? "📌 " : ""} {teacher ? teacher.name : "Boş Slot"}
                            </div>
                          );
                        })}
                        {assignedIds.length === 0 && (
                          // --text-muted measured (axe-core) at 3.62:1 against this
                          // cell's background in dark theme — --text-secondary passes.
                          <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", fontStyle: "italic", textAlign: "center", display: "block", marginTop: "8px" }}>
                            Boş Gün
                          </span>
                        )}
                      </div>
                    ) : (
                      // --text-muted measured (axe-core) at 4.39:1 (light) / 3.47:1
                      // (dark) on this excluded cell's background — both fail
                      // 4.5:1; --text-secondary passes in both themes.
                      <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", fontStyle: "italic", textAlign: "center", width: "100%", margin: "auto 0" }}>
                        Nöbet Yok
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
                <span style={{ fontSize: "0.7rem", textTransform: "uppercase", fontWeight: "700", color: "var(--primary)" }}>Günlük Nöbet Ayarları</span>
                <h3 style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontWeight: "800", fontSize: "1.05rem" }}>
                  📅 {selectedDateDetails.dateFriendly}
                </h3>
              </div>

              {/* Day-specific teacher count override counter */}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: "700", color: "var(--text-secondary)" }}>Gereken Öğretmen Sayısı:</label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "var(--slate-50)", padding: "6px 12px", borderRadius: "8px", border: "1.5px solid var(--border)", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Nöbetçi Sayısı:</span>
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
                <label style={{ fontSize: "0.8rem", fontWeight: "700", color: "var(--text-secondary)" }}>Öğretmenleri Bu Güne Sabitle:</label>
                
                {Array.from({ length: requiredCount }).map((_, slotIdx) => (
                  <div key={slotIdx} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontWeight: "600" }}>Nöbetçi {slotIdx + 1}:</span>
                    <CustomSelect
                      options={teachers.map(t => ({ value: t.id, label: t.name }))}
                      value={pinnedIds[slotIdx] || ""}
                      placeholder="Öğretmen Seç (Boş Slot)..."
                      variant="pinned"
                      ariaLabel={`Nöbetçi ${slotIdx + 1} için öğretmen seç`}
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
                  Sıfırla
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flexGrow: 1, padding: "6px 10px", fontSize: "0.78rem" }}
                  onClick={() => setSelectedDateStr(null)}
                >
                  Kapat
                </button>
              </div>
            </div>
          ) : (
            // --text-muted measured (axe-core) at 3.73:1 in dark theme for the
            // <p> below (inherited from here) — --text-secondary passes.
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: "250px", color: "var(--text-secondary)", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", marginBottom: "8px" }} aria-hidden="true">📅</div>
              <h4 style={{ fontWeight: "800", color: "var(--text-primary)", margin: "0 0 4px 0", fontSize: "0.95rem" }}>Gün Seçilmedi</h4>
              <p style={{ fontSize: "0.78rem", margin: 0, lineHeight: "1.15rem" }}>
                Öğretmen sabitlemek veya o güne özel nöbetçi sayısı girmek için ortadaki takvimden aktif bir güne tıklayın.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
