import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "node:test";
import { assertRuntimeSafe, loadConfig } from "../src/config.js";
import { redactForLog } from "../src/redact.js";
import { buildServer } from "../src/server.js";
import { authed, createHarness, login, seed, world } from "./harness.js";
import { batchPayload, sampleSession } from "./fixture-session.js";

describe("redaction and runtime guards", () => {
  it("removes observations, tokens, and signed urls", () => {
    const redacted = redactForLog({
      subject: "participant-a",
      authorization: "Bearer secret",
      cookie: "nv_session=abc",
      events: [{ x: 424242 }],
      upload: { url: "https://minio.local/bucket/key?X-Amz-Signature=abcdef" },
      note: "https://minio.local/object?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=zzz",
    }) as { subject: string; authorization: string; events: string; upload: string; note: string };
    assert.equal(redacted.subject, "participant-a");
    assert.equal(redacted.authorization, "[redacted]");
    assert.equal(redacted.events, "[redacted]");
    assert.equal(redacted.upload, "[redacted]");
    assert.equal(redacted.note, "[redacted-url]");
  });

  it("does not write batch coordinates or the csrf token to request logs", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const harness = await createHarness();
    await seed(harness.db);
    const logged = await buildServer({ ...harness.deps, logger: { level: "info", stream } });
    try {
      const auth = await login(logged, world.participantSubject, world.orgA);
      const admin = await login(logged, world.adminA, world.orgA);
      const record = sampleSession("log-session");
      record.trials[0].events[0].x = 424242.5;
      const assignment = await logged.inject({
        method: "POST",
        url: "/api/v1/assignments",
        headers: authed(admin),
        payload: {
          participantId: world.participantId,
          exposureStatus: "unseen",
          manifest: {
            protocol: record.protocol,
            scorer: record.scorer,
            taskIds: record.taskIds,
            source: record.source,
            input: record.input,
            accessibilityId: "default",
            configHash: "fixture-config",
          },
        },
      });
      assert.equal(assignment.statusCode, 200, assignment.body);
      await logged.inject({
        method: "PUT",
        url: "/api/v1/sessions/log-session",
        headers: authed(auth),
        payload: {
          participantId: world.participantId,
          assignmentId: assignment.json().id,
          assignmentRevision: assignment.json().revision,
          startedAt: record.startedAt,
          completion: "complete",
        },
      });
      const batch = await logged.inject({
        method: "PUT",
        url: "/api/v1/sessions/log-session/batches/batch-1",
        headers: authed(auth),
        payload: batchPayload(record),
      });
      assert.equal(batch.statusCode, 200, batch.body);
      const text = lines.join("\n");
      assert.equal(text.includes("424242"), false);
      assert.equal(text.includes(auth.csrf), false);
      assert.equal(text.includes("X-Amz-Signature"), false);
    } finally {
      await logged.close();
      await harness.close();
    }
  });

  it("refuses local identity and memory storage in production", () => {
    const config = loadConfig({ NODE_ENV: "production", IDENTITY_MODE: "local" });
    assert.throws(() => assertRuntimeSafe(config, "memory"), /OIDC/);
    const oidc = loadConfig({
      NODE_ENV: "production",
      IDENTITY_MODE: "oidc",
      OIDC_ISSUER: "https://idp.example.test",
      OIDC_CLIENT_ID: "client",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_REDIRECT_URI: "https://app.example.test/callback",
    });
    assert.throws(() => assertRuntimeSafe(oidc, "memory"), /memory/);
    assert.doesNotThrow(() => assertRuntimeSafe(oidc, "s3"));
  });
});
