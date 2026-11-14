import pg from "pg";
import { pgConnectionConfig } from "./env.js";
import { SCHEMA_SQL } from "./schema.js";

const { Pool } = pg;

export interface QueryResult<T> {
  rows: T[];
}

export interface Database {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
}

interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  exec(sql: string): Promise<unknown>;
  transaction?<T>(fn: (tx: QueryClient) => Promise<T>): Promise<T>;
}

export function wrapDatabase(client: QueryClient): Database {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await client.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await client.exec(sql);
    },
    async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
      if (!client.transaction) {
        throw new Error("Nested transactions are not supported.");
      }
      return client.transaction(async (tx) => fn(wrapDatabase(tx)));
    },
  };
}

export function createPgDatabase(connectionString: string): Database {
  const pool = new Pool(pgConnectionConfig(connectionString));
  const client: QueryClient = {
    query: async (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    transaction: async (fn) => {
      const connection = await pool.connect();
      const bound: QueryClient = {
        query: async (sql, params) => connection.query(sql, params),
        exec: (sql) => connection.query(sql),
      };
      try {
        await connection.query("BEGIN");
        const result = await fn(bound);
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    },
  };
  return wrapDatabase(client);
}

export async function migrate(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(724001)");
    await tx.exec(SCHEMA_SQL);
  });
  await migrateTimescale(db);
}

/**
 * When TimescaleDB is installed, turn response_events and gaze_samples into
 * hypertables. Plain Postgres and PGlite skip this and keep the original schema.
 */
export async function migrateTimescale(db: Database): Promise<boolean> {
  try {
    const available = await db.query<{ ok: boolean | string | number }>(
      `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') AS ok`,
    );
    const flag = available.rows[0]?.ok;
    if (flag !== true && flag !== "t" && Number(flag) !== 1) return false;
    await db.exec("CREATE EXTENSION IF NOT EXISTS timescaledb");
  } catch {
    return false;
  }

  const hypertable = async (table: string, timeColumn: string, includePk: boolean) => {
    if (includePk) {
      await db.exec(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_pkey`);
      await db.exec(
        `ALTER TABLE ${table} ADD PRIMARY KEY (${timeColumn}, session_id, trial_id, seq)`,
      );
    }
    await db.exec(
      `SELECT create_hypertable('${table}', '${timeColumn}', if_not_exists => TRUE, migrate_data => TRUE)`,
    );
  };

  try {
    await hypertable("response_events", "recorded_at", true);
  } catch {
    /* already converted, or the extension cannot change this table */
  }
  try {
    await hypertable("gaze_samples", "recorded_at", true);
  } catch {
    /* optional time-series table */
  }
  try {
    await db.exec(
      `SELECT create_hypertable('metric_events', 'created_at', if_not_exists => TRUE, migrate_data => TRUE)`,
    );
  } catch {
    /* metrics stay a plain table when hypertable conversion is unavailable */
  }
  return true;
}

export async function sessionActivity(
  db: Database,
  orgId: string,
): Promise<Array<{ bucket: string; count: number }>> {
  const map = (rows: Array<{ bucket: Date | string; count: number | string }>) =>
    rows.map((row) => ({
      bucket: new Date(row.bucket).toISOString(),
      count: Number(row.count),
    }));
  try {
    const result = await db.query<{ bucket: Date | string; count: number }>(
      `SELECT time_bucket('1 day', started_at) AS bucket, COUNT(*)::int AS count
       FROM sessions WHERE org_id = $1
       GROUP BY 1 ORDER BY 1`,
      [orgId],
    );
    return map(result.rows);
  } catch {
    const result = await db.query<{ bucket: Date | string; count: number }>(
      `SELECT date_trunc('day', started_at) AS bucket, COUNT(*)::int AS count
       FROM sessions WHERE org_id = $1
       GROUP BY 1 ORDER BY 1`,
      [orgId],
    );
    return map(result.rows);
  }
}

export async function many<T>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function one<T>(db: Database, sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await many<T>(db, sql, params);
  return rows[0] ?? null;
}

export function asJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}
