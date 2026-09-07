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
  const rows = await db.select<DbTeacher[]>("SELECT * FROM teachers ORDER BY name ASC");
  return rows || [];
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

export async function saveSchedule(schedule: DbSchedule): Promise<void> {
  const db = await getDb();
  // Relies on the UNIQUE(year, month) index (see initDb): OR REPLACE resolves the conflict
  // by deleting the existing row for that year/month and inserting this one, so regenerating
  // a schedule for an already-saved month replaces it instead of appending a duplicate.
  await db.execute(
    "INSERT OR REPLACE INTO schedules (id, year, month, assignments, holidays, weekend_duty_days, config) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      schedule.id,
      schedule.year,
      schedule.month,
      schedule.assignments,
      schedule.holidays,
      schedule.weekend_duty_days,
      schedule.config,
    ]
  );
}

/**
 * Deletes all rows from all tables in the SQLite database to perform a complete system reset.
 */
export async function resetDb(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM teachers;");
  await db.execute("DELETE FROM availabilities;");
  await db.execute("DELETE FROM schedules;");
}
