import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Step1Roster } from "../../src/components/Step1Roster";
import { DbTeacher } from "../../src/db";

const teachers: DbTeacher[] = [{ id: "T1", name: "Ahmet Yılmaz", target_hours: 4, priority: 1 }];

function baseProps(overrides: Partial<React.ComponentProps<typeof Step1Roster>> = {}) {
  return {
    teachers,
    selectedTeacherId: null as string | null,
    setSelectedTeacherId: vi.fn(),
    editingTeacherId: null as string | null,
    setEditingTeacherId: vi.fn(),
    teacherName: "",
    setTeacherName: vi.fn(),
    teacherTarget: 4,
    setTeacherTarget: vi.fn(),
    teacherPriority: 1,
    setTeacherPriority: vi.fn(),
    handleSaveTeacher: vi.fn(),
    handleEditTeacherClick: vi.fn(),
    handleDeleteTeacher: vi.fn(),
    handleFileImport: vi.fn(),
    selectedYear: 2026,
    setSelectedYear: vi.fn(),
    selectedMonth: 10,
    setSelectedMonth: vi.fn(),
    availabilities: {},
    handleCycleAvailability: vi.fn(),
    ...overrides,
  };
}

describe("Step1Roster", () => {
  it("renders the step title and the teacher roster/import panels", () => {
    render(<Step1Roster {...baseProps()} />);
    expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument();
    expect(screen.getByText("Ahmet Yılmaz")).toBeInTheDocument();
    expect(screen.getByText("Excel / CSV Dosyası Yükle")).toBeInTheDocument();
  });

  it("shows an empty-selection placeholder when no teacher is selected", () => {
    render(<Step1Roster {...baseProps({ selectedTeacherId: null })} />);
    expect(screen.getByText("Öğretmen Seçilmedi")).toBeInTheDocument();
  });

  it("shows the availability calendar for the selected teacher instead of the placeholder", () => {
    render(<Step1Roster {...baseProps({ selectedTeacherId: "T1" })} />);
    expect(screen.queryByText("Öğretmen Seçilmedi")).not.toBeInTheDocument();
    // AvailabilityCalendar renders the teacher's name in its heading.
    expect(screen.getAllByText("Ahmet Yılmaz").length).toBeGreaterThan(0);
  });

  it("clicking a teacher in the roster list calls setSelectedTeacherId", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<Step1Roster {...props} />);
    await user.click(screen.getByText("Ahmet Yılmaz"));
    expect(props.setSelectedTeacherId).toHaveBeenCalledWith("T1");
  });

  it("has the title tooltip marked with the --title modifier (clipping fix)", () => {
    const { container } = render(<Step1Roster {...baseProps()} />);
    const titleTooltip = container.querySelector(".tooltip-container--title");
    expect(titleTooltip).toBeTruthy();
  });
});
