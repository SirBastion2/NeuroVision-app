import type { AppConfig } from "./config.js";
import type { Database } from "./db.js";
import type { Metrics } from "./metrics.js";
import type { ObjectStore } from "./objects.js";

export interface Deps {
  db: Database;
  objects: ObjectStore;
  config: AppConfig;
  metrics: Metrics;
  now: () => Date;
}

export interface Actor {
  subject: string;
  orgId: string;
  role: "admin" | "reviewer" | "participant";
  appSessionId: string;
  csrfToken: string;
}
