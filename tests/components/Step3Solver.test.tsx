import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Step3Solver } from "../../src/components/Step3Solver";
import { DbTeacher } from "../../src/db";
import type { PartnerGroup } from "../../src/solver/partners";

const teachers: DbTeacher[] = [{ id: "T1", name: "Ahmet Yılmaz", target_hours: 4, priority: 1 }];

function baseProps(overrides: Partial<React.ComponentProps<typeof Step3Solver>> = {}) {
  return {
    teachers,
    selectedYear: 2026,
    selectedMonth: 10,
    holidays: [] as string[],
    weekendDutyDays: [] as string[],
    solverMode: "fairness" as const,
    setSolverMode: vi.fn(),
    respectTargets: false,
    setRespectTargets: vi.fn(),
    avoidConsecutiveDays: false,
    setAvoidConsecutiveDays: vi.fn(),
    unfilledDays: [] as Array<{ date: string; required: number; assigned: number }>,
    teachersPerDay: 1,
    setTeachersPerDay: vi.fn(),
    pinnedAssignments: {} as Record<string, string[]>,
    setPinnedAssignments: vi.fn(),
    daySpecificTeachers: {} as Record<string, number>,
    setDaySpecificTeachers: vi.fn(),
    generatedSchedule: {} as Record<string, string[]>,
    solverError: null as string | null,
    handleClearPins: vi.fn(),
    handleGenerateSchedule: vi.fn(),
    handleExportSchedule: vi.fn(),
    partnerGroups: [] as PartnerGroup[],
    ...overrides,
  };
}

function renderStep3(overrides: Partial<React.ComponentProps<typeof Step3Solver>> = {}) {
  return render(<Step3Solver {...baseProps(overrides)} />);
}

describe("Step3Solver", () => {
  it("renders the step title, the 4 solver-mode options, and the generate button", () => {
    render(<Step3Solver {...baseProps()} />);
    expect(screen.getByText(/Adım 3: Planlama Seçenekleri/)).toBeInTheDocument();
    expect(screen.getByText("Eşit Dağıt (Adalet)")).toBeInTheDocument();
    expect(screen.getByText("Öncelik Sırası")).toBeInTheDocument();
    expect(screen.getByText("Dengeli (Hedef Odaklı)")).toBeInTheDocument();
    expect(screen.getByText("Rastgele Doldur")).toBeInTheDocument();
    expect(screen.getByText("⚡ Programı Hazırla")).toBeInTheDocument();
  });

  it("does not show the export button until a schedule has been generated", () => {
    render(<Step3Solver {...baseProps()} />);
    expect(screen.queryByText("📥 Excel'e Aktar")).not.toBeInTheDocument();
  });

  it("shows the export button once generatedSchedule is non-empty", () => {
    render(<Step3Solver {...baseProps({ generatedSchedule: { "2026-10-01": ["T1"] } })} />);
    expect(screen.getByText("📥 Excel'e Aktar")).toBeInTheDocument();
  });

  it("clicking a solver-mode card calls setSolverMode with that mode", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<Step3Solver {...props} />);
    await user.click(screen.getByText("Öncelik Sırası"));
    expect(props.setSolverMode).toHaveBeenCalledWith("priority");
  });

  it("clicking 'Programı Hazırla' calls handleGenerateSchedule", async () => {
    const user = userEvent.setup();
    const props = baseProps();
    render(<Step3Solver {...props} />);
    await user.click(screen.getByText("⚡ Programı Hazırla"));
    expect(props.handleGenerateSchedule).toHaveBeenCalled();
  });

  it("shows the solver error alert with the exact message when solverError is set", () => {
    render(<Step3Solver {...baseProps({ solverError: "12 Ekim için öğretmen bulunamadı." })} />);
    expect(screen.getByText("Sıkışma Hatası:")).toBeInTheDocument();
    expect(screen.getByText(/12 Ekim için öğretmen bulunamadı\./)).toBeInTheDocument();
  });

  it("clicking an active day cell opens the day configurator sidebar with the pinned CustomSelect using variant='pinned'", async () => {
    const user = userEvent.setup();
    render(<Step3Solver {...baseProps()} />);

    expect(screen.getByText("Gün Seçilmedi")).toBeInTheDocument();
    // Oct 1, 2026 is a Thursday (active weekday, no holiday configured)
    await user.click(screen.getByText("1"));

    expect(screen.queryByText("Gün Seçilmedi")).not.toBeInTheDocument();
    expect(screen.getByText("Günlük Nöbet Ayarları")).toBeInTheDocument();
    expect(screen.getByText("Nöbetçi 1:")).toBeInTheDocument();
  });

  it("the pinned CustomSelect renders with warning styling once a teacher is pinned to the selected day", async () => {
    const user = userEvent.setup();
    render(
      <Step3Solver
        {...baseProps({ pinnedAssignments: { "2026-10-01": ["T1"] } })}
      />
    );
    await user.click(screen.getByText("1"));

    const pinnedHeader = screen.getByText("Ahmet Yılmaz").closest(".form-control") as HTMLElement;
    expect(pinnedHeader).toBeTruthy();
    expect(pinnedHeader.style.backgroundColor).toBe("var(--warning-light)");
  });

  describe("aylık hedefleri kesinlikle aşma", () => {
    it("renders as a real checkbox, unchecked by default", () => {
      render(<Step3Solver {...baseProps()} />);
      const checkbox = screen.getByRole("checkbox", { name: /Aylık hedefleri kesinlikle aşma/ });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    });

    it("reflects the respectTargets prop", () => {
      render(<Step3Solver {...baseProps({ respectTargets: true })} />);
      expect(screen.getByRole("checkbox", { name: /Aylık hedefleri kesinlikle aşma/ })).toBeChecked();
    });

    it("clicking it calls setRespectTargets with the new value", async () => {
      const user = userEvent.setup();
      const props = baseProps();
      render(<Step3Solver {...props} />);
      await user.click(screen.getByRole("checkbox", { name: /Aylık hedefleri kesinlikle aşma/ }));
      expect(props.setRespectTargets).toHaveBeenCalledWith(true);
    });

    it("is independent of the four distribution rules, which stay selectable", async () => {
      const user = userEvent.setup();
      const props = baseProps({ respectTargets: true });
      render(<Step3Solver {...props} />);
      await user.click(screen.getByText("Öncelik Sırası"));
      expect(props.setSolverMode).toHaveBeenCalledWith("priority");
      expect(props.setRespectTargets).not.toHaveBeenCalled();
    });
  });

  describe("üst üste iki gün nöbet verme", () => {
    it("renders as a real checkbox, unchecked by default", () => {
      render(<Step3Solver {...baseProps()} />);
      const checkbox = screen.getByRole("checkbox", { name: /üst üste iki gün/i });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).not.toBeChecked();
    });

    it("reflects the avoidConsecutiveDays prop", () => {
      render(<Step3Solver {...baseProps({ avoidConsecutiveDays: true })} />);
      expect(screen.getByRole("checkbox", { name: /üst üste iki gün/i })).toBeChecked();
    });

    it("clicking it calls setAvoidConsecutiveDays with the new value", async () => {
      const user = userEvent.setup();
      const props = baseProps();
      render(<Step3Solver {...props} />);
      await user.click(screen.getByRole("checkbox", { name: /üst üste iki gün/i }));
      expect(props.setAvoidConsecutiveDays).toHaveBeenCalledWith(true);
    });

    it("is independent of the hard target cap — both can be checked at once", () => {
      render(<Step3Solver {...baseProps({ respectTargets: true, avoidConsecutiveDays: true })} />);
      expect(screen.getByRole("checkbox", { name: /Aylık hedefleri kesinlikle aşma/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /üst üste iki gün/i })).toBeChecked();
    });

    it("toggling it leaves the distribution rule and the target cap alone", async () => {
      const user = userEvent.setup();
      const props = baseProps();
      render(<Step3Solver {...props} />);
      await user.click(screen.getByRole("checkbox", { name: /üst üste iki gün/i }));
      expect(props.setSolverMode).not.toHaveBeenCalled();
      expect(props.setRespectTargets).not.toHaveBeenCalled();
    });
  });

  describe("open-day summary", () => {
    it("is absent when nothing is left open", () => {
      render(<Step3Solver {...baseProps()} />);
      expect(screen.queryByText(/gün boş kaldı/)).not.toBeInTheDocument();
    });

    it("reports the day count and the total number of open slots", () => {
      render(
        <Step3Solver
          {...baseProps({
            unfilledDays: [
              { date: "2026-10-01", required: 2, assigned: 0 },
              { date: "2026-10-02", required: 1, assigned: 0 },
            ],
          })}
        />
      );
      const summary = screen.getByRole("status");
      expect(summary).toHaveTextContent("2 gün boş kaldı");
      expect(summary).toHaveTextContent("3 nöbet");
    });

    it("is a warning, not the red solver-error alert", () => {
      render(
        <Step3Solver
          {...baseProps({ unfilledDays: [{ date: "2026-10-01", required: 1, assigned: 0 }] })}
        />
      );
      expect(screen.getByRole("status")).toHaveClass("alert-warning");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("names the hard target cap as a possible cause when that rule is on", () => {
      render(
        <Step3Solver
          {...baseProps({
            respectTargets: true,
            unfilledDays: [{ date: "2026-10-01", required: 1, assigned: 0 }],
          })}
        />
      );
      const summary = screen.getByRole("status");
      expect(summary).toHaveTextContent(/Aylık hedefleri kesinlikle aşma/);
      expect(summary).not.toHaveTextContent(/üst üste iki gün/i);
    });

    it("names the back-to-back rule as a possible cause when that rule is on", () => {
      render(
        <Step3Solver
          {...baseProps({
            avoidConsecutiveDays: true,
            unfilledDays: [{ date: "2026-10-01", required: 1, assigned: 0 }],
          })}
        />
      );
      const summary = screen.getByRole("status");
      expect(summary).toHaveTextContent(/üst üste iki gün/i);
      expect(summary).not.toHaveTextContent(/Aylık hedefleri kesinlikle aşma/);
    });

    it("names both rules when both are on", () => {
      render(
        <Step3Solver
          {...baseProps({
            respectTargets: true,
            avoidConsecutiveDays: true,
            unfilledDays: [{ date: "2026-10-01", required: 1, assigned: 0 }],
          })}
        />
      );
      const summary = screen.getByRole("status");
      expect(summary).toHaveTextContent(/Aylık hedefleri kesinlikle aşma/);
      expect(summary).toHaveTextContent(/üst üste iki gün/i);
    });

    it("blames neither rule when neither is on", () => {
      render(
        <Step3Solver
          {...baseProps({ unfilledDays: [{ date: "2026-10-01", required: 1, assigned: 0 }] })}
        />
      );
      const summary = screen.getByRole("status");
      expect(summary).not.toHaveTextContent(/Aylık hedefleri kesinlikle aşma/);
      expect(summary).not.toHaveTextContent(/üst üste iki gün/i);
    });

    it("coexists with a solver error without either replacing the other", () => {
      render(
        <Step3Solver
          {...baseProps({
            solverError: "Sıkıştı",
            unfilledDays: [{ date: "2026-10-01", required: 1, assigned: 0 }],
          })}
        />
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Sıkıştı");
      expect(screen.getByRole("status")).toHaveTextContent("1 gün boş kaldı");
    });
  });

  describe("nöbet grupları", () => {
    it("grup günlerini takvimde işaretler", () => {
      renderStep3({
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 1 }],
        generatedSchedule: { "2026-10-01": ["T1", "T2"], "2026-10-02": ["T3"] },
      });
      expect(screen.getAllByTitle(/nöbet grubu/i)).toHaveLength(1);
    });

    it("eksik kalan grup günlerini uyarı olarak bildirir", () => {
      renderStep3({
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T2"], goalDays: 2 }],
        generatedSchedule: { "2026-10-01": ["T1", "T2"], "2026-10-02": ["T3"] },
      });
      const warning = screen.getByText(/2 günün 1'i/);
      expect(warning).toBeInTheDocument();
      expect(warning.textContent).toMatch(/Ahmet|T1|Ali/);
    });

    it("grup tanımlı değilse grup uyarısı göstermez", () => {
      renderStep3({
        partnerGroups: [],
        generatedSchedule: { "2026-10-01": ["T1"] },
      });
      expect(screen.queryByText(/nöbet grubu/i)).not.toBeInTheDocument();
    });
  });
  describe("boş kalan nöbet yerleri", () => {
    it("hiç atama yapılmamış günde kaç slotun boş olduğunu yazar", () => {
      renderStep3({ teachersPerDay: 2, generatedSchedule: {} });

      expect(screen.getAllByText("2 boş slot").length).toBeGreaterThan(0);
      expect(screen.queryByText("Boş Gün")).not.toBeInTheDocument();
    });

    it("kısmen dolu günü boş gün saymaz, yalnızca kalan slotu yazar", () => {
      renderStep3({
        teachersPerDay: 2,
        daySpecificTeachers: { "2026-10-01": 2 },
        generatedSchedule: { "2026-10-01": ["T1"] },
      });

      // 1 Ekim'de bir nöbetçi var, bir slot boş.
      expect(screen.getAllByText("Ahmet Yılmaz").length).toBeGreaterThan(0);
      expect(screen.getAllByText("1 boş slot").length).toBeGreaterThan(0);
    });

    it("günün tamamı doluysa hiçbir şey yazmaz", () => {
      renderStep3({ teachersPerDay: 1, generatedSchedule: { "2026-10-01": ["T1"] } });

      const cell = screen.getAllByText("Ahmet Yılmaz")[0].closest(".calendar-cell") as HTMLElement;
      expect(cell.textContent).not.toMatch(/boş slot/);
    });
  });

  describe("sabitleme uyarıları", () => {
    // A pin always wins; these warnings only make sure the principal knows.
    const elifPinnedThrice = {
      teachers: [{ id: "T1", name: "Elif", target_hours: 2, priority: 1, post_id: "kiz" }],
      pinnedAssignments: { "2026-10-01": ["T1"], "2026-10-05": ["T1"], "2026-10-08": ["T1"] },
    };

    it("hedefinden fazla güne sabitlenen öğretmeni bildirir", () => {
      renderStep3(elifPinnedThrice);

      expect(screen.getByText("Elif: 3 güne sabitlendi, hedefi 2")).toBeInTheDocument();
    });

    it("ayın hedefi değiştirilmişse onu esas alır", () => {
      renderStep3({
        teachers: [{ id: "T1", name: "Elif", target_hours: 5, priority: 1, post_id: "kiz" }],
        pinnedAssignments: { "2026-10-01": ["T1"], "2026-10-05": ["T1"] },
        monthlyTargets: { T1: 1 },
      });

      expect(screen.getByText("Elif: 2 güne sabitlendi, hedefi 1")).toBeInTheDocument();
    });

    it("öğretmenin Uygun Değil işaretlediği güne sabitlemeyi bildirir", () => {
      renderStep3({
        teachers: [{ id: "T1", name: "Elif", target_hours: 4, priority: 1, post_id: "kiz" }],
        pinnedAssignments: { "2026-10-05": ["T1"] },
        availabilities: { T1: { "2026-10-05": "unavailable" } },
      });

      expect(screen.getByText("Elif: 5 Ekim gününde Uygun Değil olarak işaretli")).toBeInTheDocument();
    });

    it("sınırı aşan sabitleme yoksa uyarı göstermez", () => {
      renderStep3({
        teachers: [{ id: "T1", name: "Elif", target_hours: 4, priority: 1, post_id: "kiz" }],
        pinnedAssignments: { "2026-10-01": ["T1"] },
      });

      expect(screen.queryByText(/sabitlendi|Uygun Değil olarak işaretli/)).not.toBeInTheDocument();
    });

    it("uyarı planlamayı engellemez", async () => {
      const user = userEvent.setup();
      const props = baseProps(elifPinnedThrice);
      render(<Step3Solver {...props} />);

      await user.click(screen.getByText("⚡ Programı Hazırla"));

      expect(props.handleGenerateSchedule).toHaveBeenCalled();
    });
  });

  describe("dağıtım kuralı açıklamaları", () => {
    it("her kuralda hedefine ulaşmamış öğretmenlerin önce geldiğini söyler", () => {
      renderStep3();

      expect(screen.getByText(/Her kuralda sıra aynı/)).toBeInTheDocument();
      for (const description of screen.getAllByText(/[Hh]edefine ulaşmamış/)) {
        expect(description).toBeInTheDocument();
      }
      expect(screen.getAllByText(/[Hh]edefine ulaşmamış/).length).toBeGreaterThanOrEqual(4);
    });

    it("kıdem kuralının açıklamasında izinden söz etmez", () => {
      renderStep3();

      expect(screen.queryByText(/izin/)).not.toBeInTheDocument();
    });
  });
});
