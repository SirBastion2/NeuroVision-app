import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEnvFile, pgConnectionConfig } from "../src/env.js";
import { createObjectStoreFromEnv, PostgresObjectStore } from "../src/objects.js";
import { assertRuntimeSafe, loadConfig } from "../src/config.js";
import { migrate, wrapDatabase } from "../src/db.js";
import { PGlite } from "@electric-sql/pglite";

describe("hosted Postgres connection strings", () => {
  it("drops uselibpqcompat and enables TLS for sslmode=require", () => {
    const config = pgConnectionConfig(
      "postgres://user:secret@example.test:5432/tsdb?uselibpqcompat=true&sslmode=require",
    );
    assert.equal(config.connectionString?.includes("uselibpqcompat"), false);
    assert.equal(config.connectionString?.includes("sslmode=require"), true);
    assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  });

  it("keeps verify-full certificate checks", () => {
    const config = pgConnectionConfig("postgres://user:secret@example.test:5432/tsdb?sslmode=verify-full");
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  });
});

describe("root env parser", () => {
  it("reads KEY=value lines and ignores comments", () => {
    const parsed = parseEnvFile("# comment\nDATABASE_URL=postgres://x\nEMPTY=\nIDENTITY_MODE=local\n");
    assert.equal(parsed.DATABASE_URL, "postgres://x");
    assert.equal(parsed.IDENTITY_MODE, "local");
    assert.equal(parsed.EMPTY, "");
  });
});

describe("optional object store", () => {
  it("falls back to Postgres when S3 env vars are absent", async () => {
    const client = new PGlite();
    await client.waitReady;
    const db = wrapDatabase({
      query: (sql, params) => client.query(sql, params),
      exec: async (sql) => {
        await client.exec(sql);
      },
      transaction: (fn) =>
        client.transaction((tx) =>
          fn({
            query: (sql, params) => tx.query(sql, params),
            exec: async (sql) => {
              await tx.exec(sql);
            },
          }),
        ),
    });
    await migrate(db);
    const store = createObjectStoreFromEnv({}, db);
    assert.equal(store.kind, "postgres");
    assert.ok(store instanceof PostgresObjectStore);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await store.put("trace-1", bytes);
    const stored = await store.get("trace-1");
    assert.ok(stored);
    assert.deepEqual([...stored], [1, 2, 3, 4]);
    await store.delete("trace-1");
    assert.equal(await store.get("trace-1"), null);
    await client.close();
  });

  it("keeps memory as a local-only adapter", () => {
    const store = createObjectStoreFromEnv({ OBJECT_STORE: "memory" });
    assert.equal(store.kind, "memory");
    const config = loadConfig({ NODE_ENV: "production", IDENTITY_MODE: "oidc", OIDC_ISSUER: "https://idp.test", OIDC_CLIENT_ID: "id", OIDC_CLIENT_SECRET: "secret", OIDC_REDIRECT_URI: "http://localhost/callback" });
    assert.throws(() => assertRuntimeSafe(config, "memory"));
    assert.doesNotThrow(() => assertRuntimeSafe(config, "postgres"));
  });
});
