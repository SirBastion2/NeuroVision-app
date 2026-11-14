import cookie from "@fastify/cookie";
import Fastify, { type FastifyServerOptions } from "fastify";
import { authenticate } from "./auth.js";
import type { Actor, Deps } from "./deps.js";
import { registerRoutes, sendError } from "./routes.js";

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
  }
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export interface BuildServerOptions extends Deps {
  logger?: FastifyServerOptions["logger"];
}

export async function buildServer(options: BuildServerOptions) {
  const app = Fastify({
    logger: options.logger ?? { level: "info" },
    disableRequestLogging: true,
    bodyLimit: 1_048_576,
  });
  await app.register(cookie);
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser("application/gzip", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.addHook("onRequest", async (request) => {
    request.actor = null;
  });
  app.addHook("preHandler", async (request) => {
    if (request.routeOptions.config.public) return;
    request.actor = await authenticate(options, request);
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        path: request.url.split("?")[0],
        statusCode: reply.statusCode,
        subject: request.actor?.subject ?? null,
      },
      "request",
    );
  });
  app.setErrorHandler((error, request, reply) => {
    sendError(error, request, reply);
  });
  await registerRoutes(app, options);
  return app;
}

export type { Deps } from "./deps.js";
