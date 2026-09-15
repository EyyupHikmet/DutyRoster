import { useState } from "react";
import { getTeachers, saveTeacher, deleteTeacher, moveTeacherToPost, DbTeacher } from "../db";
import { effectiveTarget } from "../utils/targets";
import { PartnerGroup, committedGroupDays } from "../solver/partners";
import { findNameConflict } from "../utils/teacherNames";

export interface SaveTeacherContext {
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
  applyMonthlyTarget: (teacherId: string, target: number) => void;
  /** Removes a teacher who has just moved to another post from the loaded month. */
  pruneTeacherFromMonth: (teacherId: string) => void;
}

/**
 * What useTeachers needs from useScheduleState to keep the currently loaded
 * month's in-memory partnerGroups/monthlyTargets from disagreeing with what
 * db.ts's deleteTeacher() cascade just did to every SAVED month's row.
 * useTeachers deliberately does not own that state itself — it is passed in,
 * the same way handleSaveTeacherSubmit already takes SaveTeacherContext,
 * rather than reaching into useScheduleState or duplicating its state.
 */
export interface DeleteTeacherContext {
  pruneTeacherFromMonth: (teacherId: string) => void;
}

/**
 * The staff of one duty post (ADR-0007). Every teacher is loaded, because
 * names are unique across all posts, but `teachers` is only the given post's.
 */
export function useTeachers(postId?: string | null) {
  const [allTeachers, setAllTeachers] = useState<DbTeacher[]>([]);
  const teachers = allTeachers.filter((t) => t.post_id === postId);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState<string>("");
  const [teacherTarget, setTeacherTarget] = useState<number>(1);
  const [teacherPriority, setTeacherPriority] = useState<number>(1); // 1: Standart, 2: Orta, 3: Yüksek
  const [teacherError, setTeacherError] = useState<string | null>(null);
  // The post chosen in the teacher form, or null for the post on screen.
  const [teacherPostId, setTeacherPostId] = useState<string | null>(null);

  const loadTeachers = async () => {
    try {
      const list = await getTeachers();
      setAllTeachers(list);
      const own = list.filter((t) => t.post_id === postId);
      if (own.length > 0 && !selectedTeacherId) {
        setSelectedTeacherId(own[0].id);
      }
      return own;
    } catch (err) {
      console.error("Öğretmenler yüklenemedi:", err);
      return [];
    }
  };

  const handleSaveTeacherSubmit = async (
    e: React.FormEvent | undefined,
    ctx: SaveTeacherContext
  ) => {
    if (e) e.preventDefault();
    setTeacherError(null);
    if (!teacherName.trim()) return false;

    // The name is what tells teachers apart (see teacherNames.ts), so a name
    // another teacher already has is refused rather than saved as a twin.
    const conflict = findNameConflict(teacherName, allTeachers, editingTeacherId);
    if (conflict) {
      setTeacherError(
        `“${conflict.name}” adında bir öğretmen zaten var. İki öğretmeni ayırt edebilmek için adı değiştirin (ör. “${conflict.name} (Mat.)”).`
      );
      return false;
    }

    const id = editingTeacherId || crypto.randomUUID();
    const target = Number(teacherTarget);
    const current = allTeachers.find((t) => t.id === id);
    const targetPostId = teacherPostId ?? current?.post_id ?? postId ?? "";
    // Only a teacher who has a post can move, and only to a different known one.
    const moving = Boolean(editingTeacherId && current?.post_id && targetPostId && current.post_id !== targetPostId);

    // The month's target is a ceiling on what this teacher has already been
    // committed to in groups. Lowering it below that would leave the month
    // over-committed the moment it is saved, which is exactly what creating
    // such a group is refused for — so refuse it here too, symmetrically.
    const committed = committedGroupDays(id, ctx.partnerGroups);

    if (committed > target) {
      setTeacherError(
        `${teacherName.trim()}: bu ay gruplarda toplam ${committed} ortak nöbet günü tanımlı, hedefi ${target} yapamazsınız. Önce grupların gün sayısını azaltın.`
      );
      return false;
    }

    const newTeacher: DbTeacher = {
      id,
      name: teacherName.trim(),
      // The teachers table keeps the teacher's USUAL target. A brand new teacher
      // adopts what was typed; an existing one keeps theirs, because the field
      // on this screen edits the selected month, not the general default.
      target_hours: editingTeacherId
        ? current?.target_hours ?? target
        : target,
      priority: Number(teacherPriority),
      post_id: targetPostId
    };

    try {
      if (moving) {
        // Moving cleans the teacher out of the old post's month setups. The
        // month on screen belongs to that post, so it is pruned in memory too.
        await moveTeacherToPost(id, targetPostId);
        ctx.pruneTeacherFromMonth(id);
      }
      await saveTeacher(newTeacher);
      // This month's target belongs to the post on screen, which a moved
      // teacher has just left.
      if (!moving) ctx.applyMonthlyTarget(id, target);
      const own = await loadTeachers();

      if (!selectedTeacherId) {
        setSelectedTeacherId(newTeacher.id);
      } else if (moving && selectedTeacherId === id) {
        setSelectedTeacherId(own.length > 0 ? own[0].id : null);
      }

      // Reset form states
      setEditingTeacherId(null);
      setTeacherName("");
      setTeacherTarget(4);
      setTeacherPriority(1);
      setTeacherPostId(null);
      return true;
    } catch (err) {
      console.error("Öğretmen kaydedilemedi:", err);
      setTeacherError("Öğretmen kaydedilemedi. Lütfen tekrar deneyin.");
      return false;
    }
  };

  const handleEditTeacherClick = (t: DbTeacher, monthlyTargets: Record<string, number> = {}) => {
    // Starting a fresh edit must not leave a stale refusal from a previous,
    // unrelated save lingering on screen.
    setTeacherError(null);
    setEditingTeacherId(t.id);
    setTeacherName(t.name);
    setTeacherTarget(effectiveTarget(t, monthlyTargets));
    setTeacherPriority(t.priority);
    setTeacherPostId(t.post_id);
  };

  const handleDeleteTeacherClick = async (id: string, ctx: DeleteTeacherContext) => {
    if (!window.confirm("Bu öğretmeni ve tüm uygunluk kayıtlarını silmek istediğinize emin misiniz?")) return false;
    try {
      await deleteTeacher(id);
      // db.ts's deleteTeacher() already cascaded this id out of every SAVED
      // month's partnerGroups/monthlyTargets. The currently loaded month's
      // in-memory copies of those same fields live in useScheduleState, not
      // here — without this, a save right after this delete would write the
      // stale in-memory groups straight back over the row db.ts just cleaned,
      // resurrecting the deleted teacher for that month.
      ctx.pruneTeacherFromMonth(id);
      const list = await loadTeachers();
      if (selectedTeacherId === id) {
        setSelectedTeacherId(list.length > 0 ? list[0].id : null);
      }
      return true;
    } catch (err) {
      console.error("Öğretmen silinemedi:", err);
      return false;
    }
  };

  return {
    teachers,
    setTeachers: setAllTeachers,
    allTeachers,
    teacherPostId,
    setTeacherPostId,
    selectedTeacherId,
    setSelectedTeacherId,
    editingTeacherId,
    setEditingTeacherId,
    teacherName,
    setTeacherName,
    teacherTarget,
    setTeacherTarget,
    teacherPriority,
    setTeacherPriority,
    teacherError,
    setTeacherError,
    loadTeachers,
    handleSaveTeacherSubmit,
    handleEditTeacherClick,
    handleDeleteTeacherClick
  };
}
