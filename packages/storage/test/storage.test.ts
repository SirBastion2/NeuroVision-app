import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyResponse,
  createTargetSelectionLayout,
  PRACTICE_RULES_VERSION,
  PROTOCOL_ID,
  SCORER_ID,
  type SessionRecord,
} from "@neurovision/domain";
import {
  createPackageHistoryStore,
  ENVELOPE_KEY,
  EnvelopeError,
  loadEnvelope,
  memoryStore,
  readProfile,
  saveSession,
  sessionDedupeKey,
  writeProfile,
} from "../src/index.js";

function session(id: string, source: SessionRecord["source"]): SessionRecord {
  const layout = createTargetSelectionLayout("fixed-a");
  const viewport = { width: 1200, height: 800, dpr: 1, class: "desktop-960" as const };
  const trial = {
    id: `${id}-target`,
    task: "target-selection" as const,
    layout,
    events: [] as SessionRecord["trials"][number]["events"],
    duration: 1000,
    end: "done" as const,
    input: "mouse-trackpad" as const,
    viewport,
  };
  const stimulus = layout.stimuli.find((item) => item.kind === "target");
  if (!stimulus) throw new Error("missing target");
  trial.events.push(
    classifyResponse({
      sessionId: id,
      trialId: trial.id,
      task: "target-selection",
      layout,
      existing: [],
      point: { x: stimulus.x, y: stimulus.y },
      elapsed: 100,
    }),
  );
  return {
    id,
    profileId: "local",
    alias: "Local",
    source,
    protocol: PROTOCOL_ID,
    scorer: SCORER_ID,
    taskIds: ["target-selection"],
    status: "complete",
    input: "mouse-trackpad",
    viewport,
    startedAt: "2026-11-01T14:00:00.000Z",
    completedAt: "2026-11-01T14:02:00.000Z",
    trials: [trial],
    practice: [],
    decision: {
      version: PRACTICE_RULES_VERSION,
      cue: "none",
      density: "standard",
      level: 0,
      explanation: "storage fixture",
      metrics: null,
      override: null,
    },
    pointerSampling: false,
    calibration: null,
  };
}

describe("browser envelope", () => {
  it("upserts by source, profile, and id and preserves malformed storage", () => {
    const store = memoryStore();
    const live = session("s1", "live");
    const saved = saveSession(store, live);
    assert.equal(saved.sessions.length, 1);
    assert.equal(sessionDedupeKey(live), "live:local:s1");
    const replacement = { ...live, alias: "Updated" };
    saveSession(store, replacement);
    saveSession(store, session("s1", "demonstration"));
    const loaded = loadEnvelope(store);
    assert.equal(loaded.sessions.length, 2);
    assert.equal(loaded.sessions.find((item) => item.source === "live")?.alias, "Updated");

    const raw = store.snapshot()[ENVELOPE_KEY] ?? "";
    store.setItem(ENVELOPE_KEY, "{");
    assert.throws(() => loadEnvelope(store), EnvelopeError);
    assert.equal(store.snapshot()[ENVELOPE_KEY], "{");
    store.setItem(ENVELOPE_KEY, raw);
    store.setItem(ENVELOPE_KEY, JSON.stringify({ version: 1, seeded: true, sessions: [{ id: "bad" }] }));
    assert.throws(() => saveSession(store, live), EnvelopeError);
    assert.equal(store.snapshot()[ENVELOPE_KEY]?.includes("bad"), true);

    assert.throws(() => saveSession(memoryStore(), { ...live, source: "simulated" }), /invalid session record/);
    writeProfile(store, { id: "local", alias: "Local" });
    assert.deepEqual(readProfile(store), { id: "local", alias: "Local" });
  });

  it("refuses a write that exceeds the quota and keeps the previous envelope", () => {
    const store = memoryStore();
    const live = session("quota", "live");
    saveSession(store, live);
    const before = store.snapshot()[ENVELOPE_KEY];
    assert.throws(() => saveSession(store, session("quota-2", "live"), { maxBytes: 32 }), EnvelopeError);
    assert.equal(store.snapshot()[ENVELOPE_KEY], before);

    const failing = {
      ...store,
      setItem() {
        throw new Error("disk full");
      },
    };
    assert.throws(() => saveSession(failing, session("quota-3", "demonstration")), /disk full/);
    assert.equal(store.snapshot()[ENVELOPE_KEY], before);
  });

  it("round-trips records through the package history store", async () => {
    const store = memoryStore();
    const history = createPackageHistoryStore(store);
    assert.equal(history.kind, "package");
    const live = session("hist", "live");
    const saved = await history.save(live);
    assert.equal(saved.alias, "Local");
    assert.equal((await history.load("missing")), null);
    assert.equal((await history.load("hist"))?.source, "live");
    await history.save(session("hist", "demonstration"));
    assert.equal((await history.load("hist"))?.source, "live");
    assert.equal((await history.list()).length, 2);
  });

  it("removes a session by id, including an incomplete record", async () => {
    const store = memoryStore();
    const history = createPackageHistoryStore(store);
    const live = session("kept", "live");
    const incomplete = { ...session("pending-open", "live"), status: "incomplete" as const };
    await history.save(live);
    await history.save(incomplete);
    assert.equal((await history.list()).length, 2);
    await history.remove("pending-open");
    assert.equal((await history.load("pending-open")), null);
    assert.deepEqual(
      (await history.list()).map((item) => item.id),
      ["kept"],
    );
    await history.remove("pending-open");
    assert.equal((await history.list()).length, 1);
  });
});
