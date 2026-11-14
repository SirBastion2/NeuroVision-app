import type { FastifyReply, FastifyRequest } from "fastify";
import { CSRF_COOKIE, SESSION_COOKIE, type AppConfig } from "./config.js";
import type { Actor, Deps } from "./deps.js";
import { one } from "./db.js";
import { HttpError } from "./errors.js";
import { safeEqual } from "./hash.js";
import { authorizationUrl, createPkce, exchangeCode, providerEndpoints, randomSecret } from "./oidc.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface AppSessionRow {
  id: string;
  subject: string;
  org_id: string;
  csrf_token: string;
  expires_at: Date | string;
}

interface MembershipRow {
  role: Actor["role"];
  revoked_at: Date | string | null;
}

export async function authenticate(deps: Deps, request: FastifyRequest): Promise<Actor> {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (!sessionId) throw new HttpError(401, "unauthorized", "Sign in required.");
  const session = await one<AppSessionRow>(deps.db, "SELECT * FROM app_sessions WHERE id = $1", [sessionId]);
  if (!session || new Date(session.expires_at).getTime() <= deps.now().getTime()) {
    throw new HttpError(401, "unauthorized", "Session expired.");
  }
  const membership = await one<MembershipRow>(
    deps.db,
    "SELECT role, revoked_at FROM memberships WHERE org_id = $1 AND subject = $2",
    [session.org_id, session.subject],
  );
  if (!membership) throw new HttpError(403, "forbidden", "No membership for this organization.");
  if (membership.revoked_at) throw new HttpError(403, "forbidden", "Membership revoked.");
  if (MUTATING.has(request.method)) {
    const header = request.headers["x-csrf-token"];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token || !safeEqual(token, session.csrf_token)) {
      throw new HttpError(403, "forbidden", "CSRF token missing or invalid.");
    }
  }
  return {
    subject: session.subject,
    orgId: session.org_id,
    role: membership.role,
    appSessionId: session.id,
    csrfToken: session.csrf_token,
  };
}

export function writeSessionCookies(reply: FastifyReply, config: AppConfig, sessionId: string, csrfToken: string, expires: Date) {
  const maxAge = Math.max(1, Math.floor((expires.getTime() - Date.now()) / 1000));
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  reply.setCookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export function clearSessionCookies(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure: config.cookieSecure, sameSite: "lax" });
  reply.clearCookie(CSRF_COOKIE, { path: "/", httpOnly: false, secure: config.cookieSecure, sameSite: "lax" });
}

export async function createAppSession(deps: Deps, subject: string, orgId: string): Promise<{ id: string; csrf: string; expires: Date }> {
  const id = randomSecret(32);
  const csrf = randomSecret(32);
  const expires = new Date(deps.now().getTime() + deps.config.sessionTtlMs);
  await deps.db.query(
    "INSERT INTO app_sessions (id, subject, org_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4, $5)",
    [id, subject, orgId, csrf, expires.toISOString()],
  );
  return { id, csrf, expires };
}

export async function startOidcLogin(deps: Deps): Promise<string> {
  if (deps.config.identityMode !== "oidc") {
    throw new HttpError(404, "not_found", "OIDC sign-in is disabled.");
  }
  if (!deps.config.oidc) {
    throw new HttpError(503, "oidc_not_configured", "OIDC is not configured.");
  }
  const endpoints = await providerEndpoints(deps.config.oidc);
  const pkce = createPkce();
  const state = randomSecret(24);
  const nonce = randomSecret(24);
  const expires = new Date(deps.now().getTime() + 10 * 60 * 1000);
  await deps.db.query(
    "INSERT INTO oidc_transactions (state, nonce, code_verifier, expires_at) VALUES ($1, $2, $3, $4)",
    [state, nonce, pkce.verifier, expires.toISOString()],
  );
  return authorizationUrl({
    authorizeEndpoint: endpoints.authorize,
    clientId: deps.config.oidc.clientId,
    redirectUri: deps.config.oidc.redirectUri,
    state,
    nonce,
    codeChallenge: pkce.challenge,
  });
}

export async function finishOidcLogin(deps: Deps, code: string, state: string): Promise<{ subject: string; orgId: string; role: Actor["role"]; sessionId: string; csrf: string; expires: Date }> {
  if (deps.config.identityMode !== "oidc" || !deps.config.oidc) {
    throw new HttpError(404, "not_found", "OIDC sign-in is disabled.");
  }
  const transaction = await one<{ nonce: string; code_verifier: string; expires_at: Date | string }>(
    deps.db,
    "SELECT nonce, code_verifier, expires_at FROM oidc_transactions WHERE state = $1",
    [state],
  );
  if (!transaction || new Date(transaction.expires_at).getTime() <= deps.now().getTime()) {
    throw new HttpError(400, "validation", "Sign-in state is missing or expired.");
  }
  await deps.db.query("DELETE FROM oidc_transactions WHERE state = $1", [state]);
  const endpoints = await providerEndpoints(deps.config.oidc);
  const identity = await exchangeCode({
    config: deps.config.oidc,
    tokenEndpoint: endpoints.token,
    code,
    codeVerifier: transaction.code_verifier,
    nonce: transaction.nonce,
    jwksUri: endpoints.jwks,
  });
  const memberships = await deps.db.query<{ org_id: string; role: Actor["role"]; revoked_at: Date | string | null }>(
    "SELECT org_id, role, revoked_at FROM memberships WHERE subject = $1 AND revoked_at IS NULL",
    [identity.subject],
  );
  if (memberships.rows.length === 0) {
    throw new HttpError(403, "forbidden", "This account has no organization membership.");
  }
  if (memberships.rows.length > 1) {
    throw new HttpError(409, "conflict", "Choose an organization.", {
      orgIds: memberships.rows.map((row) => row.org_id),
    });
  }
  const membership = memberships.rows[0];
  if (!membership) throw new HttpError(403, "forbidden", "This account has no organization membership.");
  const session = await createAppSession(deps, identity.subject, membership.org_id);
  return {
    subject: identity.subject,
    orgId: membership.org_id,
    role: membership.role,
    sessionId: session.id,
    csrf: session.csrf,
    expires: session.expires,
  };
}
