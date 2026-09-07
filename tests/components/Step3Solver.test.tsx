import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Step3Solver } from "../../src/components/Step3Solver";
import { DbTeacher } from "../../src/db";

const teachers: DbTeacher[] = [{ id: "T1", name: "Ahmet Yılmaz", target_hours: 4, priority: 1 }];

function baseProps(overrides: Partial<React.ComponentProps<typeof Step3Solver>> = {}) {
  return {
    teachers,
    selectedYear: 2026,
    selectedMonth: 10,
    holidays: [] as string[],
    weekendDutyDays: [] as string[],
    solverMode: "fairness" as const,
    setSolverMode: vi.fn(),
    teachersPerDay: 1,
    setTeachersPerDay: vi.fn(),
    pinnedAssignments: {} as Record<string, string[]>,
    setPinnedAssignments: vi.fn(),
    daySpecificTeachers: {} as Record<string, number>,
    setDaySpecificTeachers: vi.fn(),
    generatedSchedule: {} as Record<string, string[]>,
    solverError: null as string | null,
    handleClearPins: vi.fn(),
    handleGenerateSchedule: vi.fn(),
    handleExportSchedule: vi.fn(),
    ...overrides,
  };
}

describe("Step3Solver", () => {
  it("renders the step title, the 4 solver-mode options, and the generate button", () => {
    render(<Step3Solver {...baseProps()} />);
    expect(screen.getByText(/Adım 3: Planlama Seçenekleri/)).toBeInTheDocument();
    expect(screen.getByText("Eşit Dağıt (Adalet)")).toBeInTheDocument();
    expect(screen.getByText("Kıdem Öncelikli")).toBeInTheDocument();
    expect(screen.getByText("Dengeli (Hedef Odaklı)")).toBeInTheDocument();
    expect(screen.getByText("Rastgele Doldur")).toBeInTheDocument();
    expect(screen.getByText("⚡ Programı Hazırla")).toBeInTheDocument();
  });

  it("does not show the export button until a schedule has been generated", () => {
    render(<Step3Solver {...baseProps()} />);
    expect(screen.queryByText("📥 Excel'e Aktar")).not.toBeInTheDocument();
  });

  it("shows the export button once generatedSchedule is non-empty", () => {
    render(<Step3Solver {...baseProps({ generatedSchedule: { "2026-10-01": ["T1"] } })} />);
    expect(screen.getByText("📥 Excel'e Aktar")).toBeInTheDocument();
  });

  it("clicking a solver-mode card calls setSolverMode with that mode", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<Step3Solver {...props} />);
    await user.click(screen.getByText("Kıdem Öncelikli"));
    expect(props.setSolverMode).toHaveBeenCalledWith("priority");
  });

  it("clicking 'Programı Hazırla' calls handleGenerateSchedule", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<Step3Solver {...props} />);
    await user.click(screen.getByText("⚡ Programı Hazırla"));
    expect(props.handleGenerateSchedule).toHaveBeenCalled();
  });

  it("shows the solver error alert with the exact message when solverError is set", () => {
    render(<Step3Solver {...baseProps({ solverError: "12 Ekim için öğretmen bulunamadı." })} />);
    expect(screen.getByText("Sıkışma Hatası:")).toBeInTheDocument();
    expect(screen.getByText(/12 Ekim için öğretmen bulunamadı\./)).toBeInTheDocument();
  });

  it("clicking an active day cell opens the day configurator sidebar with the pinned CustomSelect using variant='pinned'", async () => {
    const user = userEvent.setup();
    render(<Step3Solver {...baseProps()} />);

    expect(screen.getByText("Gün Seçilmedi")).toBeInTheDocument();
    // Oct 1, 2026 is a Thursday (active weekday, no holiday configured)
    await user.click(screen.getByText("1"));

    expect(screen.queryByText("Gün Seçilmedi")).not.toBeInTheDocument();
    expect(screen.getByText("Günlük Nöbet Ayarları")).toBeInTheDocument();
    expect(screen.getByText("Nöbetçi 1:")).toBeInTheDocument();
  });

  it("the pinned CustomSelect renders with warning styling once a teacher is pinned to the selected day", async () => {
    const user = userEvent.setup();
    render(
      <Step3Solver
        {...baseProps({ pinnedAssignments: { "2026-10-01": ["T1"] } })}
      />
    );
    await user.click(screen.getByText("1"));

    const pinnedHeader = screen.getByText("Ahmet Yılmaz").closest(".form-control") as HTMLElement;
    expect(pinnedHeader).toBeTruthy();
    expect(pinnedHeader.style.backgroundColor).toBe("var(--warning-light)");
  });
});
