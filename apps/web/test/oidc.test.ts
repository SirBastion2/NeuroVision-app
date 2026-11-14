import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OidcCallbackError,
  OidcConfigError,
  createAppServices,
  createOidcClient,
} from "../src/services/index.ts";

const oidcConfig = {
  authorizeUrl: "https://issuer.example.test/authorize",
  tokenUrl: "https://issuer.example.test/token",
  clientId: "neurovision-web",
  redirectUri: "https://app.example.test/callback",
  scope: "openid",
};

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    snapshot: () => new Map(data),
  };
}

describe("OIDC authorization-code PKCE helper", () => {
  it("builds a redirect URL, exchanges the callback, and keeps the token in memory", async () => {
    const storage = memoryStorage();
    const tokenCalls: Array<{ url: string; body: string }> = [];
    const client = createOidcClient({
      config: oidcConfig,
      storage,
      now: () => 1_000_000,
      randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
      fetch: async (input, init) => {
        const url = String(input);
        const rawBody = init?.body;
        const body =
          typeof rawBody === "string"
            ? rawBody
            : rawBody instanceof URLSearchParams
              ? rawBody.toString()
              : "";
        tokenCalls.push({ url, body });
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: "id-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const redirect = await client.buildAuthorizationUrl();
    const url = new URL(redirect.url);
    assert.equal(url.origin + url.pathname, oidcConfig.authorizeUrl);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), oidcConfig.clientId);
    assert.equal(url.searchParams.get("redirect_uri"), oidcConfig.redirectUri);
    assert.equal(url.searchParams.get("scope"), "openid");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("code_challenge"));
    assert.equal(url.searchParams.get("state"), redirect.state);
    assert.equal(storage.snapshot().size, 1);
    assert.equal(client.getAccessToken(), null);

    const token = await client.handleCallback(
      `https://app.example.test/callback?code=auth-code&state=${redirect.state}`,
    );
    assert.equal(token.accessToken, "access-1");
    assert.equal(client.getAccessToken(), "access-1");
    assert.equal(token.expiresAt, 1_000_000 + 3600 * 1000);
    assert.equal(storage.snapshot().size, 0);
    assert.equal(tokenCalls.length, 1);
    assert.equal(tokenCalls[0]?.url, oidcConfig.tokenUrl);
    const params = new URLSearchParams(tokenCalls[0]?.body);
    assert.equal(params.get("grant_type"), "authorization_code");
    assert.equal(params.get("code"), "auth-code");
    assert.equal(params.get("code_verifier"), redirect.verifier);
    assert.equal(params.get("client_id"), oidcConfig.clientId);
  });

  it("rejects a callback whose state does not match the in-flight request", async () => {
    const client = createOidcClient({
      config: oidcConfig,
      storage: memoryStorage(),
    });
    const redirect = await client.buildAuthorizationUrl();
    await assert.rejects(
      () => client.handleCallback(`https://app.example.test/callback?code=auth-code&state=${redirect.state}-other`),
      OidcCallbackError,
    );
    assert.equal(client.getAccessToken(), null);
  });

  it("requires OIDC config values when the API has no auth routes", async () => {
    const client = createOidcClient({ config: null, storage: memoryStorage() });
    assert.equal(client.configured, false);
    await assert.rejects(() => client.buildAuthorizationUrl(), OidcConfigError);
  });

  it("wires the helper through createAppServices and sends the in-memory token", async () => {
    const storage = memoryStorage();
    const oidc = createOidcClient({
      config: oidcConfig,
      storage,
      randomBytes: (size) => Uint8Array.from({ length: size }, () => 7),
      fetch: async () =>
        new Response(JSON.stringify({ access_token: "svc-token", token_type: "Bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const headers: string[] = [];
    const services = createAppServices({
      config: {
        apiBaseUrl: "https://api.example.test",
        standalone: false,
        oidc: oidcConfig,
      },
      oidc,
      fetch: async (_input, init) => {
        headers.push(new Headers(init?.headers).get("authorization") ?? "");
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const redirect = await services.beginOidcRedirect();
    await services.completeOidcCallback(
      `https://app.example.test/callback?code=from-app&state=${redirect.state}`,
    );
    assert.equal(services.getAccessToken(), "svc-token");
    await services.health();
    assert.deepEqual(headers, ["Bearer svc-token"]);
  });
});
