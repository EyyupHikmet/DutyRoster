import { DbDutyPost, DbSchedule, DbTeacher } from "../db";
import { daySettingsOf } from "./monthSetup";
import { freezeScheduleReport, ScheduleReport } from "./scheduleReport";
import { schoolYearStart } from "./approvedSchedules";

/** An approved schedule as a report for every post needs it. */
interface EarlierCopy {
  year: number;
  month: number;
  /** The post's name as shown: frozen at approval, or the post's current name for old copies. */
  postName: string;
  report: ScheduleReport;
}

export interface AllPostsReportInput {
  /** Every duty post. */
  posts: DbDutyPost[];
  /** The post on screen, whose schedule comes from the screen. */
  screenPostId: string;
  /** The schedule on screen as its duty report shows it. */
  screenReport: ScheduleReport;
  /** Saved month setups; only the working month's are used. */
  schedules: DbSchedule[];
  /** Every post's teachers. */
  teachers: DbTeacher[];
  /** Approved schedules to add from earlier in the school year; empty when earlier schedules are not included. */
  earlierCopies: EarlierCopy[];
}

export interface AllPostsReport {
  /** The working month's schedules, then earlier approved copies, latest first. */
  reports: ScheduleReport[];
  /** Posts with no schedule for the working month, in Turkish alphabetical order. */
  skippedPosts: string[];
}

const monthIndex = ({ year, month }: { year: number; month: number }) => year * 12 + month;

/** A saved month setup as its duty report, or null when it has no schedule to report. */
function savedReport(row: DbSchedule, post: DbDutyPost, teachers: DbTeacher[]): ScheduleReport | null {
  const days = daySettingsOf(row);
  if (!days) return null;
  try {
    const generatedSchedule: Record<string, string[]> = JSON.parse(row.assignments) || {};
    if (!Object.values(generatedSchedule).some((ids) => ids.length > 0)) return null;
    const monthlyTargets = JSON.parse(row.config).monthlyTargets || {};
    return freezeScheduleReport(
      { year: row.year, month: row.month, postName: post.name, generatedSchedule, monthlyTargets, ...days },
      teachers.filter((t) => t.post_id === post.id)
    );
  } catch {
    return null;
  }
}

/**
 * The schedules a report for every duty post is made of (#28). The post on
 * screen brings the schedule on screen, saved or not; every other post brings
 * its saved schedule for the month, frozen with its own teachers, or is named
 * as left out. Earlier approved copies of every post in the school year follow.
 */
export function gatherAllPostsReports(input: AllPostsReportInput): AllPostsReport {
  const { year, month } = input.screenReport;
  const reports: ScheduleReport[] = [input.screenReport];
  const skippedPosts: string[] = [];

  for (const post of input.posts) {
    if (post.id === input.screenPostId) continue;
    const row = input.schedules.find((s) => s.post_id === post.id && s.year === year && s.month === month);
    const report = row ? savedReport(row, post, input.teachers) : null;
    if (report) reports.push(report);
    else skippedPosts.push(post.name);
  }

  const start = schoolYearStart(year, month);
  const earlier = input.earlierCopies
    .filter((c) => schoolYearStart(c.year, c.month) === start && monthIndex(c) < monthIndex({ year, month }))
    .sort((a, b) => monthIndex(b) - monthIndex(a))
    .map((c) => (c.report.postName ? c.report : { ...c.report, postName: c.postName }));

  return {
    reports: [...reports, ...earlier],
    skippedPosts: skippedPosts.sort((a, b) => a.localeCompare(b, "tr")),
  };
}
