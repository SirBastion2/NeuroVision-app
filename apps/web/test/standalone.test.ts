import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkStandalone } from "../../../scripts/check-standalone.mjs";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = join(webRoot, "dist/standalone");

describe("standalone HTML build", () => {
  it("emits one file with JS and CSS inlined and no external script or link URLs", () => {
    if (!existsSync(join(standaloneDir, "index.html"))) {
      const result = spawnSync("npm", ["run", "build:standalone"], {
        cwd: webRoot,
        encoding: "utf8",
        env: process.env,
      });
      if (result.status !== 0) {
        assert.fail(result.stderr || result.stdout || "standalone build failed");
      }
    }
    const { file, bytes, html } = checkStandalone(standaloneDir);
    assert.match(file, /index\.html$/);
    assert.ok(bytes > 1_000, `expected a non-empty HTML file, got ${bytes} bytes`);
    assert.match(html, /<script>/);
    assert.match(html, /<style[\s>]/);
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=\s*["'](?!data:)/i);
    assert.doesNotMatch(html, /<link\b[^>]*\bhref\s*=\s*["'](?!data:)/i);
  });
});
