import { DbTeacher } from "../db";
import { foldName } from "./turkishText";

/**
 * Until the app has a real teacher register, a teacher's name is what tells
 * teachers apart, so no two teachers in the staff may share one. The running
 * total of a duty report relies on it (ADR-0006).
 *
 * "The same name" follows the identity rule in AGENTS.md ("Turkish text"):
 * case and extra spaces do not count, Turkish letters do ("Şule" ≠ "Sule").
 */
export function sameTeacherName(a: string, b: string): boolean {
  return foldName(a) === foldName(b);
}

/** The teacher, other than `exceptId`, who already has `name`. */
export function findNameConflict(name: string, teachers: DbTeacher[], exceptId?: string | null): DbTeacher | undefined {
  return teachers.find((t) => t.id !== exceptId && sameTeacherName(t.name, name));
}

/**
 * Splits imported teachers into those to add and the names to skip: a name
 * already in the staff, or already earlier in the same file, is skipped.
 */
export function splitImportByName<T extends { name: string }>(
  imported: T[],
  existing: { name: string }[]
): { added: T[]; skipped: string[] } {
  const seen = new Set(existing.map((t) => foldName(t.name)));
  const added: T[] = [];
  const skipped: string[] = [];
  for (const t of imported) {
    const key = foldName(t.name);
    if (seen.has(key)) {
      skipped.push(t.name);
    } else {
      seen.add(key);
      added.push(t);
    }
  }
  return { added, skipped };
}

/** Ids of teachers who share their name with another teacher, as older data may. */
export function duplicateNameIds(teachers: DbTeacher[]): Set<string> {
  const byName = new Map<string, string[]>();
  for (const t of teachers) {
    const key = foldName(t.name);
    byName.set(key, [...(byName.get(key) ?? []), t.id]);
  }
  return new Set([...byName.values()].filter((ids) => ids.length > 1).flat());
}
