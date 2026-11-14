export interface OidcRuntimeConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface WebRuntimeConfig {
  apiBaseUrl: string;
  standalone: boolean;
  oidc: OidcRuntimeConfig | null;
}

type EnvRecord = Record<string, string | boolean | undefined>;

function processEnv(): EnvRecord | undefined {
  const globalProcess = (globalThis as { process?: { env?: EnvRecord } }).process;
  return globalProcess?.env;
}

function viteEnv(): EnvRecord | undefined {
  const meta = import.meta as ImportMeta & { env?: EnvRecord };
  return meta.env;
}

/** Read a Vite or process env value. Empty when unset. */
export function readEnv(name: string, env?: EnvRecord): string {
  const source = env ?? viteEnv() ?? processEnv() ?? {};
  const value = source[name];
  return typeof value === "string" ? value.trim() : "";
}

function isFileProtocol(): boolean {
  try {
    return typeof location !== "undefined" && location.protocol === "file:";
  } catch {
    return false;
  }
}

export function isStandaloneRuntime(env?: EnvRecord): boolean {
  if (readEnv("VITE_STANDALONE", env) === "true") return true;
  return isFileProtocol();
}

export function readOidcConfig(env?: EnvRecord): OidcRuntimeConfig | null {
  const authorizeUrl = readEnv("VITE_OIDC_AUTHORIZE_URL", env);
  const tokenUrl = readEnv("VITE_OIDC_TOKEN_URL", env);
  const clientId = readEnv("VITE_OIDC_CLIENT_ID", env);
  const redirectUri = readEnv("VITE_OIDC_REDIRECT_URI", env);
  if (!authorizeUrl || !tokenUrl || !clientId || !redirectUri) return null;
  return {
    authorizeUrl,
    tokenUrl,
    clientId,
    redirectUri,
    scope: readEnv("VITE_OIDC_SCOPE", env) || "openid",
  };
}

export function readRuntimeConfig(env?: EnvRecord): WebRuntimeConfig {
  const standalone = isStandaloneRuntime(env);
  const apiBaseUrl = standalone ? "" : readEnv("VITE_API_BASE_URL", env).replace(/\/+$/, "");
  return {
    apiBaseUrl,
    standalone,
    oidc: standalone ? null : readOidcConfig(env),
  };
}

export function isApiEnabled(config: Pick<WebRuntimeConfig, "apiBaseUrl" | "standalone">): boolean {
  return !config.standalone && config.apiBaseUrl.length > 0;
}
