import React from "react";
import { TypedDeleteDialog } from "./TypedDeleteDialog";
import { formatApprovalDate } from "../utils/approvedSchedules";

interface DeleteApprovedDialogProps {
  /** The approved schedule's month and year, e.g. "Kasım 2026". */
  label: string;
  /** The duty post's name as approved, so two posts' "Kasım 2026" are told apart. */
  postName?: string;
  approvedAt: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Deleting an approved schedule cannot be undone, so its month and year are typed first. */
export const DeleteApprovedDialog: React.FC<DeleteApprovedDialogProps> = ({ label, postName, approvedAt, onCancel, onConfirm }) => (
  <TypedDeleteDialog
    title="Onaylı Çizelgeyi Sil"
    confirmText={label}
    description={
      <>
        {postName ? `${postName} – ` : ""}
        {label} için {formatApprovalDate(approvedAt)} tarihinde onaylanmış çizelge kalıcı olarak silinecek.{" "}
        <strong style={{ color: "var(--danger)" }}>Bu işlem geri alınamaz.</strong>
      </>
    }
    onCancel={onCancel}
    onConfirm={onConfirm}
  />
);
