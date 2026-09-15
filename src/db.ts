import Database from "@tauri-apps/plugin-sql";
import { foldName } from "./utils/turkishText";

let dbReady: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  // One setup per copy of this module, however many callers arrive before it
  // finishes. (initDb must still tolerate another copy setting the same file
  // up at once, as after a hot reload; see ensureAPost.)
  if (!dbReady) {
    dbReady = (async () => {
      // Load SQLite database. It will be stored in the app data directory.
      const db = await Database.load("sqlite:teacher_duty_scheduler.db");
      await initDb(db);
      return db;
    })().catch((err) => {
      dbReady = null;
      throw err;
    });
  }
  return dbReady;
}

/** The post every database starts with, and that existing data moves into (ADR-0007). */
const DEFAULT_POST_NAME = "Yurt";

async function initDb(db: Database) {
  // Create tables if they do not exist
  await db.execute(`
    CREATE TABLE IF NOT EXISTS duty_posts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_hours REAL NOT NULL,
      priority INTEGER NOT NULL,
      post_id TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS availabilities (
      teacher_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (teacher_id, date)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      assignments TEXT NOT NULL,
      holidays TEXT NOT NULL,
      weekend_duty_days TEXT NOT NULL,
      config TEXT NOT NULL,
      post_id TEXT
    );
  `);

  // Approved schedules are frozen copies kept apart from the working month
  // (ADR-0006). `report` holds everything the duty report needs, including
  // teacher names, so a copy never reads the teachers table again. A schedule
  // has at most one approved copy, hence the unique schedule_id.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS approved_schedules (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL UNIQUE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      approved_at TEXT NOT NULL,
      report TEXT NOT NULL,
      post_id TEXT
    );
  `);

  // Databases saved before duty posts existed have no post columns.
  await addColumnIfMissing(db, "teachers", "post_id", "TEXT");
  await addColumnIfMissing(db, "schedules", "post_id", "TEXT");
  await addColumnIfMissing(db, "approved_schedules", "post_id", "TEXT");

  // Migration: older builds could insert a fresh row (fresh crypto.randomUUID()) on every
  // regenerate for the same month, leaving duplicates behind. Before enforcing uniqueness
  // below, collapse any pre-existing duplicates down to the most recently inserted row per
  // (post, year, month) so the unique index can be created safely.
  await db.execute(`
    DELETE FROM schedules
    WHERE rowid NOT IN (
      SELECT MAX(rowid) FROM schedules GROUP BY post_id, year, month
    );
  `);

  // Every database has at least one post. Anything saved before posts existed
  // belongs to it.
  const defaultPostId = await ensureAPost(db);
  await db.execute("UPDATE teachers SET post_id = $1 WHERE post_id IS NULL", [defaultPostId]);
  await db.execute("UPDATE schedules SET post_id = $1 WHERE post_id IS NULL", [defaultPostId]);
  await db.execute(
    `UPDATE approved_schedules
       SET post_id = COALESCE((SELECT s.post_id FROM schedules s WHERE s.id = approved_schedules.schedule_id), $1)
     WHERE post_id IS NULL`,
    [defaultPostId]
  );

  // One month setup per (post, year, month), replacing the older one per (year, month)
  // (ADR-0007). With this in place, "INSERT OR REPLACE" (used by saveSchedule below)
  // replaces the existing row for that post's month instead of appending a duplicate.
  await db.execute("DROP INDEX IF EXISTS idx_schedules_year_month;");
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_post_year_month ON schedules (post_id, year, month);
  `);
}

async function addColumnIfMissing(db: Database, table: string, column: string, type: string) {
  const columns = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  if (!(columns || []).some((c) => c.name === column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** The id of the first post, creating the default post when there is none. */
async function ensureAPost(db: Database): Promise<string> {
  // A single statement, so two setups running at once cannot both find the
  // table empty and both insert a default post.
  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO duty_posts (id, name) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM duty_posts)",
    [id, DEFAULT_POST_NAME]
  );
  const posts = sortPosts((await db.select<DbDutyPost[]>("SELECT id, name FROM duty_posts")) || []);
  return posts[0]?.id ?? id;
}

// Duty Posts Operations
export interface DbDutyPost {
  id: string;
  name: string;
}

// Sorted in code, not with ORDER BY: SQLite compares bytes, which puts every
// Turkish capital (Ç Ğ İ Ö Ş Ü) after Z. See AGENTS.md, "Turkish text".
const sortPosts = (posts: DbDutyPost[]) => [...posts].sort((a, b) => a.name.localeCompare(b.name, "tr"));

/** Every duty post, in Turkish alphabetical order. */
export async function getDutyPosts(): Promise<DbDutyPost[]> {
  const db = await getDb();
  return sortPosts((await db.select<DbDutyPost[]>("SELECT id, name FROM duty_posts")) || []);
}

export type DutyPostNameResult<T> = T | { status: "duplicate"; existing: DbDutyPost } | { status: "empty" };

/**
 * Checks a post name: posts are told apart by name, compared like teacher
 * names (case and extra spaces do not count, Turkish letters do).
 */
async function checkPostName(name: string, exceptId?: string) {
  const trimmed = name.trim();
  if (!trimmed) return { status: "empty" as const };
  const existing = (await getDutyPosts()).find((p) => p.id !== exceptId && foldName(p.name) === foldName(trimmed));
  if (existing) return { status: "duplicate" as const, existing };
  return { status: "ok" as const, name: trimmed };
}

export async function addDutyPost(name: string): Promise<DutyPostNameResult<{ status: "added"; post: DbDutyPost }>> {
  const checked = await checkPostName(name);
  if (checked.status !== "ok") return checked;
  const db = await getDb();
  const post = { id: crypto.randomUUID(), name: checked.name };
  await db.execute("INSERT INTO duty_posts (id, name) VALUES ($1, $2)", [post.id, post.name]);
  return { status: "added", post };
}

export async function renameDutyPost(id: string, name: string): Promise<DutyPostNameResult<{ status: "renamed" }>> {
  const checked = await checkPostName(name, id);
  if (checked.status !== "ok") return checked;
  const db = await getDb();
  await db.execute("UPDATE duty_posts SET name = $1 WHERE id = $2", [checked.name, id]);
  return { status: "renamed" };
}

const LAST_POST_KEY = "last_post_id";

/** The post the app last had selected, or the first post if that one is gone. */
export async function getLastPostId(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>("SELECT value FROM app_settings WHERE key = $1", [LAST_POST_KEY]);
  const posts = await getDutyPosts();
  const remembered = rows && rows.length > 0 ? rows[0].value : null;
  return posts.some((p) => p.id === remembered) ? (remembered as string) : posts[0].id;
}

export async function setLastPostId(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ($1, $2)", [LAST_POST_KEY, id]);
}

// Teachers CRUD Operations
export interface DbTeacher {
  id: string;
  name: string;
  target_hours: number;
  priority: number;
  /** The duty post whose staff the teacher belongs to (ADR-0007). */
  post_id: string;
}

/** One post's teachers, or every teacher when no post is given. */
export async function getTeachers(postId?: string): Promise<DbTeacher[]> {
  const db = await getDb();
  const rows = postId
    ? await db.select<DbTeacher[]>("SELECT * FROM teachers WHERE post_id = $1", [postId])
    : await db.select<DbTeacher[]>("SELECT * FROM teachers");
  // Sorted here, not with ORDER BY: SQLite compares bytes, which puts every
  // Turkish capital (Ç Ğ İ Ö Ş Ü) after Z. See AGENTS.md, "Turkish text".
  return (rows || []).sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function saveTeacher(teacher: DbTeacher): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO teachers (id, name, target_hours, priority, post_id) VALUES ($1, $2, $3, $4, $5)",
    [teacher.id, teacher.name, teacher.target_hours, teacher.priority, teacher.post_id]
  );
}

export async function deleteTeacher(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM teachers WHERE id = $1", [id]);
  await db.execute("DELETE FROM availabilities WHERE teacher_id = $1", [id]);
  await removeTeacherFromMonthSetups(db, id, await getAllSchedules());
}

/**
 * Moves a teacher to another post's staff (ADR-0007). Their availability
 * belongs to them and goes with them; the old post's month setups stop
 * mentioning them, the same cleanup as deleting a teacher.
 */
export async function moveTeacherToPost(teacherId: string, postId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ post_id: string }[]>("SELECT post_id FROM teachers WHERE id = $1", [teacherId]);
  const oldPostId = rows && rows.length > 0 ? rows[0].post_id : null;
  if (!oldPostId || oldPostId === postId) return;
  await db.execute("UPDATE teachers SET post_id = $1 WHERE id = $2", [postId, teacherId]);
  await removeTeacherFromMonthSetups(db, teacherId, await getAllSchedules(oldPostId));
}

/**
 * Deletes a post with its staff, their availability and its month setups. Its
 * approved schedules are official records and stay. A database always keeps
 * at least one post.
 */
export async function deleteDutyPost(id: string): Promise<{ status: "deleted" } | { status: "last" }> {
  if ((await getDutyPosts()).length <= 1) return { status: "last" };
  const db = await getDb();
  await db.execute("DELETE FROM availabilities WHERE teacher_id IN (SELECT id FROM teachers WHERE post_id = $1)", [id]);
  await db.execute("DELETE FROM teachers WHERE post_id = $1", [id]);
  await db.execute("DELETE FROM schedules WHERE post_id = $1", [id]);
  await db.execute("DELETE FROM duty_posts WHERE id = $1", [id]);
  return { status: "deleted" };
}

async function removeTeacherFromMonthSetups(db: Database, id: string, schedules: DbSchedule[]) {
  // Partner groups and monthly duty targets live inside each month's config
  // blob, so a removed teacher would otherwise linger there as a dangling id
  // and reappear as a phantom member the next time that month is opened. A
  // group left with fewer than two members is no longer a group, so it goes too.
  for (const row of schedules) {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(row.config);
    } catch {
      continue; // an unreadable config is not this function's problem to fix
    }

    const groups = Array.isArray(config.partnerGroups)
      ? (config.partnerGroups as { id: string; memberIds: string[]; goalDays: number }[])
      : [];
    const targets = (config.monthlyTargets ?? {}) as Record<string, number>;

    const touchesGroups = groups.some((gr) => gr.memberIds.includes(id));
    const touchesTargets = Object.prototype.hasOwnProperty.call(targets, id);
    if (!touchesGroups && !touchesTargets) continue;

    const nextGroups = groups
      .map((gr) => ({ ...gr, memberIds: gr.memberIds.filter((m) => m !== id) }))
      .filter((gr) => gr.memberIds.length >= 2);

    const nextTargets = { ...targets };
    delete nextTargets[id];

    const nextConfig = JSON.stringify({
      ...config,
      partnerGroups: nextGroups,
      monthlyTargets: nextTargets,
    });

    await db.execute("UPDATE schedules SET config = $1 WHERE id = $2", [
      nextConfig,
      row.id,
    ]);
  }
}

// Availabilities Operations
export interface DbAvailability {
  teacher_id: string;
  date: string;
  status: "preferred" | "available" | "unavailable";
}

export async function getAvailabilities(teacherId?: string): Promise<DbAvailability[]> {
  const db = await getDb();
  if (teacherId) {
    return await db.select<DbAvailability[]>(
      "SELECT * FROM availabilities WHERE teacher_id = $1",
      [teacherId]
    );
  } else {
    return await db.select<DbAvailability[]>("SELECT * FROM availabilities");
  }
}

export async function saveAvailability(avail: DbAvailability): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO availabilities (teacher_id, date, status) VALUES ($1, $2, $3)",
    [avail.teacher_id, avail.date, avail.status]
  );
}

export async function saveBulkAvailabilities(avails: DbAvailability[]): Promise<void> {
  const db = await getDb();
  // Using simple loop since tauri-plugin-sql handles single statements.
  // This is clean and robust for our local-first scale.
  for (const avail of avails) {
    await db.execute(
      "INSERT OR REPLACE INTO availabilities (teacher_id, date, status) VALUES ($1, $2, $3)",
      [avail.teacher_id, avail.date, avail.status]
    );
  }
}

// Schedules Operations
export interface DbSchedule {
  id: string;
  /** The duty post this month setup belongs to (ADR-0007). */
  post_id: string;
  year: number;
  month: number;
  assignments: string; // JSON string
  holidays: string;    // JSON string
  weekend_duty_days: string; // JSON string
  config: string;      // JSON string
}

export async function getSchedule(postId: string, year: number, month: number): Promise<DbSchedule | null> {
  const db = await getDb();
  // ORDER BY rowid DESC is a defensive fallback: the UNIQUE(post, year, month) index created
  // in initDb should keep this to a single row, but if an older un-migrated db file ever slips
  // through, this guarantees the most recently saved schedule is the one that loads back.
  const rows = await db.select<DbSchedule[]>(
    "SELECT * FROM schedules WHERE post_id = $1 AND year = $2 AND month = $3 ORDER BY rowid DESC LIMIT 1",
    [postId, year, month]
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

/** One post's month setups, or every post's when no post is given. */
export async function getAllSchedules(postId?: string): Promise<DbSchedule[]> {
  const db = await getDb();
  const rows = postId
    ? await db.select<DbSchedule[]>("SELECT * FROM schedules WHERE post_id = $1 ORDER BY year ASC, month ASC", [postId])
    : await db.select<DbSchedule[]>("SELECT * FROM schedules ORDER BY year ASC, month ASC");
  return rows || [];
}

/**
 * Saves a month and returns the id it is stored under. A month keeps the id it
 * was first saved with, whatever id the caller passes, so an approved schedule
 * can keep pointing at the schedule it came from (ADR-0006).
 */
export async function saveSchedule(schedule: DbSchedule): Promise<string> {
  const db = await getDb();
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM schedules WHERE post_id = $1 AND year = $2 AND month = $3 ORDER BY rowid DESC LIMIT 1",
    [schedule.post_id, schedule.year, schedule.month]
  );
  const id = existing && existing.length > 0 ? existing[0].id : schedule.id;

  // Relies on the UNIQUE(post, year, month) index (see initDb): OR REPLACE resolves the
  // conflict by deleting the existing row for that post's month and inserting this one, so
  // regenerating a schedule replaces it instead of appending a duplicate.
  await db.execute(
    "INSERT OR REPLACE INTO schedules (id, post_id, year, month, assignments, holidays, weekend_duty_days, config) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      id,
      schedule.post_id,
      schedule.year,
      schedule.month,
      schedule.assignments,
      schedule.holidays,
      schedule.weekend_duty_days,
      schedule.config,
    ]
  );
  return id;
}

// Approved Schedules Operations
export interface DbApprovedSchedule {
  id: string;
  schedule_id: string; // the working schedule this copy was approved from
  /** The duty post of that schedule. The post may since have been deleted. */
  post_id: string;
  year: number;
  month: number;
  approved_at: string; // ISO timestamp
  report: string;      // JSON string: the frozen ScheduleReport
}

/** Every approved schedule, latest month first. */
export async function getApprovedSchedules(): Promise<DbApprovedSchedule[]> {
  const db = await getDb();
  const rows = await db.select<DbApprovedSchedule[]>(
    "SELECT id, schedule_id, post_id, year, month, approved_at, report FROM approved_schedules ORDER BY year DESC, month DESC, approved_at DESC"
  );
  return rows || [];
}

/** Stores an approved schedule, replacing the earlier copy of the same schedule. */
export async function approveSchedule(copy: DbApprovedSchedule): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO approved_schedules (id, schedule_id, post_id, year, month, approved_at, report) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [copy.id, copy.schedule_id, copy.post_id, copy.year, copy.month, copy.approved_at, copy.report]
  );
}

export async function deleteApprovedSchedule(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM approved_schedules WHERE id = $1", [id]);
}

/**
 * Deletes all rows from all tables in the SQLite database to perform a complete system reset.
 * Approved schedules are official records, so they survive a reset unless
 * `includeApproved` is set.
 */
export async function resetDb(options: { includeApproved?: boolean } = {}): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM teachers;");
  await db.execute("DELETE FROM availabilities;");
  await db.execute("DELETE FROM schedules;");
  if (options.includeApproved) {
    await db.execute("DELETE FROM approved_schedules;");
  }
  // A database always has a post, so a reset leaves one empty "Yurt"
  // (ADR-0007). Approved schedules that are kept still belong to, and name,
  // the posts they were approved in.
  await db.execute("DELETE FROM duty_posts;");
  await ensureAPost(db);
}
