import Database from "@tauri-apps/plugin-sql";

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }
  // Load SQLite database. It will be stored in the app data directory.
  dbInstance = await Database.load("sqlite:teacher_duty_scheduler.db");
  await initDb(dbInstance);
  return dbInstance;
}

async function initDb(db: Database) {
  // Create tables if they do not exist
  await db.execute(`
    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_hours REAL NOT NULL,
      priority INTEGER NOT NULL
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
      config TEXT NOT NULL
    );
  `);

  // Migration: older builds could insert a fresh row (fresh crypto.randomUUID()) on every
  // regenerate for the same (year, month), leaving duplicates behind. Before enforcing
  // uniqueness below, collapse any pre-existing duplicates down to the most recently
  // inserted row per (year, month) so the new unique index can be created safely.
  await db.execute(`
    DELETE FROM schedules
    WHERE rowid NOT IN (
      SELECT MAX(rowid) FROM schedules GROUP BY year, month
    );
  `);

  // Enforce one schedule row per (year, month) going forward. With this in place,
  // "INSERT OR REPLACE" (used by saveSchedule below) replaces the existing row for that
  // year/month instead of appending a duplicate.
  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_year_month ON schedules (year, month);
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
      report TEXT NOT NULL
    );
  `);
}

// Teachers CRUD Operations
export interface DbTeacher {
  id: string;
  name: string;
  target_hours: number;
  priority: number;
}

export async function getTeachers(): Promise<DbTeacher[]> {
  const db = await getDb();
  const rows = await db.select<DbTeacher[]>("SELECT * FROM teachers");
  // Sorted here, not with ORDER BY: SQLite compares bytes, which puts every
  // Turkish capital (Ç Ğ İ Ö Ş Ü) after Z. See AGENTS.md, "Turkish text".
  return (rows || []).sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function saveTeacher(teacher: DbTeacher): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO teachers (id, name, target_hours, priority) VALUES ($1, $2, $3, $4)",
    [teacher.id, teacher.name, teacher.target_hours, teacher.priority]
  );
}

export async function deleteTeacher(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM teachers WHERE id = $1", [id]);
  await db.execute("DELETE FROM availabilities WHERE teacher_id = $1", [id]);

  // Partner groups and monthly duty targets live inside each month's config
  // blob, so a deleted teacher would otherwise linger there as a dangling id
  // and reappear as a phantom member the next time that month is opened. A
  // group left with fewer than two members is no longer a group, so it goes too.
  const schedules = await getAllSchedules();
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
  year: number;
  month: number;
  assignments: string; // JSON string
  holidays: string;    // JSON string
  weekend_duty_days: string; // JSON string
  config: string;      // JSON string
}

export async function getSchedule(year: number, month: number): Promise<DbSchedule | null> {
  const db = await getDb();
  // ORDER BY rowid DESC is a defensive fallback: the UNIQUE(year, month) index created in
  // initDb should keep this to a single row, but if an older un-migrated db file ever slips
  // through, this guarantees the most recently saved schedule is the one that loads back.
  const rows = await db.select<DbSchedule[]>(
    "SELECT * FROM schedules WHERE year = $1 AND month = $2 ORDER BY rowid DESC LIMIT 1",
    [year, month]
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

export async function getAllSchedules(): Promise<DbSchedule[]> {
  const db = await getDb();
  const rows = await db.select<DbSchedule[]>(
    "SELECT * FROM schedules ORDER BY year ASC, month ASC"
  );
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
    "SELECT id FROM schedules WHERE year = $1 AND month = $2 ORDER BY rowid DESC LIMIT 1",
    [schedule.year, schedule.month]
  );
  // A month set up again after a reset has no row, but may still have an
  // approved copy pointing at its old id. Taking that id back means approving
  // the month again replaces the copy instead of adding a second one.
  const orphaned =
    existing && existing.length > 0
      ? []
      : await db.select<{ schedule_id: string }[]>(
          "SELECT schedule_id FROM approved_schedules WHERE year = $1 AND month = $2 AND schedule_id NOT IN (SELECT id FROM schedules) LIMIT 1",
          [schedule.year, schedule.month]
        );
  const id =
    existing && existing.length > 0
      ? existing[0].id
      : orphaned && orphaned.length > 0
        ? orphaned[0].schedule_id
        : schedule.id;

  // Relies on the UNIQUE(year, month) index (see initDb): OR REPLACE resolves the conflict
  // by deleting the existing row for that year/month and inserting this one, so regenerating
  // a schedule for an already-saved month replaces it instead of appending a duplicate.
  await db.execute(
    "INSERT OR REPLACE INTO schedules (id, year, month, assignments, holidays, weekend_duty_days, config) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      id,
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
  year: number;
  month: number;
  approved_at: string; // ISO timestamp
  report: string;      // JSON string: the frozen ScheduleReport
}

/** Every approved schedule, latest month first. */
export async function getApprovedSchedules(): Promise<DbApprovedSchedule[]> {
  const db = await getDb();
  const rows = await db.select<DbApprovedSchedule[]>(
    "SELECT id, schedule_id, year, month, approved_at, report FROM approved_schedules ORDER BY year DESC, month DESC, approved_at DESC"
  );
  return rows || [];
}

/** Stores an approved schedule, replacing the earlier copy of the same schedule. */
export async function approveSchedule(copy: DbApprovedSchedule): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO approved_schedules (id, schedule_id, year, month, approved_at, report) VALUES ($1, $2, $3, $4, $5, $6)",
    [copy.id, copy.schedule_id, copy.year, copy.month, copy.approved_at, copy.report]
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
}
