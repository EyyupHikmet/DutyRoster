import { describe, it, expect, vi, beforeEach } from "vitest";
import SqliteDatabase from "better-sqlite3";

// db.ts imports `Database` (default export) from "@tauri-apps/plugin-sql", which only
// works inside a real Tauri runtime (it talks to the Rust IPC bridge). We replace it
// with a fake backed by a real in-memory SQLite connection (better-sqlite3) so these
// tests exercise db.ts's *actual* SQL — including the (year, month) dedup migration
// and unique-index upsert behavior fixed earlier — against a real SQL engine,
// not a mock that unconditionally reports success.
//
// `mockState` is created via vi.hoisted() specifically so the exact same object
// reference is visible both inside the vi.mock() factory below and in the test
// bodies later in this file. (An earlier version of this file kept the fake
// Database in a separate tests/mocks/pluginSql.ts file and set its state via a
// plain re-imported module-level variable; that silently broke because Vitest's
// mocked-module resolution for "@tauri-apps/plugin-sql" produced a DIFFERENT
// module instance than a plain `import("./mocks/pluginSql")` from this file — so
// `__setNextRawDb()` and the fake `Database.load()` were reading/writing two
// unrelated copies of `nextRawDb`, and every test silently got a fresh anonymous
// in-memory db instead of the seeded one. Verified by adding temporary console.log
// instrumentation to both call sites and observing "nextRawDb is NULL" logged
// immediately after "__setNextRawDb called" within the same test. vi.hoisted's
// shared object reference sidesteps that module-identity problem entirely.)
const mockState = vi.hoisted(() => ({
  nextRawDb: null as InstanceType<typeof import("better-sqlite3")> | null,
}));

function __setNextRawDb(db: InstanceType<typeof SqliteDatabase>) {
  mockState.nextRawDb = db;
}

vi.mock("@tauri-apps/plugin-sql", async () => {
  const { default: RealSqliteDatabase } = await import("better-sqlite3");

  function toSqliteSql(sql: string): string {
    // @tauri-apps/plugin-sql uses Postgres-style $1, $2, ... placeholders;
    // better-sqlite3 uses plain "?". Every call site in db.ts passes bind values
    // in the same left-to-right order the placeholders appear, so a straight
    // regex substitution is sufficient (no out-of-order params in this codebase).
    return sql.replace(/\$\d+/g, "?");
  }

  class FakeDatabase {
    private raw: InstanceType<typeof RealSqliteDatabase>;
    private constructor(raw: InstanceType<typeof RealSqliteDatabase>) {
      this.raw = raw;
    }
    static async load(_connectionString: string): Promise<FakeDatabase> {
      const raw = mockState.nextRawDb ?? new RealSqliteDatabase(":memory:");
      mockState.nextRawDb = null;
      return new FakeDatabase(raw as InstanceType<typeof RealSqliteDatabase>);
    }
    async execute(sql: string, bindValues: unknown[] = []) {
      const stmt = this.raw.prepare(toSqliteSql(sql));
      const info = stmt.run(...(bindValues as never[]));
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    }
    async select<T>(sql: string, bindValues: unknown[] = []): Promise<T> {
      const stmt = this.raw.prepare(toSqliteSql(sql));
      return stmt.all(...(bindValues as never[])) as unknown as T;
    }
  }

  return { default: FakeDatabase };
});

// db.ts caches its Database connection in a module-level singleton (`dbInstance`),
// so each test resets the module registry and re-imports db.ts fresh so initDb()
// genuinely runs again every time, including its dedup/migration logic. Because
// __setNextRawDb() closes over the vi.hoisted() `mockState` object (not a
// re-imported module), it keeps working correctly across vi.resetModules() calls.
async function freshDb() {
  vi.resetModules();
  const raw = new SqliteDatabase(":memory:");
  __setNextRawDb(raw);
  const dbModule = await import("../src/db");
  return { raw, ...dbModule };
}

beforeEach(() => {
  vi.resetModules();
});

describe("db.ts — Teachers CRUD", () => {
  it("saveTeacher + getTeachers round-trips a teacher, ordered by name", async () => {
    const { saveTeacher, getTeachers } = await freshDb();

    await saveTeacher({ id: "T2", name: "Zeynep", target_hours: 4, priority: 2 });
    await saveTeacher({ id: "T1", name: "Ahmet", target_hours: 5, priority: 3 });

    const teachers = await getTeachers();
    expect(teachers).toHaveLength(2);
    // getTeachers() orders by name ASC
    expect(teachers.map((t) => t.name)).toEqual(["Ahmet", "Zeynep"]);
    expect(teachers[0]).toMatchObject({ id: "T1", target_hours: 5, priority: 3 });
  });

  it("saveTeacher with an existing id upserts (INSERT OR REPLACE) rather than duplicating", async () => {
    const { saveTeacher, getTeachers } = await freshDb();

    await saveTeacher({ id: "T1", name: "Ahmet", target_hours: 4, priority: 1 });
    await saveTeacher({ id: "T1", name: "Ahmet Yılmaz", target_hours: 6, priority: 3 });

    const teachers = await getTeachers();
    expect(teachers).toHaveLength(1);
    expect(teachers[0]).toMatchObject({
      id: "T1",
      name: "Ahmet Yılmaz",
      target_hours: 6,
      priority: 3,
    });
  });

  it("deleteTeacher removes the teacher AND cascades to their availabilities", async () => {
    const { saveTeacher, deleteTeacher, getTeachers, saveAvailability, getAvailabilities } =
      await freshDb();

    await saveTeacher({ id: "T1", name: "Ahmet", target_hours: 4, priority: 1 });
    await saveAvailability({ teacher_id: "T1", date: "2026-10-01", status: "preferred" });

    await deleteTeacher("T1");

    expect(await getTeachers()).toHaveLength(0);
    expect(await getAvailabilities("T1")).toHaveLength(0);
  });
});

describe("db.ts — Availabilities", () => {
  it("saveAvailability upserts per (teacher_id, date) primary key", async () => {
    const { saveAvailability, getAvailabilities } = await freshDb();

    await saveAvailability({ teacher_id: "T1", date: "2026-10-01", status: "available" });
    await saveAvailability({ teacher_id: "T1", date: "2026-10-01", status: "unavailable" });

    const rows = await getAvailabilities("T1");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("unavailable");
  });

  it("getAvailabilities() with no teacherId returns rows for all teachers", async () => {
    const { saveAvailability, getAvailabilities } = await freshDb();

    await saveAvailability({ teacher_id: "T1", date: "2026-10-01", status: "preferred" });
    await saveAvailability({ teacher_id: "T2", date: "2026-10-02", status: "unavailable" });

    const rows = await getAvailabilities();
    expect(rows).toHaveLength(2);
  });

  it("saveBulkAvailabilities writes every entry in the batch", async () => {
    const { saveBulkAvailabilities, getAvailabilities } = await freshDb();

    await saveBulkAvailabilities([
      { teacher_id: "T1", date: "2026-10-01", status: "preferred" },
      { teacher_id: "T1", date: "2026-10-02", status: "unavailable" },
      { teacher_id: "T2", date: "2026-10-01", status: "available" },
    ]);

    expect(await getAvailabilities("T1")).toHaveLength(2);
    expect(await getAvailabilities()).toHaveLength(3);
  });
});

describe("db.ts — Schedules: (year, month) dedup migration + upsert", () => {
  it("initDb() collapses pre-existing duplicate (year, month) rows to the most recently inserted one", async () => {
    vi.resetModules();
    const raw = new SqliteDatabase(":memory:");
    // Pre-seed the schedules table with two duplicate rows for the same (year, month),
    // reproducing the exact bug fixed earlier (pre-migration, older builds could
    // insert a fresh row per regenerate instead of replacing). This must happen BEFORE
    // getDb()/initDb() runs so the dedup DELETE has real duplicates to collapse.
    raw.exec(`
      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        assignments TEXT NOT NULL,
        holidays TEXT NOT NULL,
        weekend_duty_days TEXT NOT NULL,
        config TEXT NOT NULL
      );
    `);
    const insert = raw.prepare(
      `INSERT INTO schedules (id, year, month, assignments, holidays, weekend_duty_days, config) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run("old-uuid", 2026, 5, "{}", "[]", "[]", "{}"); // lower rowid (older)
    insert.run("new-uuid", 2026, 5, "{}", "[]", "[]", "{}"); // higher rowid (most recent)

    __setNextRawDb(raw);
    const { getSchedule } = await import("../src/db");

    // getSchedule() calls getDb() internally, which runs initDb()'s dedup + unique
    // index migration as a side effect on first call.
    const result = await getSchedule(2026, 5);

    const remainingRows = raw.prepare("SELECT id FROM schedules").all() as { id: string }[];
    expect(remainingRows).toHaveLength(1);
    expect(remainingRows[0].id).toBe("new-uuid"); // kept the higher-rowid (most recent) row
    expect(result?.id).toBe("new-uuid");

    const index = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_schedules_year_month'")
      .get();
    expect(index, "CREATE UNIQUE INDEX idx_schedules_year_month should exist after initDb()").toBeDefined();
  });

  it("saveSchedule() called twice for the same (year, month) with a fresh UUID each time REPLACES, not duplicates", async () => {
    const { saveSchedule, getSchedule, raw } = await freshDb();

    await saveSchedule({
      id: "uuid-1",
      year: 2026,
      month: 6,
      assignments: JSON.stringify({ "2026-06-01": ["T1"] }),
      holidays: "[]",
      weekend_duty_days: "[]",
      config: JSON.stringify({ mode: "fairness" }),
    });

    // Simulate regenerating the schedule for the same month: useScheduleState.ts's
    // saveGeneratedScheduleToDb always mints a brand-new crypto.randomUUID().
    await saveSchedule({
      id: "uuid-2",
      year: 2026,
      month: 6,
      assignments: JSON.stringify({ "2026-06-01": ["T2"] }),
      holidays: "[]",
      weekend_duty_days: "[]",
      config: JSON.stringify({ mode: "priority" }),
    });

    const rows = raw.prepare("SELECT id FROM schedules WHERE year = 2026 AND month = 6").all() as {
      id: string;
    }[];
    expect(rows, "regenerating must replace the row, not append a duplicate").toHaveLength(1);
    expect(rows[0].id).toBe("uuid-2");

    const loaded = await getSchedule(2026, 6);
    expect(loaded?.id).toBe("uuid-2");
    expect(JSON.parse(loaded!.assignments)).toEqual({ "2026-06-01": ["T2"] });
    expect(JSON.parse(loaded!.config)).toEqual({ mode: "priority" });
  });

  it("saveSchedule() for a DIFFERENT (year, month) does not disturb the existing row", async () => {
    const { saveSchedule, raw } = await freshDb();

    await saveSchedule({
      id: "uuid-may",
      year: 2026,
      month: 5,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: "{}",
    });
    await saveSchedule({
      id: "uuid-june",
      year: 2026,
      month: 6,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: "{}",
    });

    const rows = raw.prepare("SELECT year, month, id FROM schedules ORDER BY year, month").all();
    expect(rows).toEqual([
      { year: 2026, month: 5, id: "uuid-may" },
      { year: 2026, month: 6, id: "uuid-june" },
    ]);
  });

  it("getSchedule() for a (year, month) with no saved schedule returns null", async () => {
    const { getSchedule } = await freshDb();
    expect(await getSchedule(2099, 1)).toBeNull();
  });
});

describe("db.ts — resetDb()", () => {
  it("wipes all rows from teachers, availabilities, and schedules", async () => {
    const { saveTeacher, saveAvailability, saveSchedule, resetDb, getTeachers, getAvailabilities, getSchedule } =
      await freshDb();

    await saveTeacher({ id: "T1", name: "Ahmet", target_hours: 4, priority: 1 });
    await saveAvailability({ teacher_id: "T1", date: "2026-10-01", status: "preferred" });
    await saveSchedule({
      id: "s1",
      year: 2026,
      month: 10,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: "{}",
    });

    await resetDb();

    expect(await getTeachers()).toHaveLength(0);
    expect(await getAvailabilities()).toHaveLength(0);
    expect(await getSchedule(2026, 10)).toBeNull();
  });
});
