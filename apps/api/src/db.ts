import pg from "pg";
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
  const pool = new Pool({ connectionString });
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
  await db.exec(SCHEMA_SQL);
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
