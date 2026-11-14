import {
  classifyResponse,
  createTargetSelectionLayout,
  PRACTICE_RULES_VERSION,
  PROTOCOL_ID,
  SCORER_ID,
  type SessionRecord,
} from "@neurovision/domain";
import type { AssignmentManifest } from "../src/contracts.provisional.js";
import { contentHash } from "../src/hash.js";

export function sampleSession(id: string, source: SessionRecord["source"] = "live"): SessionRecord {
  const layout = createTargetSelectionLayout("fixed-a");
  const viewport = { width: 1280, height: 800, dpr: 1, class: "desktop-960" as const };
  const trial = {
    id: `${id}-target`,
    task: "target-selection" as const,
    layout,
    events: [] as SessionRecord["trials"][number]["events"],
    duration: 4000,
    end: "done" as const,
    input: "mouse-trackpad" as const,
    viewport,
  };
  const stimulus = layout.stimuli.find((item) => item.kind === "target");
  if (!stimulus) throw new Error("Fixture layout has no target.");
  trial.events.push(
    classifyResponse({
      sessionId: id,
      trialId: trial.id,
      task: trial.task,
      layout,
      existing: [],
      point: { x: stimulus.x, y: stimulus.y },
      elapsed: 500,
    }),
  );
  return {
    id,
    profileId: "local",
    alias: "Local participant",
    source,
    protocol: PROTOCOL_ID,
    scorer: SCORER_ID,
    taskIds: ["target-selection", "line-bisection"],
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
      explanation: "Fixture decision.",
      metrics: null,
      override: null,
    },
    pointerSampling: false,
    calibration: null,
  };
}

export function manifestFor(session: SessionRecord): AssignmentManifest {
  return {
    protocol: session.protocol,
    scorer: session.scorer,
    taskIds: session.taskIds,
    source: session.source,
    input: session.input,
    accessibilityId: "default",
    configHash: "fixture-config",
  };
}

export function batchPayload(session: SessionRecord, sequence = 1, parentBatchId: string | null = null) {
  const { trials, practice, ...shell } = session;
  const payload = { sequence, parentBatchId, shell, trials, practice };
  return { ...payload, contentHash: contentHash(payload) };
}
