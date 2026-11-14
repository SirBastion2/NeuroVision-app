import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";
import { openRuntime, type Runtime } from "./runtime.js";

export const vercelFunctionConfig = {
  api: { bodyParser: false as const },
  maxDuration: 60,
};

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function splitPathSearch(raw: string): { path: string; search: string } {
  const q = raw.indexOf("?");
  return q >= 0 ? { path: raw.slice(0, q), search: raw.slice(q) } : { path: raw, search: "" };
}

function mapHealthAlias(url: string): string {
  const { path, search } = splitPathSearch(url);
  if (path === "/api/health") return `/health${search}`;
  return url;
}

function pathFromRouteMatches(raw: string | undefined, search: string): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Record<string, string>;
    const suffix = parsed["1"] ?? parsed.path;
    if (!suffix) return undefined;
    const path = suffix.startsWith("/") ? suffix : `/api/${suffix}`;
    return `${path}${search}`;
  } catch {
    return undefined;
  }
}

/**
 * Rewrites send `/api/(.*)` and `/health` to the `/api` function. When the
 * Node runtime keeps the client path on `req.url`, Fastify matches as-is.
 * When it sets `req.url` to the function dest (`/api`), restore the client
 * path from `x-vercel-original-path` or `x-now-route-matches`.
 */
export function resolveVercelUrl(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const { path, search } = splitPathSearch(raw);
  const rewrittenToFunction = path === "/api" || path === "/api/" || path === "/";

  if (rewrittenToFunction) {
    const original =
      firstHeader(req.headers["x-vercel-original-path"]) ??
      firstHeader(req.headers["x-vercel-original-uri"]) ??
      firstHeader(req.headers["x-forwarded-uri"]);
    if (original?.startsWith("/") && original !== "/api" && original !== "/api/") {
      const parsed = splitPathSearch(original);
      return mapHealthAlias(`${parsed.path}${parsed.search || search}`);
    }
    const fromMatches = pathFromRouteMatches(firstHeader(req.headers["x-now-route-matches"]), search);
    if (fromMatches) return mapHealthAlias(fromMatches);
  }

  return mapHealthAlias(raw);
}

export function normalizeVercelUrl(req: IncomingMessage): void {
  req.url = resolveVercelUrl(req);
}

export function createVercelHandler(getApp: () => Promise<FastifyInstance>) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const app = await getApp();
    await app.ready();
    normalizeVercelUrl(req);
    await new Promise<void>((resolve, reject) => {
      res.once("finish", resolve);
      res.once("close", resolve);
      res.once("error", reject);
      app.server.emit("request", req, res);
    });
  };
}

let appPromise: Promise<FastifyInstance> | null = null;

export async function getVercelApp(env: NodeJS.ProcessEnv = process.env, runtime?: Runtime): Promise<FastifyInstance> {
  if (runtime) {
    return buildServer({ ...runtime, logger: false });
  }
  if (!appPromise) {
    appPromise = openRuntime(env, { poolMax: 1 }).then((opened) =>
      buildServer({ ...opened, logger: { level: "warn" } }),
    );
  }
  return appPromise;
}

const defaultHandler = createVercelHandler(() => getVercelApp());

export default defaultHandler;
export const config = vercelFunctionConfig;
