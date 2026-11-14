import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");

if (!existsSync(envFile)) {
  console.error("Missing .env. Copy .env.example to .env and set DATABASE_URL.");
  process.exit(1);
}

const env = { ...process.env, VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || "/" };

console.log("API http://127.0.0.1:3001  web http://127.0.0.1:5173");
console.log("Local identity: enter a participant ID (org-demo). Same ID on another device shares history.");

const api = spawn("npm", ["run", "dev", "-w", "@neurovision/api"], { cwd: root, stdio: "inherit", env });
const web = spawn("npm", ["run", "dev", "-w", "@neurovision/web"], { cwd: root, stdio: "inherit", env });

function stop() {
  api.kill("SIGTERM");
  web.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

api.on("exit", (code) => {
  if (code) process.exit(code);
});
web.on("exit", (code) => {
  if (code) process.exit(code);
});
