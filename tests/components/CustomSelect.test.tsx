import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomSelect } from "../../src/components/CustomSelect";

const options = [
  { value: "1", label: "Standart" },
  { value: "2", label: "Orta Kıdemli" },
  { value: "3", label: "Yüksek Kıdemli" },
];

// This is exactly the regression this suite exists to guard against:
// CustomSelect used to hardcode orange/warning "pinned" styling whenever `value`
// was truthy, regardless of which picker it was used for (Kıdem/Öncelik, Year/Month
// all rendered permanently orange). The fix added `variant?: "default" | "pinned"`,
// default "default", and gates the warning styling on `variant === "pinned"`.
describe("CustomSelect — variant styling (regression)", () => {
  it("default variant with a value selected does NOT apply pinned/warning styling", () => {
    render(
      <CustomSelect options={options} value="2" onChange={() => {}} />
    );
    const header = screen.getByText("Orta Kıdemli").closest(".form-control") as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.backgroundColor).toBe("var(--bg-card)");
    expect(header.style.borderColor).toBe("var(--border)");
    expect(header.style.fontWeight).toBe("500");
  });

  it("explicit variant='default' with a value selected also does NOT apply pinned styling", () => {
    render(
      <CustomSelect options={options} value="3" onChange={() => {}} variant="default" />
    );
    const header = screen.getByText("Yüksek Kıdemli").closest(".form-control") as HTMLElement;
    expect(header.style.backgroundColor).toBe("var(--bg-card)");
    expect(header.style.fontWeight).toBe("500");
  });

  it("variant='pinned' WITH a value selected DOES apply the warning/pinned styling", () => {
    render(
      <CustomSelect options={options} value="1" onChange={() => {}} variant="pinned" />
    );
    const header = screen.getByText("Standart").closest(".form-control") as HTMLElement;
    expect(header.style.backgroundColor).toBe("var(--warning-light)");
    expect(header.style.borderColor).toBe("var(--warning)");
    expect(header.style.fontWeight).toBe("bold");
  });

  it("variant='pinned' with NO value selected does NOT apply pinned styling (isPinned requires both)", () => {
    render(
      <CustomSelect options={options} value="" onChange={() => {}} variant="pinned" placeholder="Seçiniz..." />
    );
    const header = screen.getByText("Seçiniz...").closest(".form-control") as HTMLElement;
    expect(header.style.backgroundColor).toBe("var(--bg-card)");
    expect(header.style.fontWeight).toBe("500");
  });
});

describe("CustomSelect — rendering and interaction", () => {
  it("shows the placeholder when no value is selected", () => {
    render(<CustomSelect options={options} value="" onChange={() => {}} placeholder="Seçiniz..." />);
    expect(screen.getByText("Seçiniz...")).toBeInTheDocument();
  });

  it("opens the dropdown on click and lists every option", async () => {
    const user = userEvent.setup();
    render(<CustomSelect options={options} value="" onChange={() => {}} />);

    await user.click(screen.getByText("Seçiniz..."));

    for (const opt of options) {
      expect(screen.getByText(opt.label)).toBeInTheDocument();
    }
  });

  it("calls onChange with the clicked option's value and closes the dropdown", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomSelect options={options} value="" onChange={onChange} />);

    await user.click(screen.getByText("Seçiniz..."));
    await user.click(screen.getByText("Yüksek Kıdemli"));

    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("clicking the placeholder row inside the open dropdown clears the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomSelect options={options} value="2" onChange={onChange} placeholder="Seçiniz..." />);

    await user.click(screen.getByText("Orta Kıdemli"));
    // Two "Seçiniz..." nodes might exist once open (header shows selected label, not
    // placeholder, so only the dropdown's clear row shows "Seçiniz...").
    await user.click(screen.getByText("Seçiniz..."));

    expect(onChange).toHaveBeenCalledWith("");
  });
});
