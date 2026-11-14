import type { FaceLandmarker as FaceLandmarkerType } from "@mediapipe/tasks-vision";
import type { AffineCorrection, GazeQuality, GazeSample, SmoothingLevel, ValidationReport } from "../metrics/types";
import { clamp, median } from "../metrics/math";
import { applyAffine, composeAffine, IDENTITY, pageToScreenAffine } from "./affine";
import { AUTO_ADVANCE_MS, CALIBRATION_POINTS, HEAD_MOTION_MS, HEAD_MOTION_POINTS, SAMPLE_MS, SETTLE_MS, beep } from "./calibration";
import { extractFeatures, type FrameFeatures } from "./features";
import { BlinkDetector, GazeSmoother } from "./filters";
import { LiveFixationDetector } from "./fixations";
import { GazeModel, type TrainingRow } from "./model";
import { pageOrigin, pageToScreen, readWindowMetrics, screenToPage } from "./screen";
import { Emitter, type CalibrationOptions, type CalibrationPresenter, type CalibrationResult, type GazeSource, type TrackerStatus } from "./types";
import { computeValidationReport, VALIDATION_POINTS, type ValidationInput } from "./validation";

const MP_VERSION = "1.2.3";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const YAW_SIGN_KEY = "neurovision.gaze.yawSign";
const FACE_LOST_MS = 300;
const MOVED_MS = 600;
const VALIDATE_SETTLE_MS = 600;
const VALIDATE_SAMPLE_MS = 1000;

type Collector = (f: FrameFeatures, raw: { x: number; y: number } | null, now: number) => void;

function storedYawSign(): 1 | -1 {
  try {
    return localStorage.getItem(YAW_SIGN_KEY) === "-1" ? -1 : 1;
  } catch {
    return 1;
  }
}

/**
 * Webcam gaze tracker: MediaPipe Face Landmarker (VIDEO mode, transformation matrices,
 * GPU with CPU fallback) → iris/head features → ridge model → validation correction →
 * click refinement → page coordinates → median-of-3 + One Euro → clamp → fixation flag.
 *
 * Privacy: frames are processed in memory and dropped. Only coordinates leave this class.
 */
export class GazeTracker implements GazeSource {
  readonly kind = "webcam" as const;
  private samples = new Emitter<GazeSample>();
  private statusEmitter = new Emitter<TrackerStatus>();
  private landmarker: FaceLandmarkerType | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private frameHandle = 0;
  private lastVideoTime = -1;
  private running = false;
  private emitting = false;
  private collectors = new Set<Collector>();

  private model: GazeModel | null = null;
  private validationCorrection: AffineCorrection = IDENTITY; // screen coords
  private refinementCorrection: AffineCorrection = IDENTITY; // screen coords
  private smoother: GazeSmoother;
  private smoothing: SmoothingLevel;
  private blink = new BlinkDetector();
  private fixation = new LiveFixationDetector();
  private validation: ValidationReport | null = null;
  private baselineYaw: number | null = null;
  private yawSign: 1 | -1 = storedYawSign();

  private lastFaceAt = 0;
  private outOfRangeSince: number | null = null;
  private status: TrackerStatus = { faceVisible: false, movedTooMuch: false, fps: null };
  private frameTimes: number[] = [];
  private recent: boolean[] = [];
  private lastFeatures: FrameFeatures | null = null;
  private lastRaw: { x: number; y: number } | null = null;
  private lastBlink = false;

  constructor(opts: { smoothing?: SmoothingLevel } = {}) {
    this.smoothing = opts.smoothing ?? "medium";
    this.smoother = new GazeSmoother(this.smoothing);
  }

  /** Opens the camera and loads the model. Must be called from a user gesture on some browsers. */
  async init(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser has no camera API (needs HTTPS or localhost).");
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play();
    this.video = video;
    if (!this.landmarker) {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const make = (delegate: "GPU" | "CPU") =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
          outputFaceBlendshapes: false,
        });
      try {
        this.landmarker = await make("GPU");
      } catch {
        this.landmarker = await make("CPU");
      }
    }
    this.running = true;
    this.loop();
  }

  /** The live camera element, for an on-screen positioning preview. Never recorded. */
  getVideo(): HTMLVideoElement | null {
    return this.video;
  }

  private loop = () => {
    if (!this.running || !this.video) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    // Only process a frame when the video time has advanced.
    if (v.currentTime !== this.lastVideoTime && v.readyState >= 2 && this.landmarker) {
      this.lastVideoTime = v.currentTime;
      const now = performance.now();
      const res = this.landmarker.detectForVideo(v, now);
      this.onFrame(res.faceLandmarks[0] ?? null, res.facialTransformationMatrixes?.[0]?.data ?? null, now);
    }
    this.frameHandle = v.requestVideoFrameCallback ? v.requestVideoFrameCallback(this.loop) : requestAnimationFrame(this.loop);
  };

  private onFrame(landmarks: Array<{ x: number; y: number; z?: number }> | null, matrix: number[] | null, now: number) {
    this.frameTimes.push(now);
    while (this.frameTimes.length > 30) this.frameTimes.shift();
    const fps = this.frameTimes.length > 1 ? (1000 * (this.frameTimes.length - 1)) / (now - this.frameTimes[0]!) : null;
    const aspect = this.video ? this.video.videoWidth / Math.max(1, this.video.videoHeight) : 4 / 3;
    const f = landmarks ? extractFeatures(landmarks, matrix, aspect, this.yawSign) : null;
    this.lastFeatures = f;
    if (f) this.lastFaceAt = now;

    const isBlink = f ? this.blink.isBlink(f.openness) : false;
    const raw = f && !isBlink && this.model ? this.rawPagePrediction(f) : null;
    this.lastRaw = raw;
    this.lastBlink = isBlink;
    if (f && !isBlink) this.collectors.forEach((c) => c(f, raw, now));

    const out = this.model && f && this.model.outOfRange(f.vector);
    this.outOfRangeSince = out ? (this.outOfRangeSince ?? now) : null;
    this.updateStatus({
      faceVisible: now - this.lastFaceAt < FACE_LOST_MS,
      movedTooMuch: this.outOfRangeSince !== null && now - this.outOfRangeSince > MOVED_MS,
      fps,
    });

    if (!this.emitting) return;
    this.recent.push(raw !== null);
    while (this.recent.length > 150) this.recent.shift();
    let sample: GazeSample = {
      t: now,
      x: null,
      y: null,
      confidence: 0,
      blink: isBlink,
      isFixation: false,
      headYawDeg: f?.head ? f.head.yawDeg : null,
      headPitchDeg: f?.head ? f.head.pitchDeg : null,
    };
    if (raw) {
      const s = this.smoother.push(raw.x, raw.y, now);
      sample = {
        ...sample,
        x: clamp(s.x, 0, window.innerWidth),
        y: clamp(s.y, 0, window.innerHeight),
        confidence: this.status.movedTooMuch ? 0.5 : 1,
      };
    } else if (!f) {
      this.smoother.reset();
    }
    sample.isFixation = this.fixation.push(sample);
    this.samples.emit(sample);
  }

  /** Model → validation correction → click refinement, in screen coords, then to page coords. Unsmoothed. */
  private rawPagePrediction(f: FrameFeatures): { x: number; y: number } {
    const screen = applyAffine(composeAffine(this.validationCorrection, this.refinementCorrection), this.model!.predict(f.vector));
    return screenToPage(screen, readWindowMetrics());
  }

  private updateStatus(next: TrackerStatus) {
    const changed = next.faceVisible !== this.status.faceVisible || next.movedTooMuch !== this.status.movedTooMuch;
    this.status = next;
    if (changed || Math.random() < 0.05) this.statusEmitter.emit(next);
  }

  private collect(c: Collector): () => void {
    this.collectors.add(c);
    return () => void this.collectors.delete(c);
  }

  /**
   * 13 click-confirmed points (≈0.9 s of frames each) plus 3 head-motion points (≈4 s
   * while turning and nodding). Targets are stored in SCREEN coordinates.
   */
  async calibrate(opts?: CalibrationOptions): Promise<CalibrationResult> {
    if (!opts?.presenter) throw new Error("Webcam calibration needs a presenter (the calibration overlay).");
    const { presenter } = opts;
    const autoAdvanceMs = opts.autoAdvance ? AUTO_ADVANCE_MS : null;
    const rows: TrainingRow[] = [];
    const yaws: number[] = [];
    const cancel = (): CalibrationResult => ({ ok: false, cancelled: true, points: 0, frames: 0, lambda: null, cvErrorPx: null });
    const toPage = (p: { fx: number; fy: number }) => ({ x: p.fx * window.innerWidth, y: p.fy * window.innerHeight });

    await presenter.moveTo(toPage({ fx: 0.5, fy: 0.5 }), { beep: false, instruction: "Follow the dot with your eyes." });
    const all = [...CALIBRATION_POINTS.map((p) => ({ ...p, head: false })), ...HEAD_MOTION_POINTS.map((p) => ({ ...p, head: true }))];
    for (const [group, p] of all.entries()) {
      const page = toPage(p);
      await presenter.moveTo(page, {
        beep: true,
        instruction: p.head ? "Keep looking at the dot. Click it, then slowly turn and nod your head." : "Keep your head still. Move only your eyes to the dot, then click it.",
      });
      if (!(await presenter.waitForConfirm({ autoAdvanceMs }))) return cancel();
      const target = pageToScreen(page, readWindowMetrics());
      const start = performance.now() + SETTLE_MS;
      const stop = this.collect((f, _raw, now) => {
        if (now < start) return;
        rows.push({ features: f.vector, target, group });
        if (!p.head && f.head) yaws.push(f.head.yawDeg);
      });
      const ok = await presenter.hold(p.head ? HEAD_MOTION_MS : SAMPLE_MS, {
        kind: p.head ? "head" : "sample",
        instruction: p.head ? "Keep your eyes on the dot while you slowly turn and nod your head." : "Hold your gaze on the dot. Keep your head still.",
      });
      stop();
      if (!ok) return cancel();
    }
    const points = new Set(rows.map((r) => r.group)).size;
    if (points < 8 || rows.length < 80) {
      return { ok: false, cancelled: false, points, frames: rows.length, lambda: null, cvErrorPx: null, message: "Not enough face frames. Check lighting and that your face is in view." };
    }
    this.model = GazeModel.fit(rows);
    this.baselineYaw = median(yaws);
    this.validationCorrection = IDENTITY;
    this.refinementCorrection = IDENTITY;
    this.validation = null;
    this.smoother.reset();
    return { ok: true, cancelled: false, points, frames: rows.length, lambda: this.model.lambda, cvErrorPx: this.model.cvErrorPx };
  }

  /** 7 held-out dots the participant just looks at. Fits and applies the affine correction when it helps. */
  async validate(opts?: { presenter: CalibrationPresenter }): Promise<ValidationReport | null> {
    if (!this.model || !opts?.presenter) return null;
    const { presenter } = opts;
    this.validationCorrection = IDENTITY;
    const inputs: ValidationInput[] = [];
    for (const p of VALIDATION_POINTS) {
      const target = { x: p.fx * window.innerWidth, y: p.fy * window.innerHeight };
      await presenter.moveTo(target, { beep: true, instruction: "Just look at the dot. No clicking." });
      if (!(await presenter.hold(VALIDATE_SETTLE_MS, { kind: "settle" }))) return null;
      const frames: Array<{ x: number; y: number }> = [];
      const stop = this.collect((_f, raw) => raw && frames.push(raw));
      const ok = await presenter.hold(VALIDATE_SAMPLE_MS, { kind: "validate" });
      stop();
      if (!ok) return null;
      inputs.push({ target, frames });
    }
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const { report, correction } = computeValidationReport(inputs, viewport);
    if (correction) this.validationCorrection = pageToScreenAffine(correction, pageOrigin(readWindowMetrics()));
    this.validation = report;
    return report;
  }

  /** Applies (or clears) a click-based refinement fitted in page coordinates. */
  setClickRefinement(c: AffineCorrection | null) {
    this.refinementCorrection = c ? pageToScreenAffine(c, pageOrigin(readWindowMetrics())) : IDENTITY;
  }

  /** Starts emitting samples. The camera keeps running between start/stop until stop() releases it. */
  start() {
    this.emitting = true;
    this.smoother.reset();
    this.recent = [];
  }

  /** Stops emitting AND releases the camera, so the camera light turns off. Call init() to resume. */
  stop() {
    this.emitting = false;
    this.running = false;
    const v = this.video as (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }) | null;
    if (v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.lastVideoTime = -1;
    this.updateStatus({ faceVisible: false, movedTooMuch: false, fps: null });
  }

  /** Pauses emission without releasing the camera (between calibration and a test). */
  pause() {
    this.emitting = false;
  }

  get isRunning() {
    return this.running;
  }
  get isCalibrated() {
    return this.model !== null;
  }

  subscribe(cb: (s: GazeSample) => void) {
    return this.samples.on(cb);
  }
  subscribeStatus(cb: (s: TrackerStatus) => void) {
    cb(this.status);
    return this.statusEmitter.on(cb);
  }
  setSmoothing(level: SmoothingLevel) {
    this.smoothing = level;
    this.smoother.setLevel(level);
  }

  /** Current head pose, for the Free look readout. */
  headPose(): { yawDeg: number; pitchDeg: number } | null {
    const h = this.lastFeatures?.head;
    return h ? { yawDeg: h.yawDeg, pitchDeg: h.pitchDeg } : null;
  }
  /** Live split of the current estimate into eye-driven and head-driven parts (px), for Free look. */
  contributions(): { eye: { x: number; y: number }; head: { x: number; y: number }; irisH: number } | null {
    if (!this.model || !this.lastFeatures) return null;
    const f = this.lastFeatures;
    return { ...this.model.explain(f.vector), irisH: (f.right.h + f.left.h) / 2 };
  }
  /** Why there is or isn't an estimate right now, plus the unclamped estimate. For Free look. */
  debugEstimate(): { reason: "ok" | "no-face" | "blink" | "not-calibrated" | "camera-off"; raw: { x: number; y: number } | null } {
    if (!this.running) return { reason: "camera-off", raw: null };
    if (!this.model) return { reason: "not-calibrated", raw: null };
    if (!this.lastFeatures) return { reason: "no-face", raw: null };
    if (this.lastBlink) return { reason: "blink", raw: null };
    return { reason: "ok", raw: this.lastRaw };
  }
  getYawSign() {
    return this.yawSign;
  }
  /** Flips the yaw sign so positive means "toward screen left". Persisted. Recalibrate afterwards. */
  setYawSign(sign: 1 | -1) {
    this.yawSign = sign;
    try {
      localStorage.setItem(YAW_SIGN_KEY, String(sign));
    } catch {
      /* not persisted */
    }
  }

  getQuality(): GazeQuality {
    return {
      source: "webcam",
      calibrated: this.model !== null,
      smoothing: this.smoothing,
      validation: this.validation,
      calibrationHeadYawDeg: this.baselineYaw,
      trackedFraction: this.recent.length ? this.recent.filter(Boolean).length / this.recent.length : null,
      fps: this.status.fps,
      clickRefinement: null,
    };
  }
}

export { beep };
