import type { GazeStreamKind, Source } from "./contracts.js";

export interface StreamProvenance {
  streamKind: GazeStreamKind;
  source: Source;
  badge: string;
  disclaimer: string;
  isSurrogate: boolean;
}

const LABELS: Record<GazeStreamKind, StreamProvenance> = {
  webcam: {
    streamKind: "webcam",
    source: "observed",
    badge: "Observed webcam gaze",
    disclaimer:
      "Webcam gaze estimates after independent validation. Research observation only; not a clinical measure.",
    isSurrogate: false,
  },
  "simulated-lab": {
    streamKind: "simulated-lab",
    source: "simulated",
    badge: "SIMULATED LAB — not webcam gaze",
    disclaimer:
      "Deterministic simulated gaze for demonstration. Must not appear as observed participant gaze.",
    isSurrogate: true,
  },
  mock: {
    streamKind: "mock",
    source: "simulated",
    badge: "MOCK PROVIDER — not real gaze",
    disclaimer:
      "Test/mock adapter. Forbidden in release configurations labeled as observed webcam tracking.",
    isSurrogate: true,
  },
  "click-only": {
    streamKind: "click-only",
    source: "observed",
    badge: "Click-only (no gaze)",
    disclaimer:
      "Camera unavailable or denied. Click capture continues; gaze metrics are unavailable.",
    isSurrogate: true,
  },
};

export function provenanceFor(kind: GazeStreamKind): StreamProvenance {
  return LABELS[kind];
}

export function assertNotSilentSurrogate(
  kind: GazeStreamKind,
  claimedSource: Source,
): void {
  const p = provenanceFor(kind);
  if (p.isSurrogate && claimedSource === "observed" && kind !== "click-only") {
    throw new Error(
      `Refuse silent surrogate as observed: streamKind=${kind} badge="${p.badge}"`,
    );
  }
}
