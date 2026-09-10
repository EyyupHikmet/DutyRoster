import { useState } from "react";
import { getTeachers, saveTeacher, deleteTeacher, DbTeacher } from "../db";
import { effectiveTarget } from "../utils/targets";
import { PartnerGroup, committedGroupDays } from "../solver/partners";

export interface SaveTeacherContext {
  partnerGroups: PartnerGroup[];
  monthlyTargets: Record<string, number>;
  applyMonthlyTarget: (teacherId: string, target: number) => void;
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

export function useTeachers() {
  const [teachers, setTeachers] = useState<DbTeacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState<string>("");
  const [teacherTarget, setTeacherTarget] = useState<number>(1);
  const [teacherPriority, setTeacherPriority] = useState<number>(1); // 1: Standart, 2: Orta, 3: Yüksek
  const [teacherError, setTeacherError] = useState<string | null>(null);

  const loadTeachers = async () => {
    try {
      const list = await getTeachers();
      setTeachers(list);
      if (list.length > 0 && !selectedTeacherId) {
        setSelectedTeacherId(list[0].id);
      }
      return list;
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

    const id = editingTeacherId || crypto.randomUUID();
    const target = Number(teacherTarget);

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
        ? teachers.find((t) => t.id === id)?.target_hours ?? target
        : target,
      priority: Number(teacherPriority)
    };

    try {
      await saveTeacher(newTeacher);
      ctx.applyMonthlyTarget(id, target);
      await loadTeachers();

      if (!selectedTeacherId) {
        setSelectedTeacherId(newTeacher.id);
      }

      // Reset form states
      setEditingTeacherId(null);
      setTeacherName("");
      setTeacherTarget(4);
      setTeacherPriority(1);
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
    setTeachers,
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
