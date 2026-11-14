import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("Vercel production bundle", { concurrency: false }, () => {
  it("loads without workspace TypeScript or PGlite", () => {
    const result = spawnSync(process.execPath, [join(root, "scripts/check-vercel-bundle.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const start = result.stdout.indexOf("{");
    assert.ok(start >= 0, result.stdout);
    const parsed = JSON.parse(result.stdout.slice(start)) as {
      ok: boolean;
      results: Array<{ body: string }>;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.results.length, 3);
    for (const call of parsed.results) {
      assert.match(call.body, /DATABASE_URL is required/);
      assert.equal(call.body.includes("ERR_MODULE_NOT_FOUND"), false);
    }
  });
});
