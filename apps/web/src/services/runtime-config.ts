export type IdentityMode = "local" | "oidc";

export interface WebRuntimeConfig {
  apiBaseUrl: string;
  standalone: boolean;
  identityMode?: IdentityMode;
}

type EnvRecord = Record<string, string | boolean | undefined>;

function processEnv(): EnvRecord | undefined {
  const globalProcess = (globalThis as { process?: { env?: EnvRecord } }).process;
  return globalProcess?.env;
}

function viteEnv(): EnvRecord {
  const env = (import.meta as ImportMeta & { env?: EnvRecord }).env;
  return {
    VITE_API_BASE_URL: env?.VITE_API_BASE_URL ?? import.meta.env?.VITE_API_BASE_URL,
    VITE_STANDALONE: env?.VITE_STANDALONE ?? import.meta.env?.VITE_STANDALONE,
    VITE_IDENTITY_MODE: env?.VITE_IDENTITY_MODE ?? import.meta.env?.VITE_IDENTITY_MODE,
  };
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

export function readIdentityMode(env?: EnvRecord): IdentityMode {
  return readEnv("VITE_IDENTITY_MODE", env) === "oidc" ? "oidc" : "local";
}

export function readRuntimeConfig(env?: EnvRecord): WebRuntimeConfig {
  const standalone = isStandaloneRuntime(env);
  const raw = standalone ? "" : readEnv("VITE_API_BASE_URL", env);
  const apiBaseUrl = raw === "/" ? "/" : raw.replace(/\/+$/, "");
  return {
    apiBaseUrl,
    standalone,
    identityMode: readIdentityMode(env),
  };
}

export function isApiEnabled(config: Pick<WebRuntimeConfig, "apiBaseUrl" | "standalone">): boolean {
  return !config.standalone && config.apiBaseUrl.length > 0;
}
