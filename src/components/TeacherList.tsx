import React from "react";
import { DbTeacher } from "../db";
import { PartnerGroup } from "../solver/partners";
import { effectiveTarget } from "../utils/targets";

interface TeacherListProps {
  teachers: DbTeacher[];
  selectedTeacherId: string | null;
  onSelectTeacher: (id: string) => void;
  onEditTeacher: (t: DbTeacher) => void;
  onDeleteTeacher: (id: string) => void;
  /**
   * This month's target overrides, and the groups the roster is committed to
   * this month. Optional (defaulting below) so a caller that hasn't wired
   * month context yet — Step1Roster.tsx, until Task 10 plumbs it through —
   * still compiles; it falls back to each teacher's usual target and shows
   * no group marker.
   */
  monthlyTargets?: Record<string, number>;
  partnerGroups?: PartnerGroup[];
}

export const TeacherList: React.FC<TeacherListProps> = ({
  teachers,
  selectedTeacherId,
  onSelectTeacher,
  onEditTeacher,
  onDeleteTeacher,
  monthlyTargets = {},
  partnerGroups = []
}) => {
  return (
    <div className="fill-column">
      <h3 style={{ margin: "0 0 12px 0", color: "var(--slate-900)", fontWeight: "800", fontSize: "1.1rem", flexShrink: 0 }}>
        Öğretmen Kadrosu ({teachers.length})
      </h3>
      {teachers.length === 0 ? (
        <div className="alert alert-info" style={{ margin: 0 }}>
          Sistemde henüz öğretmen kayıtlı değil. Lütfen öğretmen ekleyin veya Excel listesi yükleyin.
        </div>
      ) : (
        <div 
          className="teacher-list-container" 
          style={{ 
            flexGrow: 1, 
            overflowY: "auto", 
            border: "1px solid var(--slate-200)", 
            borderRadius: "10px", 
            backgroundColor: "var(--bg-content)"
          }}
        >
          {teachers.map((t) => {
            const target = effectiveTarget(t, monthlyTargets);
            const committed = partnerGroups
              .filter((group) => group.memberIds.includes(t.id))
              .reduce((sum, group) => sum + group.goalDays, 0);
            // Only mark a teacher whose groups actually account for the whole
            // month's target — a 0/0 teacher (no target, no groups) isn't
            // "fully committed" to anything.
            const fullyCommittedToGroups = committed > 0 && committed === target;
            return (
            <div
              key={t.id}
              className={`teacher-item ${selectedTeacherId === t.id ? 'selected' : ''}`}
            >
              {/* A native <button>, not the whole row, carries the "select" action.
                  The whole row can't be role="button" here: it would nest an
                  interactive widget around the Edit/Delete <button>s below,
                  which is an explicit WCAG 4.1.2/axe "nested-interactive"
                  violation (assistive tech can't tell which control activates
                  on a click/Enter, and a screen reader will not reliably
                  reach the inner buttons). This keeps every control keyboard
                  operable via its own, non-nested Tab stop instead. */}
              <button
                type="button"
                className="teacher-info-btn"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  margin: 0,
                  font: "inherit",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  flexGrow: 1,
                  minWidth: 0
                }}
                aria-pressed={selectedTeacherId === t.id}
                aria-label={`${t.name} öğretmenini seç`}
                onClick={() => onSelectTeacher(t.id)}
              >
                <div className="teacher-info">
                  <h4>{t.name}</h4>
                  <p>
                    Hedef: {target} Nöbet | Kıdem:{" "}
                    {t.priority === 3 ? "Yüksek" : t.priority === 2 ? "Orta" : "Standart"}
                    {fullyCommittedToGroups && (
                      // A plain, non-interactive <span>: it must not become
                      // another focusable/clickable control nested inside the
                      // row's own button (see the comment above about WCAG
                      // 4.1.2), and it carries its own visible text rather
                      // than relying on the title tooltip alone.
                      <span
                        title="Bu ayki nöbetlerinin tamamı gruplara ayrılmış"
                        style={{ marginLeft: "6px", fontSize: "0.8rem", color: "var(--primary)" }}
                      >
                        {" "}| Tümü gruplara ayrılmış
                      </span>
                    )}
                  </p>
                </div>
              </button>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  className="delete-btn"
                  style={{ color: "#3182ce" }}
                  onClick={() => onEditTeacher(t)}
                  title="Düzenle"
                  aria-label={`${t.name} bilgilerini düzenle`}
                >
                  <span aria-hidden="true">✏️</span>
                </button>
                <button
                  className="delete-btn"
                  onClick={() => onDeleteTeacher(t.id)}
                  title="Sil"
                  aria-label={`${t.name} öğretmenini sil`}
                >
                  <span aria-hidden="true">❌</span>
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
