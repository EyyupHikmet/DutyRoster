import React, { useState } from "react";
import { DbTeacher } from "../db";
import { PartnerGroup } from "../solver/partners";
import { validatePartnerGroups } from "../solver/validation";
import { effectiveTarget } from "../utils/targets";
import { MONTHS_TR } from "../utils/dateUtils";

interface PartnerGroupsProps {
  teachers: DbTeacher[];
  /** e.g. "Ekim 2026" — groups belong to one month, so the card says which. */
  monthLabel: string;
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
  onChangeGroups: (groups: PartnerGroup[]) => void;
  copyMonths: { year: number; month: number }[];
  onCopyFromMonth: (year: number, month: number) => void;
}

export const PartnerGroups: React.FC<PartnerGroupsProps> = ({
  teachers,
  monthLabel,
  partnerGroups,
  monthlyTargets,
  onChangeGroups,
  copyMonths,
  onCopyFromMonth,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [goalDays, setGoalDays] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [copySelection, setCopySelection] = useState<string>(
    copyMonths.length > 0 ? `${copyMonths[0].year}-${copyMonths[0].month}` : ""
  );

  const nameOf = (id: string) => teachers.find((t) => t.id === id)?.name ?? id;

  // How many joint days each teacher is already committed to this month. Shown
  // next to their checkbox so the principal can see why a save would be refused
  // before they attempt it, rather than only after.
  const committedDays = (teacherId: string): number =>
    partnerGroups
      .filter((group) => group.memberIds.includes(teacherId))
      .reduce((sum, group) => sum + group.goalDays, 0);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const candidate: PartnerGroup = {
      id: crypto.randomUUID(),
      memberIds: [...selectedIds],
      goalDays: Number(goalDays),
    };

    // Validate the whole month, not just this group: over-commitment is a
    // property of every group a teacher belongs to, so it can only be judged
    // against the full set. Only issues this group is responsible for are
    // reported back, though — the principal is trying to save THIS group.
    const issues = validatePartnerGroups(
      [...partnerGroups, candidate],
      teachers,
      monthlyTargets
    );
    const blocking = issues.find(
      (issue) =>
        issue.groupId === candidate.id ||
        (issue.teacherId !== undefined && candidate.memberIds.includes(issue.teacherId))
    );

    if (blocking) {
      setError(blocking.message);
      return;
    }

    onChangeGroups([...partnerGroups, candidate]);
    setSelectedIds([]);
    setGoalDays(1);
  };

  const handleDelete = (id: string) => {
    setError(null);
    onChangeGroups(partnerGroups.filter((group) => group.id !== id));
  };

  const handleCopy = () => {
    const [year, month] = copySelection.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;
    setError(null);
    onCopyFromMonth(year, month);
  };

  return (
    <div className="card" style={{ marginBottom: "20px" }}>
      <h3
        style={{
          margin: "0 0 4px 0",
          color: "var(--primary)",
          fontWeight: "800",
          fontSize: "1.1rem",
        }}
      >
        Nöbet Grupları
      </h3>
      <p style={{ margin: "0 0 14px 0", fontSize: "0.78rem", color: "var(--slate-500)" }}>
        {monthLabel} için birlikte nöbet tutacak öğretmenler.
      </p>

      {partnerGroups.length === 0 ? (
        <div className="alert alert-info" style={{ margin: "0 0 14px 0", fontSize: "0.8rem" }}>
          Henüz nöbet grubu tanımlanmadı.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 14px 0", padding: 0 }}>
          {partnerGroups.map((group) => (
            <li
              key={group.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                padding: "8px 10px",
                marginBottom: "6px",
                borderRadius: "8px",
                border: "1px solid var(--slate-200)",
                backgroundColor: "var(--bg-content)",
              }}
            >
              <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>
                {group.memberIds.map(nameOf).join(" + ")}
              </span>
              <span style={{ fontSize: "0.78rem", color: "var(--slate-500)" }}>
                {group.goalDays} gün
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                onClick={() => handleDelete(group.id)}
              >
                Grubu Sil
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit}>
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px 0" }}>
          <legend style={{ fontSize: "0.82rem", fontWeight: 700, padding: 0 }}>
            Gruba girecek öğretmenler
          </legend>
          <div style={{ maxHeight: "160px", overflowY: "auto", marginTop: "6px" }}>
            {teachers.map((teacher) => {
              const committed = committedDays(teacher.id);
              const target = effectiveTarget(teacher, monthlyTargets);
              return (
                <label
                  key={teacher.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "0.8rem",
                    padding: "3px 0",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(teacher.id)}
                    onChange={() => toggleMember(teacher.id)}
                  />
                  <span>{teacher.name}</span>
                  <span style={{ marginLeft: "auto", color: "var(--slate-500)" }}>
                    {committed}/{target}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="form-group">
          <label htmlFor="partner-goal-days-input">Ortak nöbet günü sayısı</label>
          <input
            type="number"
            id="partner-goal-days-input"
            className="form-control"
            min="1"
            max="20"
            value={goalDays}
            onChange={(e) => setGoalDays(Number(e.target.value))}
            required
          />
        </div>

        {error && (
          <div
            className="alert alert-danger"
            role="alert"
            style={{ margin: "0 0 12px 0", fontSize: "0.78rem" }}
          >
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
          Grubu Kaydet
        </button>
      </form>

      {copyMonths.length > 0 && (
        <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--slate-200)" }}>
          <div className="form-group" style={{ marginBottom: "8px" }}>
            <label htmlFor="partner-copy-month-select">Başka aydan kopyala</label>
            <select
              id="partner-copy-month-select"
              className="form-control"
              value={copySelection}
              onChange={(e) => setCopySelection(e.target.value)}
            >
              {copyMonths.map(({ year, month }) => (
                <option key={`${year}-${month}`} value={`${year}-${month}`}>
                  {MONTHS_TR[month - 1]} {year}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: "100%" }}
            onClick={handleCopy}
          >
            Seçilen aydan kopyala
          </button>
        </div>
      )}
    </div>
  );
};
