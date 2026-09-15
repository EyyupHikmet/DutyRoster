import React, { useEffect, useRef } from "react";

interface ModalDialogProps {
  titleId: string;
  title: string;
  icon: string;
  titleColor?: string;
  describedById?: string;
  maxWidth?: string;
  /** Receives focus when the dialog opens; the dialog itself does otherwise. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  onCancel: () => void;
  children: React.ReactNode;
}

/**
 * A compact confirmation dialog with the same contract as the dialogs written
 * inline in App.tsx: role="dialog" with aria-modal and an accessible name
 * (WCAG 4.1.2), focus moved in on open and kept inside with Tab (2.4.3), Escape
 * cancels, and focus goes back to where it was on close.
 */
export const ModalDialog: React.FC<ModalDialogProps> = ({
  titleId,
  title,
  icon,
  titleColor = "var(--text-primary)",
  describedById,
  maxWidth = "420px",
  initialFocusRef,
  onCancel,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Read the latest handler without re-running the effect, which would steal
  // focus back into the dialog on every render.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (initialFocusRef?.current ?? dialogRef.current)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancelRef.current();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const stillUsable =
        previouslyFocused && previouslyFocused !== document.body && document.body.contains(previouslyFocused);
      if (stillUsable) previouslyFocused.focus();
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        ref={dialogRef}
        className="card surface-solid"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth,
          padding: "24px",
          borderRadius: "16px",
          border: "1.5px solid var(--border)",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", borderBottom: "1.5px solid var(--border)", paddingBottom: "12px" }}>
          <span style={{ fontSize: "1.5rem" }} aria-hidden="true">{icon}</span>
          <h3 id={titleId} style={{ margin: 0, color: titleColor, fontWeight: "850", fontSize: "1.15rem" }}>
            {title}
          </h3>
        </div>
        {children}
      </div>
    </div>
  );
};
