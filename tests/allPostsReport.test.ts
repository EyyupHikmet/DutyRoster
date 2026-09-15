import { describe, it, expect } from "vitest";
import { gatherAllPostsReports } from "../src/utils/allPostsReport";
import { freezeScheduleReport, ScheduleReport } from "../src/utils/scheduleReport";
import { DbSchedule, DbTeacher } from "../src/db";

// "Tüm nöbet yerlerini ekle" (#28): which schedules go into one report for
// every duty post. The post on screen brings the schedule on screen; every
// other post brings its saved schedule for the month, or is named as left out.

const posts = [
  { id: "kiz", name: "Kız Yurdu" },
  { id: "erkek", name: "Erkek Yurdu" },
  { id: "camlik", name: "Çamlık Binası" },
];

const teachers: DbTeacher[] = [
  { id: "K1", name: "Ayşe", target_hours: 3, priority: 1, post_id: "kiz" },
  { id: "E2", name: "Zeynep", target_hours: 2, priority: 1, post_id: "erkek" },
  { id: "E1", name: "Ali", target_hours: 2, priority: 1, post_id: "erkek" },
  { id: "C1", name: "Cengiz", target_hours: 1, priority: 1, post_id: "camlik" },
];

// Aralık 2026: the post on screen is Kız Yurdu.
const screenReport = freezeScheduleReport(
  {
    year: 2026, month: 12, postName: "Kız Yurdu",
    generatedSchedule: { "2026-12-01": ["K1"] },
    holidays: [], weekendDutyDays: [], extraDays: [],
    teachersPerDay: 1, daySpecificTeachers: {}, monthlyTargets: {},
  },
  teachers.filter((t) => t.post_id === "kiz")
);

const saved = (postId: string, year: number, month: number, overrides: Partial<DbSchedule> = {}): DbSchedule => ({
  id: `${postId}-${year}-${month}`,
  post_id: postId,
  year,
  month,
  assignments: JSON.stringify({ [`${year}-${String(month).padStart(2, "0")}-01`]: ["E1"] }),
  holidays: JSON.stringify(["2026-12-25"]),
  weekend_duty_days: JSON.stringify(["2026-12-05"]),
  config: JSON.stringify({ teachersPerDay: 2, daySpecificTeachers: { "2026-12-02": 3 }, extraDays: ["2026-12-05"], monthlyTargets: { E2: 4 } }),
  ...overrides,
});

const copy = (postId: string, postName: string, year: number, month: number, report: Partial<ScheduleReport> = {}) => ({
  post_id: postId,
  postName,
  year,
  month,
  report: { ...screenReport, year, month, postName, ...report },
});

const gather = (overrides: Partial<Parameters<typeof gatherAllPostsReports>[0]> = {}) =>
  gatherAllPostsReports({
    posts,
    screenPostId: "kiz",
    screenReport,
    schedules: [saved("erkek", 2026, 12)],
    teachers,
    earlierCopies: [],
    ...overrides,
  });

describe("gatherAllPostsReports", () => {
  it("uses the schedule on screen for its post, not the saved one", () => {
    const { reports } = gather({
      schedules: [saved("erkek", 2026, 12), saved("kiz", 2026, 12, { assignments: JSON.stringify({ "2026-12-09": ["K1"] }) })],
    });

    expect(reports.find((r) => r.postName === "Kız Yurdu")).toBe(screenReport);
  });

  it("freezes another post's saved month with its own teachers, targets and day settings", () => {
    const erkek = gather().reports.find((r) => r.postName === "Erkek Yurdu")!;

    expect(erkek).toEqual(
      freezeScheduleReport(
        {
          year: 2026, month: 12, postName: "Erkek Yurdu",
          generatedSchedule: { "2026-12-01": ["E1"] },
          holidays: ["2026-12-25"], weekendDutyDays: ["2026-12-05"], extraDays: ["2026-12-05"],
          teachersPerDay: 2, daySpecificTeachers: { "2026-12-02": 3 }, monthlyTargets: { E2: 4 },
        },
        teachers.filter((t) => t.post_id === "erkek")
      )
    );
    expect(erkek.teachers).toEqual([
      { id: "E1", name: "Ali", target: 2 },
      { id: "E2", name: "Zeynep", target: 4 },
    ]);
  });

  it("leaves out posts with no schedule for the month and names them", () => {
    const { reports, skippedPosts } = gather({
      schedules: [
        saved("erkek", 2026, 12),
        // Another month of Çamlık Binası is not a schedule for Aralık.
        saved("camlik", 2026, 11),
      ],
    });

    expect(reports.map((r) => r.postName)).toEqual(["Kız Yurdu", "Erkek Yurdu"]);
    expect(skippedPosts).toEqual(["Çamlık Binası"]);
  });

  it("leaves out a saved month with nothing assigned, or whose data cannot be read", () => {
    const { reports, skippedPosts } = gather({
      schedules: [
        saved("erkek", 2026, 12, { assignments: JSON.stringify({ "2026-12-01": [] }) }),
        saved("camlik", 2026, 12, { config: "{not json" }),
      ],
    });

    expect(reports).toEqual([screenReport]);
    expect(skippedPosts).toEqual(["Çamlık Binası", "Erkek Yurdu"]);
  });

  it("adds every post's approved copies from earlier in the school year", () => {
    const { reports } = gather({
      earlierCopies: [
        copy("erkek", "Erkek Yurdu", 2026, 11),
        copy("kiz", "Kız Yurdu", 2026, 9),
        copy("camlik", "Çamlık Binası", 2026, 10),
        // Not earlier in this school year: the working month itself, a later month, last school year.
        copy("erkek", "Erkek Yurdu", 2026, 12),
        copy("kiz", "Kız Yurdu", 2027, 1),
        copy("kiz", "Kız Yurdu", 2026, 8),
      ],
    });

    expect(reports.map((r) => `${r.postName} ${r.month}/${r.year}`)).toEqual([
      "Kız Yurdu 12/2026",
      "Erkek Yurdu 12/2026",
      "Erkek Yurdu 11/2026",
      "Çamlık Binası 10/2026",
      "Kız Yurdu 9/2026",
    ]);
  });

  it("names a copy approved before duty posts existed after its post", () => {
    const legacy = copy("kiz", "Kız Yurdu", 2026, 10, { postName: undefined });

    const { reports } = gather({ earlierCopies: [legacy] });

    expect(reports.find((r) => r.month === 10)?.postName).toBe("Kız Yurdu");
    expect(legacy.report.postName, "the stored copy is untouched").toBeUndefined();
  });
});
