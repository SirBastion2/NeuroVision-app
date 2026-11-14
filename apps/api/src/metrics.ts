import type { Database } from "./db.js";
import { many, one } from "./db.js";

export type MetricName = "upload_failure" | "analysis_failure";

export interface Metrics {
  record(name: MetricName): Promise<void>;
}

export function createMetrics(db: Database): Metrics {
  return {
    async record(name) {
      await db.query("INSERT INTO metric_events (name) VALUES ($1)", [name]);
    },
  };
}

export interface MetricSnapshot {
  uploadFailures: number;
  analysisFailures: number;
  deletionBacklog: number;
  queueAgeMs: number;
}

export async function readMetrics(db: Database, now: Date): Promise<MetricSnapshot> {
  const counts = await many<{ name: string; count: number }>(
    db,
    "SELECT name, COUNT(*)::int AS count FROM metric_events GROUP BY name",
  );
  const byName = new Map(counts.map((row) => [row.name, Number(row.count)]));
  const backlog = await one<{ count: number }>(
    db,
    "SELECT COUNT(*)::int AS count FROM jobs WHERE kind = 'cleanup' AND status IN ('queued', 'leased', 'failed')",
  );
  const oldest = await one<{ created_at: Date | string }>(
    db,
    "SELECT MIN(created_at) AS created_at FROM jobs WHERE status IN ('queued', 'leased')",
  );
  const createdAt = oldest?.created_at ? new Date(oldest.created_at).getTime() : null;
  return {
    uploadFailures: byName.get("upload_failure") ?? 0,
    analysisFailures: byName.get("analysis_failure") ?? 0,
    deletionBacklog: Number(backlog?.count ?? 0),
    queueAgeMs: createdAt === null ? 0 : Math.max(0, now.getTime() - createdAt),
  };
}

export function metricsText(snapshot: MetricSnapshot): string {
  return [
    "# HELP neurovision_upload_failures Upload checksum or size failures",
    "# TYPE neurovision_upload_failures counter",
    `neurovision_upload_failures ${snapshot.uploadFailures}`,
    "# HELP neurovision_analysis_failures Analysis jobs that failed an attempt",
    "# TYPE neurovision_analysis_failures counter",
    `neurovision_analysis_failures ${snapshot.analysisFailures}`,
    "# HELP neurovision_deletion_backlog Cleanup jobs not yet succeeded",
    "# TYPE neurovision_deletion_backlog gauge",
    `neurovision_deletion_backlog ${snapshot.deletionBacklog}`,
    "# HELP neurovision_queue_age_ms Age of the oldest queued or leased job",
    "# TYPE neurovision_queue_age_ms gauge",
    `neurovision_queue_age_ms ${Math.round(snapshot.queueAgeMs)}`,
    "",
  ].join("\n");
}
