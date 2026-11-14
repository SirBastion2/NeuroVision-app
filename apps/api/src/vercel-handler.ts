import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";
import { openRuntime, type Runtime } from "./runtime.js";

export const vercelFunctionConfig = {
  api: { bodyParser: false as const },
  maxDuration: 60,
};

/**
 * When `/health` is rewritten to `/api/health`, Fastify still serves GET /health.
 */
export function normalizeVercelUrl(req: IncomingMessage): void {
  const raw = req.url ?? "/";
  const q = raw.indexOf("?");
  const path = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q) : "";
  if (path === "/api/health") req.url = `/health${search}`;
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
