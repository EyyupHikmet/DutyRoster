import { describe, it, expect } from "vitest";
import { PartnerGroup } from "../../src/solver/partners";
import { validatePartnerGroups } from "../../src/solver/validation";

const teachers = [
  { id: "T1", name: "Ali", target_hours: 4 },
  { id: "T2", name: "Ayşe", target_hours: 2 },
  { id: "T3", name: "Can", target_hours: 3 },
];

const g = (id: string, memberIds: string[], goalDays: number): PartnerGroup => ({
  id,
  memberIds,
  goalDays,
});

describe("validatePartnerGroups", () => {
  it("kuralara uyan gruplar için sorun bildirmez", () => {
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 2)];
    expect(validatePartnerGroups(groups, teachers, {})).toEqual([]);
  });

  it("tek üyeli grubu reddeder", () => {
    const issues = validatePartnerGroups([g("g1", ["T1"], 1)], teachers, {});
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("too_few_members");
    expect(issues[0].groupId).toBe("g1");
  });

  it("sıfır veya negatif ortak gün hedefini reddeder", () => {
    const issues = validatePartnerGroups([g("g1", ["T1", "T2"], 0)], teachers, {});
    expect(issues.map((i) => i.code)).toContain("invalid_goal");
  });

  it("kadroda olmayan bir öğretmen içeren grubu reddeder", () => {
    const issues = validatePartnerGroups([g("g1", ["T1", "TX"], 1)], teachers, {});
    expect(issues.map((i) => i.code)).toContain("unknown_member");
  });

  it("aynı öğretmenlerden oluşan ikinci grubu reddeder (sıra farkı önemsiz)", () => {
    const groups = [g("g1", ["T1", "T2"], 1), g("g2", ["T2", "T1"], 1)];
    const issues = validatePartnerGroups(groups, teachers, {});
    expect(issues.map((i) => i.code)).toContain("duplicate_group");
  });

  it("aylık hedefini aşan taahhüdü reddeder ve öğretmeni adıyla bildirir", () => {
    // Can'ın hedefi 3; 2 + 2 = 4 ortak gün taahhüdü fazla.
    const groups = [g("g1", ["T1", "T3"], 2), g("g2", ["T2", "T3"], 2)];
    const issues = validatePartnerGroups(groups, teachers, {});
    const over = issues.find((i) => i.code === "over_committed");
    expect(over).toBeDefined();
    expect(over!.teacherId).toBe("T3");
    expect(over!.message).toContain("Can");
    expect(over!.message).toContain("4");
    expect(over!.message).toContain("3");
  });

  it("taahhüt tam hedefe eşitse kabul eder", () => {
    // Can: 1 + 2 = 3, hedefi de 3.
    const groups = [g("g1", ["T1", "T3"], 1), g("g2", ["T2", "T3"], 2)];
    expect(validatePartnerGroups(groups, teachers, {})).toEqual([]);
  });

  it("aylık hedef ezmesini dikkate alır", () => {
    // Ayşe'nin genel hedefi 2 ama bu ay 1; 2 günlük grup artık fazla.
    const groups = [g("g1", ["T2", "T3"], 2)];
    expect(validatePartnerGroups(groups, teachers, {})).toEqual([]);
    const issues = validatePartnerGroups(groups, teachers, { T2: 1 });
    expect(issues.map((i) => i.code)).toContain("over_committed");
  });

  it("grup yoksa sorun bildirmez", () => {
    expect(validatePartnerGroups([], teachers, {})).toEqual([]);
  });
});
