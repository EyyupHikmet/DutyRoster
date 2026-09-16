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
  mockSelect: null as ReturnType<typeof vi.fn> | null,
  mockExecute: null as ReturnType<typeof vi.fn> | null,
}));

function __setNextRawDb(db: InstanceType<typeof SqliteDatabase>) {
  mockState.nextRawDb = db;
}

function __useMockSelectExecute(select: ReturnType<typeof vi.fn>, execute: ReturnType<typeof vi.fn>) {
  mockState.mockSelect = select;
  mockState.mockExecute = execute;
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
      // If mockExecute is set, use it (for tests that need to inspect exact SQL calls)
      if (mockState.mockExecute) {
        return mockState.mockExecute(sql, bindValues);
      }
      const stmt = this.raw.prepare(toSqliteSql(sql));
      const info = stmt.run(...(bindValues as never[]));
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    }
    async select<T>(sql: string, bindValues: unknown[] = []): Promise<T> {
      // If mockSelect is set, use it (for tests that need to inspect exact SQL calls)
      if (mockState.mockSelect) {
        return mockState.mockSelect(sql, bindValues) as T;
      }
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
  mockState.mockSelect = null;
  mockState.mockExecute = null;
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

  it("getTeachers lists the staff in Turkish alphabetical order", async () => {
    const { saveTeacher, getTeachers } = await freshDb();

    const names = ["Zeynep", "Şule", "Çağlar", "İsmail", "Ümit", "Davut", "Ömer", "Sule", "Ilgın", "Cengiz", "Uğur", "Oya"];
    for (const [i, name] of names.entries()) {
      await saveTeacher({ id: `T${i}`, name, target_hours: 1, priority: 1 });
    }

    const teachers = await getTeachers();
    expect(teachers.map((t) => t.name)).toEqual([
      "Cengiz", "Çağlar", "Davut", "Ilgın", "İsmail", "Oya", "Ömer", "Sule", "Şule", "Uğur", "Ümit", "Zeynep",
    ]);
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
    const { getSchedule, getDutyPosts } = await import("../src/db");

    // getSchedule() calls getDb() internally, which runs initDb()'s dedup + unique
    // index migration as a side effect on first call.
    const result = await getSchedule((await getDutyPosts())[0].id, 2026, 5);

    const remainingRows = raw.prepare("SELECT id FROM schedules").all() as { id: string }[];
    expect(remainingRows).toHaveLength(1);
    expect(remainingRows[0].id).toBe("new-uuid"); // kept the higher-rowid (most recent) row
    expect(result?.id).toBe("new-uuid");

    const index = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_schedules_post_year_month'")
      .get();
    expect(index, "CREATE UNIQUE INDEX idx_schedules_post_year_month should exist after initDb()").toBeDefined();
  });

  it("saveSchedule() called twice for the same (year, month) with a fresh UUID each time REPLACES, not duplicates", async () => {
    const { saveSchedule, getSchedule, getDutyPosts, raw } = await freshDb();
    const post = (await getDutyPosts())[0].id;

    await saveSchedule({
      id: "uuid-1",
      post_id: post,
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
      post_id: post,
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
    // The month keeps the id it was first saved with, so an approved schedule
    // can keep pointing at the schedule it came from (ADR-0006).
    expect(rows[0].id).toBe("uuid-1");

    const loaded = await getSchedule(post, 2026, 6);
    expect(loaded?.id).toBe("uuid-1");
    expect(JSON.parse(loaded!.assignments)).toEqual({ "2026-06-01": ["T2"] });
    expect(JSON.parse(loaded!.config)).toEqual({ mode: "priority" });
  });

  it("saveSchedule() for a DIFFERENT (year, month) does not disturb the existing row", async () => {
    const { saveSchedule, getDutyPosts, raw } = await freshDb();
    const post = (await getDutyPosts())[0].id;

    await saveSchedule({
      id: "uuid-may",
      post_id: post,
      year: 2026,
      month: 5,
      assignments: "{}",
      holidays: "[]",
      weekend_duty_days: "[]",
      config: "{}",
    });
    await saveSchedule({
      id: "uuid-june",
      post_id: post,
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
    const { getSchedule, getDutyPosts } = await freshDb();
    expect(await getSchedule((await getDutyPosts())[0].id, 2099, 1)).toBeNull();
  });
});

describe("db.ts — resetDb()", () => {
  it("wipes all rows from teachers, availabilities, and schedules", async () => {
    const { saveTeacher, saveAvailability, saveSchedule, resetDb, getTeachers, getAvailabilities, getSchedule, getDutyPosts } =
      await freshDb();
    const post = (await getDutyPosts())[0].id;

    await saveTeacher({ id: "T1", name: "Ahmet", target_hours: 4, priority: 1, post_id: post });
    await saveAvailability({ teacher_id: "T1", date: "2026-10-01", status: "preferred" });
    await saveSchedule({
      id: "s1",
      post_id: post,
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
    expect(await getSchedule(post, 2026, 10)).toBeNull();
  });

  it("keeps approved schedules unless asked to delete them too", async () => {
    const { approveSchedule, getApprovedSchedules, resetDb } = await freshDb();
    await approveSchedule(approvedCopy({ id: "a1", schedule_id: "s1", year: 2026, month: 10 }));

    await resetDb();
    expect((await getApprovedSchedules()).map((c) => c.id)).toEqual(["a1"]);

    await resetDb({ includeApproved: true });
    expect(await getApprovedSchedules()).toEqual([]);
  });
});

function approvedCopy(overrides: Partial<import("../src/db").DbApprovedSchedule>) {
  return {
    id: "a1",
    schedule_id: "s1",
    post_id: "p1",
    year: 2026,
    month: 9,
    approved_at: "2026-09-30T10:00:00.000Z",
    report: JSON.stringify({ marker: overrides.id ?? "a1" }),
    ...overrides,
  };
}


/** A database as saved by the app before duty posts existed. */
async function legacyDb(seed: (raw: InstanceType<typeof SqliteDatabase>) => void) {
  vi.resetModules();
  const raw = new SqliteDatabase(":memory:");
  raw.exec(`
    CREATE TABLE teachers (id TEXT PRIMARY KEY, name TEXT NOT NULL, target_hours REAL NOT NULL, priority INTEGER NOT NULL);
    CREATE TABLE availabilities (teacher_id TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (teacher_id, date));
    CREATE TABLE schedules (id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, assignments TEXT NOT NULL,
      holidays TEXT NOT NULL, weekend_duty_days TEXT NOT NULL, config TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_schedules_year_month ON schedules (year, month);
    CREATE TABLE approved_schedules (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL UNIQUE, year INTEGER NOT NULL,
      month INTEGER NOT NULL, approved_at TEXT NOT NULL, report TEXT NOT NULL);
  `);
  seed(raw);
  __setNextRawDb(raw);
  const dbModule = await import("../src/db");
  return { raw, ...dbModule };
}

describe("db.ts — duty posts", () => {
  it("turns an existing database into a single post named Yurt that owns everything", async () => {
    const { getDutyPosts, getTeachers, getSchedule, getApprovedSchedules, getAvailabilities } = await legacyDb((raw) => {
      raw.exec(`
        INSERT INTO teachers VALUES ('T1', 'Çağlar', 4, 1);
        INSERT INTO availabilities VALUES ('T1', '2026-09-01', 'preferred');
        INSERT INTO schedules VALUES ('s9', 2026, 9, '{"2026-09-01":["T1"]}', '[]', '[]', '{}');
        INSERT INTO approved_schedules VALUES ('a9', 's9', 2026, 9, '2026-09-30T10:00:00.000Z', '{}');
      `);
    });

    const posts = await getDutyPosts();
    expect(posts.map((p) => p.name)).toEqual(["Yurt"]);
    const yurt = posts[0].id;

    expect(await getTeachers(yurt)).toEqual([{ id: "T1", name: "Çağlar", target_hours: 4, priority: 1, post_id: yurt }]);
    expect((await getSchedule(yurt, 2026, 9))?.id).toBe("s9");
    expect((await getApprovedSchedules()).map((c) => c.post_id)).toEqual([yurt]);
    expect(await getAvailabilities()).toHaveLength(1);
  });

  it("upgrades an existing database only once", async () => {
    const { raw, getDutyPosts } = await legacyDb(() => {});
    await getDutyPosts();

    // The next launch reads the same file again.
    vi.resetModules();
    __setNextRawDb(raw);
    const again = await import("../src/db");

    expect((await again.getDutyPosts()).map((p) => p.name)).toEqual(["Yurt"]);
  });

  it("starts a new database with one empty post named Yurt, which is the one selected", async () => {
    const { getDutyPosts, getTeachers, getLastPostId } = await freshDb();

    const posts = await getDutyPosts();
    expect(posts.map((p) => p.name)).toEqual(["Yurt"]);
    expect(await getTeachers(posts[0].id)).toEqual([]);
    expect(await getLastPostId()).toBe(posts[0].id);
  });

  it("adds posts and lists them in Turkish alphabetical order", async () => {
    const { addDutyPost, getDutyPosts } = await freshDb();

    await addDutyPost("Kız Yurdu");
    await addDutyPost("  Çamlık Binası ");

    expect((await getDutyPosts()).map((p) => p.name)).toEqual(["Çamlık Binası", "Kız Yurdu", "Yurt"]);
  });

  it("refuses a post name another post already has, compared like teacher names", async () => {
    const { addDutyPost, getDutyPosts } = await freshDb();
    await addDutyPost("Kız Yurdu");

    expect((await addDutyPost("KIZ  YURDU")).status).toBe("duplicate");
    expect((await addDutyPost("Kiz Yurdu")).status).toBe("added");
    expect((await addDutyPost("   ")).status).toBe("empty");
    expect(await getDutyPosts()).toHaveLength(3);
  });

  it("renames a post, refusing another post's name but allowing its own in new capitals", async () => {
    const { addDutyPost, renameDutyPost, getDutyPosts } = await freshDb();
    const kiz = await addDutyPost("Kız Yurdu");
    if (kiz.status !== "added") throw new Error("setup");
    const yurt = (await getDutyPosts()).find((p) => p.name === "Yurt")!;

    expect((await renameDutyPost(yurt.id, "kız yurdu")).status).toBe("duplicate");
    expect((await renameDutyPost(yurt.id, "Erkek Yurdu")).status).toBe("renamed");
    expect((await renameDutyPost(kiz.post.id, "KIZ YURDU")).status).toBe("renamed");

    expect((await getDutyPosts()).map((p) => p.name)).toEqual(["Erkek Yurdu", "KIZ YURDU"]);
  });

  it("remembers the interface language, and has none until one is chosen", async () => {
    const { getLanguage, setLanguage } = await freshDb();

    expect(await getLanguage(), "nothing saved means the default language applies").toBeNull();

    await setLanguage("en");
    expect(await getLanguage()).toBe("en");

    await setLanguage("tr");
    expect(await getLanguage()).toBe("tr");
  });

  it("remembers the last selected post, falling back to the first when it no longer exists", async () => {
    const { addDutyPost, setLastPostId, getLastPostId, getDutyPosts } = await freshDb();
    const kiz = await addDutyPost("Kız Yurdu");
    if (kiz.status !== "added") throw new Error("setup");

    await setLastPostId(kiz.post.id);
    expect(await getLastPostId()).toBe(kiz.post.id);

    await setLastPostId("gone");
    expect(await getLastPostId()).toBe((await getDutyPosts())[0].id);
  });
});

describe("db.ts — each duty post has its own staff and months", () => {
  async function twoPosts() {
    const dbModule = await freshDb();
    const yurt = (await dbModule.getDutyPosts())[0].id;
    const added = await dbModule.addDutyPost("Kız Yurdu");
    if (added.status !== "added") throw new Error("setup");
    return { ...dbModule, yurt, kiz: added.post.id };
  }

  const setup = (id: string, postId: string, year: number, month: number, config = "{}") => ({
    id,
    post_id: postId,
    year,
    month,
    assignments: "{}",
    holidays: "[]",
    weekend_duty_days: "[]",
    config,
  });

  it("keeps the same month of two posts apart", async () => {
    const { saveSchedule, getSchedule, yurt, kiz } = await twoPosts();
    await saveSchedule(setup("y11", yurt, 2026, 11));
    await saveSchedule(setup("k11", kiz, 2026, 11));

    const again = await saveSchedule(setup("fresh-id", yurt, 2026, 11, '{"mode":"random"}'));

    expect(again).toBe("y11");
    expect((await getSchedule(yurt, 2026, 11))?.config).toBe('{"mode":"random"}');
    expect((await getSchedule(kiz, 2026, 11))?.id).toBe("k11");
  });

  it("lists one post's teachers, or every teacher when no post is given", async () => {
    const { saveTeacher, getTeachers, yurt, kiz } = await twoPosts();
    await saveTeacher({ id: "T1", name: "Ayşe", target_hours: 4, priority: 1, post_id: yurt });
    await saveTeacher({ id: "T2", name: "Çağlar", target_hours: 4, priority: 1, post_id: kiz });

    expect((await getTeachers(kiz)).map((t) => t.id)).toEqual(["T2"]);
    expect((await getTeachers()).map((t) => t.id)).toEqual(["T1", "T2"]);
  });

  it("deletes a post with its teachers, their availability and its months, but keeps its approved schedules", async () => {
    const {
      saveTeacher, saveAvailability, saveSchedule, approveSchedule, deleteDutyPost,
      getDutyPosts, getTeachers, getAvailabilities, getSchedule, getApprovedSchedules, yurt, kiz,
    } = await twoPosts();
    await saveTeacher({ id: "T1", name: "Ayşe", target_hours: 4, priority: 1, post_id: yurt });
    await saveTeacher({ id: "T2", name: "Çağlar", target_hours: 4, priority: 1, post_id: kiz });
    await saveAvailability({ teacher_id: "T1", date: "2026-11-02", status: "preferred" });
    await saveAvailability({ teacher_id: "T2", date: "2026-11-02", status: "preferred" });
    await saveSchedule(setup("k11", kiz, 2026, 11));
    await approveSchedule({
      id: "a11", schedule_id: "k11", post_id: kiz, year: 2026, month: 11,
      approved_at: "2026-11-30T10:00:00.000Z", report: "{}",
    });

    expect((await deleteDutyPost(kiz)).status).toBe("deleted");

    expect((await getDutyPosts()).map((p) => p.name)).toEqual(["Yurt"]);
    expect((await getTeachers()).map((t) => t.id)).toEqual(["T1"]);
    expect((await getAvailabilities()).map((a) => a.teacher_id)).toEqual(["T1"]);
    expect(await getSchedule(kiz, 2026, 11)).toBeNull();
    expect((await getApprovedSchedules()).map((c) => c.id)).toEqual(["a11"]);
  });

  it("refuses to delete the last post", async () => {
    const { getDutyPosts, deleteDutyPost } = await freshDb();
    const [only] = await getDutyPosts();

    expect((await deleteDutyPost(only.id)).status).toBe("last");
    expect(await getDutyPosts()).toHaveLength(1);
  });

  it("moves a teacher to another post, cleaning them out of the old post's month setups", async () => {
    const { saveTeacher, saveAvailability, saveSchedule, moveTeacherToPost, getTeachers, getAvailabilities, getSchedule, yurt, kiz } =
      await twoPosts();
    await saveTeacher({ id: "T1", name: "Ayşe", target_hours: 4, priority: 1, post_id: yurt });
    await saveTeacher({ id: "T3", name: "Burak", target_hours: 4, priority: 1, post_id: yurt });
    await saveAvailability({ teacher_id: "T1", date: "2026-10-01", status: "unavailable" });
    await saveSchedule(
      setup("y10", yurt, 2026, 10, JSON.stringify({
        partnerGroups: [{ id: "g1", memberIds: ["T1", "T3"], goalDays: 1 }],
        monthlyTargets: { T1: 3, T3: 2 },
      }))
    );

    await moveTeacherToPost("T1", kiz);

    expect((await getTeachers(kiz)).map((t) => t.id)).toEqual(["T1"]);
    expect((await getTeachers(yurt)).map((t) => t.id)).toEqual(["T3"]);
    expect(await getAvailabilities("T1")).toHaveLength(1);
    const config = JSON.parse((await getSchedule(yurt, 2026, 10))!.config);
    expect(config.partnerGroups).toEqual([]);
    expect(config.monthlyTargets).toEqual({ T3: 2 });
  });

  it("resets to a single empty post named Yurt, which becomes the selected one", async () => {
    const { saveTeacher, setLastPostId, resetDb, getDutyPosts, getTeachers, getLastPostId, kiz } = await twoPosts();
    await saveTeacher({ id: "T2", name: "Çağlar", target_hours: 4, priority: 1, post_id: kiz });
    await setLastPostId(kiz);

    await resetDb();

    const posts = await getDutyPosts();
    expect(posts.map((p) => p.name)).toEqual(["Yurt"]);
    expect(await getTeachers()).toEqual([]);
    expect(await getLastPostId()).toBe(posts[0].id);
  });
});

describe("db.ts — approved schedules", () => {
  it("stores an approved schedule and reads it back unchanged", async () => {
    const { approveSchedule, getApprovedSchedules } = await freshDb();
    const copy = approvedCopy({ id: "a1", schedule_id: "s1", year: 2026, month: 9 });

    await approveSchedule(copy);

    expect(await getApprovedSchedules()).toEqual([copy]);
  });

  it("lists approved schedules latest month first", async () => {
    const { approveSchedule, getApprovedSchedules } = await freshDb();
    await approveSchedule(approvedCopy({ id: "eylul", schedule_id: "s9", year: 2026, month: 9 }));
    await approveSchedule(approvedCopy({ id: "ocak", schedule_id: "s1", year: 2027, month: 1 }));
    await approveSchedule(approvedCopy({ id: "kasim", schedule_id: "s11", year: 2026, month: 11 }));

    expect((await getApprovedSchedules()).map((c) => c.id)).toEqual(["ocak", "kasim", "eylul"]);
  });

  it("approving the same schedule again replaces its approved copy", async () => {
    const { approveSchedule, getApprovedSchedules } = await freshDb();
    await approveSchedule(approvedCopy({ id: "first", schedule_id: "s11", month: 11 }));
    await approveSchedule(approvedCopy({ id: "other", schedule_id: "s10", month: 10 }));

    await approveSchedule(approvedCopy({ id: "second", schedule_id: "s11", month: 11 }));

    expect((await getApprovedSchedules()).map((c) => c.id)).toEqual(["second", "other"]);
  });

  it("deletes one approved schedule and leaves the rest", async () => {
    const { approveSchedule, deleteApprovedSchedule, getApprovedSchedules } = await freshDb();
    await approveSchedule(approvedCopy({ id: "eylul", schedule_id: "s9", month: 9 }));
    await approveSchedule(approvedCopy({ id: "ekim", schedule_id: "s10", month: 10 }));

    await deleteApprovedSchedule("ekim");

    expect((await getApprovedSchedules()).map((c) => c.id)).toEqual(["eylul"]);
  });

  it("deleting a teacher leaves approved schedules untouched", async () => {
    const { saveTeacher, approveSchedule, deleteTeacher, getApprovedSchedules } = await freshDb();
    await saveTeacher({ id: "T1", name: "Çağlar", target_hours: 4, priority: 1 });
    const copy = approvedCopy({ report: JSON.stringify({ teachers: [{ id: "T1", name: "Çağlar" }] }) });
    await approveSchedule(copy);

    await deleteTeacher("T1");

    expect(await getApprovedSchedules()).toEqual([copy]);
  });

});

describe("öğretmen silindiğinde aylık gruplar ve hedefler temizlenir", () => {
  it("silinen öğretmeni gruplardan ve aylık hedeflerden çıkarır", async () => {
    const config = JSON.stringify({
      mode: "fairness",
      teachersPerDay: 1,
      pinnedAssignments: {},
      partnerGroups: [
        { id: "g1", memberIds: ["T1", "T2", "T3"], goalDays: 2 },
        { id: "g2", memberIds: ["T1", "T2"], goalDays: 1 },
      ],
      monthlyTargets: { T1: 5, T2: 3 },
    });

    // Only month setups come back: setting up the database also reads other
    // tables (duty posts, column lists), which must look empty here.
    const mockSelect = vi.fn(async (sql: string) =>
      sql.includes("FROM schedules")
        ? [{ id: "s1", post_id: "p1", year: 2026, month: 10, assignments: "{}", holidays: "[]", weekend_duty_days: "[]", config }]
        : []
    );
    const mockExecute = vi.fn().mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });

    vi.resetModules();
    __useMockSelectExecute(mockSelect, mockExecute);

    const { deleteTeacher } = await import("../src/db");
    await deleteTeacher("T1");

    const rewrite = mockExecute.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("UPDATE schedules SET config")
    );
    expect(rewrite).toBeDefined();
    const written = JSON.parse(rewrite![1][0] as string);

    // g1 iki üyeyle ayakta kalır, g2 tek üye kaldığı için silinir.
    expect(written.partnerGroups).toEqual([
      { id: "g1", memberIds: ["T2", "T3"], goalDays: 2 },
    ]);
    expect(written.monthlyTargets).toEqual({ T2: 3 });
  });

  it("grubu olmayan aylara dokunmaz", async () => {
    const config = JSON.stringify({ mode: "fairness", teachersPerDay: 1, pinnedAssignments: {} });
    // Only month setups come back: setting up the database also reads other
    // tables (duty posts, column lists), which must look empty here.
    const mockSelect = vi.fn(async (sql: string) =>
      sql.includes("FROM schedules")
        ? [{ id: "s1", post_id: "p1", year: 2026, month: 10, assignments: "{}", holidays: "[]", weekend_duty_days: "[]", config }]
        : []
    );
    const mockExecute = vi.fn().mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 });

    vi.resetModules();
    __useMockSelectExecute(mockSelect, mockExecute);

    const { deleteTeacher } = await import("../src/db");
    await deleteTeacher("T1");

    const rewrite = mockExecute.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("UPDATE schedules SET config")
    );
    expect(rewrite).toBeUndefined();
  });
});
