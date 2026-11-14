import type { OidcRuntimeConfig } from "./runtime-config";

export interface OidcToken {
  accessToken: string;
  tokenType: string;
  expiresAt: number | null;
  idToken: string | null;
  refreshToken: string | null;
  scope: string | null;
}

export interface AuthorizationRedirect {
  url: string;
  state: string;
  verifier: string;
}

export interface OidcTransactionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CreateOidcClientOptions {
  config: OidcRuntimeConfig | null;
  storage?: OidcTransactionStore | null;
  fetch?: typeof fetch;
  randomBytes?: (size: number) => Uint8Array;
  now?: () => number;
  transactionKey?: string;
}

export interface OidcClient {
  readonly configured: boolean;
  buildAuthorizationUrl(): Promise<AuthorizationRedirect>;
  handleCallback(url: string | URL): Promise<OidcToken>;
  getAccessToken(): string | null;
  getToken(): OidcToken | null;
  clearToken(): void;
}

export class OidcConfigError extends Error {
  constructor(message = "OIDC is not configured.") {
    super(message);
    this.name = "OidcConfigError";
  }
}

export class OidcCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcCallbackError";
  }
}

const DEFAULT_TRANSACTION_KEY = "nv:oidc:pkce";

interface PkceTransaction {
  state: string;
  verifier: string;
  redirectUri: string;
  nonce: string;
}

function getSessionStorage(): OidcTransactionStore | null {
  try {
    const storage = (globalThis as { sessionStorage?: OidcTransactionStore }).sessionStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function memoryTransactionStore(): OidcTransactionStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function defaultRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

function requireConfig(config: OidcRuntimeConfig | null): OidcRuntimeConfig {
  if (!config) throw new OidcConfigError();
  return config;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Browser authorization-code + PKCE helper. The access token is held in
 * memory only. The in-flight verifier/state pair is written to a transaction
 * store (sessionStorage in the browser) so the redirect can complete.
 *
 * `apps/api` currently exposes no OIDC routes. This helper uses the Vite
 * config values `VITE_OIDC_AUTHORIZE_URL`, `VITE_OIDC_TOKEN_URL`,
 * `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_REDIRECT_URI`, and optional
 * `VITE_OIDC_SCOPE` (default `openid`).
 */
export function createOidcClient(options: CreateOidcClientOptions): OidcClient {
  const storage = options.storage ?? getSessionStorage() ?? memoryTransactionStore();
  const fetchImpl = options.fetch ?? fetch.bind(globalThis);
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  const now = options.now ?? (() => Date.now());
  const transactionKey = options.transactionKey ?? DEFAULT_TRANSACTION_KEY;
  let token: OidcToken | null = null;

  const readTransaction = (): PkceTransaction | null => {
    const raw = storage.getItem(transactionKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<PkceTransaction>;
      if (
        typeof parsed.state === "string" &&
        typeof parsed.verifier === "string" &&
        typeof parsed.redirectUri === "string" &&
        typeof parsed.nonce === "string"
      ) {
        return parsed as PkceTransaction;
      }
      return null;
    } catch {
      return null;
    }
  };

  return {
    get configured() {
      return options.config !== null;
    },

    async buildAuthorizationUrl() {
      const config = requireConfig(options.config);
      const verifier = base64UrlEncode(randomBytes(32));
      const state = base64UrlEncode(randomBytes(16));
      const nonce = base64UrlEncode(randomBytes(16));
      const challenge = await sha256Base64Url(verifier);
      const url = new URL(config.authorizeUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("scope", config.scope);
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      storage.setItem(
        transactionKey,
        JSON.stringify({
          state,
          verifier,
          redirectUri: config.redirectUri,
          nonce,
        } satisfies PkceTransaction),
      );
      return { url: url.toString(), state, verifier };
    },

    async handleCallback(input) {
      const config = requireConfig(options.config);
      const url = input instanceof URL ? input : new URL(input, "http://localhost");
      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description");
        throw new OidcCallbackError(description ? `${error}: ${description}` : error);
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        throw new OidcCallbackError("Authorization callback is missing code or state.");
      }
      const transaction = readTransaction();
      storage.removeItem(transactionKey);
      if (!transaction || transaction.state !== state) {
        throw new OidcCallbackError("Authorization state does not match the in-flight request.");
      }
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: transaction.redirectUri || config.redirectUri,
        client_id: config.clientId,
        code_verifier: transaction.verifier,
      });
      const response = await fetchImpl(config.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const payload = asRecord(await response.json().catch(() => ({})));
      if (!response.ok) {
        const message =
          typeof payload.error_description === "string"
            ? payload.error_description
            : typeof payload.error === "string"
              ? payload.error
              : "Token exchange failed.";
        throw new OidcCallbackError(message);
      }
      const accessToken = payload.access_token;
      if (typeof accessToken !== "string" || accessToken.length === 0) {
        throw new OidcCallbackError("Token response did not include an access token.");
      }
      const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : null;
      token = {
        accessToken,
        tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
        expiresAt: expiresIn === null ? null : now() + expiresIn * 1000,
        idToken: typeof payload.id_token === "string" ? payload.id_token : null,
        refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
        scope: typeof payload.scope === "string" ? payload.scope : config.scope,
      };
      return token;
    },

    getAccessToken() {
      if (!token) return null;
      if (token.expiresAt !== null && token.expiresAt <= now()) {
        token = null;
        return null;
      }
      return token.accessToken;
    },

    getToken() {
      return token;
    },

    clearToken() {
      token = null;
      storage.removeItem(transactionKey);
    },
  };
}
