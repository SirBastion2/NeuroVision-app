import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolConfig } from "pg";

const PG_QUERY_KEYS = new Set([
  "application_name",
  "channel_binding",
  "client_encoding",
  "connect_timeout",
  "gssencmode",
  "host",
  "keepalives",
  "keepalives_idle",
  "options",
  "replication",
  "ssl",
  "sslcert",
  "sslkey",
  "sslmode",
  "sslpassword",
  "sslrootcert",
  "target_session_attrs",
]);

/** Repo root from `apps/api/src`. */
export function findRepoRoot(from = fileURLToPath(new URL(".", import.meta.url))): string {
  return join(from, "../../..");
}

export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** Load gitignored `.env` from the repo root. Existing process env wins. */
export function loadRootEnv(env: NodeJS.ProcessEnv = process.env, root = findRepoRoot()): Record<string, string> {
  const file = join(root, ".env");
  if (!existsSync(file)) return {};
  const parsed = parseEnvFile(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
  return parsed;
}

function stripUnknownParams(connectionString: string): { href: string; sslmode: string } {
  try {
    const url = new URL(connectionString);
    const kept = new URLSearchParams();
    let sslmode = "";
    for (const [key, value] of url.searchParams) {
      const name = key.toLowerCase();
      if (name === "uselibpqcompat") continue;
      if (name === "sslmode") {
        // Applied via config.ssl below; leaving it in the URL makes pg override that.
        sslmode = value.toLowerCase();
        continue;
      }
      if (PG_QUERY_KEYS.has(name)) kept.set(key, value);
    }
    url.search = kept.toString();
    return { href: url.toString(), sslmode };
  } catch {
    const cleaned = connectionString
      .replace(/([?&])uselibpqcompat=[^&]*/gi, "$1")
      .replace(/[?&]$/, "")
      .replace(/\?&/, "?")
      .replace(/&&/g, "&");
    const sslmode = /[?&]sslmode=([^&]+)/i.exec(cleaned)?.[1]?.toLowerCase() ?? "";
    return { href: cleaned, sslmode };
  }
}

/**
 * Hosted Postgres (Tiger Cloud) appends `uselibpqcompat=true&sslmode=require`.
 * `pg` does not accept `uselibpqcompat` as a startup parameter.
 */
export interface PgPoolOptions {
  /** Pool size. Serverless invocations should pass 1. */
  max?: number;
}

export function pgConnectionConfig(connectionString: string, options: PgPoolOptions = {}): PoolConfig {
  const { href, sslmode } = stripUnknownParams(connectionString);
  const config: PoolConfig = {
    connectionString: href,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  };
  if (options.max !== undefined) config.max = options.max;
  if (sslmode === "require" || sslmode === "prefer") {
    config.ssl = { rejectUnauthorized: false };
  } else if (sslmode === "verify-ca" || sslmode === "verify-full") {
    config.ssl = { rejectUnauthorized: true };
  }
  return config;
}
