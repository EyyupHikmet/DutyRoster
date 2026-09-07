import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WizardNav } from "../../src/components/WizardNav";

describe("WizardNav", () => {
  it("renders all three Turkish step labels", () => {
    render(<WizardNav activeStep={1} setActiveStep={() => {}} />);
    expect(screen.getByText("Kadro & Uygunluk")).toBeInTheDocument();
    expect(screen.getByText("Ay Seçimi & Özel Günler")).toBeInTheDocument();
    expect(screen.getByText("Planla & Dışa Aktar")).toBeInTheDocument();
  });

  it("marks the active step and prior steps as completed", () => {
    const { container } = render(<WizardNav activeStep={2} setActiveStep={() => {}} />);
    const indicators = container.querySelectorAll(".step-indicator");
    expect(indicators[0].className).toContain("completed");
    expect(indicators[1].className).toContain("active");
    expect(indicators[2].className).not.toContain("active");
    expect(indicators[2].className).not.toContain("completed");
  });

  it("clicking a step indicator calls setActiveStep with that step number", async () => {
    const user = userEvent.setup();
    const setActiveStep = vi.fn();
    render(<WizardNav activeStep={1} setActiveStep={setActiveStep} />);

    await user.click(screen.getByText("Planla & Dışa Aktar"));
    expect(setActiveStep).toHaveBeenCalledWith(3);

    await user.click(screen.getByText("Ay Seçimi & Özel Günler"));
    expect(setActiveStep).toHaveBeenCalledWith(2);
  });
});
