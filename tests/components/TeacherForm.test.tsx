import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeacherForm } from "../../src/components/TeacherForm";

function setup(overrides: Partial<React.ComponentProps<typeof TeacherForm>> = {}) {
  const props = {
    editingTeacherId: null as string | null,
    teacherName: "",
    setTeacherName: vi.fn(),
    teacherTarget: 4,
    setTeacherTarget: vi.fn(),
    teacherPriority: 1,
    setTeacherPriority: vi.fn(),
    onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
    onCancel: vi.fn(),
    monthLabel: "Ekim 2026",
    usualTarget: null as number | null,
    error: null as string | null,
    ...overrides,
  };
  render(<TeacherForm {...props} />);
  return props;
}

describe("TeacherForm", () => {
  it("shows 'Yeni Öğretmen Ekle' / 'Kaydet' when not editing, no cancel button", () => {
    setup();
    expect(screen.getByText("Yeni Öğretmen Ekle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İptal" })).not.toBeInTheDocument();
  });

  it("shows 'Öğretmen Bilgilerini Güncelle' / 'Güncelle' + a cancel button when editing", () => {
    const props = setup({ editingTeacherId: "T1" });
    expect(screen.getByText("Öğretmen Bilgilerini Güncelle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Güncelle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İptal" })).toBeInTheDocument();
    // sanity: onCancel wiring
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("typing into the name field calls setTeacherName", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByPlaceholderText("Örn: Ahmet Yılmaz"), "A");
    expect(props.setTeacherName).toHaveBeenCalledWith("A");
  });

  it("submitting the form calls onSubmit", async () => {
    const user = userEvent.setup();
    const props = setup({ teacherName: "Ahmet" });
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it("clicking İptal calls onCancel", async () => {
    const user = userEvent.setup();
    const props = setup({ editingTeacherId: "T1" });
    await user.click(screen.getByRole("button", { name: "İptal" }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("hedef alanının hangi aya ait olduğunu belirtir", () => {
    setup({ monthLabel: "Ekim 2026", usualTarget: 4 });
    expect(screen.getByText(/Ekim 2026/)).toBeInTheDocument();
  });

  it("aylık hedef genel hedeften farklıysa bunu belirtir", () => {
    setup({ monthLabel: "Ekim 2026", usualTarget: 4, teacherTarget: 6 });
    expect(screen.getByText(/genel hedefi 4/i)).toBeInTheDocument();
  });

  // Important 1 (final review): useTeachers already computed this message —
  // it just had nowhere to render. This is the leaf that actually shows it.
  describe("blocked-save error (teacherError)", () => {
    it("shows nothing when there is no error", () => {
      setup({ error: null });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("renders a refused-save message as a visible alert", () => {
      setup({
        error: "Ali: bu ay gruplarda toplam 3 ortak nöbet günü tanımlı, hedefi 2 yapamazsınız.",
      });
      expect(screen.getByRole("alert")).toHaveTextContent(/Ali/);
      expect(screen.getByRole("alert")).toHaveTextContent(/3 ortak nöbet günü/);
    });
  });
});
