import React, { useState, useRef, useEffect, useId } from "react";

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  variant?: "default" | "pinned";
  /** Accessible name when there is no visible <label> element to point to (e.g. year/month pickers). */
  ariaLabel?: string;
  /** Accessible name via reference to an existing <label id="...">, preferred when one is on screen. */
  ariaLabelledBy?: string;
}

// Accessible custom listbox/combobox.
//
// This used to be a plain onClick-only <div> tree with zero keyboard support and
// zero ARIA semantics — completely unusable without a mouse/touch pointer, and
// silent to screen readers (a "form-control"-styled <div> has no implicit role,
// name, or value). WCAG 2.2 AA 2.1.1 (Keyboard) requires every function be
// operable from the keyboard, and 4.1.2 (Name, Role, Value) requires custom
// widgets to expose the same role/state/name info a native control would get
// for free. This follows the WAI-ARIA APG "select-only combobox" pattern:
//   - the visible header is `role="combobox"` with `aria-expanded`/
//     `aria-haspopup="listbox"`/`aria-controls` pointing at the popup, and
//     `aria-activedescendant` pointing at whichever option is currently
//     highlighted — the DOM focus stays on the combobox the whole time, only
//     the "virtual" highlight moves, which is what lets a single Tab stop
//     cover the whole widget (matching native <select> behavior).
//   - the popup is `role="listbox"` containing `role="option"` children with
//     `aria-selected`.
//   - ArrowDown/ArrowUp/Home/End move the highlight (opening the popup first
//     if closed), Enter/Space commits the highlighted option, Escape closes
//     without committing, Tab moves on (and closes the popup) like a native
//     select would.
export const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = "Seçiniz...",
  className = "",
  style,
  variant = "default",
  ariaLabel,
  ariaLabelledBy
}) => {
  const isPinned = variant === "pinned" && Boolean(value);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (idx: number) => `${baseId}-option-${idx}`;

  // Index 0 is always the "clear/placeholder" entry; real options follow.
  const allEntries: Option[] = [{ value: "", label: placeholder }, ...options];
  const selectedIndex = Math.max(
    0,
    allEntries.findIndex((opt) => opt.value === value)
  );
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);

  const selectedOption = options.find((opt) => opt.value === value);
  const selectedLabel = selectedOption ? selectedOption.label : placeholder;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    // jsdom (used by the component test suite) doesn't implement
    // scrollIntoView at all — guard rather than assume a DOM API exists.
    if (isOpen) {
      optionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: "nearest" });
    }
  }, [isOpen, highlightedIndex]);

  const commit = (idx: number) => {
    onChange(allEntries[idx].value);
    setIsOpen(false);
  };

  const openAt = (idx: number) => {
    setHighlightedIndex(idx);
    setIsOpen(true);
  };

  const handleHeaderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (isOpen) {
          commit(highlightedIndex);
        } else {
          openAt(selectedIndex);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen) {
          openAt(selectedIndex);
        } else {
          setHighlightedIndex((i) => Math.min(i + 1, allEntries.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!isOpen) {
          openAt(selectedIndex);
        } else {
          setHighlightedIndex((i) => Math.max(i - 1, 0));
        }
        break;
      case "Home":
        if (isOpen) {
          e.preventDefault();
          setHighlightedIndex(0);
        }
        break;
      case "End":
        if (isOpen) {
          e.preventDefault();
          setHighlightedIndex(allEntries.length - 1);
        }
        break;
      case "Escape":
        if (isOpen) {
          e.preventDefault();
          setIsOpen(false);
        }
        break;
      case "Tab":
        // Let focus move on naturally; just close the popup like a native select would.
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={dropdownRef}
      className={`custom-select-container ${className}`}
      style={{
        position: "relative",
        width: "100%",
        boxSizing: "border-box",
        ...style
      }}
    >
      {/* Clickable Header Button (Simulates the select input) */}
      <div
        className="form-control"
        role="combobox"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? optionId(highlightedIndex) : undefined}
        aria-label={ariaLabelledBy ? undefined : ariaLabel || placeholder}
        aria-labelledby={ariaLabelledBy}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          paddingRight: "14px !important", // normal padding since we render arrow as JSX element!
          backgroundImage: "none", // completely strip default select-arrow background
          backgroundColor: isPinned ? "var(--warning-light)" : "var(--bg-card)",
          borderColor: isPinned ? "var(--warning)" : "var(--border)",
          color: isPinned ? "var(--warning-text)" : "var(--text-primary)",
          fontWeight: isPinned ? "bold" : "500",
          height: "34px",
          padding: "6px 12px"
        }}
        onClick={() => (isOpen ? setIsOpen(false) : openAt(selectedIndex))}
        onKeyDown={handleHeaderKeyDown}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel}
        </span>
        {/* Animated Chevron Arrow Caret */}
        <span
          aria-hidden="true"
          style={{
            fontSize: "0.6rem",
            color: isPinned ? "var(--warning-text)" : "var(--text-secondary)",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            display: "inline-block",
            pointerEvents: "none"
          }}
        >
          ▼
        </span>
      </div>

      {/* Floating Options Dropdown Menu */}
      {isOpen && (
        <div
          className="card surface-solid"
          role="listbox"
          id={listboxId}
          aria-label={ariaLabelledBy || ariaLabel ? undefined : placeholder}
          aria-labelledby={ariaLabelledBy}
          style={{
            position: "absolute",
            top: "38px",
            left: 0,
            width: "100%",
            maxHeight: "150px",
            overflowY: "auto",

            border: "1.5px solid var(--border)",
            borderRadius: "10px",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
            padding: "4px",
            boxSizing: "border-box",
            zIndex: 9999
          }}
        >
          {allEntries.map((entry, idx) => {
            const isSelected = entry.value === value;
            const isHighlighted = idx === highlightedIndex;
            const isPlaceholderRow = idx === 0;
            return (
              <div
                key={entry.value || "__placeholder__"}
                id={optionId(idx)}
                role="option"
                aria-selected={isSelected}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  // --text-muted on this listbox's --bg-content background
                  // measured (axe-core) below 4.5:1 in dark theme;
                  // --text-secondary is the passing sibling token.
                  color: isPlaceholderRow && !isSelected
                    ? "var(--text-secondary)"
                    : isSelected
                      ? "var(--primary)"
                      : "var(--text-primary)",
                  fontWeight: isSelected ? "bold" : "500",
                  backgroundColor: isHighlighted
                    ? "var(--bg-card)"
                    : isSelected
                      ? "var(--primary-light)"
                      : "transparent",
                  transition: "background-color 0.15s"
                }}
                onMouseEnter={() => setHighlightedIndex(idx)}
                onClick={() => commit(idx)}
              >
                {entry.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
