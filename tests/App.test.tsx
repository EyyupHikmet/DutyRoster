import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import * as db from "../src/db";
import * as excelUtils from "../src/utils/excelUtils";
import * as opener from "@tauri-apps/plugin-opener";
import { getDutyDates } from "../src/utils/dateUtils";

// App.tsx (via its own import and via the 3 hooks it uses) touches db.ts for every
// piece of initial data. Mock the whole module so App can mount in jsdom without a
// real Tauri IPC bridge — db.ts's own SQL semantics are covered in tests/db.test.ts.
vi.mock("../src/db", () => ({
  getTeachers: vi.fn().mockResolvedValue([]),
  saveTeacher: vi.fn().mockResolvedValue(undefined),
  deleteTeacher: vi.fn().mockResolvedValue(undefined),
  getAvailabilities: vi.fn().mockResolvedValue([]),
  saveAvailability: vi.fn().mockResolvedValue(undefined),
  getSchedule: vi.fn().mockResolvedValue(null),
  saveSchedule: vi.fn().mockResolvedValue(undefined),
  resetDb: vi.fn().mockResolvedValue(undefined),
}));

// App.tsx calls exportScheduleToExcel directly (not through a hook),
// which in turn drives @tauri-apps/plugin-dialog's save() and plugin-fs's
// writeFile() — neither of which has a real Tauri IPC bridge in jsdom. Mock the
// whole module at App's call boundary; excelUtils.ts's own logic (filename/
// versioning, the save/cancel/error branches) is covered directly, with real
// DI, in tests/excelUtils.test.ts.
vi.mock("../src/utils/excelUtils", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/excelUtils")>(
    "../src/utils/excelUtils"
  );
  return {
    ...actual,
    exportScheduleToExcel: vi.fn(),
  };
});

// App.tsx also calls openPath/revealItemInDir directly from the export
// confirmation toast's two action buttons.
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const mockedDb = vi.mocked(db);
const mockedExcelUtils = vi.mocked(excelUtils);
const mockedOpener = vi.mocked(opener);

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.getSchedule.mockResolvedValue(null);
  mockedDb.saveSchedule.mockResolvedValue(undefined);
});

describe("App — 3-step wizard navigation", () => {
  it("starts on Step 1 (Öğretmen Kadrosu)", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());
  });

  it("clicking the Step 2 nav indicator switches the visible step to Ay Seçimi & Özel Günler", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());

    await user.click(screen.getByText("Ay Seçimi & Özel Günler"));

    expect(screen.getByText(/Ay Seçimi & Aktif Günler/)).toBeInTheDocument();
    expect(screen.queryByText(/Adım 1: Öğretmen Kadrosu/)).not.toBeInTheDocument();
  });

  it("clicking the Step 3 nav indicator switches the visible step to Planlama Seçenekleri", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());

    await user.click(screen.getByText("Planla & Dışa Aktar"));

    expect(screen.getByText(/Adım 3: Planlama Seçenekleri/)).toBeInTheDocument();
  });

  it("can navigate forward to Step 3 and back to Step 1 via the nav indicators", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());

    await user.click(screen.getByText("Planla & Dışa Aktar"));
    expect(screen.getByText(/Adım 3: Planlama Seçenekleri/)).toBeInTheDocument();

    await user.click(screen.getByText("Kadro & Uygunluk"));
    expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument();
  });

  it("the settings dropdown toggles theme between light and dark via document.documentElement's data-theme attribute", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await user.click(screen.getByTitle("Sistem ve Erişilebilirlik Ayarları"));
    await user.click(screen.getByText("☀️ Aydınlık"));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("the settings dropdown links out to the project page in the user's browser", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());

    await user.click(screen.getByTitle("Sistem ve Erişilebilirlik Ayarları"));
    await user.click(screen.getByRole("button", { name: /Proje Sayfası/ }));

    // openUrl, not openPath: this is a web address handed to the default
    // browser, not a file handed to its default application.
    expect(mockedOpener.openUrl).toHaveBeenCalledWith("https://github.com/EyyupHikmet/DutyRoster");
    expect(mockedOpener.openPath).not.toHaveBeenCalled();
  });

  it("closes the settings dropdown after opening the project page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());

    await user.click(screen.getByTitle("Sistem ve Erişilebilirlik Ayarları"));
    await user.click(screen.getByRole("button", { name: /Proje Sayfası/ }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Proje Sayfası/ })).not.toBeInTheDocument()
    );
  });
});

// Persisting per-month drafts + the save/discard/cancel prompt
// when navigating away from a month with unsaved changes.
describe("App — unsaved month-draft navigation prompt", () => {
  async function goToStep2(user: ReturnType<typeof userEvent.setup>) {
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());
    await user.click(screen.getByText("Ay Seçimi & Özel Günler"));
    await waitFor(() => expect(screen.getByText(/Ay Seçimi & Aktif Günler/)).toBeInTheDocument());
  }

  function yearCombobox() {
    return screen.getByRole("combobox", { name: "Yıl seçimi" });
  }

  // The combobox header's textContent also includes the decorative "▼"
  // chevron span (aria-hidden, not part of its accessible name) — strip it
  // down to just the visible year digits for comparisons below.
  function yearLabel() {
    return yearCombobox().textContent?.match(/\d+/)?.[0] ?? "";
  }

  async function makeDirty(user: ReturnType<typeof userEvent.setup>) {
    // Toggle any real day-eligibility cell — a genuine in-memory change to
    // `holidays`/`weekendDutyDays`, exactly what AC2 must detect as dirty.
    const dayButtons = screen.getAllByRole("button", { name: /nöbet günü\.|tatil\./ });
    await user.click(dayButtons[0]);
  }

  async function switchYear(user: ReturnType<typeof userEvent.setup>) {
    const currentLabel = yearLabel();
    await user.click(yearCombobox());
    const targetYear = ["2026", "2027", "2028"].find((y) => y !== currentLabel)!;
    await user.click(screen.getByRole("option", { name: targetYear }));
    return { currentLabel, targetYear };
  }

  it("switching year with NO unsaved changes navigates immediately, no modal", async () => {
    const user = userEvent.setup();
    await goToStep2(user);

    const { targetYear } = await switchYear(user);

    expect(screen.queryByRole("dialog", { name: "Kaydedilmemiş Değişiklikler" })).not.toBeInTheDocument();
    await waitFor(() => expect(yearLabel()).toBe(targetYear));
    expect(mockedDb.saveSchedule).not.toHaveBeenCalled();
  });

  it("switching year WITH unsaved changes opens exactly a 3-outcome (Save/Discard/Cancel) dialog", async () => {
    const user = userEvent.setup();
    await goToStep2(user);
    await makeDirty(user);

    await switchYear(user);

    const dialog = await screen.findByRole("dialog", { name: "Kaydedilmemiş Değişiklikler" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Kaydet ve Devam Et" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kaydetmeden Devam Et" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "İptal Et" })).toBeInTheDocument();
  });

  it("Cancel: stays on the original year, no navigation, nothing persisted", async () => {
    const user = userEvent.setup();
    await goToStep2(user);
    await makeDirty(user);
    const { currentLabel } = await switchYear(user);

    await user.click(await screen.findByRole("button", { name: "İptal Et" }));

    expect(screen.queryByRole("dialog", { name: "Kaydedilmemiş Değişiklikler" })).not.toBeInTheDocument();
    expect(yearLabel()).toBe(currentLabel);
    expect(mockedDb.saveSchedule).not.toHaveBeenCalled();
  });

  it("Discard: switches to the target year without saving; the left-behind month's DB row is untouched", async () => {
    const user = userEvent.setup();
    await goToStep2(user);
    await makeDirty(user);
    const { targetYear } = await switchYear(user);

    await user.click(await screen.findByRole("button", { name: "Kaydetmeden Devam Et" }));

    expect(screen.queryByRole("dialog", { name: "Kaydedilmemiş Değişiklikler" })).not.toBeInTheDocument();
    await waitFor(() => expect(yearLabel()).toBe(targetYear));
    expect(mockedDb.saveSchedule).not.toHaveBeenCalled();
  });

  it("Save: persists the departing month's draft (via the decoupled save path) then switches", async () => {
    const user = userEvent.setup();
    await goToStep2(user);
    await makeDirty(user);
    const { targetYear } = await switchYear(user);

    await user.click(await screen.findByRole("button", { name: "Kaydet ve Devam Et" }));

    expect(screen.queryByRole("dialog", { name: "Kaydedilmemiş Değişiklikler" })).not.toBeInTheDocument();
    await waitFor(() => expect(mockedDb.saveSchedule).toHaveBeenCalledTimes(1));
    // An empty/never-generated assignments map is a valid persisted draft
    // (AC1) — this month was never solved, only configured.
    expect(mockedDb.saveSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ assignments: JSON.stringify({}) })
    );
    await waitFor(() => expect(yearLabel()).toBe(targetYear));
  });
});

// Excel export's Save-As destination picker + versioned filename +
// post-save confirmation toast (with "Dosyayı Aç"/"Klasörü Aç") + cancel/error
// handling. exportScheduleToExcel itself is mocked at App's call boundary (see
// the vi.mock above) — its own save/cancel/error logic and the filename/
// version helpers are exercised directly, with real DI, in
// tests/excelUtils.test.ts. What's under test here is App.tsx's wiring: does
// it render the right thing for each of the 3 possible outcomes, and does it
// call openPath/revealItemInDir with the right path.
describe("App — Excel export save dialog and confirmation", () => {
  // App defaults the selected month to `new Date()`, while getSchedule is a
  // static mock that always answers with September 2026. Freeze the clock so
  // the seeded month and the selected month agree — otherwise these tests
  // start failing on their own the moment the real calendar moves on, and the
  // incomplete-export dialog (which compares the schedule against the SELECTED
  // month's duty days) would intercept every export.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 8)); // 8 September 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Step3Solver only renders the "Excel'e Aktar" button once
  // Object.keys(generatedSchedule).length > 0, so seed a saved schedule with a
  // non-empty assignments map (loaded by the mount-time useEffect regardless
  // of which (year, month) it actually asks for, since this is a static mock).
  //
  // `assignments` defaults to a COMPLETE month — every duty day covered — so
  // these export-mechanics tests reach the export call directly. A month with
  // open days is intercepted by the incomplete-export confirmation instead,
  // which is what the `describe` block further down covers.
  function mockSavedScheduleWithAssignments(assignments?: Record<string, string[]>) {
    const fullMonth: Record<string, string[]> = {};
    for (const date of getDutyDates(2026, 9, [], [])) {
      fullMonth[date] = ["T1"];
    }
    mockedDb.getSchedule.mockResolvedValue({
      id: "sched-1",
      year: 2026,
      month: 9,
      assignments: JSON.stringify(assignments ?? fullMonth),
      holidays: "[]",
      weekend_duty_days: "[]",
      config: JSON.stringify({
        mode: "fairness",
        teachersPerDay: 1,
        pinnedAssignments: {},
        extraDays: [],
        daySpecificTeachers: {},
      }),
    });
  }

  async function goToStep3WithExportButton(
    user: ReturnType<typeof userEvent.setup>,
    assignments?: Record<string, string[]>
  ) {
    mockSavedScheduleWithAssignments(assignments);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Adım 1: Öğretmen Kadrosu/)).toBeInTheDocument());
    await user.click(screen.getByText("Planla & Dışa Aktar"));
    await waitFor(() => expect(screen.getByText(/Adım 3: Planlama Seçenekleri/)).toBeInTheDocument());
    return screen.getByRole("button", { name: /Excel'e Aktar/ });
  }

  it("saved: shows the confirmation toast with the filename, and both action buttons wire to openPath/revealItemInDir", async () => {
    const user = userEvent.setup();
    mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({
      status: "saved",
      path: "C:\\Users\\test\\Belgeler\\2026_Eylül_Nobet_Raporu_v1.xlsx",
      filename: "2026_Eylül_Nobet_Raporu_v1.xlsx",
    });
    const exportButton = await goToStep3WithExportButton(user);

    await user.click(exportButton);

    expect(await screen.findByText(/2026_Eylül_Nobet_Raporu_v1\.xlsx/)).toBeInTheDocument();
    const openFileBtn = screen.getByRole("button", { name: "Dosyayı Aç" });
    const openFolderBtn = screen.getByRole("button", { name: "Klasörü Aç" });

    await user.click(openFileBtn);
    expect(mockedOpener.openPath).toHaveBeenCalledWith(
      "C:\\Users\\test\\Belgeler\\2026_Eylül_Nobet_Raporu_v1.xlsx"
    );

    await user.click(openFolderBtn);
    expect(mockedOpener.revealItemInDir).toHaveBeenCalledWith(
      "C:\\Users\\test\\Belgeler\\2026_Eylül_Nobet_Raporu_v1.xlsx"
    );

    // Dismiss control also present and functional (not required by the ACs,
    // but the toast must not be stuck on screen forever with no way to close it).
    await user.click(screen.getByRole("button", { name: "Bildirimi kapat" }));
    expect(screen.queryByText(/2026_Eylül_Nobet_Raporu_v1\.xlsx/)).not.toBeInTheDocument();
  });

  it("canceled: dismissing the native dialog shows no confirmation toast and no error, no opener calls", async () => {
    const user = userEvent.setup();
    mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
    const exportButton = await goToStep3WithExportButton(user);

    await user.click(exportButton);

    // Give any (incorrect) async state update a chance to land before asserting absence.
    await waitFor(() => expect(mockedExcelUtils.exportScheduleToExcel).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Dosyayı Aç" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Klasörü Aç" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockedOpener.openPath).not.toHaveBeenCalled();
    expect(mockedOpener.revealItemInDir).not.toHaveBeenCalled();
  });

  it("error: shows a Turkish failure message, never a false 'saved' confirmation", async () => {
    const user = userEvent.setup();
    mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({
      status: "error",
      message: "disk full",
    });
    const exportButton = await goToStep3WithExportButton(user);

    await user.click(exportButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Rapor kaydedilirken bir hata oluştu. Lütfen tekrar deneyin."
    );
    expect(screen.queryByRole("button", { name: "Dosyayı Aç" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Klasörü Aç" })).not.toBeInTheDocument();
  });

  // Exporting a roster with holes in it is a legitimate thing to want — the
  // principal may intend to fill the rest by hand — so the app asks instead of
  // blocking, and never writes a partial sheet without saying so first.
  describe("incomplete schedule confirmation", () => {
    // Only 1 of September 2026's 22 duty days is covered.
    const partialMonth = { "2026-09-01": ["T1"] };

    it("asks for confirmation instead of exporting when duty days are still open", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
      const exportButton = await goToStep3WithExportButton(user, partialMonth);

      await user.click(exportButton);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveAccessibleName("Çizelge Eksik");
      expect(dialog).toHaveTextContent("21 gün");
      // Nothing is written until the user says so.
      expect(mockedExcelUtils.exportScheduleToExcel).not.toHaveBeenCalled();
    });

    it("'Yine de Aktar' closes the dialog and performs the real export", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({
        status: "saved",
        path: "C:\Users\test\Belgeler\2026_Eylül_Nobet_Raporu_v1.xlsx",
        filename: "2026_Eylül_Nobet_Raporu_v1.xlsx",
      });
      const exportButton = await goToStep3WithExportButton(user, partialMonth);

      await user.click(exportButton);
      await user.click(await screen.findByRole("button", { name: "Yine de Aktar" }));

      await waitFor(() =>
        expect(mockedExcelUtils.exportScheduleToExcel).toHaveBeenCalledTimes(1)
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(await screen.findByText(/2026_Eylül_Nobet_Raporu_v1\.xlsx/)).toBeInTheDocument();
    });

    it("'Vazgeç' closes the dialog and writes nothing", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
      const exportButton = await goToStep3WithExportButton(user, partialMonth);

      await user.click(exportButton);
      await user.click(await screen.findByRole("button", { name: "Vazgeç" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mockedExcelUtils.exportScheduleToExcel).not.toHaveBeenCalled();
    });

    it("Escape cancels rather than falling through to the export", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
      const exportButton = await goToStep3WithExportButton(user, partialMonth);

      await user.click(exportButton);
      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mockedExcelUtils.exportScheduleToExcel).not.toHaveBeenCalled();
    });

    it("lists the specific open days so they can be acted on", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
      // Everything covered except 3 September.
      const assignments: Record<string, string[]> = {};
      for (const date of getDutyDates(2026, 9, [], [])) {
        if (date !== "2026-09-03") assignments[date] = ["T1"];
      }
      const exportButton = await goToStep3WithExportButton(user, assignments);

      await user.click(exportButton);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("1 gün");
      expect(dialog).toHaveTextContent("3 Eylül Perşembe");
      expect(dialog).toHaveTextContent("0/1 nöbetçi");
    });

    it("exports straight away, with no dialog, when every duty day is covered", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({ status: "canceled" });
      const exportButton = await goToStep3WithExportButton(user); // full month

      await user.click(exportButton);

      await waitFor(() =>
        expect(mockedExcelUtils.exportScheduleToExcel).toHaveBeenCalledTimes(1)
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // A rejected openPath used to go only to console.error. In a release build
  // there is no console anyone will look at, so a failure was indistinguishable
  // from a button that is not wired up -- which is exactly how it was reported.
  describe("the toast's open buttons report their own failures", () => {
    it("'Dosyayı Aç' surfaces a message when openPath rejects", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({
        status: "saved",
        path: "C:\Users\test\Belgeler\rapor.xlsx",
        filename: "rapor.xlsx",
      });
      mockedOpener.openPath.mockRejectedValue(new Error("forbidden path"));
      const exportButton = await goToStep3WithExportButton(user);
      await user.click(exportButton);

      await user.click(await screen.findByRole("button", { name: "Dosyayı Aç" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Dosya açılamadı");
    });

    it("'Klasörü Aç' surfaces a message when revealItemInDir rejects", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({
        status: "saved",
        path: "C:\Users\test\Belgeler\rapor.xlsx",
        filename: "rapor.xlsx",
      });
      mockedOpener.revealItemInDir.mockRejectedValue(new Error("nope"));
      const exportButton = await goToStep3WithExportButton(user);
      await user.click(exportButton);

      await user.click(await screen.findByRole("button", { name: "Klasörü Aç" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Klasör açılamadı");
    });

    it("shows no error when opening succeeds", async () => {
      const user = userEvent.setup();
      mockedExcelUtils.exportScheduleToExcel.mockResolvedValue({
        status: "saved",
        path: "C:\Users\test\Belgeler\rapor.xlsx",
        filename: "rapor.xlsx",
      });
      mockedOpener.openPath.mockResolvedValue(undefined);
      const exportButton = await goToStep3WithExportButton(user);
      await user.click(exportButton);

      await user.click(await screen.findByRole("button", { name: "Dosyayı Aç" }));

      await waitFor(() => expect(mockedOpener.openPath).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
