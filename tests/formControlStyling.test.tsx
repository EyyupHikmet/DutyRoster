import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TeacherForm } from "../src/components/TeacherForm";
import { CustomSelect } from "../src/components/CustomSelect";

// The real stylesheet, so these assertions run against the actual cascade
// rather than a guess about it. vitest.config.ts sets `css: true`, so this is
// injected into the jsdom document and getComputedStyle resolves it.
import "../src/App.css";

// `.form-control` is shared by three real <input>s and by CustomSelect's
// combobox <div>. It used to carry select-dropdown styling unconditionally —
// a chevron background image, 40px of right padding (with !important), and
// `appearance: none` — which gave every text and number field a dropdown
// arrow that does nothing while stripping the number spinner that does.
//
// These are computed-style assertions rather than a grep of the CSS source:
// what matters is what the browser actually resolves for these elements, and
// a source check would pass just as happily if the rule moved elsewhere.
// "none" is CSS's computed value for "no background image"; before the fix
// these elements resolved to var(--select-arrow) instead.

function renderTeacherForm(overrides: Partial<React.ComponentProps<typeof TeacherForm>> = {}) {
  render(
    <TeacherForm
      editingTeacherId={null}
      teacherName=""
      setTeacherName={vi.fn()}
      teacherTarget={4}
      setTeacherTarget={vi.fn()}
      teacherPriority={1}
      setTeacherPriority={vi.fn()}
      onSubmit={vi.fn((e: React.FormEvent) => e.preventDefault())}
      onCancel={vi.fn()}
      {...overrides}
    />
  );
}

describe("form control styling", () => {
  describe("plain inputs keep native affordances and show no dropdown arrow", () => {
    it("the teacher name text input has no chevron and no select padding", () => {
      renderTeacherForm();
      const input = screen.getByLabelText("Öğretmen Adı Soyadı");
      const style = getComputedStyle(input);

      expect(input.tagName).toBe("INPUT");
      expect(style.backgroundImage, "a text input must not show a dropdown chevron").toBe("none");
      expect(style.paddingRight, "40px right padding only exists to clear a chevron").not.toBe("40px");
    });

    it("the monthly-target number input keeps its spinner and shows no chevron", () => {
      renderTeacherForm();
      const input = document.getElementById("teacher-target-input")!;
      const style = getComputedStyle(input);

      expect(input.getAttribute("type")).toBe("number");
      expect(style.backgroundImage, "a number input must not show a dropdown chevron").toBe("none");
      // `appearance: none` is what strips the native up/down spinner. The field
      // was showing the one affordance that is fake and hiding the one that is real.
      expect(style.appearance, "appearance:none removes the number spinner").not.toBe("none");
      expect(style.paddingRight).not.toBe("40px");
    });
  });

  describe("CustomSelect", () => {
    it("renders its own chevron and is not padded for a background one", () => {
      render(
        <CustomSelect
          options={[{ value: "T1", label: "Ahmet Yılmaz" }]}
          value=""
          placeholder="Öğretmen Seç"
          onChange={vi.fn()}
          ariaLabel="Öğretmen Seç"
        />
      );
      const combobox = screen.getByRole("combobox");
      const style = getComputedStyle(combobox);

      // CustomSelect draws the caret as a JSX element, so it never wanted the
      // background image either — it already overrode it inline. What it could
      // NOT override was `padding-right: 40px !important`, which beats an
      // inline style, so its own caret sat 40px from the edge. Its inline
      // comment claimed "normal padding" while the cascade said otherwise.
      expect(combobox).toHaveTextContent("▼");
      expect(style.paddingRight, "the caret is a real element; nothing to clear").not.toBe("40px");
    });
  });
});
