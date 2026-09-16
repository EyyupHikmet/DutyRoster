import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import * as db from "../src/db";
import * as excelUtils from "../src/utils/excelUtils";
import { getDutyDates } from "../src/utils/dateUtils";
import { freezeScheduleReport, ScheduleReport } from "../src/utils/scheduleReport";

// Approving schedules, the approved schedules drawer, and including earlier
// approved schedules in the duty report, driven through App. The database and
// the file-writing export are mocked at App's boundary; their own behaviour is
// covered in db.test.ts, dutyReport.test.ts and excelUtils.test.ts.

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

const ahmet: db.DbTeacher = { id: "T1", name: "Ahmet", target_hours: 4, priority: 1, post_id: "yurt" };

/** A saved month with Ahmet on every duty day, unless `assignments` says otherwise. */
function monthRow(year: number, month: number, assignments?: Record<string, string[]>): db.DbSchedule {
  const full: Record<string, string[]> = {};
  for (const date of getDutyDates(year, month, [], [])) full[date] = ["T1"];
  return {
    id: `sched-${year}-${month}`,
    post_id: "yurt",
    year,
    month,
    assignments: JSON.stringify(assignments ?? full),
    holidays: "[]",
    weekend_duty_days: "[]",
    config: JSON.stringify({ mode: "fairness", teachersPerDay: 1, pinnedAssignments: {}, extraDays: [], daySpecificTeachers: {} }),
  };
}

/** The report the app freezes for a saved month. */
function reportOf(row: db.DbSchedule): ScheduleReport {
  return freezeScheduleReport(
    {
      year: row.year,
      month: row.month,
      postName: "Yurt",
      generatedSchedule: JSON.parse(row.assignments),
      holidays: [],
      weekendDutyDays: [],
      extraDays: [],
      teachersPerDay: 1,
      daySpecificTeachers: {},
      monthlyTargets: {},
    },
    [ahmet]
  );
}

/** An approved schedule of a saved month, approved on the 3rd of that month. */
function approved(row: db.DbSchedule, overrides: Partial<db.DbApprovedSchedule> = {}): db.DbApprovedSchedule {
  return {
    id: `approved-${row.year}-${row.month}`,
    schedule_id: row.id,
    post_id: row.post_id,
    year: row.year,
    month: row.month,
    approved_at: new Date(row.year, row.month - 1, 3, 10).toISOString(),
    report: JSON.stringify(reportOf(row)),
    ...overrides,
  };
}

const eylul = monthRow(2026, 9);
const kasim = monthRow(2026, 11);
const aralik = monthRow(2026, 12);

function savedMonths(...rows: db.DbSchedule[]) {
  mockedDb.getSchedule.mockImplementation(
    async (postId, year, month) =>
      rows.find((r) => r.post_id === postId && r.year === year && r.month === month) ?? null
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The app opens on the current month; make that Aralık 2026.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 11, 8));

  mockedDb.getDutyPosts.mockResolvedValue([{ id: "yurt", name: "Yurt" }]);
  mockedDb.getLastPostId.mockResolvedValue("yurt");
  mockedDb.getLanguage.mockResolvedValue(null);
  mockedDb.setLanguage.mockResolvedValue(undefined);
  mockedDb.setLastPostId.mockResolvedValue(undefined);
  mockedDb.getTeachers.mockResolvedValue([ahmet]);
  mockedDb.getAvailabilities.mockResolvedValue([]);
  mockedDb.getAllSchedules.mockResolvedValue([]);
  mockedDb.saveSchedule.mockImplementation(async (s) => `sched-${s.year}-${s.month}`);
  mockedDb.getApprovedSchedules.mockResolvedValue([]);
  mockedDb.approveSchedule.mockResolvedValue(undefined);
  mockedDb.deleteApprovedSchedule.mockResolvedValue(undefined);
  mockedDb.resetDb.mockResolvedValue(undefined);
  mockedExcel.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
  mockedExcel.exportDutyReport.mockResolvedValue({ status: "canceled" });
  savedMonths(aralik);
});

afterEach(() => {
  vi.useRealTimers();
});

async function openApp(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());
  return user;
}

/** Opens step 3 and returns the Onayla button once the saved schedule is on screen. */
async function openStep3(user: ReturnType<typeof userEvent.setup>) {
  await openApp(user);
  await user.click(screen.getByText("Planla & Dışa Aktar"));
  return screen.findByRole("button", { name: "Onayla" });
}

describe("approving a schedule", () => {
  it("saves the month and keeps a frozen copy of the schedule on screen", async () => {
    const user = userEvent.setup();

    await user.click(await openStep3(user));

    await waitFor(() => expect(mockedDb.approveSchedule).toHaveBeenCalledTimes(1));
    expect(mockedDb.saveSchedule).toHaveBeenCalled();
    const copy = mockedDb.approveSchedule.mock.calls[0][0];
    expect(copy).toMatchObject({ schedule_id: "sched-2026-12", year: 2026, month: 12 });
    expect(JSON.parse(copy.report)).toEqual(reportOf(aralik));
    expect(await screen.findByText("Aralık 2026 çizelgesi onaylandı.")).toBeInTheDocument();
  });

  it("asks first when the schedule has open slots", async () => {
    savedMonths(monthRow(2026, 12, { "2026-12-01": ["T1"] }));
    const user = userEvent.setup();

    await user.click(await openStep3(user));

    const dialog = await screen.findByRole("dialog", { name: "Çizelge Eksik" });
    expect(mockedDb.approveSchedule).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Yine de Onayla" }));
    await waitFor(() => expect(mockedDb.approveSchedule).toHaveBeenCalledTimes(1));
  });

  it("asks before replacing the schedule's earlier approved copy", async () => {
    mockedDb.getApprovedSchedules.mockResolvedValue([approved(aralik)]);
    const user = userEvent.setup();
    const onayla = await openStep3(user);
    await screen.findByText(/Onaylandı: 3 Aralık 2026/);

    await user.click(onayla);
    const dialog = await screen.findByRole("dialog", { name: "Onaylı Çizelgeyi Değiştir" });
    expect(dialog).toHaveTextContent("3 Aralık 2026");
    await user.click(within(dialog).getByRole("button", { name: "Vazgeç" }));
    expect(mockedDb.approveSchedule).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Onayla" }));
    const again = await screen.findByRole("dialog", { name: "Onaylı Çizelgeyi Değiştir" });
    await user.click(within(again).getByRole("button", { name: "Değiştir" }));
    await waitFor(() => expect(mockedDb.approveSchedule).toHaveBeenCalledTimes(1));
  });

  it("shows when the schedule was approved while it still matches", async () => {
    mockedDb.getApprovedSchedules.mockResolvedValue([approved(aralik)]);
    const user = userEvent.setup();

    await openStep3(user);

    expect(await screen.findByText(/Onaylandı: 3 Aralık 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Onaylandıktan sonra değişti/)).not.toBeInTheDocument();
  });

  it("tells when the schedule on screen no longer matches its approved copy", async () => {
    const olderVersion = monthRow(2026, 12, { "2026-12-01": ["T1"] });
    mockedDb.getApprovedSchedules.mockResolvedValue([approved(aralik, { report: JSON.stringify(reportOf(olderVersion)) })]);
    const user = userEvent.setup();

    await openStep3(user);

    expect(await screen.findByText(/Onaylandıktan sonra değişti/)).toBeInTheDocument();
  });
});

describe("including earlier approved schedules in the export", () => {
  const checkbox = () => screen.findByRole("checkbox", { name: /Önceki onaylı çizelgeleri ekle/ });

  it("is disabled, with the reason, when the school year has no earlier approved schedules", async () => {
    // Ağustos 2026 belongs to the previous school year.
    mockedDb.getApprovedSchedules.mockResolvedValue([approved(monthRow(2026, 8))]);
    const user = userEvent.setup();

    await openStep3(user);

    const box = await checkbox();
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(await screen.findByText("Bu eğitim-öğretim yılında önceki onaylı çizelge yok")).toBeInTheDocument();
  });

  it("is checked by default, says how many it adds, and passes them to the export", async () => {
    mockedDb.getApprovedSchedules.mockResolvedValue([approved(kasim), approved(eylul)]);
    const user = userEvent.setup();
    await openStep3(user);

    const box = await checkbox();
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toBeChecked();
    expect(screen.getByText("2 onaylı çizelge eklenecek")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Excel'e Aktar/ }));

    await waitFor(() => expect(mockedExcel.exportScheduleToExcel).toHaveBeenCalledTimes(1));
    expect(mockedExcel.exportScheduleToExcel.mock.calls[0][9]).toEqual([reportOf(kasim), reportOf(eylul)]);
  });

  it("exports the working month alone once unchecked", async () => {
    mockedDb.getApprovedSchedules.mockResolvedValue([approved(kasim), approved(eylul)]);
    const user = userEvent.setup();
    await openStep3(user);
    const box = await checkbox();
    await waitFor(() => expect(box).toBeEnabled());

    await user.click(box);
    await user.click(screen.getByRole("button", { name: /Excel'e Aktar/ }));

    await waitFor(() => expect(mockedExcel.exportScheduleToExcel).toHaveBeenCalledTimes(1));
    expect(mockedExcel.exportScheduleToExcel.mock.calls[0][9]).toEqual([]);
  });
});

describe("the approved schedules drawer", () => {
  async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
    await openApp(user);
    await user.click(screen.getByRole("button", { name: "Onaylı Çizelgeler" }));
    const drawer = await screen.findByRole("complementary", { name: "Onaylı Çizelgeler" });
    await within(drawer).findByText("Kasım 2026");
    return drawer;
  }

  beforeEach(() => {
    mockedDb.getApprovedSchedules.mockResolvedValue([approved(kasim), approved(eylul)]);
  });

  it("lists approved schedules and finds them by month name, ignoring Turkish marks", async () => {
    const user = userEvent.setup();
    const drawer = await openDrawer(user);
    expect(within(drawer).getByText("Eylül 2026")).toBeInTheDocument();

    await user.type(within(drawer).getByRole("searchbox", { name: "Onaylı çizelge ara" }), "kasim");

    expect(within(drawer).getByText("Kasım 2026")).toBeInTheDocument();
    expect(within(drawer).queryByText("Eylül 2026")).not.toBeInTheDocument();
  });

  it("exports one approved schedule on its own", async () => {
    const user = userEvent.setup();
    const drawer = await openDrawer(user);

    await user.click(within(drawer).getByRole("button", { name: "Kasım 2026 çizelgesini Excel'e aktar" }));

    await waitFor(() => expect(mockedExcel.exportDutyReport).toHaveBeenCalledTimes(1));
    expect(mockedExcel.exportDutyReport.mock.calls[0][0]).toEqual([reportOf(kasim)]);
  });

  it("deletes an approved schedule only after its name is typed", async () => {
    const user = userEvent.setup();
    const drawer = await openDrawer(user);

    await user.click(within(drawer).getByRole("button", { name: "Kasım 2026 çizelgesini sil" }));

    const dialog = await screen.findByRole("dialog", { name: "Onaylı Çizelgeyi Sil" });
    const sil = within(dialog).getByRole("button", { name: "Sil" });
    const input = within(dialog).getByRole("textbox");
    expect(sil).toBeDisabled();

    await user.type(input, "Eylül 2026");
    expect(sil).toBeDisabled();

    await user.clear(input);
    await user.type(input, "Kasım 2026");
    expect(sil).toBeEnabled();

    await user.click(sil);
    await waitFor(() => expect(mockedDb.deleteApprovedSchedule).toHaveBeenCalledWith("approved-2026-11"));
  });
});

describe("resetting the database", () => {
  async function openResetDialog(user: ReturnType<typeof userEvent.setup>) {
    await openApp(user);
    await user.click(screen.getByTitle("Sistem ve Erişilebilirlik Ayarları"));
    await user.click(screen.getByRole("button", { name: /Veritabanını Sıfırla/ }));
    return screen.findByRole("dialog", { name: "Sistemi ve Veritabanını Sıfırla" });
  }

  it("keeps approved schedules by default", async () => {
    const user = userEvent.setup();
    const dialog = await openResetDialog(user);

    expect(within(dialog).getByRole("checkbox", { name: "Onaylı çizelgeleri de sil" })).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Evet, Tümünü Sıfırla" }));

    await waitFor(() => expect(mockedDb.resetDb).toHaveBeenCalledWith({ includeApproved: false }));
  });

  it("deletes approved schedules too when asked", async () => {
    const user = userEvent.setup();
    const dialog = await openResetDialog(user);

    await user.click(within(dialog).getByRole("checkbox", { name: "Onaylı çizelgeleri de sil" }));
    await user.click(within(dialog).getByRole("button", { name: "Evet, Tümünü Sıfırla" }));

    await waitFor(() => expect(mockedDb.resetDb).toHaveBeenCalledWith({ includeApproved: true }));
  });
});
