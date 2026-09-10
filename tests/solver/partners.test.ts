import { describe, it, expect } from "vitest";
import {
  PartnerGroup,
  creditPartnerGroups,
  placePartnerGroups,
  committedGroupDays,
} from "../../src/solver/partners";
import { AvailabilityStatus } from "../../src/solver/index";

const g = (id: string, memberIds: string[], goalDays: number): PartnerGroup => ({
  id,
  memberIds,
  goalDays,
});

describe("creditPartnerGroups", () => {
  it("üyelerin tamamı aynı gündeyse o günü gruba sayar", () => {
    const schedule = { "2026-10-01": ["T1", "T2"], "2026-10-02": ["T3"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 1)])).toEqual({ g1: 1 });
  });

  it("üyelerden biri eksikse o günü saymaz", () => {
    const schedule = { "2026-10-01": ["T1", "T3"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 1)])).toEqual({ g1: 0 });
  });

  it("birden fazla günü toplar", () => {
    const schedule = {
      "2026-10-01": ["T1", "T2"],
      "2026-10-02": ["T1", "T2"],
      "2026-10-05": ["T1"],
    };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2"], 2)])).toEqual({ g1: 2 });
  });

  it("ortak üyesi olmayan iki grup aynı günü birlikte alabilir", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3", "T4"] };
    const groups = [g("g1", ["T1", "T2"], 1), g("g2", ["T3", "T4"], 1)];
    expect(creditPartnerGroups(schedule, groups)).toEqual({ g1: 1, g2: 1 });
  });

  it("ortak üyesi olan iki grup aynı günden yalnızca biri sayılır", () => {
    // T3 her iki gruptaysa, tek bir gün iki kez sayılamaz.
    // g1 ve g2 eşit boyutta olduğundan, id'ye göre tie-break yapılır:
    // g1 < g2 lexicographically, bu yüzden g1 kazanır.
    const schedule = { "2026-10-01": ["T1", "T2", "T3"] };
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 1)];
    const credit = creditPartnerGroups(schedule, groups);
    expect(credit.g1).toBe(1);
    expect(credit.g2).toBe(0);
    expect(credit.g1 + credit.g2).toBe(1);
  });

  it("çakışma durumunda daha kalabalık grup önceliklidir", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3"] };
    const groups = [g("small", ["T1", "T2"], 1), g("big", ["T1", "T2", "T3"], 1)];
    expect(creditPartnerGroups(schedule, groups)).toEqual({ big: 1, small: 0 });
  });

  it("üç kişilik bir grubu tam kadro olduğunda sayar", () => {
    const schedule = { "2026-10-01": ["T1", "T2", "T3"], "2026-10-02": ["T1", "T2"] };
    expect(creditPartnerGroups(schedule, [g("g1", ["T1", "T2", "T3"], 2)])).toEqual({ g1: 1 });
  });

  it("grup yoksa boş bir sonuç döndürür", () => {
    expect(creditPartnerGroups({ "2026-10-01": ["T1"] }, [])).toEqual({});
  });

  it("üyesi olmayan bir grup hiçbir gün sayılmaz", () => {
    // Boş memberIds, her gün için `every` true döndürür, ancak
    // bu grup hiçbir zaman kredi almamalı.
    const schedule = {
      "2026-10-01": ["T1", "T2"],
      "2026-10-02": ["T3"],
      "2026-10-03": ["T4"],
    };
    expect(creditPartnerGroups(schedule, [g("empty", [], 1)])).toEqual({ empty: 0 });
  });
});

describe("committedGroupDays", () => {
  it("sums goalDays across every group containing the teacher", () => {
    const groups = [g("g1", ["T1", "T2"], 2), g("g2", ["T1", "T3"], 3)];
    expect(committedGroupDays("T1", groups)).toBe(5);
    expect(committedGroupDays("T2", groups)).toBe(2);
  });

  it("ignores groups the teacher does not belong to", () => {
    expect(committedGroupDays("T9", [g("g1", ["T1", "T2"], 4)])).toBe(0);
  });

  // The one case the four raw `filter().reduce()` copies this replaces all
  // got wrong in different ways: a member id repeated within a single
  // group's memberIds must not inflate that group's contribution beyond its
  // own goalDays.
  it("counts a group only once even if the teacher's id is duplicated within its memberIds", () => {
    const groups = [g("g1", ["T1", "T1", "T2"], 3)];
    expect(committedGroupDays("T1", groups)).toBe(3);
  });

  it("clamps a non-finite goalDays to 0 rather than propagating NaN/Infinity", () => {
    const nonFinite = g("g1", ["T1", "T2"], NaN);
    const infinite = g("g2", ["T1", "T2"], Infinity);
    expect(committedGroupDays("T1", [nonFinite])).toBe(0);
    expect(committedGroupDays("T1", [infinite])).toBe(0);
  });

  it("clamps a negative goalDays to 0", () => {
    expect(committedGroupDays("T1", [g("g1", ["T1", "T2"], -3)])).toBe(0);
  });
});

const DATES = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"];

function allAvailable(
  ids: string[]
): Record<string, Record<string, AvailabilityStatus>> {
  const out: Record<string, Record<string, AvailabilityStatus>> = {};
  for (const id of ids) {
    out[id] = {};
    for (const d of DATES) out[id][d] = "available";
  }
  return out;
}

const membersOn = (
  result: { placements: Record<string, string[]> },
  date: string
): string[] => result.placements[date] ?? [];

describe("placePartnerGroups", () => {
  it("hedef kadar gün yerleştirir", () => {
    const groups = [g("g1", ["T1", "T2"], 2)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2"]),
      () => 1,
      {}
    );
    expect(result.placed.g1).toBe(2);
    const days = DATES.filter((d) => membersOn(result, d).includes("g1"));
    expect(days).toHaveLength(2);
  });

  it("üyelerden biri uygun değilse o günü kullanmaz", () => {
    const avail = allAvailable(["T1", "T2"]);
    avail["T2"]["2026-10-01"] = "unavailable";
    avail["T2"]["2026-10-02"] = "unavailable";
    avail["T2"]["2026-10-05"] = "unavailable";
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 2)],
      avail,
      () => 1,
      {}
    );
    expect(result.placed.g1).toBe(2);
    expect(membersOn(result, "2026-10-01")).toEqual([]);
    expect(membersOn(result, "2026-10-02")).toEqual([]);
    expect(membersOn(result, "2026-10-05")).toEqual([]);
  });

  it("yerleştirilemeyen günleri eksik olarak bildirir", () => {
    const avail = allAvailable(["T1", "T2"]);
    for (const d of DATES.slice(1)) avail["T2"][d] = "unavailable";
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 3)],
      avail,
      () => 1,
      {}
    );
    expect(result.placed.g1).toBe(1);
  });

  it("günlük nöbetçi sayısından kalabalık grup için günü genişletir", () => {
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2", "T3"], 1)],
      allAvailable(["T1", "T2", "T3"]),
      () => 1,
      {}
    );
    expect(result.placed.g1).toBe(1);
  });

  it("ortak üyesi olmayan iki grup aynı güne sığabilir", () => {
    const groups = [g("g1", ["T1", "T2"], 5), g("g2", ["T3", "T4"], 5)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2", "T3", "T4"]),
      () => 4,
      {}
    );
    expect(result.placed.g1).toBe(5);
    expect(result.placed.g2).toBe(5);
    const shared = DATES.filter((d) => membersOn(result, d).length === 2);
    expect(shared).toHaveLength(5);
  });

  it("gün kapasitesi yetmiyorsa iki grup aynı güne konmaz", () => {
    const groups = [g("g1", ["T1", "T2"], 5), g("g2", ["T3", "T4"], 5)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2", "T3", "T4"]),
      () => 3,
      {}
    );
    for (const d of DATES) {
      expect(membersOn(result, d).length).toBeLessThanOrEqual(1);
    }
    // Kapasite kısıtı günleri paylaştırmalı ama ilerlemeyi durdurmamalı: 5 gün
    // var ve her gün en fazla bir grubu barındırabildiğinden toplam 5 yerleşir.
    expect(result.placed.g1 + result.placed.g2).toBe(5);
  });

  it("ortak üyesi olan iki grup aynı güne konmaz", () => {
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 2)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2", "T3"]),
      () => 4,
      {}
    );
    expect(result.placed.g1).toBe(1);
    expect(result.placed.g2).toBe(2);
    for (const d of DATES) {
      expect(membersOn(result, d).length).toBeLessThanOrEqual(1);
    }
  });

  it("sabitlenmiş bir gün grubun tamamını içeriyorsa hedeften düşer", () => {
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 2)],
      allAvailable(["T1", "T2"]),
      () => 2,
      { "2026-10-01": ["T1", "T2"] }
    );
    expect(result.placed.g1).toBe(2);
    // Sabitlenen gün zaten sayıldığı için yalnızca 1 gün daha yerleştirilir.
    const placedDays = DATES.filter((d) => membersOn(result, d).includes("g1"));
    expect(placedDays).toHaveLength(1);
    expect(placedDays).not.toContain("2026-10-01");
  });

  it("en kısıtlı gruba öncelik verir", () => {
    // g1 yalnızca 1 günde mümkün; g2 her gün mümkün. İkisi de yerleşmeli.
    const avail = allAvailable(["T1", "T2", "T3", "T4"]);
    for (const d of DATES.slice(1)) avail["T2"][d] = "unavailable";
    const groups = [g("g2", ["T3", "T4"], 5), g("g1", ["T1", "T2"], 1)];
    const result = placePartnerGroups(DATES, groups, avail, () => 2, {});
    expect(result.placed.g1).toBe(1);
    // g1'i kazandırmak g2'yi aç bırakmamalı: g1 tek günü aldıktan sonra g2'ye
    // kalan 4 gün hâlâ yerleşmeli (5. gün g1'e gittiği için 1 eksik kalır).
    expect(result.placed.g2).toBe(4);
  });

  it("grup yoksa boş sonuç döndürür", () => {
    const result = placePartnerGroups(DATES, [], allAvailable(["T1"]), () => 1, {});
    expect(result.placements).toEqual({});
    expect(result.placed).toEqual({});
  });

  it("üyesi olmayan bir grup asla yerleştirilmez", () => {
    // Bir müdür grubu kaydedip tüm üyelerini kaldırırsa memberIds boş kalır.
    // Boş bir grup hiçbir güne "yerleştirilemez" — creditPartnerGroups zaten
    // böyle bir grubu asla saymaz, placePartnerGroups de aynı fikirde olmalı.
    const groups = [g("empty", [], 3), g("g1", ["T1", "T2"], 1)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2"]),
      () => 1,
      {}
    );
    expect(result.placed.empty).toBe(0);
    for (const d of DATES) {
      expect(membersOn(result, d)).not.toContain("empty");
    }
  });

  it("sabitlenmiş bir günde üyesiz grup hiçbir tarihe ayrılmaz", () => {
    // Sabitlenmiş bir gün varken bile boş grup, creditPartnerGroups'un
    // ürettiği preCredited değeriyle çelişmemeli: ikisi de 0 vermeli ve
    // groupsOnDay üzerinden başka bir tarihi de bloke etmemeli.
    const groups = [g("empty", [], 2), g("g1", ["T1", "T2"], 1)];
    const result = placePartnerGroups(
      DATES,
      groups,
      allAvailable(["T1", "T2"]),
      () => 2,
      { "2026-10-01": ["T1", "T2"] }
    );
    expect(result.placed.empty).toBe(0);
    for (const d of DATES) {
      expect(membersOn(result, d)).not.toContain("empty");
    }
  });

  it("avoidConsecutiveDays açıkken grup ardışık takvim günlerine konmaz", () => {
    // DATES = [01, 02, 05, 06, 07]. 01-02 ardışık; 02-05 arasında hafta sonu
    // boşluğu var (ardışık değil). Hedef 2 gün: kısıt açıkken 01 ve 02'yi
    // birlikte kullanamaz.
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 2)],
      allAvailable(["T1", "T2"]),
      () => 1,
      {},
      true
    );
    expect(result.placed.g1).toBe(2);
    const days = DATES.filter((d) => membersOn(result, d).includes("g1"));
    expect(days).toHaveLength(2);
    expect(days).not.toEqual(["2026-10-01", "2026-10-02"]);
    expect(days.includes("2026-10-01") && days.includes("2026-10-02")).toBe(false);
  });

  it("avoidConsecutiveDays açıkken sabitlenmiş güne komşu tarihe konmaz", () => {
    // T1, 2026-10-01'de tek başına sabitli (gruba ait olmayan normal bir
    // nöbet). T2, 01'de müsait değil, bu yüzden grup zaten 01'i kullanamaz —
    // ama kısıt olmasa 02'yi rahatça kullanırdı. Kısıt açıkken 02, T1'in
    // sabit nöbetine komşu olduğu için de yasaklanmalı.
    const avail = allAvailable(["T1", "T2"]);
    avail["T2"]["2026-10-01"] = "unavailable";
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 1)],
      avail,
      () => 2,
      { "2026-10-01": ["T1"] },
      true
    );
    expect(membersOn(result, "2026-10-02")).not.toContain("g1");
    expect(result.placed.g1).toBe(1);
    const days = DATES.filter((d) => membersOn(result, d).includes("g1"));
    expect(days).toEqual(["2026-10-05"]);
  });

  it("avoidConsecutiveDays kapalıyken (varsayılan) ardışık yerleşime izin verir", () => {
    // Aynı senaryo, kısıt olmadan: bayrağın davranışı gerçekten kapattığını
    // ve mevcut çağıranların etkilenmediğini kanıtlar.
    const result = placePartnerGroups(
      DATES,
      [g("g1", ["T1", "T2"], 2)],
      allAvailable(["T1", "T2"]),
      () => 1,
      {}
      // avoidConsecutiveDays verilmedi -> varsayılan false
    );
    expect(result.placed.g1).toBe(2);
    const days = DATES.filter((d) => membersOn(result, d).includes("g1"));
    expect(days).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("avoidConsecutiveDays hedefi imkânsız kılarsa hata fırlatmadan eksik bildirir", () => {
    // Sadece iki, birbirine komşu tarih var. Kısıt açıkken grup ikisini
    // birden alamaz: biri diğerini komşuluk yüzünden bloke eder. Hedef 2
    // iken sonuç 1 olmalı, hata fırlatılmamalı.
    const tightDates = ["2026-10-01", "2026-10-02"];
    const avail: Record<string, Record<string, AvailabilityStatus>> = {
      T1: { "2026-10-01": "available", "2026-10-02": "available" },
      T2: { "2026-10-01": "available", "2026-10-02": "available" },
    };
    const result = placePartnerGroups(
      tightDates,
      [g("g1", ["T1", "T2"], 2)],
      avail,
      () => 1,
      {},
      true
    );
    expect(result.placed.g1).toBe(1);
  });
});
