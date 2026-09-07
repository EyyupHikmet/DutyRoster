import { useState } from "react";
import { getAvailabilities, saveAvailability } from "../db";
import { AvailabilityStatus } from "../solver";

export function useAvailabilities() {
  const [availabilities, setAvailabilities] = useState<Record<string, Record<string, AvailabilityStatus>>>({}); // teacherId -> date -> status

  const loadAvailabilities = async () => {
    try {
      const list = await getAvailabilities();
      const availsMap: Record<string, Record<string, AvailabilityStatus>> = {};
      for (const av of list) {
        if (!availsMap[av.teacher_id]) {
          availsMap[av.teacher_id] = {};
        }
        availsMap[av.teacher_id][av.date] = av.status as AvailabilityStatus;
      }
      setAvailabilities(availsMap);
      return availsMap;
    } catch (err) {
      console.error("Uygunluklar yüklenemedi:", err);
      return {};
    }
  };

  const handleCycleAvailability = async (selectedTeacherId: string, dateStr: string) => {
    if (!selectedTeacherId) return "available";

    const currentStatus = availabilities[selectedTeacherId]?.[dateStr] || "available";
    let nextStatus: AvailabilityStatus = "available";

    if (currentStatus === "available") {
      nextStatus = "preferred";
    } else if (currentStatus === "preferred") {
      nextStatus = "unavailable";
    } else {
      nextStatus = "available";
    }

    // Update state
    setAvailabilities((prev) => {
      const teacherAvails = prev[selectedTeacherId] ? { ...prev[selectedTeacherId] } : {};
      teacherAvails[dateStr] = nextStatus;
      return { ...prev, [selectedTeacherId]: teacherAvails };
    });

    // Save to SQLite
    try {
      await saveAvailability({
        teacher_id: selectedTeacherId,
        date: dateStr,
        status: nextStatus
      });
      return nextStatus;
    } catch (err) {
      console.error("Uygunluk kaydedilemedi:", err);
      return currentStatus;
    }
  };

  return {
    availabilities,
    setAvailabilities,
    loadAvailabilities,
    handleCycleAvailability
  };
}
