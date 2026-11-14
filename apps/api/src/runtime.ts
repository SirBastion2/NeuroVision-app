import { assertRuntimeSafe, loadConfig, type AppConfig } from "./config.js";
import { seedDemo } from "./demo-seed.js";
import { createMetrics, type Metrics } from "./metrics.js";
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

export async function openRuntime(env: NodeJS.ProcessEnv = process.env): Promise<Runtime> {
  const config = loadConfig(env);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const objects = createObjectStoreFromEnv(env);
  assertRuntimeSafe(config, objects.kind);
  const db = createPgDatabase(databaseUrl);
  await migrate(db);
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
