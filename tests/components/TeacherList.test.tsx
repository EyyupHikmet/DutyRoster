import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeacherList } from "../../src/components/TeacherList";
import { DbTeacher } from "../../src/db";

const teachers: DbTeacher[] = [
  { id: "T1", name: "Ahmet Yılmaz", target_hours: 4, priority: 1 },
  { id: "T2", name: "Zeynep Çelik", target_hours: 6, priority: 3 },
];

function renderList(overrides: Partial<React.ComponentProps<typeof TeacherList>> = {}) {
  const props = {
    teachers,
    selectedTeacherId: null as string | null,
    onSelectTeacher: vi.fn(),
    onEditTeacher: vi.fn(),
    onDeleteTeacher: vi.fn(),
    monthlyTargets: {} as Record<string, number>,
    partnerGroups: [],
    ...overrides,
  };
  render(<TeacherList {...props} />);
  return props;
}

describe("TeacherList", () => {
  it("shows an empty-state message when there are no teachers", () => {
    render(
      <TeacherList
        teachers={[]}
        selectedTeacherId={null}
        onSelectTeacher={() => {}}
        onEditTeacher={() => {}}
        onDeleteTeacher={() => {}}
        monthlyTargets={{}}
        partnerGroups={[]}
      />
    );
    expect(screen.getByText(/henüz öğretmen kayıtlı değil/i)).toBeInTheDocument();
  });

  it("renders every teacher with name, target hours, and Turkish priority label", () => {
    render(
      <TeacherList
        teachers={teachers}
        selectedTeacherId={null}
        onSelectTeacher={() => {}}
        onEditTeacher={() => {}}
        onDeleteTeacher={() => {}}
        monthlyTargets={{}}
        partnerGroups={[]}
      />
    );
    expect(screen.getByText("Ahmet Yılmaz")).toBeInTheDocument();
    expect(screen.getByText("Zeynep Çelik")).toBeInTheDocument();
    expect(screen.getByText(/Hedef: 4 Nöbet \| Kıdem: Standart/)).toBeInTheDocument();
    expect(screen.getByText(/Hedef: 6 Nöbet \| Kıdem: Yüksek/)).toBeInTheDocument();
    expect(screen.getByText("Öğretmen Kadrosu (2)")).toBeInTheDocument();
  });

  it("clicking a teacher row calls onSelectTeacher with its id", async () => {
    const user = userEvent.setup();
    const onSelectTeacher = vi.fn();
    render(
      <TeacherList
        teachers={teachers}
        selectedTeacherId={null}
        onSelectTeacher={onSelectTeacher}
        onEditTeacher={() => {}}
        onDeleteTeacher={() => {}}
        monthlyTargets={{}}
        partnerGroups={[]}
      />
    );
    await user.click(screen.getByText("Ahmet Yılmaz"));
    expect(onSelectTeacher).toHaveBeenCalledWith("T1");
  });

  it("clicking edit/delete buttons calls their handlers and does NOT bubble into onSelectTeacher", async () => {
    const user = userEvent.setup();
    const onSelectTeacher = vi.fn();
    const onEditTeacher = vi.fn();
    const onDeleteTeacher = vi.fn();
    render(
      <TeacherList
        teachers={teachers}
        selectedTeacherId={null}
        onSelectTeacher={onSelectTeacher}
        onEditTeacher={onEditTeacher}
        onDeleteTeacher={onDeleteTeacher}
        monthlyTargets={{}}
        partnerGroups={[]}
      />
    );

    await user.click(screen.getAllByTitle("Düzenle")[0]);
    expect(onEditTeacher).toHaveBeenCalledWith(teachers[0]);
    expect(onSelectTeacher).not.toHaveBeenCalled();

    await user.click(screen.getAllByTitle("Sil")[1]);
    expect(onDeleteTeacher).toHaveBeenCalledWith("T2");
    expect(onSelectTeacher).not.toHaveBeenCalled();
  });

  it("öğretmenin bu aya ait hedefini gösterir", () => {
    renderList({
      teachers: [{ id: "T1", name: "Ali", target_hours: 4, priority: 1 }],
      monthlyTargets: { T1: 6 },
      partnerGroups: [],
    });
    expect(screen.getByText(/Hedef: 6/)).toBeInTheDocument();
  });

  it("hedefi gruplara tamamen bağlanmış öğretmeni işaretler", () => {
    renderList({
      teachers: [{ id: "T1", name: "Ali", target_hours: 2, priority: 1 }],
      monthlyTargets: {},
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
    });
    expect(screen.getByTitle(/tamamı gruplara ayrılmış/i)).toBeInTheDocument();
  });
});
