import { Buffer } from "node:buffer";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { createAppSession, finishOidcLogin, startOidcLogin, writeSessionCookies, clearSessionCookies } from "./auth.js";
import type { BatchPayload } from "./contracts.provisional.js";
import type { Actor, Deps } from "./deps.js";
import { HttpError } from "./errors.js";
import { commitLegacy, previewLegacy } from "./legacy.js";
import { metricsText, readMetrics } from "./metrics.js";
import {
  assignReviewer,
  authorizeTrace,
  createAssignment,
  createMembership,
  createParticipant,
  deleteParticipant,
  exportParticipant,
  finalizeSession,
  listParticipants,
  listSessions,
  putBatch,
  putBattery,
  putSession,
  readSession,
  readSummaries,
  readTraceBytes,
  readTraceDownload,
  revokeMembership,
  scoringNormsForOrg,
  writeTraceContent,
} from "./sessions.js";

const id = z.string().min(1).max(80);

const manifestSchema = z.object({
  protocol: z.string().min(1).max(120),
  scorer: z.string().min(1).max(120),
  taskIds: z.array(z.enum(["target-selection", "line-bisection"])).min(1),
  source: z.enum(["live", "demonstration"]),
  input: z.enum(["mouse-trackpad", "keyboard", "touch"]),
  accessibilityId: z.string().min(1).max(120),
  configHash: z.string().min(1).max(200),
});

function actorOf(request: FastifyRequest): Actor {
  if (!request.actor) throw new HttpError(401, "unauthorized", "Sign in required.");
  return request.actor;
}

export async function registerRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get("/health", { config: { public: true } }, async () => ({ status: "ok" }));

  app.get("/metrics", { config: { public: true } }, async (_request, reply) => {
    const snapshot = await readMetrics(deps.db, deps.now());
    return reply.type("text/plain; version=0.0.4").send(metricsText(snapshot));
  });

  app.post("/api/v1/auth/local", { config: { public: true } }, async (request, reply) => {
    if (deps.config.identityMode !== "local") {
      throw new HttpError(404, "not_found", "Local sign-in is disabled.");
    }
    const body = z.object({ subject: z.string().min(1).max(200), orgId: id }).parse(request.body);
    const membership = await deps.db.query<{ role: Actor["role"]; revoked_at: Date | string | null }>(
      "SELECT role, revoked_at FROM memberships WHERE org_id = $1 AND subject = $2",
      [body.orgId, body.subject],
    );
    const row = membership.rows[0];
    if (!row || row.revoked_at) throw new HttpError(403, "forbidden", "No active membership for this local identity.");
    const session = await createAppSession(deps, body.subject, body.orgId);
    writeSessionCookies(reply, deps.config, session.id, session.csrf, session.expires);
    return { subject: body.subject, orgId: body.orgId, role: row.role };
  });

  app.get("/api/v1/auth/login", { config: { public: true } }, async (_request, reply) => {
    const url = await startOidcLogin(deps);
    return reply.redirect(url);
  });

  app.get("/api/v1/auth/callback", { config: { public: true } }, async (request, reply) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
    const result = await finishOidcLogin(deps, query.code, query.state);
    writeSessionCookies(reply, deps.config, result.sessionId, result.csrf, result.expires);
    return reply.redirect("/");
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const actor = actorOf(request);
    await deps.db.query("DELETE FROM app_sessions WHERE id = $1", [actor.appSessionId]);
    clearSessionCookies(reply, deps.config);
    return { signedOut: true };
  });

  app.get("/api/v1/me", async (request) => {
    const actor = actorOf(request);
    return { subject: actor.subject, orgId: actor.orgId, role: actor.role, csrfToken: actor.csrfToken };
  });

  app.get("/api/v1/participants", async (request) => {
    return { participants: await listParticipants(deps, actorOf(request)) };
  });

  app.post("/api/v1/participants", async (request) => {
    const body = z.object({ id: id.optional(), label: z.string().min(1).max(120), subject: z.string().min(1).max(200).optional() }).parse(request.body);
    return createParticipant(deps, actorOf(request), body);
  });

  app.post("/api/v1/memberships", async (request) => {
    const body = z.object({ subject: z.string().min(1).max(200), role: z.enum(["admin", "reviewer", "participant"]) }).parse(request.body);
    return createMembership(deps, actorOf(request), body);
  });

  app.post("/api/v1/memberships/revoke", async (request) => {
    const body = z.object({ subject: z.string().min(1).max(200) }).parse(request.body);
    return revokeMembership(deps, actorOf(request), body.subject);
  });

  app.post("/api/v1/reviewer-assignments", async (request) => {
    const body = z.object({ subject: z.string().min(1).max(200), participantId: id }).parse(request.body);
    return assignReviewer(deps, actorOf(request), body);
  });

  app.post("/api/v1/assignments", async (request) => {
    const body = z
      .object({
        id: id.optional(),
        participantId: id,
        exposureStatus: z.enum(["unseen", "seen", "unknown"]),
        manifest: manifestSchema,
      })
      .parse(request.body);
    return createAssignment(deps, actorOf(request), body);
  });

  app.get("/api/v1/sessions", async (request) => {
    return listSessions(deps, actorOf(request));
  });

  app.get("/api/v1/norms", async (request) => {
    return scoringNormsForOrg(deps, actorOf(request));
  });

  app.put("/api/v1/sessions/:sessionId", async (request) => {
    const { sessionId } = z.object({ sessionId: id }).parse(request.params);
    const body = z
      .object({
        participantId: id,
        assignmentId: id,
        assignmentRevision: z.number().int().positive(),
        startedAt: z.string().datetime(),
        completion: z.enum(["active", "complete", "interrupted"]),
      })
      .parse(request.body);
    return putSession(deps, actorOf(request), sessionId, body);
  });

  app.put("/api/v1/sessions/:sessionId/battery", async (request) => {
    const { sessionId } = z.object({ sessionId: id }).parse(request.params);
    return putBattery(deps, actorOf(request), sessionId, request.body);
  });

  app.put("/api/v1/sessions/:sessionId/batches/:batchId", async (request) => {
    const path = z.object({ sessionId: id, batchId: id }).parse(request.params);
    const body = z
      .object({
        sequence: z.number().int().positive(),
        parentBatchId: z.string().min(1).max(80).nullable(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        shell: z.record(z.unknown()),
        trials: z.array(z.unknown()),
        practice: z.array(z.unknown()),
      })
      .parse(request.body);
    return putBatch(deps, actorOf(request), path.sessionId, path.batchId, body as BatchPayload & { contentHash: string });
  });

  app.post("/api/v1/sessions/:sessionId/trace-uploads", async (request) => {
    const { sessionId } = z.object({ sessionId: id }).parse(request.params);
    const body = z
      .object({
        declaredByteCount: z.number().int().positive(),
        declaredExpandedBytes: z.number().int().positive(),
        declaredChecksum: z.string().regex(/^[a-f0-9]{64}$/),
        contentType: z.string().min(1).max(120),
      })
      .parse(request.body);
    return authorizeTrace(deps, actorOf(request), sessionId, body);
  });

  app.put(
    "/api/v1/sessions/:sessionId/trace-uploads/:traceId/content",
    { bodyLimit: deps.config.traceMaxBytes },
    async (request) => {
      const path = z.object({ sessionId: id, traceId: id }).parse(request.params);
      if (!Buffer.isBuffer(request.body)) throw new HttpError(400, "validation", "Trace body must be raw bytes.");
      return writeTraceContent(deps, actorOf(request), path.sessionId, path.traceId, new Uint8Array(request.body));
    },
  );

  app.get("/api/v1/sessions/:sessionId/trace-uploads/:traceId/content", async (request, reply) => {
    const path = z.object({ sessionId: id, traceId: id }).parse(request.params);
    const bytes = await readTraceBytes(deps, actorOf(request), path.sessionId, path.traceId);
    return reply.header("cache-control", "no-store").type("application/octet-stream").send(Buffer.from(bytes));
  });

  app.get("/api/v1/sessions/:sessionId/traces/:traceId", async (request) => {
    const path = z.object({ sessionId: id, traceId: id }).parse(request.params);
    return readTraceDownload(deps, actorOf(request), path.sessionId, path.traceId);
  });

  app.post("/api/v1/sessions/:sessionId/finalize", async (request) => {
    const { sessionId } = z.object({ sessionId: id }).parse(request.params);
    return finalizeSession(deps, actorOf(request), sessionId);
  });

  app.get("/api/v1/sessions/:sessionId", async (request) => {
    const { sessionId } = z.object({ sessionId: id }).parse(request.params);
    return readSession(deps, actorOf(request), sessionId);
  });

  app.get("/api/v1/sessions/:sessionId/summaries", async (request) => {
    const { sessionId } = z.object({ sessionId: id }).parse(request.params);
    return readSummaries(deps, actorOf(request), sessionId);
  });

  app.post("/api/v1/participants/:participantId/exports", async (request) => {
    const { participantId } = z.object({ participantId: id }).parse(request.params);
    return exportParticipant(deps, actorOf(request), participantId);
  });

  app.delete("/api/v1/participants/:participantId", async (request) => {
    const { participantId } = z.object({ participantId: id }).parse(request.params);
    z.object({ confirm: z.literal(true) }).parse(request.body);
    return deleteParticipant(deps, actorOf(request), participantId);
  });

  app.post("/api/v1/imports/legacy/preview", async (request) => {
    const body = z.object({ envelope: z.unknown() }).parse(request.body);
    return previewLegacy(deps, actorOf(request), body.envelope);
  });

  app.post("/api/v1/imports/legacy", async (request) => {
    const body = z.object({ participantId: id, envelope: z.unknown() }).parse(request.body);
    return commitLegacy(deps, actorOf(request), body.participantId, body.envelope);
  });
}

export function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({
      error: error.code,
      message: error.message,
      details: error.details ?? {},
    });
  }
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "validation",
      message: "Request failed validation.",
      details: { issues: error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })) },
    });
  }
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 500;
  if (statusCode === 413) {
    return reply.code(413).send({ error: "payload_too_large", message: "Payload exceeds the size limit." });
  }
  request.log.error({ message: error instanceof Error ? error.message : "error" }, "request failed");
  return reply.code(500).send({ error: "internal", message: "Internal error." });
}
