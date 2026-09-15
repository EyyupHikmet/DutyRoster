import React, { useEffect, useRef, useState } from "react";
import { DbDutyPost } from "../db";
import { ModalDialog } from "./ModalDialog";
import { TypedDeleteDialog } from "./TypedDeleteDialog";

interface PostMenuProps {
  posts: DbDutyPost[];
  selectedPostId: string | null;
  onSelectPost: (postId: string) => void;
  /** Adds a post; resolves to the message to show when the name is refused, or null. */
  onAddPost: (name: string) => Promise<string | null>;
  /** Renames the selected post; resolves to the message to show when refused, or null. */
  onRenamePost: (name: string) => Promise<string | null>;
  /** Deletes the selected post, once its name has been typed. */
  onDeletePost: () => void | Promise<void>;
  /** Shows only the icon, for a narrow header. The name stays in the label and tooltip. */
  compact?: boolean;
}

const itemSelector = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled])';

/**
 * The duty post switcher, shown in the header on every step (ADR-0007): which post's staff and
 * months are on screen, plus adding, renaming and deleting posts. A menu
 * button with arrow-key navigation, following the WAI-ARIA menu button pattern.
 */
export const PostMenu: React.FC<PostMenuProps> = ({ posts, selectedPostId, onSelectPost, onAddPost, onRenamePost, onDeletePost, compact = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dialog, setDialog] = useState<"add" | "rename" | "delete" | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = posts.find((p) => p.id === selectedPostId);

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLElement>(itemSelector)?.focus();
    const handlePointer = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(itemSelector) ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
    items[next].focus();
  };

  const choose = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={toggleRef}
        type="button"
        className="header-pill-btn"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="duty-post-menu"
        aria-label={`Nöbet yeri: ${selected?.name ?? ""}`}
        title={selected?.name}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">🏠</span>
        {!compact && selected?.name}
        <span aria-hidden="true">▾</span>
      </button>

      {isOpen && (
        <div
          id="duty-post-menu"
          ref={menuRef}
          role="menu"
          aria-label="Nöbet yerleri"
          className="card surface-solid"
          onKeyDown={moveFocus}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: "230px",
            padding: "6px",
            borderRadius: "10px",
            border: "1.5px solid var(--border)",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            zIndex: 300,
          }}
        >
          {posts.map((post) => (
            <button
              key={post.id}
              type="button"
              role="menuitemradio"
              aria-checked={post.id === selectedPostId}
              className="post-menu-item"
              onClick={() => choose(() => onSelectPost(post.id))}
            >
              <span aria-hidden="true" style={{ width: "1em" }}>{post.id === selectedPostId ? "✓" : ""}</span>
              {post.name}
            </button>
          ))}
          <div role="separator" style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
          <button type="button" role="menuitem" className="post-menu-item" onClick={() => choose(() => setDialog("add"))}>
            <span aria-hidden="true" style={{ width: "1em" }}>+</span>
            Nöbet yeri ekle
          </button>
          <button type="button" role="menuitem" className="post-menu-item" onClick={() => choose(() => setDialog("rename"))}>
            <span aria-hidden="true" style={{ width: "1em" }}>✎</span>
            Adını değiştir
          </button>
          <button
            type="button"
            role="menuitem"
            className="post-menu-item"
            disabled={posts.length <= 1}
            title={posts.length <= 1 ? "Tek nöbet yeri silinemez" : undefined}
            onClick={() => choose(() => setDialog("delete"))}
          >
            <span aria-hidden="true" style={{ width: "1em" }}>🗑</span>
            Nöbet yerini sil
          </button>
        </div>
      )}

      {(dialog === "add" || dialog === "rename") && (
        <PostNameDialog
          mode={dialog}
          initialName={dialog === "rename" ? selected?.name ?? "" : ""}
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            const message = dialog === "add" ? await onAddPost(name) : await onRenamePost(name);
            if (!message) setDialog(null);
            return message;
          }}
        />
      )}

      {dialog === "delete" && selected && (
        <TypedDeleteDialog
          title="Nöbet Yerini Sil"
          confirmText={selected.name}
          description={
            <>
              {selected.name} nöbet yeri; öğretmenleri, onların uygunlukları ve aylık planlarıyla birlikte kalıcı olarak
              silinecek. Onaylı çizelgeleri korunur.{" "}
              <strong style={{ color: "var(--danger)" }}>Bu işlem geri alınamaz.</strong>
            </>
          }
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setDialog(null);
            await onDeletePost();
          }}
        />
      )}
    </div>
  );
};

interface PostNameDialogProps {
  mode: "add" | "rename";
  initialName: string;
  onCancel: () => void;
  /** Resolves to a message to show when the name is refused, or null once accepted. */
  onSubmit: (name: string) => Promise<string | null>;
}

const PostNameDialog: React.FC<PostNameDialogProps> = ({ mode, initialName, onCancel, onSubmit }) => {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const message = await onSubmit(name);
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <ModalDialog
      titleId={mode === "add" ? "add-post-title" : "rename-post-title"}
      title={mode === "add" ? "Nöbet Yeri Ekle" : "Nöbet Yerini Yeniden Adlandır"}
      icon="🏠"
      initialFocusRef={inputRef}
      onCancel={onCancel}
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="post-name-input">Nöbet yerinin adı</label>
          <input
            id="post-name-input"
            ref={inputRef}
            className="form-control"
            autoComplete="off"
            placeholder="Örn: Kız Yurdu"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </div>
        {error && (
          <div className="alert alert-danger" role="alert" style={{ margin: 0, fontSize: "0.82rem" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: "12px" }}>
          <button type="button" className="btn btn-secondary" style={{ flexGrow: 1 }} onClick={onCancel}>
            Vazgeç
          </button>
          <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }} disabled={busy}>
            {mode === "add" ? "Ekle" : "Kaydet"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
};
