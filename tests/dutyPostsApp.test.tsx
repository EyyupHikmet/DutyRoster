import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import * as db from "../src/db";
import * as excelUtils from "../src/utils/excelUtils";
import { getDutyDates } from "../src/utils/dateUtils";

// Duty posts driven through App (ADR-0007): the post menu in the header, the post's
// name on steps 2 and 3, copying day settings between posts, moving a teacher,
// and approval and export staying within a post. The database is mocked at
// App's boundary; its own behaviour is covered in db.test.ts.

vi.mock("../src/db", () => ({
  getTeachers: vi.fn(),
  saveTeacher: vi.fn(),
  deleteTeacher: vi.fn(),
  moveTeacherToPost: vi.fn(),
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

const erkek: db.DbDutyPost = { id: "erkek", name: "Erkek Yurdu" };
const kiz: db.DbDutyPost = { id: "kiz", name: "Kız Yurdu" };
const ayse: db.DbTeacher = { id: "T1", name: "Ayşe Yılmaz", target_hours: 4, priority: 1, post_id: "erkek" };
const burak: db.DbTeacher = { id: "T2", name: "Burak Demir", target_hours: 4, priority: 1, post_id: "kiz" };

/** A post's saved Aralık 2026, with its one teacher on every duty day. */
function aralikOf(postId: string, teacherId: string, holidays: string[] = []): db.DbSchedule {
  const assignments: Record<string, string[]> = {};
  for (const date of getDutyDates(2026, 12, holidays, [])) assignments[date] = [teacherId];
  return {
    id: `sched-${postId}`,
    post_id: postId,
    year: 2026,
    month: 12,
    assignments: JSON.stringify(assignments),
    holidays: JSON.stringify(holidays),
    weekend_duty_days: "[]",
    config: JSON.stringify({ mode: "fairness", teachersPerDay: 1, extraDays: [] }),
  };
}

/** An approved Kasım 2026 of a post, with the post's name frozen in it. */
function approvedKasim(postId: string, postName: string): db.DbApprovedSchedule {
  return {
    id: `approved-${postId}`,
    schedule_id: `kasim-${postId}`,
    post_id: postId,
    year: 2026,
    month: 11,
    approved_at: new Date(2026, 10, 3, 10).toISOString(),
    report: JSON.stringify({
      year: 2026, month: 11, postName, teachers: [], assignments: {},
      holidays: [], weekendDutyDays: [], extraDays: [], requiredCounts: {},
    }),
  };
}

let posts: db.DbDutyPost[];
const savedMonths = () => [aralikOf("erkek", "T1"), aralikOf("kiz", "T2", ["2026-12-01"])];

beforeEach(() => {
  vi.clearAllMocks();
  // The app opens on the current month; make that Aralık 2026.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 11, 8));

  posts = [erkek, kiz];
  mockedDb.getDutyPosts.mockImplementation(async () => [...posts]);
  mockedDb.getLastPostId.mockResolvedValue("erkek");
  mockedDb.setLastPostId.mockResolvedValue(undefined);
  mockedDb.addDutyPost.mockResolvedValue({ status: "empty" });
  mockedDb.renameDutyPost.mockResolvedValue({ status: "renamed" });
  mockedDb.deleteDutyPost.mockResolvedValue({ status: "deleted" });
  mockedDb.getTeachers.mockResolvedValue([ayse, burak]);
  mockedDb.saveTeacher.mockResolvedValue(undefined);
  mockedDb.moveTeacherToPost.mockResolvedValue(undefined);
  mockedDb.getAvailabilities.mockResolvedValue([]);
  mockedDb.getSchedule.mockImplementation(
    async (postId, year, month) =>
      savedMonths().find((r) => r.post_id === postId && r.year === year && r.month === month) ?? null
  );
  mockedDb.getAllSchedules.mockImplementation(async (postId?: string) =>
    savedMonths().filter((r) => !postId || r.post_id === postId)
  );
  mockedDb.saveSchedule.mockImplementation(async (s) => s.id);
  mockedDb.getApprovedSchedules.mockResolvedValue([]);
  mockedDb.approveSchedule.mockResolvedValue(undefined);
  mockedExcel.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
});

afterEach(() => {
  vi.useRealTimers();
});

async function openApp() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText("Öğretmen Kadrosu (1)");
  return user;
}

async function openPostMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Nöbet yeri: / }));
  return screen.findByRole("menu", { name: "Nöbet yerleri" });
}

describe("choosing a duty post", () => {
  it("opens on the last selected post and shows only its staff", async () => {
    await openApp();

    expect(screen.getByRole("button", { name: "Nöbet yeri: Erkek Yurdu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ayşe Yılmaz öğretmenini seç" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Burak Demir öğretmenini seç" })).not.toBeInTheDocument();
    expect(mockedDb.getSchedule).toHaveBeenCalledWith("erkek", 2026, 12);
  });

  it("keeps the post menu on every step, like the approved schedules button", async () => {
    const user = await openApp();

    for (const step of ["Ay Seçimi & Özel Günler", "Planla & Dışa Aktar", "Kadro & Uygunluk"]) {
      await user.click(screen.getByText(step));
      expect(await screen.findByRole("button", { name: "Nöbet yeri: Erkek Yurdu" })).toBeInTheDocument();
    }
  });

  it("switches post from a later step too", async () => {
    const user = await openApp();
    await user.click(screen.getByText("Planla & Dışa Aktar"));

    const menu = await openPostMenu(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: "Kız Yurdu" }));

    expect(await screen.findByRole("heading", { name: /Adım 3.*Kız Yurdu/ })).toBeInTheDocument();
    expect(mockedDb.getSchedule).toHaveBeenCalledWith("kiz", 2026, 12);
  });

  it("switches to another post from the menu and remembers it", async () => {
    const user = await openApp();

    const menu = await openPostMenu(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: "Kız Yurdu" }));

    expect(await screen.findByRole("button", { name: "Burak Demir öğretmenini seç" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ayşe Yılmaz öğretmenini seç" })).not.toBeInTheDocument();
    expect(mockedDb.getSchedule).toHaveBeenCalledWith("kiz", 2026, 12);
    expect(mockedDb.setLastPostId).toHaveBeenCalledWith("kiz");
  });

  it("asks before leaving a post with unsaved changes", async () => {
    const user = await openApp();
    await user.click(screen.getByText("Ay Seçimi & Özel Günler"));
    const days = await screen.findAllByRole("button", { name: /nöbet günü\.|tatil\./ });
    await user.click(days[0]);
    await user.click(screen.getByText("Kadro & Uygunluk"));

    const menu = await openPostMenu(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: "Kız Yurdu" }));

    const dialog = await screen.findByRole("dialog", { name: "Kaydedilmemiş Değişiklikler" });
    await user.click(within(dialog).getByRole("button", { name: "İptal Et" }));
    expect(screen.getByRole("button", { name: "Nöbet yeri: Erkek Yurdu" })).toBeInTheDocument();
    expect(mockedDb.getSchedule).not.toHaveBeenCalledWith("kiz", 2026, 12);
  });

  it("adds a post, saying so when the name is taken, and switches to it", async () => {
    mockedDb.addDutyPost.mockImplementation(async (name) => {
      if (name.trim().toLocaleLowerCase("tr") === "kız yurdu") return { status: "duplicate", existing: kiz };
      const post = { id: "cam", name: name.trim() };
      posts.push(post);
      return { status: "added", post };
    });
    const user = await openApp();

    const menu = await openPostMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Nöbet yeri ekle" }));
    const dialog = await screen.findByRole("dialog", { name: "Nöbet Yeri Ekle" });
    const input = within(dialog).getByRole("textbox", { name: "Nöbet yerinin adı" });

    await user.type(input, "kız yurdu");
    await user.click(within(dialog).getByRole("button", { name: "Ekle" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("“Kız Yurdu” adında bir nöbet yeri zaten var.");

    await user.clear(input);
    await user.type(input, "Çamlık Binası");
    await user.click(within(dialog).getByRole("button", { name: "Ekle" }));

    expect(await screen.findByRole("button", { name: "Nöbet yeri: Çamlık Binası" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Nöbet Yeri Ekle" })).not.toBeInTheDocument();
  });

  it("renames the selected post", async () => {
    mockedDb.renameDutyPost.mockImplementation(async (id, name) => {
      posts = posts.map((p) => (p.id === id ? { ...p, name } : p));
      return { status: "renamed" };
    });
    const user = await openApp();

    const menu = await openPostMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Adını değiştir" }));
    const dialog = await screen.findByRole("dialog", { name: "Nöbet Yerini Yeniden Adlandır" });
    const input = within(dialog).getByRole("textbox", { name: "Nöbet yerinin adı" });
    expect(input).toHaveValue("Erkek Yurdu");

    await user.clear(input);
    await user.type(input, "Erkek Pansiyonu");
    await user.click(within(dialog).getByRole("button", { name: "Kaydet" }));

    expect(await screen.findByRole("button", { name: "Nöbet yeri: Erkek Pansiyonu" })).toBeInTheDocument();
    expect(mockedDb.renameDutyPost).toHaveBeenCalledWith("erkek", "Erkek Pansiyonu");
  });

  it("deletes a post only after its name is typed", async () => {
    mockedDb.deleteDutyPost.mockImplementation(async (id) => {
      posts = posts.filter((p) => p.id !== id);
      return { status: "deleted" };
    });
    const user = await openApp();

    const menu = await openPostMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Nöbet yerini sil" }));
    const dialog = await screen.findByRole("dialog", { name: "Nöbet Yerini Sil" });
    const sil = within(dialog).getByRole("button", { name: "Sil" });
    expect(sil).toBeDisabled();

    await user.type(within(dialog).getByRole("textbox"), "Erkek Yurdu");
    await user.click(sil);

    await waitFor(() => expect(mockedDb.deleteDutyPost).toHaveBeenCalledWith("erkek"));
    expect(await screen.findByRole("button", { name: "Nöbet yeri: Kız Yurdu" })).toBeInTheDocument();
  });

  it("does not offer to delete the only post", async () => {
    posts = [erkek];
    const user = await openApp();

    const menu = await openPostMenu(user);

    expect(within(menu).getByRole("menuitem", { name: "Nöbet yerini sil" })).toBeDisabled();
  });
});

describe("working on a post's month", () => {
  it("names the post on steps 2 and 3", async () => {
    const user = await openApp();

    await user.click(screen.getByText("Ay Seçimi & Özel Günler"));
    expect(await screen.findByRole("heading", { name: /Ay Seçimi & Aktif Günler.*Erkek Yurdu/ })).toBeInTheDocument();

    await user.click(screen.getByText("Planla & Dışa Aktar"));
    expect(await screen.findByRole("heading", { name: /Adım 3.*Erkek Yurdu/ })).toBeInTheDocument();
  });

  it("copies another post's day settings on step 2", async () => {
    const user = await openApp();
    await user.click(screen.getByText("Ay Seçimi & Özel Günler"));
    expect(await screen.findByRole("button", { name: /^1, nöbet günü\./ })).toBeInTheDocument();

    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Gün ayarlarının kopyalanacağı nöbet yeri" }),
      "Kız Yurdu"
    );
    await user.click(screen.getByRole("button", { name: "Başka nöbet yerinden kopyala" }));

    await waitFor(() => expect(mockedDb.getSchedule).toHaveBeenCalledWith("kiz", 2026, 12));
    expect(await screen.findByRole("button", { name: /^1, tatil\./ })).toBeInTheDocument();
  });

  it("moves a teacher to another post from the teacher form", async () => {
    const user = await openApp();

    await user.click(screen.getByRole("button", { name: "Ayşe Yılmaz bilgilerini düzenle" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Nöbet Yeri" }), "Kız Yurdu");
    await user.click(screen.getByRole("button", { name: "Güncelle" }));

    await waitFor(() => expect(mockedDb.moveTeacherToPost).toHaveBeenCalledWith("T1", "kiz"));
    expect(mockedDb.saveTeacher).toHaveBeenCalledWith(expect.objectContaining({ id: "T1", post_id: "kiz" }));
  });

  it("approves into the selected post, freezing the post's name", async () => {
    const user = await openApp();
    await user.click(screen.getByText("Planla & Dışa Aktar"));

    await user.click(await screen.findByRole("button", { name: "Onayla" }));

    await waitFor(() => expect(mockedDb.approveSchedule).toHaveBeenCalledTimes(1));
    const stored = mockedDb.approveSchedule.mock.calls[0][0];
    expect(stored.post_id).toBe("erkek");
    expect(JSON.parse(stored.report).postName).toBe("Erkek Yurdu");
  });

  it("adds only the post's own earlier approved schedules to the export", async () => {
    mockedDb.getApprovedSchedules.mockResolvedValue([approvedKasim("erkek", "Erkek Yurdu"), approvedKasim("kiz", "Kız Yurdu")]);
    const user = await openApp();

    await user.click(screen.getByText("Planla & Dışa Aktar"));

    expect(await screen.findByText("1 onaylı çizelge eklenecek")).toBeInTheDocument();
  });

  it("names each approved schedule's post in the drawer", async () => {
    mockedDb.getApprovedSchedules.mockResolvedValue([approvedKasim("erkek", "Erkek Yurdu"), approvedKasim("kiz", "Kız Yurdu")]);
    const user = await openApp();

    await user.click(screen.getByRole("button", { name: "Onaylı Çizelgeler" }));
    const drawer = await screen.findByRole("complementary", { name: "Onaylı Çizelgeler" });

    expect(await within(drawer).findByText(/Kız Yurdu/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Erkek Yurdu/)).toBeInTheDocument();
  });
});

describe("the header on a narrow window", () => {
  const setWidth = (width: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    window.dispatchEvent(new Event("resize"));
  };

  afterEach(() => setWidth(1024));

  it("keeps only the icons of the post and approved schedules buttons, still announcing their names", async () => {
    setWidth(800);
    await openApp();

    expect(screen.getByRole("button", { name: "Nöbet yeri: Erkek Yurdu" })).not.toHaveTextContent("Erkek Yurdu");
    expect(screen.getByRole("button", { name: "Onaylı Çizelgeler" })).not.toHaveTextContent("Onaylı Çizelgeler");
  });

  it("shows their names when there is room", async () => {
    setWidth(1400);
    await openApp();

    expect(screen.getByRole("button", { name: "Nöbet yeri: Erkek Yurdu" })).toHaveTextContent("Erkek Yurdu");
    expect(screen.getByRole("button", { name: "Onaylı Çizelgeler" })).toHaveTextContent("Onaylı Çizelgeler");
  });
});
