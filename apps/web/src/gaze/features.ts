/**
 * Per-frame features from MediaPipe Face Landmarker output. Pure, no MediaPipe import.
 *
 * Landmark indices (478-point mesh with irises), in image coordinates:
 *   subject's right eye: corners 33 (outer) / 133 (inner), iris 468, lids 159 / 145
 *   subject's left eye:  corners 362 (inner) / 263 (outer), iris 473, lids 386 / 374
 * Each iris is measured against its own eye's corners. For both eyes the axis runs from
 * the image-left corner to the image-right corner, so signs agree between eyes.
 */

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export interface EyeFeatures {
  /** Iris position along the eye axis, normalized by eye width, 0 = centred. */
  h: number;
  /** Iris offset perpendicular to the eye axis (image-down positive), normalized by eye width. */
  v: number;
  /** Lid gap / eye width. */
  openness: number;
}

export interface HeadPose {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  tx: number;
  ty: number;
  tz: number;
  layout: "column-major" | "row-major";
}

export interface FrameFeatures {
  right: EyeFeatures;
  left: EyeFeatures;
  openness: number;
  head: HeadPose | null;
  faceX: number;
  faceY: number;
  faceSize: number;
  /** Model input, in FEATURE_NAMES order. */
  vector: number[];
}

export const FEATURE_NAMES = [
  "rightH",
  "rightV",
  "leftH",
  "leftV",
  "openness",
  "yaw",
  "pitch",
  "roll",
  "tx",
  "ty",
  "tz",
  "faceX",
  "faceY",
  "faceSize",
] as const;

/** Features that describe head placement; used for the "moved since calibration" check. */
export const HEAD_FEATURE_INDICES = [5, 6, 8, 9, 10, 11, 12, 13];

/** Eye features (iris offsets, openness) vs head features (pose, position, size). */
export const EYE_FEATURE_INDICES = [0, 1, 2, 3, 4];

/**
 * Minimum realistic spread per feature, in its own units: iris offsets 0.02 of eye width,
 * openness 0.02, angles 3°, translation 1 cm (z 2 cm), face position 0.02 of the frame,
 * face size 0.01. Stops a still head from being amplified into a big gaze shift.
 */
export const FEATURE_SD_FLOOR = [0.02, 0.02, 0.02, 0.02, 0.02, 3, 3, 3, 1, 1, 2, 0.02, 0.02, 0.01];

/**
 * Ridge penalty multiplier per feature: head features cost 8× more, so the model has to
 * explain gaze with the eyes first and uses the head only to compensate for movement.
 */
export const FEATURE_PENALTY = FEATURE_SD_FLOOR.map((_, j) => (EYE_FEATURE_INDICES.includes(j) ? 1 : 8));

const EYES = {
  right: { a: 33, b: 133, iris: 468, upper: 159, lower: 145 },
  left: { a: 362, b: 263, iris: 473, upper: 386, lower: 374 },
} as const;

export function eyeFeatures(lm: readonly Landmark[], eye: (typeof EYES)["right" | "left"], aspect = 1): EyeFeatures | null {
  const p = (i: number) => {
    const l = lm[i];
    return l ? { x: l.x * aspect, y: l.y } : null;
  };
  const a = p(eye.a);
  const b = p(eye.b);
  const iris = p(eye.iris);
  const up = p(eye.upper);
  const lo = p(eye.lower);
  if (!a || !b || !iris || !up || !lo) return null;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const w2 = ux * ux + uy * uy;
  if (w2 < 1e-10) return null;
  const dx = iris.x - a.x;
  const dy = iris.y - a.y;
  return {
    h: (dx * ux + dy * uy) / w2 - 0.5,
    v: (ux * dy - uy * dx) / w2,
    openness: Math.hypot(up.x - lo.x, up.y - lo.y) / Math.sqrt(w2),
  };
}

const RAD = 180 / Math.PI;

/**
 * Reads a 4×4 facial transformation matrix. MediaPipe documents column-major data, but
 * we detect it: the translation (with a large negative z, the face in front of the
 * camera) sits at indices 12–14 in column-major and 3/7/11 in row-major order.
 */
export function parseTransform(data: readonly number[]): HeadPose | null {
  if (data.length < 16) return null;
  const colT = Math.abs(data[12]!) + Math.abs(data[13]!) + Math.abs(data[14]!);
  const rowT = Math.abs(data[3]!) + Math.abs(data[7]!) + Math.abs(data[11]!);
  const columnMajor = colT >= rowT;
  // R[r][c] in row-major terms.
  const at = (r: number, c: number) => (columnMajor ? data[c * 4 + r]! : data[r * 4 + c]!);
  const tx = columnMajor ? data[12]! : data[3]!;
  const ty = columnMajor ? data[13]! : data[7]!;
  const tz = columnMajor ? data[14]! : data[11]!;
  // R = Ry(yaw)·Rx(pitch)·Rz(roll): yaw from the third column, pitch from R[1][2].
  const yaw = Math.atan2(at(0, 2), at(2, 2));
  const pitch = Math.asin(Math.max(-1, Math.min(1, -at(1, 2))));
  const roll = Math.atan2(at(1, 0), at(1, 1));
  return {
    yawDeg: yaw * RAD,
    pitchDeg: pitch * RAD,
    rollDeg: roll * RAD,
    tx,
    ty,
    tz,
    layout: columnMajor ? "column-major" : "row-major",
  };
}

/**
 * Builds the model feature vector. `yawSign` lets the app flip yaw if the on-screen
 * check shows the sign convention is reversed (positive must mean toward screen left).
 */
export function extractFeatures(
  landmarks: readonly Landmark[],
  matrix: readonly number[] | null,
  aspect = 4 / 3,
  yawSign: 1 | -1 = 1,
): FrameFeatures | null {
  const right = eyeFeatures(landmarks, EYES.right, aspect);
  const left = eyeFeatures(landmarks, EYES.left, aspect);
  if (!right || !left) return null;
  const parsed = matrix ? parseTransform(matrix) : null;
  const head = parsed ? { ...parsed, yawDeg: parsed.yawDeg * yawSign } : null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const l of landmarks) {
    if (l.x < minX) minX = l.x;
    if (l.x > maxX) maxX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.y > maxY) maxY = l.y;
  }
  const faceX = (minX + maxX) / 2;
  const faceY = (minY + maxY) / 2;
  const faceSize = maxX - minX;
  const openness = (right.openness + left.openness) / 2;
  return {
    right,
    left,
    openness,
    head,
    faceX,
    faceY,
    faceSize,
    vector: [
      right.h,
      right.v,
      left.h,
      left.v,
      openness,
      head?.yawDeg ?? 0,
      head?.pitchDeg ?? 0,
      head?.rollDeg ?? 0,
      head?.tx ?? 0,
      head?.ty ?? 0,
      head?.tz ?? 0,
      faceX,
      faceY,
      faceSize,
    ],
  };
}
