import { useState } from "react";
import { approveSchedule, deleteApprovedSchedule, getApprovedSchedules, DbApprovedSchedule } from "../db";
import { ScheduleReport } from "../utils/scheduleReport";

/** An approved schedule with its frozen report read back from storage. */
export type ApprovedSchedule = Omit<DbApprovedSchedule, "report"> & { report: ScheduleReport };

export function useApprovedSchedules() {
  // Latest month first, as the database returns them.
  const [approvedSchedules, setApprovedSchedules] = useState<ApprovedSchedule[]>([]);

  const loadApprovedSchedules = async () => {
    try {
      const rows = (await getApprovedSchedules()) ?? [];
      setApprovedSchedules(
        rows.flatMap((row) => {
          try {
            return [{ ...row, report: JSON.parse(row.report) as ScheduleReport }];
          } catch {
            // One unreadable copy must not hide the others.
            console.error("Onaylı çizelge okunamadı:", row.id);
            return [];
          }
        })
      );
    } catch (err) {
      console.error("Onaylı çizelgeler yüklenemedi:", err);
    }
  };

  /** Stores `report` as the approved schedule of `scheduleId`, replacing any earlier copy. */
  const approve = async (scheduleId: string, report: ScheduleReport): Promise<boolean> => {
    try {
      await approveSchedule({
        id: crypto.randomUUID(),
        schedule_id: scheduleId,
        year: report.year,
        month: report.month,
        approved_at: new Date().toISOString(),
        report: JSON.stringify(report),
      });
      await loadApprovedSchedules();
      return true;
    } catch (err) {
      console.error("Çizelge onaylanamadı:", err);
      return false;
    }
  };

  const remove = async (id: string): Promise<boolean> => {
    try {
      await deleteApprovedSchedule(id);
      await loadApprovedSchedules();
      return true;
    } catch (err) {
      console.error("Onaylı çizelge silinemedi:", err);
      return false;
    }
  };

  return { approvedSchedules, loadApprovedSchedules, approve, remove };
}
