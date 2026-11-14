import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleVercelApi, vercelBundlePath } from "./bundle-vercel-api.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function copyPackageTree(name, fromModules, toModules, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);
  const src = join(fromModules, ...name.split("/"));
  if (!existsSync(src)) return;
  const dest = join(toModules, ...name.split("/"));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, dereference: true });
  const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    copyPackageTree(dep, fromModules, toModules, seen);
  }
}

function assertNoWorkspaceSource(dir) {
  if (existsSync(join(dir, "packages"))) {
    throw new Error("Temp copy must not contain packages/");
  }
  const domain = join(dir, "node_modules/@neurovision/domain");
  if (existsSync(domain)) {
    throw new Error("Temp copy must not resolve @neurovision/domain from node_modules");
  }
  if (existsSync(join(dir, "node_modules/@electric-sql/pglite"))) {
    throw new Error("Temp copy must not include PGlite");
  }
}

function assertBundleIsProduction(bundleText) {
  if (bundleText.includes("@electric-sql/pglite") || /\bPGlite\b/.test(bundleText)) {
    throw new Error("PGlite leaked into the Vercel bundle");
  }
  if (/(?:from|import)\s+["']@neurovision\/[^"']+["']/.test(bundleText)) {
    throw new Error("Workspace packages must be inlined, not imported, in the Vercel bundle");
  }
}

const probeSource = `import { createServer } from "node:http";
import handler from "./api/index.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function call(origin, method, url, { headers = {}, body } = {}) {
  const response = await fetch(origin + url, { method, headers, body });
  const text = await response.text();
  return { method, url, status: response.status, body: text };
}

const server = createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: message, code }));
    }
  });
});

await listen(server);
const { port } = server.address();
const origin = "http://127.0.0.1:" + port;
const results = [];
try {
  results.push(await call(origin, "GET", "/health"));
  results.push(await call(origin, "GET", "/api/v1/me"));
  results.push(
    await call(origin, "POST", "/api/v1/auth/local", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "bundle-1", orgId: "org-demo" }),
    }),
  );
} finally {
  await close(server);
}

for (const result of results) {
  if (result.body.includes("ERR_MODULE_NOT_FOUND") || result.body.includes("Cannot find module")) {
    throw new Error("Module resolution failed for " + result.method + " " + result.url + ": " + result.body);
  }
  if (!/DATABASE_URL is required/.test(result.body)) {
    throw new Error(
      "Expected DATABASE_URL error for " + result.method + " " + result.url + ", got HTTP " + result.status + " " + result.body,
    );
  }
}

process.stdout.write(JSON.stringify({ ok: true, results }, null, 2) + "\\n");
`;

export async function runVercelBundleCheck({ bundleFirst = true } = {}) {
  if (bundleFirst || !existsSync(vercelBundlePath)) {
    await bundleVercelApi();
  }
  const bundleText = readFileSync(vercelBundlePath, "utf8");
  assertBundleIsProduction(bundleText);

  const dir = mkdtempSync(join(tmpdir(), "nv-vercel-bundle-"));
  try {
    cpSync(join(root, "api"), join(dir, "api"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
    copyPackageTree("pg", join(root, "node_modules"), join(dir, "node_modules"));
    assertNoWorkspaceSource(dir);
    writeFileSync(join(dir, "probe.mjs"), probeSource);

    const env = { ...process.env };
    delete env.DATABASE_URL;
    env.IDENTITY_MODE = "local";
    env.NODE_ENV = "production";
    env.VERCEL = "1";

    const result = spawnSync(process.execPath, [join(dir, "probe.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `vercel bundle check exited ${result.status}`);
    }
    return JSON.parse(result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await runVercelBundleCheck();
}
