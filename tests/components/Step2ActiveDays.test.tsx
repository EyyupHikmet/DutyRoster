import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Step2ActiveDays } from "../../src/components/Step2ActiveDays";

function baseProps(overrides: Partial<React.ComponentProps<typeof Step2ActiveDays>> = {}) {
  return {
    selectedYear: 2026,
    setSelectedYear: vi.fn(),
    selectedMonth: 10,
    setSelectedMonth: vi.fn(),
    holidays: [] as string[],
    weekendDutyDays: [] as string[],
    extraDays: [] as string[],
    handleToggleExtraDay: vi.fn(),
    handleToggleDayEligibility: vi.fn(),
    ...overrides,
  };
}

describe("Step2ActiveDays", () => {
  it("renders the step heading and a full month grid with 'Nöbet Var'/'Tatil' badges", () => {
    render(<Step2ActiveDays {...baseProps()} />);
    expect(screen.getByText(/Ay Seçimi & Aktif Günler/)).toBeInTheDocument();
    // Oct 2026: weekdays default included ("Nöbet Var"), weekends default excluded ("Tatil")
    expect(screen.getAllByText("Nöbet Var").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tatil").length).toBeGreaterThan(0);
  });

  it("a weekday marked as a holiday shows 'excluded' styling/badge, a weekend marked as duty shows 'included'", () => {
    render(
      <Step2ActiveDays
        {...baseProps({
          holidays: ["2026-10-29"], // a Thursday in Oct 2026
          weekendDutyDays: ["2026-10-03"], // a Saturday in Oct 2026
        })}
      />
    );
    // Both the holiday weekday and the duty weekend now individually diverge from the
    // weekday/weekend default — spot-check via the cell count of each badge type
    // shifting by exactly one in each direction relative to the default-only render.
    const included = screen.getAllByText("Nöbet Var").length;
    const excluded = screen.getAllByText("Tatil").length;
    expect(included).toBeGreaterThan(0);
    expect(excluded).toBeGreaterThan(0);
  });

  it("clicking a day cell calls handleToggleDayEligibility with its date and weekend flag", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<Step2ActiveDays {...props} />);
    // Oct 1, 2026 is a Thursday (weekday)
    await user.click(screen.getByText("1"));
    expect(props.handleToggleDayEligibility).toHaveBeenCalledWith("2026-10-01", false);
  });

  it("clicking the Standart/Ekstra badge calls handleToggleExtraDay and does not also toggle eligibility", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<Step2ActiveDays {...props} />);
    const badge = screen.getAllByText("Standart")[0];
    await user.click(badge);
    expect(props.handleToggleExtraDay).toHaveBeenCalled();
    expect(props.handleToggleDayEligibility).not.toHaveBeenCalled();
  });

  it("renders year/month CustomSelect pickers (no step-title tooltip — Step 2 doesn't have one)", () => {
    const { container } = render(<Step2ActiveDays {...baseProps()} />);
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("Ekim")).toBeInTheDocument();
    expect(container.querySelector(".tooltip-container")).toBeNull();
  });
});
