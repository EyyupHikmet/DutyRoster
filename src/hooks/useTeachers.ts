import { useState } from "react";
import { getTeachers, saveTeacher, deleteTeacher, DbTeacher } from "../db";

export function useTeachers() {
  const [teachers, setTeachers] = useState<DbTeacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [teacherName, setTeacherName] = useState<string>("");
  const [teacherTarget, setTeacherTarget] = useState<number>(4);
  const [teacherPriority, setTeacherPriority] = useState<number>(1); // 1: Standart, 2: Orta, 3: Yüksek

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

  const handleSaveTeacherSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!teacherName.trim()) return false;

    const newTeacher: DbTeacher = {
      id: editingTeacherId || crypto.randomUUID(),
      name: teacherName.trim(),
      target_hours: Number(teacherTarget),
      priority: Number(teacherPriority)
    };

    try {
      await saveTeacher(newTeacher);
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
      return false;
    }
  };

  const handleEditTeacherClick = (t: DbTeacher) => {
    setEditingTeacherId(t.id);
    setTeacherName(t.name);
    setTeacherTarget(t.target_hours);
    setTeacherPriority(t.priority);
  };

  const handleDeleteTeacherClick = async (id: string) => {
    if (!window.confirm("Bu öğretmeni ve tüm uygunluk kayıtlarını silmek istediğinize emin misiniz?")) return false;
    try {
      await deleteTeacher(id);
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
    loadTeachers,
    handleSaveTeacherSubmit,
    handleEditTeacherClick,
    handleDeleteTeacherClick
  };
}
