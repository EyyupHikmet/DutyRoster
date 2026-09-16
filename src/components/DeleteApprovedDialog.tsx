import React from "react";
import { useTranslation } from "react-i18next";
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
export const DeleteApprovedDialog: React.FC<DeleteApprovedDialogProps> = ({ label, postName, approvedAt, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  return (
    <TypedDeleteDialog
      title={t("approved.deleteTitle")}
      confirmText={label}
      description={
        <>
          {postName ? `${postName} – ` : ""}
          {t("approved.deleteWarning", { what: label, approvedAt: formatApprovalDate(approvedAt) })}{" "}
          <strong style={{ color: "var(--danger)" }}>{t("approved.irreversible")}</strong>
        </>
      }
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
};
