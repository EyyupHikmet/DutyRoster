import { it, expect, vi } from "vitest";
import SqliteDatabase from "better-sqlite3";

// The app can set the database up from two places at once: React's StrictMode
// runs mount effects twice, and a hot reload brings a second copy of db.ts.
// Both copies open the same database file. Here every load returns the same
// in-memory database, so two copies of the module really do race on one.
const shared = vi.hoisted(() => ({ raw: null as InstanceType<typeof import("better-sqlite3")> | null }));

vi.mock("@tauri-apps/plugin-sql", async () => {
  const toSqlite = (sql: string) => sql.replace(/\$\d+/g, "?");
  class FakeDatabase {
    static async load(): Promise<FakeDatabase> {
      return new FakeDatabase();
    }
    async execute(sql: string, bindValues: unknown[] = []) {
      const info = shared.raw!.prepare(toSqlite(sql)).run(...(bindValues as never[]));
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    }
    async select<T>(sql: string, bindValues: unknown[] = []): Promise<T> {
      return shared.raw!.prepare(toSqlite(sql)).all(...(bindValues as never[])) as T;
    }
  }
  return { default: FakeDatabase };
});

it("creates a single default post when the database is set up twice at the same time", async () => {
  shared.raw = new SqliteDatabase(":memory:");
  vi.resetModules();
  const first = await import("../src/db");
  vi.resetModules();
  const second = await import("../src/db");

  const [fromFirst, fromSecond] = await Promise.all([first.getDutyPosts(), second.getDutyPosts()]);

  expect(shared.raw.prepare("SELECT name FROM duty_posts").all()).toEqual([{ name: "Yurt" }]);
  expect(fromFirst.map((p) => p.id)).toEqual(fromSecond.map((p) => p.id));
});

it("sets the database up once when one copy of the module is asked for it twice at the same time", async () => {
  shared.raw = new SqliteDatabase(":memory:");
  vi.resetModules();
  const db = await import("../src/db");

  await Promise.all([db.getDutyPosts(), db.getTeachers(), db.getLastPostId()]);

  expect(shared.raw.prepare("SELECT COUNT(*) AS n FROM duty_posts").get()).toEqual({ n: 1 });
});
