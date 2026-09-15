import { describe, it, expect } from "vitest";
import {
  sameTeacherName,
  findNameConflict,
  splitImportByName,
  duplicateNameIds,
} from "../src/utils/teacherNames";
import { DbTeacher } from "../src/db";

const teacher = (id: string, name: string): DbTeacher => ({ id, name, target_hours: 1, priority: 1 });

describe("sameTeacherName", () => {
  it("ignores case, with Turkish capitals", () => {
    expect(sameTeacherName("ÇAĞLAR", "Çağlar")).toBe(true);
    expect(sameTeacherName("İSMAİL", "ismail")).toBe(true);
    expect(sameTeacherName("ILGIN", "ılgın")).toBe(true);
  });

  it("ignores spaces at the ends and repeated spaces inside", () => {
    expect(sameTeacherName("  Ayşe   Yılmaz ", "Ayşe Yılmaz")).toBe(true);
  });

  it("keeps Turkish letters distinct from their plain counterparts", () => {
    expect(sameTeacherName("Şule", "Sule")).toBe(false);
    expect(sameTeacherName("Ilgın", "İlgin")).toBe(false);
    expect(sameTeacherName("Gül", "Gul")).toBe(false);
  });
});

describe("findNameConflict", () => {
  const staff = [teacher("T1", "Ayşe Yılmaz"), teacher("T2", "Çağlar Demir")];

  it("finds the teacher who already has the name", () => {
    expect(findNameConflict("ÇAĞLAR DEMİR", staff)?.id).toBe("T2");
  });

  it("finds nothing for a new name", () => {
    expect(findNameConflict("Şule Kaya", staff)).toBeUndefined();
  });

  it("does not count the teacher being edited as a conflict with themselves", () => {
    expect(findNameConflict("ayşe yılmaz", staff, "T1")).toBeUndefined();
    expect(findNameConflict("Ayşe Yılmaz", staff, "T2")?.id).toBe("T1");
  });
});

describe("splitImportByName", () => {
  it("adds new names and skips those already in the staff or earlier in the file", () => {
    const existing = [teacher("T1", "Ayşe Yılmaz")];
    const imported = [
      teacher("N1", "AYŞE YILMAZ"),
      teacher("N2", "Şule Kaya"),
      teacher("N3", "Sule Kaya"),
      teacher("N4", "şule  kaya"),
    ];

    const { added, skipped } = splitImportByName(imported, existing);

    expect(added.map((t) => t.id)).toEqual(["N2", "N3"]);
    expect(skipped).toEqual(["AYŞE YILMAZ", "şule  kaya"]);
  });

  it("adds everything when nothing clashes", () => {
    const { added, skipped } = splitImportByName([teacher("N1", "Cengiz"), teacher("N2", "Çağlar")], []);

    expect(added).toHaveLength(2);
    expect(skipped).toEqual([]);
  });
});

describe("duplicateNameIds", () => {
  it("finds every teacher who shares a name with another", () => {
    const staff = [
      teacher("T1", "Ayşe Yılmaz"),
      teacher("T2", "Cengiz"),
      teacher("T3", "ayşe  yılmaz"),
      teacher("T4", "Şule"),
      teacher("T5", "Sule"),
    ];

    expect([...duplicateNameIds(staff)].sort()).toEqual(["T1", "T3"]);
  });
});
