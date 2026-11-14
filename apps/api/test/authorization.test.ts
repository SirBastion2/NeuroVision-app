import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { authorizationUrl, createPkce } from "../src/oidc.js";
import { authed, createHarness, login, seed, uploadSession, world } from "./harness.js";

describe("authorization", { concurrency: false }, () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  before(async () => {
    harness = await createHarness();
    await seed(harness.db);
    const participant = await login(harness.app, world.participantSubject, world.orgA);
    await uploadSession(harness.app, participant, "auth-session");
  });

  after(async () => {
    await harness.close();
  });

  it("rejects missing, expired, revoked, and cross-site request tokens", async () => {
    const missing = await harness.app.inject({ method: "GET", url: "/api/v1/me" });
    assert.equal(missing.statusCode, 401);

    const auth = await login(harness.app, world.reviewerA, world.orgA);
    await harness.db.query("UPDATE app_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE subject = $1", [
      world.reviewerA,
    ]);
    const expired = await harness.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: auth.cookie } });
    assert.equal(expired.statusCode, 401);

    const again = await login(harness.app, world.reviewerA, world.orgA);
    await harness.db.query("UPDATE memberships SET revoked_at = now() WHERE subject = $1 AND org_id = $2", [
      world.reviewerA,
      world.orgA,
    ]);
    const revoked = await harness.app.inject({ method: "GET", url: "/api/v1/me", headers: authed(again) });
    assert.equal(revoked.statusCode, 403);
    await harness.db.query("UPDATE memberships SET revoked_at = NULL WHERE subject = $1 AND org_id = $2", [
      world.reviewerA,
      world.orgA,
    ]);

    const participant = await login(harness.app, world.participantSubject, world.orgA);
    const csrf = await harness.app.inject({
      method: "POST",
      url: "/api/v1/assignments",
      headers: { cookie: participant.cookie },
      payload: { participantId: world.participantId, exposureStatus: "unseen", manifest: { protocol: "x" } },
    });
    assert.equal(csrf.statusCode, 403);
  });

  it("hides other organizations and unassigned measurements", async () => {
    const outsider = await login(harness.app, world.outsider, world.orgB);
    const cross = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/auth-session",
      headers: authed(outsider),
    });
    assert.equal(cross.statusCode, 404);
    assert.equal(cross.body.includes("Participant A"), false);
    assert.equal(cross.body.includes("target-selection"), false);

    const unassigned = await login(harness.app, world.reviewerU, world.orgA);
    const denied = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/auth-session",
      headers: authed(unassigned),
    });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.includes("4242"), false);

    const admin = await login(harness.app, world.adminA, world.orgA);
    const adminRead = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/auth-session",
      headers: authed(admin),
    });
    assert.equal(adminRead.statusCode, 403);
    const listed = await harness.app.inject({ method: "GET", url: "/api/v1/participants", headers: authed(admin) });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().participants.length, 2);

    const reviewer = await login(harness.app, world.reviewerA, world.orgA);
    const allowed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/auth-session",
      headers: authed(reviewer),
    });
    assert.equal(allowed.statusCode, 200);
    const reviewerList = await harness.app.inject({
      method: "GET",
      url: "/api/v1/participants",
      headers: authed(reviewer),
    });
    assert.deepEqual(reviewerList.json().participants, [{ id: world.participantId, label: "Participant A" }]);

    const other = await login(harness.app, world.otherSubject, world.orgA);
    const hidden = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/auth-session",
      headers: authed(other),
    });
    assert.equal(hidden.statusCode, 404);

    const owner = await login(harness.app, world.participantSubject, world.orgA);
    const own = await harness.app.inject({
      method: "GET",
      url: "/api/v1/sessions/auth-session/summaries",
      headers: authed(owner),
    });
    assert.equal(own.statusCode, 200);
  });

  it("lets only an administrator tombstone a participant", async () => {
    const owner = await login(harness.app, world.participantSubject, world.orgA);
    const denied = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/participants/${world.otherParticipantId}`,
      headers: authed(owner),
      payload: { confirm: true },
    });
    assert.equal(denied.statusCode, 403);
    const admin = await login(harness.app, world.adminA, world.orgA);
    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/participants/${world.otherParticipantId}`,
      headers: authed(admin),
      payload: { confirm: true },
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    const repeat = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/participants/${world.otherParticipantId}`,
      headers: authed(admin),
      payload: { confirm: true },
    });
    assert.equal(repeat.json().idempotent, true);
    const gone = await harness.app.inject({
      method: "GET",
      url: "/api/v1/participants",
      headers: authed(admin),
    });
    assert.equal(
      gone.json().participants.some((item: { id: string }) => item.id === world.otherParticipantId),
      false,
    );
  });
});

describe("oidc local boundary", { concurrency: false }, () => {
  it("disables local sign-in and keeps the client secret out of the authorize redirect", async () => {
    const pair = createPkce("verifier-example-value");
    assert.notEqual(pair.challenge, pair.verifier);
    const url = authorizationUrl({
      authorizeEndpoint: "https://idp.example.test/authorize",
      clientId: "client",
      redirectUri: "http://localhost/callback",
      state: "state-1",
      nonce: "nonce-1",
      codeChallenge: pair.challenge,
    });
    assert.equal(url.includes("response_type=code"), true);
    assert.equal(url.includes("code_challenge_method=S256"), true);
    assert.equal(url.includes("client_secret"), false);

    const harness = await createHarness({
      IDENTITY_MODE: "oidc",
      OIDC_ISSUER: "https://idp.example.test",
      OIDC_CLIENT_ID: "client",
      OIDC_CLIENT_SECRET: "secret-value",
      OIDC_REDIRECT_URI: "http://localhost:3001/api/v1/auth/callback",
      OIDC_AUTHORIZE_URL: "https://idp.example.test/authorize",
      OIDC_TOKEN_URL: "https://idp.example.test/token",
      OIDC_JWKS_URI: "https://idp.example.test/jwks",
    });
    try {
      const local = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/local",
        payload: { subject: "admin-a", orgId: "org-a" },
      });
      assert.equal(local.statusCode, 404);
      const loginResponse = await harness.app.inject({ method: "GET", url: "/api/v1/auth/login" });
      assert.equal(loginResponse.statusCode, 302);
      const location = loginResponse.headers.location ?? "";
      assert.equal(location.includes("secret-value"), false);
      assert.equal(location.includes("response_type=code"), true);
      const callback = await harness.app.inject({
        method: "GET",
        url: "/api/v1/auth/callback?code=nope&state=missing-state",
      });
      assert.equal(callback.statusCode, 400);
    } finally {
      await harness.close();
    }
  });
});
