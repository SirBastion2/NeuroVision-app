import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
export const vercelBundlePath = join(root, "api/_bundle/server.mjs");
const entry = join(root, "apps/api/src/vercel-handler.ts");

const TEST_ONLY = /@electric-sql\/pglite|\/apps\/api\/test\/|\/test\/.*\.test\./;

export async function bundleVercelApi() {
  mkdirSync(dirname(vercelBundlePath), { recursive: true });
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: vercelBundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: ["node20"],
    logLevel: "info",
    legalComments: "none",
    sourcemap: false,
    splitting: false,
    external: ["pg", "pg-native"],
    banner: {
      js: 'import { createRequire as __nvCreateRequire } from "node:module";\nconst require = __nvCreateRequire(import.meta.url);',
    },
    plugins: [
      {
        name: "block-test-only",
        setup(build) {
          build.onResolve({ filter: TEST_ONLY }, (args) => ({
            errors: [{ text: `Test-only module must not enter the Vercel bundle: ${args.path}` }],
          }));
        },
      },
    ],
  });
  return vercelBundlePath;
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await bundleVercelApi();
}
