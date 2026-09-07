import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AvailabilityCalendar } from "../../src/components/AvailabilityCalendar";
import { DbTeacher } from "../../src/db";

const teachers: DbTeacher[] = [{ id: "T1", name: "Ahmet Yılmaz", target_hours: 4, priority: 1 }];

describe("AvailabilityCalendar", () => {
  it("shows the selected teacher's name and defaults unset days to 'Uygun'", () => {
    render(
      <AvailabilityCalendar
        teachers={teachers}
        selectedTeacherId="T1"
        availabilities={{}}
        selectedYear={2026}
        setSelectedYear={() => {}}
        selectedMonth={10}
        setSelectedMonth={() => {}}
        onCycleAvailability={() => {}}
      />
    );
    expect(screen.getByText("Ahmet Yılmaz")).toBeInTheDocument();
    expect(screen.getAllByText("Uygun").length).toBeGreaterThan(0);
  });

  it("renders status badges reflecting the availabilities map (preferred/unavailable)", () => {
    render(
      <AvailabilityCalendar
        teachers={teachers}
        selectedTeacherId="T1"
        availabilities={{ T1: { "2026-10-01": "preferred", "2026-10-02": "unavailable" } }}
        selectedYear={2026}
        setSelectedYear={() => {}}
        selectedMonth={10}
        setSelectedMonth={() => {}}
        onCycleAvailability={() => {}}
      />
    );
    expect(screen.getAllByText("Tercih").length).toBeGreaterThan(0);
    expect(screen.getAllByText("İzinli").length).toBeGreaterThan(0);
  });

  it("clicking a day cell calls onCycleAvailability with that date's YYYY-MM-DD string", async () => {
    const user = userEvent.setup();
    const onCycleAvailability = vi.fn();
    render(
      <AvailabilityCalendar
        teachers={teachers}
        selectedTeacherId="T1"
        availabilities={{}}
        selectedYear={2026}
        setSelectedYear={() => {}}
        selectedMonth={10}
        setSelectedMonth={() => {}}
        onCycleAvailability={onCycleAvailability}
      />
    );
    // Oct 1, 2026 renders "1" as its date number.
    await user.click(screen.getByText("1"));
    expect(onCycleAvailability).toHaveBeenCalledWith("2026-10-01");
  });
});
