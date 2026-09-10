import React from "react";
import { CustomSelect } from "./CustomSelect";

interface TeacherFormProps {
  editingTeacherId: string | null;
  teacherName: string;
  setTeacherName: (v: string) => void;
  teacherTarget: number;
  setTeacherTarget: (v: number) => void;
  teacherPriority: number;
  setTeacherPriority: (v: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  /**
   * Which month's target this form edits, for the label and the "differs
   * from usual" note below. Optional (defaulting below) so a caller that
   * hasn't wired month context yet — Step1Roster.tsx, until Task 10 plumbs
   * it through — still compiles.
   */
  monthLabel?: string;
  /** The teacher's usual (teachers.target_hours) target, or null when unknown
   * (e.g. a brand-new teacher, or the caller hasn't wired it yet). */
  usualTarget?: number | null;
}

export const TeacherForm: React.FC<TeacherFormProps> = ({
  editingTeacherId,
  teacherName,
  setTeacherName,
  teacherTarget,
  setTeacherTarget,
  teacherPriority,
  setTeacherPriority,
  onSubmit,
  onCancel,
  monthLabel = "bu ay",
  usualTarget = null
}) => {
  return (
    <div className="card" style={{ marginBottom: "20px" }}>
      <h3 style={{ margin: "0 0 16px 0", color: "var(--primary)", fontWeight: "800", fontSize: "1.1rem" }}>
        {editingTeacherId ? "Öğretmen Bilgilerini Güncelle" : "Yeni Öğretmen Ekle"}
      </h3>
      
      <form onSubmit={onSubmit}>
        <div className="form-group">
          <label htmlFor="teacher-name-input">Öğretmen Adı Soyadı</label>
          <input
            type="text"
            id="teacher-name-input"
            className="form-control"
            placeholder="Örn: Ahmet Yılmaz"
            value={teacherName}
            onChange={(e) => setTeacherName(e.target.value)}
            required
          />
        </div>

        <div className="grid-2col" style={{ gap: "16px", marginBottom: "16px" }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="teacher-target-input">
              {`Aylık Nöbet Hedefi (${monthLabel})`}
              <span className="tooltip-container" style={{ marginLeft: "4px" }}>
                <span className="tooltip-icon" aria-hidden="true">i</span>
                <div className="tooltip-content">
                  Bu öğretmenin o ay boyunca alması planlanan toplam nöbet sayısı.
                </div>
              </span>
            </label>
            <input
              type="number"
              id="teacher-target-input"
              className="form-control"
              min="1"
              max="20"
              value={teacherTarget}
              onChange={(e) => setTeacherTarget(Number(e.target.value))}
              required
            />
            {usualTarget !== null && usualTarget !== teacherTarget && (
              <p style={{ margin: "6px 0 0 0", fontSize: "0.8rem", color: "var(--slate-500)" }}>
                {`Bu öğretmenin genel hedefi ${usualTarget}. Girdiğiniz değer yalnızca ${monthLabel} için geçerlidir.`}
              </p>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label id="teacher-priority-label">
              Kıdem / Öncelik
              <span className="tooltip-container" style={{ marginLeft: "4px" }}>
                <span className="tooltip-icon" aria-hidden="true">i</span>
                <div className="tooltip-content">
                  Kıdem Önceliği modunda, yüksek kıdemli öğretmenlerin gün tercihleri öncelikli olarak değerlendirilir.
                </div>
              </span>
            </label>
            <CustomSelect
              options={[
                { value: "1", label: "Standart" },
                { value: "2", label: "Orta Kıdemli" },
                { value: "3", label: "Yüksek Kıdemli" }
              ]}
              value={String(teacherPriority)}
              onChange={(val) => setTeacherPriority(Number(val))}
              ariaLabelledBy="teacher-priority-label"
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button type="submit" className="btn btn-primary">
            {editingTeacherId ? "Güncelle" : "Kaydet"}
          </button>
          {editingTeacherId && (
            <button 
              type="button" 
              className="btn btn-secondary"
              onClick={onCancel}
            >
              İptal
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
