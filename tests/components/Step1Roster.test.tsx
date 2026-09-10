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
    monthLabel: "Ekim 2026",
    partnerGroups: [],
    monthlyTargets: {},
    onChangeGroups: vi.fn(),
    copyMonths: [],
    onCopyFromMonth: vi.fn(),
    ...overrides,
  };
}

describe("Step1Roster", () => {
  it("renders the step title and the teacher roster/import panels", () => {
    render(<Step1Roster {...baseProps()} />);
    expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument();
    // Appears twice once PartnerGroups is mounted: once in the roster list,
    // once in the group-membership checkbox list.
    expect(screen.getAllByText("Ahmet Yılmaz").length).toBeGreaterThan(0);
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
    // Scoped to the roster list's own select control — PartnerGroups also
    // renders the teacher's name (in its membership checkbox list), so a
    // plain text match would be ambiguous.
    await user.click(screen.getByRole("button", { name: "Ahmet Yılmaz öğretmenini seç" }));
    expect(props.setSelectedTeacherId).toHaveBeenCalledWith("T1");
  });

  it("has the title tooltip marked with the --title modifier (clipping fix)", () => {
    const { container } = render(<Step1Roster {...baseProps()} />);
    const titleTooltip = container.querySelector(".tooltip-container--title");
    expect(titleTooltip).toBeTruthy();
  });

  it("nöbet grupları kartını yan sütunda gösterir", () => {
    render(
      <Step1Roster
        {...baseProps({
          partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
        })}
      />
    );
    expect(screen.getByText(/Nöbet Grupları/i)).toBeInTheDocument();
    expect(screen.getByText(/2 gün/)).toBeInTheDocument();
  });

  // Task 9 made TeacherForm's monthLabel/usualTarget and TeacherList's
  // monthlyTargets/partnerGroups optional (with silent defaults "bu ay" /
  // null / {} / []) as a temporary bridge until this task wired real values
  // through. That bridge means a dropped prop here would compile clean and
  // every pre-existing test would stay green while the UI quietly showed
  // nothing new — so these assert the REAL, month-reflecting values actually
  // reach the two children, not their defaults.
  describe("threads real month context through to TeacherForm and TeacherList", () => {
    it("passes the real monthLabel to TeacherForm, not the 'bu ay' default", () => {
      render(<Step1Roster {...baseProps({ monthLabel: "Kasım 2026" })} />);
      expect(screen.getByText(/Aylık Nöbet Hedefi \(Kasım 2026\)/)).toBeInTheDocument();
      expect(screen.queryByText(/Aylık Nöbet Hedefi \(bu ay\)/)).not.toBeInTheDocument();
    });

    it("derives usualTarget for TeacherForm from the teacher being edited, not null", () => {
      const editTeachers: DbTeacher[] = [
        { id: "T1", name: "Ahmet Yılmaz", target_hours: 7, priority: 1 },
      ];
      render(
        <Step1Roster
          {...baseProps({
            teachers: editTeachers,
            editingTeacherId: "T1",
            teacherTarget: 3,
          })}
        />
      );
      // TeacherForm only prints this note when usualTarget !== null AND
      // usualTarget !== teacherTarget — it can only appear if the real
      // target_hours (7) reached the form, not the default null.
      expect(screen.getByText(/genel hedefi 7/i)).toBeInTheDocument();
    });

    it("passes this month's real partnerGroups and monthlyTargets to TeacherList, not the {}/[] defaults", () => {
      const groupTeachers: DbTeacher[] = [
        { id: "T1", name: "Ahmet Yılmaz", target_hours: 4, priority: 1 },
        { id: "T2", name: "Ayşe Demir", target_hours: 3, priority: 1 },
      ];
      render(
        <Step1Roster
          {...baseProps({
            teachers: groupTeachers,
            partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
            monthlyTargets: { T1: 2 },
          })}
        />
      );
      // T1's monthly override (2) makes the group fully account for the
      // month's target — this marker can only render if both partnerGroups
      // AND monthlyTargets reached TeacherList as real values.
      expect(screen.getByTitle(/tamamı gruplara ayrılmış/i)).toBeInTheDocument();
      expect(screen.getByText(/Hedef: 2 Nöbet/)).toBeInTheDocument();
    });
  });
});
