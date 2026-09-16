import { useTranslation } from "react-i18next";
import React from "react";
import { CustomSelect } from "./CustomSelect";
import { DbDutyPost } from "../db";

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
   * from usual" note below. e.g. "Ekim 2026" — Step1Roster derives this from
   * the selected year/month and always supplies it.
   */
  monthLabel: string;
  /** The teacher's usual (teachers.target_hours) target, or null when unknown
   * (e.g. a brand-new teacher not yet in the roster). */
  usualTarget: number | null;
  /**
   * A save refused by useTeachers (e.g. lowering this month's target below
   * what the teacher is already committed to in partner groups), in Turkish,
   * naming the teacher and the numbers — or null when there is nothing to
   * show. Rendered verbatim; useTeachers owns clearing it, so this component
   * never caches or reinterprets it.
   */
  error: string | null;
  /** Every duty post. With two or more, the form can move a teacher to another post. */
  posts?: DbDutyPost[];
  postId?: string | null;
  setPostId?: (postId: string) => void;
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
  monthLabel,
  usualTarget,
  error,
  posts = [],
  postId,
  setPostId
}) => {
  const { t } = useTranslation();
  return (
    <div className="card" style={{ marginBottom: "20px" }}>
      <h3 style={{ margin: "0 0 16px 0", color: "var(--primary)", fontWeight: "800", fontSize: "1.1rem" }}>
        {t(editingTeacherId ? "teacherForm.updateTitle" : "teacherForm.addTitle")}
      </h3>
      
      <form onSubmit={onSubmit}>
        <div className="form-group">
          <label htmlFor="teacher-name-input">{t("teacherForm.nameLabel")}</label>
          <input
            type="text"
            id="teacher-name-input"
            className="form-control"
            placeholder={t("teacherForm.namePlaceholder")}
            value={teacherName}
            onChange={(e) => setTeacherName(e.target.value)}
            required
          />
        </div>

        {posts.length >= 2 && (
          <div className="form-group">
            <label htmlFor="teacher-post-select">{t("teacherForm.postLabel")}</label>
            <select
              id="teacher-post-select"
              className="form-control"
              value={postId ?? ""}
              onChange={(e) => setPostId?.(e.target.value)}
            >
              {posts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid-2col" style={{ gap: "16px", marginBottom: "16px" }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="teacher-target-input">
              {t("teacherForm.targetLabel", { month: monthLabel })}
              <span className="tooltip-container" style={{ marginLeft: "4px" }}>
                <span className="tooltip-icon" aria-hidden="true">i</span>
                <div className="tooltip-content">
                  {t("teacherForm.targetHelp")}
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
                {t("teacherForm.usualTarget", { target: usualTarget, month: monthLabel })}
              </p>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label id="teacher-priority-label">
              {t("teacherForm.priorityLabel")}
              <span className="tooltip-container" style={{ marginLeft: "4px" }}>
                <span className="tooltip-icon" aria-hidden="true">i</span>
                <div className="tooltip-content">
                  {t("teacherForm.priorityHelp")}
                </div>
              </span>
            </label>
            <CustomSelect
              options={[
                { value: "1", label: t("teacherForm.priorityStandard") },
                { value: "2", label: t("teacherForm.priorityMedium") },
                { value: "3", label: t("teacherForm.priorityHigh") }
              ]}
              value={String(teacherPriority)}
              onChange={(val) => setTeacherPriority(Number(val))}
              ariaLabelledBy="teacher-priority-label"
            />
          </div>
        </div>

        {/* Matches the pattern already used by PartnerGroups' own blocked-save
            error (div.alert.alert-danger, role="alert" — WCAG 2.2 AA 4.1.3):
            a save refused here is exactly the same kind of event (a monthly
            target that would leave the teacher over-committed), so both
            paths should look and behave identically. */}
        {error && (
          <div
            className="alert alert-danger"
            role="alert"
            style={{ margin: "0 0 12px 0", fontSize: "0.8rem" }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px" }}>
          <button type="submit" className="btn btn-primary">
            {t(editingTeacherId ? "teacherForm.update" : "teacherForm.save")}
          </button>
          {editingTeacherId && (
            <button 
              type="button" 
              className="btn btn-secondary"
              onClick={onCancel}
            >
              {t("common.cancel")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
