import { effectiveTarget } from "../utils/targets";
import { PartnerGroup, memberSetKey, committedGroupDays } from "./partners";

export type ValidationCode =
  | "too_few_members"
  | "invalid_goal"
  | "unknown_member"
  | "duplicate_group"
  | "over_committed";

export interface ValidationIssue {
  code: ValidationCode;
  /** Turkish, shown to the principal verbatim. */
  message: string;
  groupId?: string;
  teacherId?: string;
}

/**
 * The single source of truth for partner-group rules. The roster screen calls
 * this to gate saving AND to render its warnings, so a rule can never be
 * enforced in one place and forgotten in the other.
 *
 * Pure: no React, no database, no I/O.
 */
export function validatePartnerGroups(
  groups: PartnerGroup[],
  teachers: { id: string; name: string; target_hours: number }[],
  monthlyTargets: Record<string, number>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(teachers.map((t) => [t.id, t]));

  // Per-group shape rules.
  const seenMemberSets = new Map<string, string>();
  for (const group of groups) {
    const uniqueMembers = new Set(group.memberIds);
    if (uniqueMembers.size < 2) {
      issues.push({
        code: "too_few_members",
        groupId: group.id,
        message: "Bir nöbet grubunda en az 2 öğretmen bulunmalıdır.",
      });
    }

    if (!Number.isFinite(group.goalDays) || group.goalDays < 1) {
      issues.push({
        code: "invalid_goal",
        groupId: group.id,
        message: "Ortak nöbet gün sayısı en az 1 olmalıdır.",
      });
    }

    for (const memberId of uniqueMembers) {
      if (!byId.has(memberId)) {
        issues.push({
          code: "unknown_member",
          groupId: group.id,
          teacherId: memberId,
          message: "Grupta kadroda bulunmayan bir öğretmen var. Lütfen grubu güncelleyin.",
        });
      }
    }

    const key = memberSetKey(group);
    const previous = seenMemberSets.get(key);
    if (previous !== undefined) {
      const names = [...uniqueMembers]
        .map((id) => byId.get(id)?.name ?? id)
        .join(" + ");
      issues.push({
        code: "duplicate_group",
        groupId: group.id,
        message: `${names} için zaten bir grup tanımlı. Aynı öğretmenlerden ikinci bir grup oluşturmak yerine mevcut grubun gün sayısını artırın.`,
      });
    } else {
      seenMemberSets.set(key, group.id);
    }
  }

  // Over-commitment: a teacher can't owe more joint days than their month
  // allows. committedGroupDays is the single source of truth for this sum —
  // it dedupes a member appearing twice in one group and clamps a
  // non-finite/negative goalDays the same way this validator itself must.
  const memberIds = new Set(groups.flatMap((group) => group.memberIds));
  for (const teacherId of memberIds) {
    const teacher = byId.get(teacherId);
    if (!teacher) continue; // already reported as unknown_member
    const total = committedGroupDays(teacherId, groups);
    if (total <= 0) continue;
    const target = effectiveTarget(teacher, monthlyTargets);
    if (total > target) {
      issues.push({
        code: "over_committed",
        teacherId,
        message: `${teacher.name}: gruplarda toplam ${total} ortak nöbet günü tanımlı, bu ayki nöbet hedefi ise ${target}. Grubun gün sayısını azaltın veya hedefi yükseltin.`,
      });
    }
  }

  return issues;
}
