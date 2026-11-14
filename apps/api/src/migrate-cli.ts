import { createPgDatabase, migrate } from "./db.js";
import { loadRootEnv } from "./env.js";

loadRootEnv();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const db = createPgDatabase(databaseUrl, { max: 1 });
await migrate(db);
console.log("Migrations applied.");
process.exit(0);
