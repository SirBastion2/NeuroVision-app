import { spawn } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = join(root, ".env");
const example = join(root, ".env.example");

if (!existsSync(envFile)) {
  copyFileSync(example, envFile);
  console.log("Created .env from .env.example. Local demo passwords are the placeholders in that file.");
}

console.log("Starting Postgres, MinIO, the API, and the worker.");
console.log("Local sign-in: POST http://localhost:3001/api/v1/auth/local");
console.log('  {"subject":"participant-demo","orgId":"org-demo"}');
console.log('  {"subject":"reviewer-demo","orgId":"org-demo"}');
console.log('  {"subject":"admin-demo","orgId":"org-demo"}');

const child = spawn(
  "docker",
  ["compose", "--env-file", envFile, "up", "--build"],
  { cwd: root, stdio: "inherit" },
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
