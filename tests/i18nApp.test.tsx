import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import * as db from "../src/db";
import { i18n } from "../src/i18n";

// Choosing the interface language, and what must not follow it: teacher and
// duty post names are Turkish whatever the interface speaks, so they keep
// sorting and folding in Turkish (AGENTS.md, "Turkish text").

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

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
  openUrl: vi.fn(),
}));

const mockedDb = vi.mocked(db);

const staff: db.DbTeacher[] = [
  { id: "T1", name: "Davut", target_hours: 4, priority: 1, post_id: "yurt" },
  { id: "T2", name: "Çağlar", target_hours: 4, priority: 1, post_id: "yurt" },
  { id: "T3", name: "Cengiz", target_hours: 4, priority: 1, post_id: "yurt" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.getDutyPosts.mockResolvedValue([{ id: "yurt", name: "Yurt" }]);
  mockedDb.getLastPostId.mockResolvedValue("yurt");
  mockedDb.setLastPostId.mockResolvedValue(undefined);
  mockedDb.getTeachers.mockResolvedValue(staff);
  mockedDb.getAvailabilities.mockResolvedValue([]);
  mockedDb.getSchedule.mockResolvedValue(null);
  mockedDb.getAllSchedules.mockResolvedValue([]);
  mockedDb.getApprovedSchedules.mockResolvedValue([]);
  mockedDb.getLanguage.mockResolvedValue(null);
  mockedDb.setLanguage.mockResolvedValue(undefined);
});

afterEach(async () => {
  // The language is global to the instance; leave it as the next test expects it.
  await i18n.changeLanguage("tr");
});

/** Opens the settings menu and returns it. */
async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu|Step 1: Staff/)).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: /Sistem ve Erişilebilirlik Ayarları|System and Accessibility Settings/ }));
  return screen.getByRole("group", { name: /Sistem ve Erişilebilirlik Ayarları|System and Accessibility Settings/ });
}

describe("choosing the interface language", () => {
  it("starts in Turkish when nothing has been chosen", async () => {
    const user = userEvent.setup();

    const menu = await openSettings(user);

    expect(screen.getByText("Adım 1: Öğretmen Kadrosu & Uygunluk Takvimi")).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Türkçe" })).toHaveAttribute("aria-pressed", "true");
    expect(within(menu).getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches the whole interface on the spot and remembers the choice", async () => {
    const user = userEvent.setup();
    const menu = await openSettings(user);

    await user.click(within(menu).getByRole("button", { name: "English" }));

    expect(await screen.findByText("Step 1: Staff & Availability Calendar")).toBeInTheDocument();
    expect(screen.getByText("Staff (3)")).toBeInTheDocument();
    expect(screen.queryByText("Adım 1: Öğretmen Kadrosu & Uygunluk Takvimi")).not.toBeInTheDocument();
    await waitFor(() => expect(mockedDb.setLanguage).toHaveBeenCalledWith("en"));
  });

  it("opens in the language chosen last time", async () => {
    mockedDb.getLanguage.mockResolvedValue("en");
    render(<App />);

    expect(await screen.findByText("Step 1: Staff & Availability Calendar")).toBeInTheDocument();
    expect(mockedDb.setLanguage, "opening does not re-save what was already saved").not.toHaveBeenCalled();
  });

});
