import React, { useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ModalDialog } from "./ModalDialog";
import { foldForSearch } from "../utils/turkishText";

interface TypedDeleteDialogProps {
  title: string;
  description: React.ReactNode;
  /** What the principal types to confirm, e.g. "Kasım 2026" or a post's name. */
  confirmText: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * A deletion that cannot be undone, confirmed by typing what is being deleted.
 * The match is forgiving about case and Turkish marks: it is there to make the
 * deletion deliberate, not to test spelling.
 */
export const TypedDeleteDialog: React.FC<TypedDeleteDialogProps> = ({ title, description, confirmText, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const baseId = useId();
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = foldForSearch(typed) === foldForSearch(confirmText);

  return (
    <ModalDialog
      titleId={`${baseId}-title`}
      describedById={`${baseId}-desc`}
      title={title}
      icon="🗑️"
      titleColor="var(--danger)"
      initialFocusRef={inputRef}
      onCancel={onCancel}
    >
      <p id={`${baseId}-desc`} style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: "1.45rem" }}>
        {description}
      </p>

      <div className="form-group" style={{ margin: 0 }}>
        <label htmlFor={`${baseId}-input`}>
          <Trans i18nKey="dialog.typeToDelete" values={{ what: confirmText }} components={{ 1: <strong /> }} />
        </label>
        <input
          id={`${baseId}-input`}
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
          {t("dialog.cancel")}
        </button>
        <button className="btn btn-danger" style={{ flexGrow: 1 }} onClick={onConfirm} disabled={!matches}>
          {t("dialog.delete")}
        </button>
      </div>
    </ModalDialog>
  );
};
