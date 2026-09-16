import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import * as db from "../src/db";
import * as excelUtils from "../src/utils/excelUtils";
import { getDutyDates } from "../src/utils/dateUtils";
import { freezeScheduleReport, ScheduleReport } from "../src/utils/scheduleReport";

// "Tüm nöbet yerlerini ekle" (#28) through App: one duty report for every
// duty post. The database and the file-writing export are mocked at App's
// boundary; the workbook is covered in dutyReport.test.ts and the choice of
// schedules in allPostsReport.test.ts.

vi.mock("../src/db", () => ({
  getTeachers: vi.fn(),
  saveTeacher: vi.fn(),
  deleteTeacher: vi.fn(),
  getAvailabilities: vi.fn(),
  saveAvailability: vi.fn(),
  getSchedule: vi.fn(),
  saveSchedule: vi.fn(),
  getAllSchedules: vi.fn(),
  resetDb: vi.fn(),
  getApprovedSchedules: vi.fn(),
  approveSchedule: vi.fn(),
  deleteApprovedSchedule: vi.fn(),
  getDutyPosts: vi.fn(),
  addDutyPost: vi.fn(),
  renameDutyPost: vi.fn(),
  deleteDutyPost: vi.fn(),
  getLastPostId: vi.fn(),
  setLastPostId: vi.fn(),
  moveTeacherToPost: vi.fn(),
  getLanguage: vi.fn(),
  setLanguage: vi.fn(),
}));

vi.mock("../src/utils/excelUtils", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/excelUtils")>("../src/utils/excelUtils");
  return { ...actual, exportScheduleToExcel: vi.fn(), exportDutyReport: vi.fn() };
});

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
  openUrl: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedExcel = vi.mocked(excelUtils);

const kiz = { id: "kiz", name: "Kız Yurdu" };
const erkek = { id: "erkek", name: "Erkek Yurdu" };
const camlik = { id: "camlik", name: "Çamlık Binası" };

const teachers: db.DbTeacher[] = [
  { id: "K1", name: "Ayşe", target_hours: 4, priority: 1, post_id: "kiz" },
  { id: "E1", name: "Ali", target_hours: 4, priority: 1, post_id: "erkek" },
  { id: "C1", name: "Cengiz", target_hours: 4, priority: 1, post_id: "camlik" },
];

/** A saved month of a post with its teacher on every duty day, unless `assignments` says otherwise. */
function monthRow(post: db.DbDutyPost, teacherId: string, year: number, month: number, assignments?: Record<string, string[]>): db.DbSchedule {
  const full: Record<string, string[]> = {};
  for (const date of getDutyDates(year, month, [], [])) full[date] = [teacherId];
  return {
    id: `${post.id}-${year}-${month}`,
    post_id: post.id,
    year,
    month,
    assignments: JSON.stringify(assignments ?? full),
    holidays: "[]",
    weekend_duty_days: "[]",
    config: JSON.stringify({ mode: "fairness", teachersPerDay: 1, pinnedAssignments: {}, extraDays: [], daySpecificTeachers: {} }),
  };
}

/** The report of a saved month, as the app freezes it. */
function reportOf(post: db.DbDutyPost, row: db.DbSchedule): ScheduleReport {
  return freezeScheduleReport(
    {
      year: row.year, month: row.month, postName: post.name,
      generatedSchedule: JSON.parse(row.assignments),
      holidays: [], weekendDutyDays: [], extraDays: [],
      teachersPerDay: 1, daySpecificTeachers: {}, monthlyTargets: {},
    },
    teachers.filter((t) => t.post_id === post.id)
  );
}

function approved(post: db.DbDutyPost, row: db.DbSchedule): db.DbApprovedSchedule {
  return {
    id: `approved-${row.id}`,
    schedule_id: row.id,
    post_id: post.id,
    year: row.year,
    month: row.month,
    approved_at: new Date(row.year, row.month - 1, 3, 10).toISOString(),
    report: JSON.stringify(reportOf(post, row)),
  };
}

const kizAralik = monthRow(kiz, "K1", 2026, 12);
const erkekAralik = monthRow(erkek, "E1", 2026, 12);
const erkekKasim = monthRow(erkek, "E1", 2026, 11);

function world(posts: db.DbDutyPost[], rows: db.DbSchedule[]) {
  mockedDb.getDutyPosts.mockResolvedValue(posts);
  mockedDb.getSchedule.mockImplementation(
    async (postId, year, month) => rows.find((r) => r.post_id === postId && r.year === year && r.month === month) ?? null
  );
  mockedDb.getAllSchedules.mockImplementation(async (postId) => rows.filter((r) => !postId || r.post_id === postId));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The app opens on the current month; make that Aralık 2026.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 11, 8));

  mockedDb.getLastPostId.mockResolvedValue("kiz");
  mockedDb.getLanguage.mockResolvedValue(null);
  mockedDb.setLanguage.mockResolvedValue(undefined);
  mockedDb.setLastPostId.mockResolvedValue(undefined);
  mockedDb.getTeachers.mockImplementation(async (postId) => teachers.filter((t) => !postId || t.post_id === postId));
  mockedDb.getAvailabilities.mockResolvedValue([]);
  mockedDb.saveSchedule.mockImplementation(async (s) => `${s.post_id}-${s.year}-${s.month}`);
  mockedDb.getApprovedSchedules.mockResolvedValue([]);
  mockedExcel.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
  mockedExcel.exportDutyReport.mockResolvedValue({ status: "canceled" });
  world([camlik, erkek, kiz], [kizAralik, erkekAralik]);
});

afterEach(() => {
  vi.useRealTimers();
});

const allPostsBox = () => screen.findByRole("checkbox", { name: /Tüm nöbet yerlerini ekle/ });

/** Opens step 3 once Kız Yurdu's saved schedule is on screen. */
async function openStep3() {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());
  await user.click(screen.getByText("Planla & Dışa Aktar"));
  await screen.findByRole("button", { name: /Excel'e Aktar/ });
  return user;
}

describe("exporting one duty report for every duty post", () => {
  it("is disabled, with the reason, when there is only one duty post", async () => {
    world([kiz], [kizAralik]);
    await openStep3();

    const box = await allPostsBox();
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByText("Başka nöbet yeri yok")).toBeInTheDocument();
  });

  it("is off by default, so Excel'e Aktar still exports the post on screen alone", async () => {
    const user = await openStep3();

    const box = await allPostsBox();
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: /Excel'e Aktar/ }));

    await waitFor(() => expect(mockedExcel.exportScheduleToExcel).toHaveBeenCalledTimes(1));
    expect(mockedExcel.exportDutyReport).not.toHaveBeenCalled();
  });

  it("exports the schedule on screen with every post's saved schedule and earlier approved ones", async () => {
    world([camlik, erkek, kiz], [kizAralik, erkekAralik, monthRow(camlik, "C1", 2026, 12)]);
    mockedDb.getApprovedSchedules.mockResolvedValue([approved(erkek, erkekKasim)]);
    const user = await openStep3();

    const box = await allPostsBox();
    await waitFor(() => expect(box).toBeEnabled());
    // The earlier approved schedules box is disabled until another post's copies count.
    const earlier = screen.getByRole("checkbox", { name: /Önceki onaylı çizelgeleri ekle/ });
    expect(earlier).toBeDisabled();

    await user.click(box);
    expect(screen.getByText("3 nöbet yeri tek raporda")).toBeInTheDocument();
    await waitFor(() => expect(earlier).toBeEnabled());
    expect(screen.getByText("1 onaylı çizelge eklenecek")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Excel'e Aktar/ }));

    await waitFor(() => expect(mockedExcel.exportDutyReport).toHaveBeenCalledTimes(1));
    const [reports, , options] = mockedExcel.exportDutyReport.mock.calls[0];
    expect(options).toEqual({ allPosts: true });
    expect(reports).toEqual([
      reportOf(kiz, kizAralik),
      reportOf(camlik, monthRow(camlik, "C1", 2026, 12)),
      reportOf(erkek, erkekAralik),
      reportOf(erkek, erkekKasim),
    ]);
    expect(mockedExcel.exportScheduleToExcel).not.toHaveBeenCalled();
  });

  it("names every post with gaps and every post left out before exporting", async () => {
    world([camlik, erkek, kiz], [kizAralik, monthRow(erkek, "E1", 2026, 12, { "2026-12-01": ["E1"] })]);
    const user = await openStep3();
    const box = await allPostsBox();
    await waitFor(() => expect(box).toBeEnabled());

    await user.click(box);
    await user.click(screen.getByRole("button", { name: /Excel'e Aktar/ }));

    const dialog = await screen.findByRole("dialog", { name: "Çizelge Eksik" });
    const openDays = getDutyDates(2026, 12, [], []).length - 1;
    expect(within(dialog).getByText(`Erkek Yurdu: ${openDays} gün eksik, ${openDays} boş slot`)).toBeInTheDocument();
    expect(within(dialog).getByText("Çamlık Binası: bu ay için çizelge yok, rapora eklenmedi.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Kız Yurdu/)).not.toBeInTheDocument();
    expect(mockedExcel.exportDutyReport).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Yine de Aktar" }));

    await waitFor(() => expect(mockedExcel.exportDutyReport).toHaveBeenCalledTimes(1));
    expect(mockedExcel.exportDutyReport.mock.calls[0][0].map((r) => r.postName)).toEqual(["Kız Yurdu", "Erkek Yurdu"]);
  });
});
