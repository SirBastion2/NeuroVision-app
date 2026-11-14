import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config.js";
import type { Deps } from "../src/deps.js";
import { migrate, one, wrapDatabase, type Database } from "../src/db.js";
import { createMetrics } from "../src/metrics.js";
import { MemoryObjectStore } from "../src/objects.js";
import { buildServer } from "../src/server.js";
import { batchPayload, manifestFor, sampleSession } from "./fixture-session.js";

export const world = {
  orgA: "org-a",
  orgB: "org-b",
  adminA: "admin-a",
  reviewerA: "reviewer-a",
  reviewerU: "reviewer-u",
  participantSubject: "participant-a",
  participantId: "participant-a",
  otherSubject: "participant-b",
  otherParticipantId: "participant-b",
  outsider: "admin-b",
  outsideParticipantId: "participant-c",
};

export async function createHarness(env: Record<string, string> = {}) {
  const client = new PGlite();
  await client.waitReady;
  const db = wrapDatabase({
    query: (sql, params) => client.query(sql, params),
    exec: async (sql) => {
      await client.exec(sql);
    },
    transaction: (fn) =>
      client.transaction((tx) =>
        fn({
          query: (sql, params) => tx.query(sql, params),
          exec: async (sql) => {
            await tx.exec(sql);
          },
        }),
      ),
  });
  await migrate(db);
  const objects = new MemoryObjectStore();
  const config = loadConfig({
    NODE_ENV: "test",
    IDENTITY_MODE: "local",
    COOKIE_SECURE: "false",
    ...env,
  });
  const deps: Deps = {
    db,
    objects,
    config,
    metrics: createMetrics(db),
    now: () => new Date(),
  };
  const app = await buildServer({ ...deps, logger: false });
  return {
    app,
    db,
    objects,
    deps,
    async close() {
      await app.close();
      await client.close();
    },
  };
}

export async function seed(db: Database) {
  await db.exec(`
    INSERT INTO organizations (id, name) VALUES
      ('${world.orgA}', 'Org A'),
      ('${world.orgB}', 'Org B');
    INSERT INTO identities (subject) VALUES
      ('${world.adminA}'),
      ('${world.reviewerA}'),
      ('${world.reviewerU}'),
      ('${world.participantSubject}'),
      ('${world.otherSubject}'),
      ('${world.outsider}');
    INSERT INTO memberships (org_id, subject, role) VALUES
      ('${world.orgA}', '${world.adminA}', 'admin'),
      ('${world.orgA}', '${world.reviewerA}', 'reviewer'),
      ('${world.orgA}', '${world.reviewerU}', 'reviewer'),
      ('${world.orgA}', '${world.participantSubject}', 'participant'),
      ('${world.orgA}', '${world.otherSubject}', 'participant'),
      ('${world.orgB}', '${world.outsider}', 'admin');
    INSERT INTO participants (id, org_id, label, subject) VALUES
      ('${world.participantId}', '${world.orgA}', 'Participant A', '${world.participantSubject}'),
      ('${world.otherParticipantId}', '${world.orgA}', 'Participant B', '${world.otherSubject}'),
      ('${world.outsideParticipantId}', '${world.orgB}', 'Participant C', NULL);
    INSERT INTO reviewer_assignments (org_id, subject, participant_id) VALUES
      ('${world.orgA}', '${world.reviewerA}', '${world.participantId}');
  `);
}

export function cookieValue(headers: { "set-cookie"?: string | string[] | undefined }, name: string) {
  const raw = headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const line of list) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (pair.slice(0, eq) === name) return pair.slice(eq + 1);
  }
  throw new Error(`Missing cookie ${name}`);
}

export async function login(app: FastifyInstance, subject: string, orgId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/local",
    payload: { subject, orgId },
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    cookie: `nv_session=${cookieValue(response.headers, "nv_session")}`,
    csrf: cookieValue(response.headers, "nv_csrf"),
  };
}

export function authed(session: { cookie: string; csrf: string }) {
  return { cookie: session.cookie, "x-csrf-token": session.csrf };
}

export async function uploadSession(app: FastifyInstance, auth: { cookie: string; csrf: string }, sessionId: string) {
  const record = sampleSession(sessionId);
  const admin = await login(app, world.adminA, world.orgA);
  const assignment = await app.inject({
    method: "POST",
    url: "/api/v1/assignments",
    headers: authed(admin),
    payload: { participantId: world.participantId, exposureStatus: "unseen", manifest: manifestFor(record) },
  });
  assert.equal(assignment.statusCode, 200, assignment.body);
  const created = assignment.json() as { id: string; revision: number };
  const session = await app.inject({
    method: "PUT",
    url: `/api/v1/sessions/${sessionId}`,
    headers: authed(auth),
    payload: {
      participantId: world.participantId,
      assignmentId: created.id,
      assignmentRevision: created.revision,
      startedAt: record.startedAt,
      completion: "complete",
    },
  });
  assert.equal(session.statusCode, 200, session.body);
  const batch = await app.inject({
    method: "PUT",
    url: `/api/v1/sessions/${sessionId}/batches/batch-1`,
    headers: authed(auth),
    payload: batchPayload(record),
  });
  assert.equal(batch.statusCode, 200, batch.body);
  const finalized = await app.inject({
    method: "POST",
    url: `/api/v1/sessions/${sessionId}/finalize`,
    headers: authed(auth),
  });
  assert.equal(finalized.statusCode, 200, finalized.body);
  return { record, assignment: created, finalized: finalized.json() as { jobId: string; inputHash: string } };
}

export async function countJobs(db: Database, sessionId: string) {
  const row = await one<{ count: number }>(db, "SELECT COUNT(*)::int AS count FROM jobs WHERE session_id = $1 AND kind = 'analysis'", [sessionId]);
  return Number(row?.count ?? 0);
}
