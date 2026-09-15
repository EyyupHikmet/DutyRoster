import React, { useEffect, useRef, useState } from "react";
import { ApprovedSchedule } from "../hooks/useApprovedSchedules";
import { MONTHS_TR } from "../utils/dateUtils";
import { formatApprovalDate, searchApprovedSchedules } from "../utils/approvedSchedules";
import { openSlotCount } from "../utils/scheduleReport";

interface ApprovedSchedulesDrawerProps {
  approvedSchedules: ApprovedSchedule[];
  onClose: () => void;
  onExport: (copy: ApprovedSchedule) => void;
  onDelete: (copy: ApprovedSchedule) => void;
}

/**
 * The list of approved schedules, opened from the header on any step. A side
 * drawer rather than a modal, so the principal can keep it open while looking
 * at the working month; opening it never changes the working month.
 */
export const ApprovedSchedulesDrawer: React.FC<ApprovedSchedulesDrawerProps> = ({
  approvedSchedules,
  onClose,
  onExport,
  onDelete,
}) => {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const visible = searchApprovedSchedules(approvedSchedules, query);

  useEffect(() => {
    searchRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      // A confirmation dialog opened from the drawer handles its own Escape.
      if (event.key === "Escape" && !document.querySelector('[aria-modal="true"]')) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <aside
      id="approved-schedules-drawer"
      aria-labelledby="approved-schedules-title"
      className="card surface-solid"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        height: "100vh",
        width: "min(380px, 100vw)",
        boxSizing: "border-box",
        padding: "20px",
        borderRadius: 0,
        borderLeft: "1.5px solid var(--border)",
        boxShadow: "-10px 0 25px -5px rgba(0, 0, 0, 0.15)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        zIndex: 500,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <h2 id="approved-schedules-title" style={{ margin: 0, fontSize: "1.1rem", fontWeight: 850, color: "var(--text-primary)" }}>
          Onaylı Çizelgeler
        </h2>
        <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={onClose} aria-label="Kapat">
          ✕
        </button>
      </div>

      <input
        ref={searchRef}
        type="search"
        className="form-control"
        aria-label="Onaylı çizelge ara"
        placeholder="Ay veya yıl yazın (ör. kasım 2026)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div style={{ overflowY: "auto", flexGrow: 1 }}>
        {approvedSchedules.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Henüz onaylanmış çizelge yok. Adım 3'te hazırladığınız çizelgeyi onaylayabilirsiniz.
          </p>
        ) : visible.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Aramanızla eşleşen onaylı çizelge yok.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            {visible.map((copy) => {
              const label = `${MONTHS_TR[copy.month - 1]} ${copy.year}`;
              const openSlots = openSlotCount(copy.report);
              return (
                <li key={copy.id} className="card" style={{ margin: 0, padding: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                    <strong style={{ color: "var(--text-primary)" }}>{label}</strong>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Onay: {formatApprovalDate(copy.approved_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                    {copy.postName ? `${copy.postName} · ` : ""}
                    {copy.report.teachers.length} öğretmen
                    {openSlots > 0 && (
                      <>
                        {" · "}
                        <span style={{ color: "var(--warning-text)", fontWeight: 700 }}>{openSlots} boş slot</span>
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ flexGrow: 1, padding: "6px 10px", fontSize: "0.78rem" }}
                      onClick={() => onExport(copy)}
                      aria-label={`${label} çizelgesini Excel'e aktar`}
                    >
                      📥 Excel'e aktar
                    </button>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "6px 12px", fontSize: "0.78rem" }}
                      onClick={() => onDelete(copy)}
                      aria-label={`${label} çizelgesini sil`}
                    >
                      Sil
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};
