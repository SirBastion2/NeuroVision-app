import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runVercelBundleCheck } from "../../../scripts/check-vercel-bundle.mjs";

describe("Vercel production bundle", { concurrency: false }, () => {
  it("loads without workspace TypeScript or PGlite", async () => {
    const result = await runVercelBundleCheck();
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 3);
    for (const call of result.results) {
      assert.match(call.body, /DATABASE_URL is required/);
      assert.equal(call.body.includes("ERR_MODULE_NOT_FOUND"), false);
    }
  });
});
