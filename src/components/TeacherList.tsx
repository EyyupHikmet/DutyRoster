import React from "react";
import { DbTeacher } from "../db";

interface TeacherListProps {
  teachers: DbTeacher[];
  selectedTeacherId: string | null;
  onSelectTeacher: (id: string) => void;
  onEditTeacher: (t: DbTeacher) => void;
  onDeleteTeacher: (id: string) => void;
}

export const TeacherList: React.FC<TeacherListProps> = ({
  teachers,
  selectedTeacherId,
  onSelectTeacher,
  onEditTeacher,
  onDeleteTeacher
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
          {teachers.map((t) => (
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
                    Hedef: {t.target_hours} Nöbet | Kıdem:{" "}
                    {t.priority === 3 ? "Yüksek" : t.priority === 2 ? "Orta" : "Standart"}
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
          ))}
        </div>
      )}
    </div>
  );
};
