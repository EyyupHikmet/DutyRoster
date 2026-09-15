import React, { useRef, useState } from "react";
import { ModalDialog } from "./ModalDialog";
import { formatApprovalDate } from "../utils/approvedSchedules";
import { foldForSearch } from "../utils/turkishText";

interface DeleteApprovedDialogProps {
  /** The approved schedule's month and year, e.g. "Kasım 2026". */
  label: string;
  approvedAt: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Deleting an approved schedule cannot be undone, so the principal types its
 * month and year first. The match is forgiving about case and Turkish marks: it
 * is there to make the deletion deliberate, not to test spelling.
 */
export const DeleteApprovedDialog: React.FC<DeleteApprovedDialogProps> = ({ label, approvedAt, onCancel, onConfirm }) => {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = foldForSearch(typed) === foldForSearch(label);

  return (
    <ModalDialog
      titleId="delete-approved-title"
      describedById="delete-approved-desc"
      title="Onaylı Çizelgeyi Sil"
      icon="🗑️"
      titleColor="var(--danger)"
      initialFocusRef={inputRef}
      onCancel={onCancel}
    >
      <p id="delete-approved-desc" style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
        {label} için {formatApprovalDate(approvedAt)} tarihinde onaylanmış çizelge kalıcı olarak silinecek.{" "}
        <strong style={{ color: "var(--danger)" }}>Bu işlem geri alınamaz.</strong>
      </p>

      <div className="form-group" style={{ margin: 0 }}>
        <label htmlFor="delete-approved-input">
          Silmek için <strong>{label}</strong> yazın.
        </label>
        <input
          id="delete-approved-input"
          ref={inputRef}
          className="form-control"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches) onConfirm();
          }}
        />
      </div>

      <div style={{ display: "flex", gap: "12px", marginTop: "4px" }}>
        <button className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={onCancel}>
          Vazgeç
        </button>
        <button className="btn btn-danger" style={{ flexGrow: 1 }} onClick={onConfirm} disabled={!matches}>
          Sil
        </button>
      </div>
    </ModalDialog>
  );
};
