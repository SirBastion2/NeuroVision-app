import type {
  CalibrationPoint,
  CalibrationResult,
  GazeProvider,
  GazeSample,
  QualityState,
  Source,
  TrialClock,
} from "./contracts.js";
import { assertNotSilentSurrogate, provenanceFor } from "./labels.js";
import { calibrationFromGates, evaluateQualityGates } from "./quality.js";

export type ProviderMode = "webcam" | "simulated-lab" | "mock" | "click-only";

export interface CreateProviderOptions {
  mode: ProviderMode;
  trialId?: string;
  seed?: number;
  claimedSource?: Source;
  releaseGuard?: boolean;
  samples?: GazeSample[];
  validationErrorPx?: number[];
  failInitialize?: boolean;
  failInitializeReason?: string;
}

export interface CreateProviderResult {
  provider: GazeProvider & { readonly provenance: ReturnType<typeof provenanceFor> };
  fellBackToClickOnly: boolean;
  fallbackReason: string | null;
}

export class ClickOnlyProvider implements GazeProvider {
  readonly provenance = provenanceFor("click-only");
  private qualityHandlers = new Set<(state: QualityState) => void>();

  async initialize(): Promise<void> {
    this.emit({ resolution: "none", reason: "camera_unavailable" });
  }

  async calibrate(_points: CalibrationPoint[]): Promise<void> {}

  async validate(_points: CalibrationPoint[]): Promise<CalibrationResult> {
    return {
      id: "click-only-no-calibration",
      providerVersion: "click-only@0.1.0",
      validationErrorPx: [],
      qualityPolicy: "nv-gaze-quality@1.0.0",
      resolution: "none",
    };
  }

  start(_clock: TrialClock, _emit: (sample: GazeSample) => void): void {
    this.emit({ resolution: "none", reason: "click_only_no_gaze_stream" });
  }

  onQuality(handler: (state: QualityState) => void): () => void {
    this.qualityHandlers.add(handler);
    return () => this.qualityHandlers.delete(handler);
  }

  async stop(): Promise<void> {}

  private emit(state: QualityState): void {
    for (const h of this.qualityHandlers) h(state);
  }
}

export class MockGazeProvider implements GazeProvider {
  readonly provenance: ReturnType<typeof provenanceFor>;
  private qualityHandlers = new Set<(state: QualityState) => void>();
  private emitted = false;

  constructor(
    private readonly opts: {
      trialId: string;
      samples: GazeSample[];
      validationErrorPx?: number[];
      failInitialize?: boolean;
      failInitializeReason?: string;
      /** Defaults to mock; use simulated-lab for the labeled demo stream. */
      streamKind?: "mock" | "simulated-lab";
    },
  ) {
    this.provenance = provenanceFor(opts.streamKind ?? "mock");
  }

  async initialize(): Promise<void> {
    if (this.opts.failInitialize) {
      const reason = this.opts.failInitializeReason ?? "mock_camera_denied";
      this.emit({ resolution: "none", reason });
      throw new Error(reason);
    }
    this.emit({
      resolution: "none",
      reason:
        this.opts.streamKind === "simulated-lab"
          ? "simulated_lab_ready"
          : "mock_ready",
    });
  }

  async calibrate(_points: CalibrationPoint[]): Promise<void> {}

  async validate(_points: CalibrationPoint[]): Promise<CalibrationResult> {
    const errors = this.opts.validationErrorPx ?? [10, 12, 8];
    const decision = evaluateQualityGates({ validationErrorPx: errors });
    const version =
      this.opts.streamKind === "simulated-lab"
        ? "simulated-lab@0.1.0"
        : "mock@0.1.0";
    return calibrationFromGates(
      this.opts.streamKind === "simulated-lab" ? "sim-cal" : "mock-cal",
      version,
      errors,
      decision,
    );
  }

  start(_clock: TrialClock, emit: (sample: GazeSample) => void): void {
    if (this.emitted) return;
    this.emitted = true;
    for (const s of this.opts.samples) {
      emit({ ...s, trialId: s.trialId || this.opts.trialId });
    }
  }

  onQuality(handler: (state: QualityState) => void): () => void {
    this.qualityHandlers.add(handler);
    return () => this.qualityHandlers.delete(handler);
  }

  async stop(): Promise<void> {
    this.emitted = false;
  }

  private emit(state: QualityState): void {
    for (const h of this.qualityHandlers) h(state);
  }
}

/** Webcam shell — not pinned; initialize fails so callers fall back. */
export class WebcamProviderStub implements GazeProvider {
  readonly provenance = provenanceFor("webcam");
  private qualityHandlers = new Set<(state: QualityState) => void>();

  async initialize(): Promise<void> {
    this.emit({ resolution: "none", reason: "webcam_provider_not_pinned" });
    throw new Error(
      "Webcam provider not pinned for this build. Use click-only or simulated-lab (explicitly labeled).",
    );
  }

  async calibrate(_points: CalibrationPoint[]): Promise<void> {
    throw new Error("Webcam provider not pinned");
  }

  async validate(_points: CalibrationPoint[]): Promise<CalibrationResult> {
    throw new Error("Webcam provider not pinned");
  }

  start(_clock: TrialClock, _emit: (sample: GazeSample) => void): void {
    throw new Error("Webcam provider not pinned");
  }

  onQuality(handler: (state: QualityState) => void): () => void {
    this.qualityHandlers.add(handler);
    return () => this.qualityHandlers.delete(handler);
  }

  async stop(): Promise<void> {}

  private emit(state: QualityState): void {
    for (const h of this.qualityHandlers) h(state);
  }
}

export function createGazeProvider(
  options: CreateProviderOptions,
): CreateProviderResult {
  if (options.releaseGuard) {
    const claimed = options.claimedSource ?? "observed";
    if (options.mode === "mock" || options.mode === "simulated-lab") {
      assertNotSilentSurrogate(options.mode, claimed);
    }
  }

  switch (options.mode) {
    case "click-only":
      return {
        provider: new ClickOnlyProvider(),
        fellBackToClickOnly: true,
        fallbackReason: "explicit_click_only",
      };
    case "simulated-lab":
      return {
        provider: new MockGazeProvider({
          trialId: options.trialId ?? "trial-sim",
          samples: options.samples ?? [],
          validationErrorPx: options.validationErrorPx ?? [8, 10, 9],
          streamKind: "simulated-lab",
        }),
        fellBackToClickOnly: false,
        fallbackReason: null,
      };
    case "mock":
      return {
        provider: new MockGazeProvider({
          trialId: options.trialId ?? "trial-mock",
          samples: options.samples ?? [],
          validationErrorPx: options.validationErrorPx,
          failInitialize: options.failInitialize,
          failInitializeReason: options.failInitializeReason,
        }),
        fellBackToClickOnly: false,
        fallbackReason: null,
      };
    case "webcam":
      return {
        provider: new WebcamProviderStub(),
        fellBackToClickOnly: false,
        fallbackReason: null,
      };
    default: {
      const _exhaustive: never = options.mode;
      throw new Error(`Unknown provider mode: ${_exhaustive}`);
    }
  }
}

export async function initializeWithCameraFallback(
  preferred: CreateProviderOptions,
): Promise<CreateProviderResult> {
  if (preferred.mode === "click-only") return createGazeProvider(preferred);

  const primary = createGazeProvider(preferred);
  try {
    await primary.provider.initialize();
    return primary;
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "camera_initialize_failed";
    const fallback = createGazeProvider({ mode: "click-only" });
    await fallback.provider.initialize();
    return {
      provider: fallback.provider,
      fellBackToClickOnly: true,
      fallbackReason: reason,
    };
  }
}
