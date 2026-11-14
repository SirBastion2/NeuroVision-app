import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { after, before, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { createVercelHandler, resolveVercelUrl } from "../src/vercel-handler.js";
import { createHarness } from "./harness.js";

function reqWith(url: string, headers: IncomingMessage["headers"] = {}): IncomingMessage {
  return { url, headers } as IncomingMessage;
}

describe("Vercel handler", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;
  let origin: string;
  let closeServer: () => Promise<void>;

  before(async () => {
    harness = await createHarness();
    const handler = createVercelHandler(async () => harness.app);
    const server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  after(async () => {
    await closeServer();
    await harness.close();
  });

  it("serves /health and an API route", async () => {
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const rewritten = await fetch(`${origin}/api/health`);
    assert.equal(rewritten.status, 200);
    assert.deepEqual(await rewritten.json(), { status: "ok" });

    const local = await fetch(`${origin}/api/v1/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "handler-1", orgId: "org-demo" }),
    });
    assert.equal(local.status, 200, await local.clone().text());
    const body = (await local.json()) as { subject: string; orgId: string; role: string };
    assert.equal(body.subject, "handler-1");
    assert.equal(body.orgId, "org-demo");
    assert.equal(body.role, "participant");
  });

  it("keeps Fastify paths after a rewrite to /api", () => {
    assert.equal(resolveVercelUrl(reqWith("/api/v1/auth/local")), "/api/v1/auth/local");
    assert.equal(resolveVercelUrl(reqWith("/health")), "/health");
    assert.equal(resolveVercelUrl(reqWith("/api/health")), "/health");
    assert.equal(
      resolveVercelUrl(reqWith("/api", { "x-vercel-original-path": "/api/v1/me" })),
      "/api/v1/me",
    );
    assert.equal(
      resolveVercelUrl(reqWith("/api", { "x-vercel-original-path": "/health" })),
      "/health",
    );
    assert.equal(
      resolveVercelUrl(
        reqWith("/api?x=1", { "x-now-route-matches": encodeURIComponent(JSON.stringify({ "1": "v1/sessions" })) }),
      ),
      "/api/v1/sessions?x=1",
    );
  });
});
