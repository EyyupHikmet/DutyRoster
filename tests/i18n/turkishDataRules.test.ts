import { describe, it, expect, afterEach } from "vitest";
import { i18n } from "../../src/i18n";
import { freezeScheduleReport } from "../../src/utils/scheduleReport";
import { searchApprovedSchedules } from "../../src/utils/approvedSchedules";
import { findNameConflict, sameTeacherName } from "../../src/utils/teacherNames";
import { foldForSearch, foldName } from "../../src/utils/turkishText";
import { DbTeacher } from "../../src/db";

// Teacher and duty post names are Turkish whatever the interface speaks, so
// sorting, folding and matching stay Turkish when the language is English
// (AGENTS.md, "Turkish text"). English collation would sort Ç after Z and fold
// "İ" to "i̇", which would reorder the staff and break name matching.

const teacher = (id: string, name: string): DbTeacher => ({
  id,
  name,
  target_hours: 4,
  priority: 1,
  post_id: "yurt",
});

const month = (teachers: DbTeacher[]) =>
  freezeScheduleReport(
    {
      year: 2026,
      month: 9,
      generatedSchedule: {},
      holidays: [],
      weekendDutyDays: [],
      extraDays: [],
      teachersPerDay: 1,
      daySpecificTeachers: {},
      monthlyTargets: {},
    },
    teachers
  );

afterEach(async () => {
  await i18n.changeLanguage("tr");
});

describe("with the interface in English", () => {
  const staff = [teacher("T1", "Davut"), teacher("T2", "Çağlar"), teacher("T3", "Cengiz"), teacher("T4", "Işıl")];

  it("still orders names the Turkish way", async () => {
    const inTurkish = month(staff).teachers.map((t) => t.name);
    await i18n.changeLanguage("en");

    expect(month(staff).teachers.map((t) => t.name), "C, Ç, D, I — not C, D, I, Ç").toEqual([
      "Cengiz",
      "Çağlar",
      "Davut",
      "Işıl",
    ]);
    expect(month(staff).teachers.map((t) => t.name)).toEqual(inTurkish);
  });

  it("still folds Turkish marks when searching a duty post's name", async () => {
    const copies = [
      { year: 2026, month: 11, postName: "Kız Yurdu" },
      { year: 2026, month: 12, postName: "Erkek Yurdu" },
    ];

    expect(searchApprovedSchedules(copies, "kasim").map((c) => c.month), "kasim finds Kasım").toEqual([11]);
    await i18n.changeLanguage("en");

    // A post's name is data: it is Turkish on screen in either language, and
    // still found by typing it without its marks.
    expect(searchApprovedSchedules(copies, "KIZ").map((c) => c.postName)).toEqual(["Kız Yurdu"]);
    expect(foldForSearch("İSTANBUL")).toBe(foldForSearch("istanbul"));
    // The month, though, is searched as the interface shows it.
    expect(searchApprovedSchedules(copies, "november").map((c) => c.month)).toEqual([11]);
    expect(searchApprovedSchedules(copies, "kasim")).toEqual([]);
  });

  it("still tells two teacher names apart exactly as Turkish does", async () => {
    await i18n.changeLanguage("en");

    expect(sameTeacherName("Şule", "Sule"), "marks are part of the name").toBe(false);
    expect(sameTeacherName("AYŞE YILMAZ", "ayşe yılmaz"), "case is not").toBe(true);
    expect(findNameConflict("ışıl", [teacher("T9", "Işıl")])?.name).toBe("Işıl");
    expect(foldName("İSMAİL")).toBe(foldName("ismail"));
  });
});
