import { useTranslation } from "react-i18next";
import React from "react";
import { DbDutyPost, DbTeacher } from "../db";
import { AvailabilityStatus } from "../solver";
import { PartnerGroup } from "../solver/partners";
import { TeacherForm } from "./TeacherForm";
import { ExcelImport } from "./ExcelImport";
import { TeacherList } from "./TeacherList";
import { AvailabilityCalendar } from "./AvailabilityCalendar";
import { PartnerGroups } from "./PartnerGroups";

interface Step1RosterProps {
  teachers: DbTeacher[];
  selectedTeacherId: string | null;
  setSelectedTeacherId: (id: string | null) => void;
  editingTeacherId: string | null;
  setEditingTeacherId: (id: string | null) => void;
  teacherName: string;
  setTeacherName: (v: string) => void;
  teacherTarget: number;
  setTeacherTarget: (v: number) => void;
  teacherPriority: number;
  setTeacherPriority: (v: number) => void;
  handleSaveTeacher: (e: React.FormEvent) => void;
  handleEditTeacherClick: (t: DbTeacher) => void;
  handleDeleteTeacher: (id: string) => void;
  /** A blocked-save refusal from useTeachers, in Turkish, or null. See
   * TeacherForm's `error` prop — this is threaded straight through to it. */
  teacherError: string | null;
  /** Clears teacherError. Called when the "İptal" button below backs out of
   * an edit, so a stale refusal from that edit doesn't linger once the form
   * has moved on to something else. */
  setTeacherError: (v: string | null) => void;
  handleFileImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
  selectedYear: number;
  setSelectedYear: (y: number) => void;
  selectedMonth: number;
  setSelectedMonth: (m: number) => void;
  availabilities: Record<string, Record<string, AvailabilityStatus>>;
  handleCycleAvailability: (dateStr: string) => void;
  /** e.g. "Ekim 2026" — the selected (year, month), for the target-hours
   * label on TeacherForm and the header of the PartnerGroups card. */
  monthLabel: string;
  /** This month's duty-target overrides and partner groups, plus the setter
   * for the latter — sourced from useScheduleState so the roster, the
   * PartnerGroups card, and the solver all agree on what THIS month looks
   * like. */
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
  onChangeGroups: (groups: PartnerGroup[]) => void;
  copyMonths: { year: number; month: number }[];
  onCopyFromMonth: (year: number, month: number) => void;
  /** Duty posts (ADR-0007), for the teacher form's post field. */
  posts?: DbDutyPost[];
  selectedPostId?: string | null;
  teacherPostId?: string | null;
  setTeacherPostId?: (postId: string | null) => void;
}

export const Step1Roster: React.FC<Step1RosterProps> = ({
  teachers,
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
  handleSaveTeacher,
  handleEditTeacherClick,
  handleDeleteTeacher,
  teacherError,
  setTeacherError,
  handleFileImport,
  selectedYear,
  setSelectedYear,
  selectedMonth,
  setSelectedMonth,
  availabilities,
  handleCycleAvailability,
  monthLabel,
  partnerGroups,
  monthlyTargets,
  onChangeGroups,
  copyMonths,
  onCopyFromMonth,
  posts = [],
  selectedPostId = null,
  teacherPostId = null,
  setTeacherPostId
}) => {
  const { t } = useTranslation();
  return (
    <div className="fill-column">
      <h2 className="step-title" style={{ margin: "0 0 12px 0", flexShrink: 0 }}>
        <span>{t("step1.title")}</span>
        <div className="tooltip-container tooltip-container--title">
          <span className="tooltip-icon">?</span>
          <div className="tooltip-content">
            {t("step1.help")}
          </div>
        </div>
      </h2>

      {/* Modern 1-2-1 Desktop Dashboard Layout */}
      <div className="desktop-split-layout">

        {/* Pane 1 (Left - 1): Teacher List - scrollable and fits vertical height */}
        <div className="card fill-column split-pane-list" style={{ padding: "16px" }}>
          <TeacherList
            teachers={teachers}
            selectedTeacherId={selectedTeacherId}
            onSelectTeacher={(id) => setSelectedTeacherId(id)}
            onEditTeacher={handleEditTeacherClick}
            onDeleteTeacher={handleDeleteTeacher}
            monthlyTargets={monthlyTargets}
            partnerGroups={partnerGroups}
          />
        </div>

        {/* Pane 2 (Middle - 2): Selected Teacher's Availability Calendar */}
        <div className="fill-column split-pane-main">
          {selectedTeacherId ? (
            <AvailabilityCalendar
              teachers={teachers}
              selectedTeacherId={selectedTeacherId}
              availabilities={availabilities}
              selectedYear={selectedYear}
              setSelectedYear={setSelectedYear}
              selectedMonth={selectedMonth}
              setSelectedMonth={setSelectedMonth}
              onCycleAvailability={handleCycleAvailability}
            />
          ) : (
            <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", border: "2px dashed var(--slate-300)", color: "var(--slate-500)" }}>
              <div style={{ fontSize: "3rem", marginBottom: "16px" }}>👈 👥</div>
              <h3>{t("step1.noTeacherSelected")}</h3>
              <p>{t("step1.noTeacherSelectedHelp")}</p>
            </div>
          )}
        </div>

        {/* Pane 3 (Right - 1): Add/Edit Teacher & Excel Loader */}
        <div className="scrollable-column split-pane-sidebar" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <TeacherForm
            editingTeacherId={editingTeacherId}
            teacherName={teacherName}
            setTeacherName={setTeacherName}
            teacherTarget={teacherTarget}
            setTeacherTarget={setTeacherTarget}
            teacherPriority={teacherPriority}
            setTeacherPriority={setTeacherPriority}
            onSubmit={handleSaveTeacher}
            onCancel={() => {
              setEditingTeacherId(null);
              setTeacherName("");
              setTeacherTarget(4);
              setTeacherPriority(1);
              setTeacherError(null);
              setTeacherPostId?.(null);
            }}
            monthLabel={monthLabel}
            usualTarget={teachers.find((t) => t.id === editingTeacherId)?.target_hours ?? null}
            error={teacherError}
            posts={posts}
            postId={teacherPostId ?? selectedPostId}
            setPostId={(id) => setTeacherPostId?.(id)}
          />
          <PartnerGroups
            teachers={teachers}
            monthLabel={monthLabel}
            partnerGroups={partnerGroups}
            monthlyTargets={monthlyTargets}
            onChangeGroups={onChangeGroups}
            copyMonths={copyMonths}
            onCopyFromMonth={onCopyFromMonth}
          />
          <ExcelImport onFileImport={handleFileImport} />
        </div>

      </div>
    </div>
  );
};
