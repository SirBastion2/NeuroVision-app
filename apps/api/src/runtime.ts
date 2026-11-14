import { assertRuntimeSafe, loadConfig, type AppConfig } from "./config.js";
import { seedDemo } from "./demo-seed.js";
import { createMetrics, type Metrics } from "./metrics.js";
import { loadRootEnv } from "./env.js";
import { createObjectStoreFromEnv, type ObjectStore } from "./objects.js";
import { createPgDatabase, migrate, type Database } from "./db.js";

export interface Runtime {
  config: AppConfig;
  db: Database;
  objects: ObjectStore;
  metrics: Metrics;
  now: () => Date;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return loadConfig(env);
}

export interface OpenRuntimeOptions {
  /** pg pool size. Defaults to 1 on Vercel, otherwise the driver default. */
  poolMax?: number;
}

export async function openRuntime(env: NodeJS.ProcessEnv = process.env, options: OpenRuntimeOptions = {}): Promise<Runtime> {
  loadRootEnv(env);
  const config = loadConfig(env);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const vercelPool = env.VERCEL === "1" || env.VERCEL === "true";
  const fromEnv = env.PG_POOL_MAX ? Number(env.PG_POOL_MAX) : undefined;
  const poolMax =
    options.poolMax ??
    (fromEnv !== undefined && Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : vercelPool ? 1 : undefined);
  const db = createPgDatabase(databaseUrl, poolMax !== undefined ? { max: poolMax } : {});
  await migrate(db);
  const objects = createObjectStoreFromEnv(env, db);
  assertRuntimeSafe(config, objects.kind);
  if (config.identityMode === "local" && env.DEMO_SEED !== "false") {
    await seedDemo(db);
  }
  if (objects.kind === "s3") {
    await objects.ensureBucket();
  }
  return { config, db, objects, metrics: createMetrics(db), now: () => new Date() };
}

export { assertRuntimeSafe, loadConfig } from "./config.js";
export { createObjectStoreFromEnv } from "./objects.js";
export { createPgDatabase, migrate } from "./db.js";
export { createMetrics } from "./metrics.js";
