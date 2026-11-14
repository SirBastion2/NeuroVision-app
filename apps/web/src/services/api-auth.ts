import { ApiOfflineError, type ApiClient } from "./api-client";

export interface Me {
  subject: string;
  orgId: string;
  role: string;
  csrfToken: string;
  participantId?: string | null;
}

export interface AuthorizationRedirect {
  url: string;
}

export interface ApiAuthClient {
  readonly configured: boolean;
  signInUrl(): string;
  callbackUrl(code: string, state: string): string;
  beginSignIn(): Promise<AuthorizationRedirect>;
  completeSignIn(url: string | URL): Promise<Me | { url: string }>;
  signInLocal(input: { subject: string; orgId: string }): Promise<Me>;
  getMe(): Promise<Me | null>;
  signOut(): Promise<void>;
  getCsrfToken(): string | null;
}

export class AuthConfigError extends Error {
  constructor(message = "API sign-in is not configured.") {
    super(message);
    this.name = "AuthConfigError";
  }
}

export class AuthCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthCallbackError";
  }
}

export interface CreateApiAuthClientOptions {
  api: ApiClient;
}

function join(base: string, path: string): string {
  if (!base || base === "/" || base === ".") return path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Browser sign-in uses the API's own routes: `GET /api/v1/auth/login` and
 * `GET /api/v1/auth/callback`. The API holds the OIDC PKCE verifier and sets
 * session cookies. This helper never talks to the identity provider directly.
 */
export function createApiAuthClient(options: CreateApiAuthClientOptions): ApiAuthClient {
  const requireApi = (): ApiClient => {
    if (!options.api.enabled) throw new AuthConfigError();
    return options.api;
  };

  return {
    get configured() {
      return options.api.enabled;
    },

    signInUrl() {
      const api = requireApi();
      return join(api.baseUrl, "/api/v1/auth/login");
    },

    callbackUrl(code, state) {
      const api = requireApi();
      const url = new URL(join(api.baseUrl, "/api/v1/auth/callback"), "http://localhost");
      url.searchParams.set("code", code);
      url.searchParams.set("state", state);
      if (!api.baseUrl || api.baseUrl === "/" || api.baseUrl === ".") {
        return `${url.pathname}${url.search}`;
      }
      return `${api.baseUrl.replace(/\/+$/, "")}${url.pathname}${url.search}`;
    },

    async beginSignIn() {
      return { url: this.signInUrl() };
    },

    async completeSignIn(input) {
      const api = requireApi();
      const url = input instanceof URL ? input : new URL(input, "http://localhost");
      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description");
        throw new AuthCallbackError(description ? `${error}: ${description}` : error);
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        throw new AuthCallbackError("Authorization callback is missing code or state.");
      }
      const target = this.callbackUrl(code, state);
      await api.completeAuthCallback(code, state);
      const me = await api.getMe().catch(() => null);
      if (me) return me;
      return { url: target };
    },

    signInLocal(input) {
      return requireApi().signInLocal(input);
    },

    async getMe() {
      if (!options.api.enabled) return null;
      try {
        return await options.api.getMe();
      } catch (error) {
        if (error instanceof ApiOfflineError) return null;
        return null;
      }
    },

    async signOut() {
      await requireApi().logout();
    },

    getCsrfToken() {
      return options.api.getCsrfToken();
    },
  };
}
