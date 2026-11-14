export type IdentityMode = "local" | "oidc";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  jwksUri?: string;
}

export interface AppConfig {
  env: string;
  identityMode: IdentityMode;
  cookieSecure: boolean;
  port: number;
  host: string;
  sessionTtlMs: number;
  traceMaxBytes: number;
  traceMaxExpandedBytes: number;
  traceTtlMs: number;
  leaseMs: number;
  maxJobAttempts: number;
  oidc: OidcConfig | null;
}

export const SESSION_COOKIE = "nv_session";
export const CSRF_COOKIE = "nv_csrf";

function integer(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer environment value, received "${value}".`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const identityMode = env.IDENTITY_MODE === "oidc" ? "oidc" : "local";
  const issuer = env.OIDC_ISSUER?.trim() ?? "";
  const clientId = env.OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.OIDC_REDIRECT_URI?.trim() ?? "";
  const oidc =
    issuer && clientId && clientSecret && redirectUri
      ? {
          issuer,
          clientId,
          clientSecret,
          redirectUri,
          ...(env.OIDC_AUTHORIZE_URL ? { authorizeUrl: env.OIDC_AUTHORIZE_URL } : {}),
          ...(env.OIDC_TOKEN_URL ? { tokenUrl: env.OIDC_TOKEN_URL } : {}),
          ...(env.OIDC_JWKS_URI ? { jwksUri: env.OIDC_JWKS_URI } : {}),
        }
      : null;

  const cookieSecureEnv = env.COOKIE_SECURE?.trim().toLowerCase();
  const cookieSecure =
    cookieSecureEnv === "true" ? true : cookieSecureEnv === "false" ? false : env.NODE_ENV === "production";

  return {
    env: env.NODE_ENV ?? "development",
    identityMode,
    cookieSecure,
    port: integer(env.PORT, 3001),
    host: env.HOST ?? "0.0.0.0",
    sessionTtlMs: integer(env.SESSION_TTL_SECONDS, 60 * 60 * 12) * 1000,
    traceMaxBytes: integer(env.TRACE_MAX_BYTES, 8_388_608),
    traceMaxExpandedBytes: integer(env.TRACE_MAX_EXPANDED_BYTES, 33_554_432),
    traceTtlMs: integer(env.TRACE_TTL_SECONDS, 15 * 60) * 1000,
    leaseMs: integer(env.JOB_LEASE_SECONDS, 30) * 1000,
    maxJobAttempts: integer(env.JOB_MAX_ATTEMPTS, 5),
    oidc,
  };
}

/** The memory object store is a local adapter. Local identity is allowed when IDENTITY_MODE=local. */
export function assertRuntimeSafe(config: AppConfig, objectStore: "memory" | "s3" | "postgres"): void {
  if (config.env !== "production") return;
  if (objectStore === "memory") {
    throw new Error("Production requires a durable object store (S3 or Postgres). The memory adapter is local only.");
  }
  if (config.identityMode === "oidc" && !config.oidc) {
    throw new Error("Production OIDC identity requires OIDC configuration.");
  }
}
