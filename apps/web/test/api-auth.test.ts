import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthConfigError,
  createApiAuthClient,
  createAppServices,
  createApiClient,
} from "../src/services/index.ts";

describe("API sign-in routes", () => {
  it("points the browser at /api/v1/auth/login and completes /api/v1/auth/callback", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/api/v1/auth/callback")) {
        return new Response(null, { status: 302, headers: { location: "/" } });
      }
      if (url.endsWith("/api/v1/me")) {
        return new Response(
          JSON.stringify({
            subject: "participant-demo",
            orgId: "org-demo",
            role: "participant",
            csrfToken: "csrf-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };
    const api = createApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    });
    const auth = createApiAuthClient({ api });
    const redirect = await auth.beginSignIn();
    assert.equal(redirect.url, "https://api.example.test/api/v1/auth/login");
    const me = await auth.completeSignIn("https://app.example.test/?code=auth-code&state=s1");
    assert.ok(me && "subject" in me);
    assert.equal(me.subject, "participant-demo");
    assert.ok(calls.some((call) => call.includes("/api/v1/auth/callback?code=auth-code&state=s1")));
    assert.ok(calls.some((call) => call.endsWith("/api/v1/me")));
  });

  it("signs in locally and sends the CSRF token on later mutating calls", async () => {
    const headers: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      headers.push(`${init?.method ?? "GET"} ${new Headers(init?.headers).get("x-csrf-token") ?? ""}`);
      if (url.endsWith("/api/v1/auth/local")) {
        return new Response(
          JSON.stringify({
            subject: "participant-demo",
            orgId: "org-demo",
            role: "participant",
            csrfToken: "csrf-local",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };
    const services = createAppServices({
      config: { apiBaseUrl: "https://api.example.test", standalone: false },
      fetch: fetchImpl,
    });
    const me = await services.signInLocal({ subject: "participant-demo", orgId: "org-demo" });
    assert.equal(me.csrfToken, "csrf-local");
    await services.health();
    await services.api.putSession({
      sessionId: "s1",
      participantId: "participant-demo",
      assignmentId: "a1",
      assignmentRevision: 1,
      startedAt: "2026-11-14T16:00:00.000Z",
      completion: "complete",
    });
    assert.ok(headers.some((line) => line.startsWith("PUT ") && line.endsWith("csrf-local")));
  });

  it("requires an API base URL before building a sign-in link", async () => {
    const auth = createApiAuthClient({
      api: createApiClient({ baseUrl: "", standalone: true }),
    });
    assert.equal(auth.configured, false);
    await assert.rejects(() => auth.beginSignIn(), AuthConfigError);
  });
});
