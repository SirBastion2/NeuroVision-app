import { loadRootEnv } from "./env.js";
import { buildServer } from "./server.js";
import { openRuntime } from "./runtime.js";

loadRootEnv();
const runtime = await openRuntime(process.env);
const app = await buildServer(runtime);
try {
  await app.listen({ port: runtime.config.port, host: runtime.config.host });
} catch (error) {
  app.log.error({ message: error instanceof Error ? error.message : "listen failed" }, "server failed to start");
  process.exit(1);
}
