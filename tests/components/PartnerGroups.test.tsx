import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartnerGroups } from "../../src/components/PartnerGroups";
import { DbTeacher } from "../../src/db";
import { PartnerGroup } from "../../src/solver/partners";

const teachers: DbTeacher[] = [
  { id: "T1", name: "Ali", target_hours: 4, priority: 1 },
  { id: "T2", name: "Ayşe", target_hours: 2, priority: 1 },
  { id: "T3", name: "Can", target_hours: 3, priority: 1 },
];

function renderCard(overrides: Partial<React.ComponentProps<typeof PartnerGroups>> = {}) {
  const onChangeGroups = vi.fn();
  const onCopyFromMonth = vi.fn();
  render(
    <PartnerGroups
      teachers={teachers}
      monthLabel="Ekim 2026"
      partnerGroups={[]}
      monthlyTargets={{}}
      onChangeGroups={onChangeGroups}
      copyMonths={[]}
      onCopyFromMonth={onCopyFromMonth}
      {...overrides}
    />
  );
  return { onChangeGroups, onCopyFromMonth };
}

describe("PartnerGroups", () => {
  it("hangi aya ait olduğunu başlıkta gösterir", () => {
    renderCard();
    expect(screen.getByText(/Ekim 2026/)).toBeInTheDocument();
  });

  it("grup yokken açıklayıcı bir mesaj gösterir", () => {
    renderCard();
    expect(screen.getByText(/henüz nöbet grubu tanımlanmadı/i)).toBeInTheDocument();
  });

  it("tanımlı grupları üye adları ve gün sayısıyla listeler", () => {
    renderCard({
      partnerGroups: [{ id: "g1", memberIds: ["T1", "T3"], goalDays: 2 }],
    });
    expect(screen.getByText(/Ali \+ Can/)).toBeInTheDocument();
    expect(screen.getByText(/2 gün/)).toBeInTheDocument();
  });

  it("iki öğretmen ve gün sayısı seçilince yeni grup ekler", async () => {
    const user = userEvent.setup();
    const { onChangeGroups } = renderCard();

    await user.click(screen.getByRole("checkbox", { name: /Ali/ }));
    await user.click(screen.getByRole("checkbox", { name: /Can/ }));
    const goal = screen.getByLabelText(/Ortak nöbet günü/i);
    await user.clear(goal);
    await user.type(goal, "2");
    await user.click(screen.getByRole("button", { name: /Grubu Kaydet/i }));

    expect(onChangeGroups).toHaveBeenCalledTimes(1);
    const saved = onChangeGroups.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].memberIds.sort()).toEqual(["T1", "T3"]);
    expect(saved[0].goalDays).toBe(2);
  });

  it("tek öğretmenle grup kaydettirmez", async () => {
    const user = userEvent.setup();
    const { onChangeGroups } = renderCard();

    await user.click(screen.getByRole("checkbox", { name: /Ali/ }));
    await user.click(screen.getByRole("button", { name: /Grubu Kaydet/i }));

    expect(onChangeGroups).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/en az 2 öğretmen/i);
  });

  it("aylık hedefi aşan grubu kaydetmez ve öğretmeni adıyla uyarır", async () => {
    const user = userEvent.setup();
    // Ayşe'nin hedefi 2; 3 günlük bir grup fazla.
    const { onChangeGroups } = renderCard();

    await user.click(screen.getByRole("checkbox", { name: /Ali/ }));
    await user.click(screen.getByRole("checkbox", { name: /Ayşe/ }));
    const goal = screen.getByLabelText(/Ortak nöbet günü/i);
    await user.clear(goal);
    await user.type(goal, "3");
    await user.click(screen.getByRole("button", { name: /Grubu Kaydet/i }));

    expect(onChangeGroups).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Ayşe/);
  });

  it("grubu siler", async () => {
    const user = userEvent.setup();
    const { onChangeGroups } = renderCard({
      partnerGroups: [
        { id: "g1", memberIds: ["T1", "T3"], goalDays: 2 },
        { id: "g2", memberIds: ["T2", "T3"], goalDays: 1 },
      ],
    });

    await user.click(screen.getAllByRole("button", { name: /Grubu Sil/i })[0]);

    expect(onChangeGroups).toHaveBeenCalledWith([
      { id: "g2", memberIds: ["T2", "T3"], goalDays: 1 },
    ]);
  });

  // Important 3 (final review): groups could previously only be deleted and
  // rebuilt from scratch — changing a goal from 2 days to 3 meant re-entering
  // every member. These prove the edit-in-place path: same id, same gate.
  describe("grubu düzenleme", () => {
    it("bir grubu düzenler ve aynı id ile, aynı grup sayısıyla kaydeder", async () => {
      const user = userEvent.setup();
      // T3 (Can, hedef 3) her iki grupta da olduğundan, g1'in günü grubun
      // kendi üyelerinin hedefini aşmayacak şekilde seçildi (2 -> 3, Can için
      // g1(3)+g2(1)=4 olurdu — bu yüzden g2'siz, tek grupla test ediliyor;
      // "diğer grup etkilenmez" ayrı bir durumla aşağıda kanıtlanıyor).
      const { onChangeGroups } = renderCard({
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T3"], goalDays: 2 }],
      });

      await user.click(screen.getByRole("button", { name: /Grubu Düzenle/i }));
      const goal = screen.getByLabelText(/Ortak nöbet günü/i);
      await user.clear(goal);
      await user.type(goal, "3");
      await user.click(screen.getByRole("button", { name: /Grubu Güncelle/i }));

      expect(onChangeGroups).toHaveBeenCalledTimes(1);
      const saved = onChangeGroups.mock.calls[0][0];
      // Same length: replaced in place, not appended as a new group.
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe("g1");
      expect(saved[0].goalDays).toBe(3);
      expect(saved[0].memberIds.sort()).toEqual(["T1", "T3"]);
    });

    it("bir grubu düzenlerken diğer gruplar etkilenmez", async () => {
      const user = userEvent.setup();
      const { onChangeGroups } = renderCard({
        partnerGroups: [
          { id: "g1", memberIds: ["T1", "T2"], goalDays: 1 },
          { id: "g2", memberIds: ["T1", "T3"], goalDays: 1 },
        ],
      });

      // Edit g1 (first row) without changing its goal — proves the SECOND
      // group is passed through untouched, not just that the first survives.
      await user.click(screen.getAllByRole("button", { name: /Grubu Düzenle/i })[0]);
      await user.click(screen.getByRole("button", { name: /Grubu Güncelle/i }));

      expect(onChangeGroups).toHaveBeenCalledTimes(1);
      const saved = onChangeGroups.mock.calls[0][0];
      expect(saved).toHaveLength(2);
      expect(saved.find((g: PartnerGroup) => g.id === "g2")).toEqual({
        id: "g2",
        memberIds: ["T1", "T3"],
        goalDays: 1,
      });
    });

    it("düzenlenen grup bir üyeyi aşırı taahhüt ettirirse reddedilir ve öğretmeni adıyla uyarır", async () => {
      const user = userEvent.setup();
      // Ali'nin hedefi 4, Can'ınki 3. g1'in gününü 4'e çıkarmak Ali'yi tam
      // hedefinde bırakır ama Can'ı aşırı taahhüt ettirir — tek bir öğretmen
      // adı beklenebilsin diye bilerek böyle seçildi.
      const { onChangeGroups } = renderCard({
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T3"], goalDays: 2 }],
      });

      await user.click(screen.getByRole("button", { name: /Grubu Düzenle/i }));
      const goal = screen.getByLabelText(/Ortak nöbet günü/i);
      await user.clear(goal);
      await user.type(goal, "4");
      await user.click(screen.getByRole("button", { name: /Grubu Güncelle/i }));

      expect(onChangeGroups).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(/Can/);
    });

    it("düzenlemeyi iptal eder ve formu sıfırlar", async () => {
      const user = userEvent.setup();
      const { onChangeGroups } = renderCard({
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T3"], goalDays: 2 }],
      });

      await user.click(screen.getByRole("button", { name: /Grubu Düzenle/i }));
      expect(screen.getByRole("button", { name: /Grubu Güncelle/i })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "İptal" }));

      expect(screen.getByRole("button", { name: /Grubu Kaydet/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Grubu Güncelle/i })).not.toBeInTheDocument();
      expect(onChangeGroups).not.toHaveBeenCalled();
    });

    it("düzenlenmekte olan grup silinirse form yeni-grup durumuna döner", async () => {
      const user = userEvent.setup();
      renderCard({
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T3"], goalDays: 2 }],
      });

      await user.click(screen.getByRole("button", { name: /Grubu Düzenle/i }));
      await user.click(screen.getByRole("button", { name: /Grubu Sil/i }));

      expect(screen.getByRole("button", { name: /Grubu Kaydet/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Grubu Güncelle/i })).not.toBeInTheDocument();
    });
  });

  it("kopyalanacak ay yoksa kopyalama seçeneğini göstermez", () => {
    renderCard({ copyMonths: [] });
    expect(screen.queryByRole("button", { name: /kopyala/i })).not.toBeInTheDocument();
  });

  it("seçilen aydan kopyalamayı tetikler", async () => {
    const user = userEvent.setup();
    const { onCopyFromMonth } = renderCard({ copyMonths: [{ year: 2026, month: 9 }] });

    await user.click(screen.getByRole("button", { name: /kopyala/i }));

    expect(onCopyFromMonth).toHaveBeenCalledWith(2026, 9);
  });

  // copyMonths is loaded from the DB asynchronously by App, so it is very
  // often still [] on the first render and only arrives afterward. The
  // initial "seçim" state must not get stuck at "" once that happens —
  // otherwise the copy button silently no-ops (Number("") is NaN) with no
  // visible error.
  it("copyMonths mount sonrasında gelse bile kopyalamayı doğru ay/yılla tetikler", async () => {
    const user = userEvent.setup();
    const onCopyFromMonth = vi.fn();
    const { rerender } = render(
      <PartnerGroups
        teachers={teachers}
        monthLabel="Ekim 2026"
        partnerGroups={[]}
        monthlyTargets={{}}
        onChangeGroups={vi.fn()}
        copyMonths={[]}
        onCopyFromMonth={onCopyFromMonth}
      />
    );
    expect(screen.queryByRole("button", { name: /kopyala/i })).not.toBeInTheDocument();

    rerender(
      <PartnerGroups
        teachers={teachers}
        monthLabel="Ekim 2026"
        partnerGroups={[]}
        monthlyTargets={{}}
        onChangeGroups={vi.fn()}
        copyMonths={[{ year: 2026, month: 9 }]}
        onCopyFromMonth={onCopyFromMonth}
      />
    );

    await user.click(await screen.findByRole("button", { name: /kopyala/i }));

    expect(onCopyFromMonth).toHaveBeenCalledWith(2026, 9);
  });
});
