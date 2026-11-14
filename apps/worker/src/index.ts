import { openRuntime } from "@neurovision/api/runtime";
import { runOnce, type WorkerDeps } from "@neurovision/api/worker";

const runtime = await openRuntime(process.env);
const deps: WorkerDeps = {
  ...runtime,
  workerId: process.env.WORKER_ID ?? `worker-${process.pid}`,
};

let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});

while (!stopped) {
  const result = await runOnce(deps);
  if (!result.processed) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
