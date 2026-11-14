import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { OidcConfig } from "./config.js";
import { HttpError } from "./errors.js";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkce(verifier = randomBytes(32).toString("base64url")): PkcePair {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizationUrl(input: {
  authorizeEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.authorizeEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface ProviderEndpoints {
  authorize: string;
  token: string;
  jwks: string;
}

export async function providerEndpoints(config: OidcConfig): Promise<ProviderEndpoints> {
  if (config.authorizeUrl && config.tokenUrl && config.jwksUri) {
    return { authorize: config.authorizeUrl, token: config.tokenUrl, jwks: config.jwksUri };
  }
  const discoveryUrl = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  let document: {
    authorization_endpoint?: string;
    token_endpoint?: string;
    jwks_uri?: string;
  };
  try {
    const response = await fetch(discoveryUrl);
    if (!response.ok) throw new Error("discovery failed");
    document = (await response.json()) as typeof document;
  } catch {
    throw new HttpError(503, "oidc_unavailable", "Identity provider discovery failed.");
  }
  if (!document.authorization_endpoint || !document.token_endpoint || !document.jwks_uri) {
    throw new HttpError(503, "oidc_unavailable", "Identity provider discovery was incomplete.");
  }
  return {
    authorize: document.authorization_endpoint,
    token: document.token_endpoint,
    jwks: document.jwks_uri,
  };
}

export async function exchangeCode(input: {
  config: OidcConfig;
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  nonce: string;
  jwksUri: string;
}): Promise<{ subject: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.config.redirectUri,
    client_id: input.config.clientId,
    code_verifier: input.codeVerifier,
    client_secret: input.config.clientSecret,
  });
  let tokenBody: { id_token?: string };
  try {
    const response = await fetch(input.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error("token exchange failed");
    tokenBody = (await response.json()) as { id_token?: string };
  } catch {
    throw new HttpError(502, "oidc_unavailable", "Identity provider token exchange failed.");
  }
  if (!tokenBody.id_token) {
    throw new HttpError(401, "unauthorized", "Identity token was missing.");
  }
  const jwks = createRemoteJWKSet(new URL(input.jwksUri));
  let payload: { sub?: string; nonce?: string };
  try {
    const verified = await jwtVerify(tokenBody.id_token, jwks, {
      issuer: input.config.issuer,
      audience: input.config.clientId,
    });
    payload = verified.payload as { sub?: string; nonce?: string };
  } catch {
    throw new HttpError(401, "unauthorized", "Identity token was rejected.");
  }
  if (payload.nonce !== input.nonce || typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new HttpError(401, "unauthorized", "Identity token was rejected.");
  }
  return { subject: `${input.config.issuer}|${payload.sub}` };
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
