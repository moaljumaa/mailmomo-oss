import { DatabaseSync, type StatementSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "../env";
import { SCHEMA } from "./schema";

/**
 * SQLite via Node's built-in `node:sqlite` (Node >= 22.13): no native add-on to compile, so it installs
 * identically on Windows, macOS and Linux. This thin wrapper keeps the small better-sqlite3-style API the app uses.
 */
type Params = unknown[];
export class Db {
  private depth = 0;
  constructor(public raw: DatabaseSync) {}

  exec(sql: string) {
    this.raw.exec(sql);
  }

  pragma(p: string) {
    this.raw.exec(`PRAGMA ${p}`);
  }

  prepare(sql: string) {
    const st: StatementSync = this.raw.prepare(sql);
    return {
      get: (...a: Params) => st.get(...(a as never[])) as unknown,
      all: (...a: Params) => st.all(...(a as never[])) as unknown[],
      run: (...a: Params) => st.run(...(a as never[])),
    };
  }

  /** Nestable transaction (outermost = BEGIN/COMMIT, inner = SAVEPOINT). */
  transaction<T>(fn: () => T): () => T {
    return () => {
      const name = `sp${this.depth}`;
      this.raw.exec(this.depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
      this.depth++;
      try {
        const r = fn();
        this.depth--;
        this.raw.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${name}`);
        return r;
      } catch (e) {
        this.depth--;
        this.raw.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw e;
      }
    };
  }

  close() {
    this.raw.close();
  }
}

const g = globalThis as unknown as { __mmdb?: Db };

export function dbPath() {
  return process.env.DB_PATH || path.join(DATA_DIR, "mailmomo.db");
}

export function db(): Db {
  if (g.__mmdb) return g.__mmdb;
  const p = dbPath();
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  const d = new Db(new DatabaseSync(p));
  d.pragma("journal_mode = WAL");
  d.pragma("synchronous = NORMAL");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  d.exec(SCHEMA);
  g.__mmdb = d;
  return d;
}

export function closeDb() {
  g.__mmdb?.close();
  g.__mmdb = undefined;
}

export function tx<T>(fn: () => T): T {
  return db().transaction(fn)();
}
