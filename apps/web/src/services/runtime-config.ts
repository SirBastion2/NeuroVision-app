export interface WebRuntimeConfig {
  apiBaseUrl: string;
  standalone: boolean;
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

export function readRuntimeConfig(env?: EnvRecord): WebRuntimeConfig {
  const standalone = isStandaloneRuntime(env);
  const apiBaseUrl = standalone ? "" : readEnv("VITE_API_BASE_URL", env).replace(/\/+$/, "");
  return {
    apiBaseUrl,
    standalone,
  };
}

export function isApiEnabled(config: Pick<WebRuntimeConfig, "apiBaseUrl" | "standalone">): boolean {
  return !config.standalone && config.apiBaseUrl.length > 0;
}
