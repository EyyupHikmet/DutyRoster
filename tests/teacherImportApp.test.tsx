import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import App from "../src/App";
import * as db from "../src/db";

// Importing the staff from Excel through App, with a real .xlsx file and the
// real parser. Only the database is mocked; its SQL is covered in db.test.ts.

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
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
  openUrl: vi.fn(),
}));

const mockedDb = vi.mocked(db);

const ayse: db.DbTeacher = { id: "T1", name: "Ayşe Yılmaz", target_hours: 4, priority: 1 };

function xlsxFile(rows: unknown[][]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Kadro");
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], "kadro.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.getTeachers.mockResolvedValue([ayse]);
  mockedDb.saveTeacher.mockResolvedValue(undefined);
  mockedDb.getAvailabilities.mockResolvedValue([]);
  mockedDb.getSchedule.mockResolvedValue(null);
  mockedDb.getAllSchedules.mockResolvedValue([]);
  mockedDb.getApprovedSchedules.mockResolvedValue([]);
});

async function importSheet(rows: unknown[][]) {
  const user = userEvent.setup({ applyAccept: false });
  render(<App />);
  // The staff has loaded (the name alone also appears in the partner group card).
  await screen.findByText("Öğretmen Kadrosu (1)");
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(input, xlsxFile(rows));
}

describe("importing the staff from Excel", () => {
  it("adds only new names and says which were skipped", async () => {
    await importSheet([
      ["Ad", "Hedef", "Öncelik"],
      ["AYŞE YILMAZ", 4, "Standart"],
      ["Şule Kaya", 3, "Orta"],
      ["Sule Kaya", 2, "Standart"],
      ["şule  kaya", 2, "Standart"],
    ]);

    // The skipped name is listed as written ("şule  kaya"); Testing Library
    // collapses the page text's repeated spaces but not the expected string's.
    expect(
      await screen.findByText("2 öğretmen yüklendi. 2 isim zaten kadroda olduğu için atlandı: AYŞE YILMAZ, şule kaya.")
    ).toBeInTheDocument();
    expect(mockedDb.saveTeacher.mock.calls.map(([t]) => t.name)).toEqual(["Şule Kaya", "Sule Kaya"]);
  });

  it("says no teacher was added when every name is already in the staff", async () => {
    await importSheet([["Ad"], ["ayşe yılmaz"]]);

    expect(
      await screen.findByText("Yeni öğretmen eklenmedi. 1 isim zaten kadroda olduğu için atlandı: ayşe yılmaz.")
    ).toBeInTheDocument();
    expect(mockedDb.saveTeacher).not.toHaveBeenCalled();
  });
});
