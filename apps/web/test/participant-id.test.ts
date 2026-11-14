import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryStore } from "@neurovision/storage";
import {
  LAST_PARTICIPANT_ID_KEY,
  createMemoryKeyValueStore,
  createScopedKeyValueStore,
  isApiEnabled,
  participantIdMessage,
  readLastParticipantId,
  readRuntimeConfig,
  writeLastParticipantId,
} from "../src/services/index.ts";

describe("participant id", () => {
  it("treats VITE_API_BASE_URL=/ as a same-origin API", () => {
    const config = readRuntimeConfig({ VITE_API_BASE_URL: "/", VITE_STANDALONE: "false" });
    assert.equal(config.apiBaseUrl, "/");
    assert.equal(isApiEnabled(config), true);
    assert.equal(config.identityMode, "local");
  });

  it("validates letters, digits, and dashes of length 3–32", () => {
    assert.equal(participantIdMessage(""), "Enter a participant ID to continue.");
    assert.equal(participantIdMessage("ab"), "Use 3–32 letters, digits, or dashes.");
    assert.equal(participantIdMessage("user_name"), "Use 3–32 letters, digits, or dashes.");
    assert.equal(participantIdMessage("P-014"), null);
    assert.equal(participantIdMessage("  alice-1  "), null);
  });

  it("remembers the last participant id in browser storage", () => {
    const store = memoryStore();
    assert.equal(readLastParticipantId(store), "");
    assert.equal(writeLastParticipantId("P-014", store), "P-014");
    assert.equal(store.getItem(LAST_PARTICIPANT_ID_KEY), "P-014");
    assert.equal(readLastParticipantId(store), "P-014");
  });

  it("keeps offline history envelopes isolated per participant", () => {
    const inner = createMemoryKeyValueStore();
    const alice = createScopedKeyValueStore(inner, "alice-1");
    const bob = createScopedKeyValueStore(inner, "bob-2");
    alice.setItem("spatial-patterns:envelope:v1", "alice-sessions");
    bob.setItem("spatial-patterns:envelope:v1", "bob-sessions");
    assert.equal(alice.getItem("spatial-patterns:envelope:v1"), "alice-sessions");
    assert.equal(bob.getItem("spatial-patterns:envelope:v1"), "bob-sessions");
    assert.equal(inner.getItem("spatial-patterns:envelope:v1"), null);
    assert.ok(inner.getItem("nv:participant:alice-1:spatial-patterns:envelope:v1"));
    alice.removeItem("spatial-patterns:envelope:v1");
    assert.equal(alice.getItem("spatial-patterns:envelope:v1"), null);
    assert.equal(bob.getItem("spatial-patterns:envelope:v1"), "bob-sessions");
  });
});
