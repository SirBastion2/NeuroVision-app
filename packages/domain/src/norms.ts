/**
 * Healthy-range norms for NeuroVision metrics.
 *
 * Scoring uses Table 2 placeholder means/SDs for the three tests that enter
 * the evidence model (Starry Night, Hollow Rings, line bisection). Those
 * values are assumed, not measured, and every result that uses them carries
 * a notice. Clock, greyscales, gaze, and Hidden scene do not enter the model.
 */

export type NormSource = "hacker-norms" | "literature" | "assumed" | "fitted" | "uncalibrated";
export type CutoffDirection = "above" | "below" | "absolute";
export type HealthyRangeStatus = "within" | "outside" | "uncalibrated";

export interface NormCitation {
  authors: string;
  year: number;
  title: string;
  journal: string;
  doi: string;
  url: string;
}

export interface NormSample {
  /** Healthy-control n when a fitted sample exists; omitted for placeholders. */
  n?: number;
  ageRange: string;
  notes?: string;
}

export interface MetricNorm {
  id: string;
  label: string;
  /** Units of `mean`, `sd`, and `cutoff` after conversion into this codebase. */
  unit: string;
  mean: number | null;
  sd: number | null;
  cutoff: number | null;
  cutoffDirection: CutoffDirection | null;
  sample: NormSample | null;
  citation: NormCitation | null;
  source: NormSource;
  calibrated: boolean;
  note: string;
}

export interface HealthyRangeReading {
  metricId: string;
  calibrated: boolean;
  z: number | null;
  beyondCutoff: boolean;
  status: HealthyRangeStatus;
  text: string;
}

export interface TestNormShape {
  mean: number | null;
  healthySd: number | null;
  sensitivity: number;
  source: NormSource;
  note?: string;
  calibrated: boolean;
  cutoff: number | null;
  sample?: NormSample | null;
  citation?: NormCitation | null;
}

/** Notice attached to any reading that used Table 2 placeholders. */
export const ASSUMED_NORM_NOTICE =
  "Healthy-range means and SDs are assumed placeholders, not measured values.";

/** Notice attached when scoring uses Eq. (9) fitted healthy-control norms. */
export function fittedNormNotice(n: number): string {
  return `Healthy-range means and SDs are fitted from ${n} healthy-control sessions (Eq. 9).`;
}

const PLACEHOLDER_NOTE =
  "Assumed placeholder (Table 2). Not a measured healthy-control sample; replace by fitting (Eq. 9) once n ≥ 5.";

const UNCALIBRATED_NOTE = "This measure does not enter the evidence model and has no scoring healthy range.";

function assumedMetric(
  id: string,
  label: string,
  unit: string,
  mean: number,
  sd: number,
  note: string,
): MetricNorm {
  return {
    id,
    label,
    unit,
    mean,
    sd,
    cutoff: null,
    cutoffDirection: null,
    sample: null,
    citation: null,
    source: "assumed",
    calibrated: true,
    note,
  };
}

function uncalibratedMetric(id: string, label: string, unit: string, note = UNCALIBRATED_NOTE): MetricNorm {
  return {
    id,
    label,
    unit,
    mean: null,
    sd: null,
    cutoff: null,
    cutoffDirection: null,
    sample: null,
    citation: null,
    source: "uncalibrated",
    calibrated: false,
    note,
  };
}

/**
 * Evidence-model lateral index = negated mean signed error, so left-weaker is
 * negative. Table 2: μ = +1, σ = 3 (percent of line length).
 */
export const BISECTION_LATERAL_INDEX: MetricNorm = assumedMetric(
  "bisection-lateral-index",
  "Line bisection lateral index",
  "negated % of line length (negative = left weaker)",
  1,
  3,
  `${PLACEHOLDER_NOTE} Index is the negated mean signed error.`,
);

/** Signed midpoint error, percent of line length, right of centre positive. Table 2 flipped. */
export const BISECTION_SIGNED_ERROR_PCT: MetricNorm = assumedMetric(
  "bisection-signed-error-pct",
  "Line bisection signed error",
  "% of line length (right of centre positive)",
  -1,
  3,
  `${PLACEHOLDER_NOTE} Sign is opposite the evidence-model index.`,
);

/** Starry Night, Eq. (1): left hit rate − right hit rate. Table 2: μ = 0, σ = 0.15. */
export const STARRY_LATERALITY: MetricNorm = assumedMetric(
  "starry-night-laterality",
  "Starry Night laterality",
  "left hit rate − right hit rate (negative = left weaker)",
  0,
  0.15,
  `${PLACEHOLDER_NOTE} Assumed symmetric.`,
);

/** Hollow Rings, Eq. (1): right omission rate − left omission rate. Table 2: μ = 0, σ = 0.06. */
export const HOLLOW_RINGS_LATERAL_INDEX: MetricNorm = assumedMetric(
  "hollow-rings-lateral-index",
  "Hollow Rings laterality",
  "right omission rate − left omission rate (negative = left weaker)",
  0,
  0.06,
  `${PLACEHOLDER_NOTE} Assumed symmetric, few omissions.`,
);

/** @deprecated Use HOLLOW_RINGS_LATERAL_INDEX. Kept as an alias for existing imports. */
export const HOLLOW_RINGS_OMISSION_ASYMMETRY = HOLLOW_RINGS_LATERAL_INDEX;

export const GREYSCALES_LTR: MetricNorm = uncalibratedMetric(
  "greyscales-ltr",
  "Greyscales bias (left-to-right readers)",
  "bias −1…1 (positive = darker-left / leftward)",
);

export const GREYSCALES_RTL: MetricNorm = uncalibratedMetric(
  "greyscales-rtl",
  "Greyscales bias (right-to-left readers)",
  "bias −1…1 (positive = darker-left / leftward)",
);

export const GREYSCALES_OTHER: MetricNorm = uncalibratedMetric(
  "greyscales-other",
  "Greyscales bias (mixed or other reading direction)",
  "bias −1…1 (positive = darker-left / leftward)",
);

export const STAR_CANCELLATION_HIT_ASYMMETRY: MetricNorm = uncalibratedMetric(
  "star-cancellation-hit-asymmetry",
  "Star cancellation hit-rate asymmetry",
  "hitRateRight − hitRateLeft",
);

export const STAR_CANCELLATION_COC: MetricNorm = uncalibratedMetric(
  "star-cancellation-coc",
  "Star cancellation Center of Cancellation",
  "normalized x (positive = found targets shifted right)",
);

export const CLOCK_LATERALITY: MetricNorm = uncalibratedMetric(
  "clock-laterality",
  "Clock check laterality",
  "left-half accuracy − right-half accuracy",
);

export const SCENE_LATERALITY: MetricNorm = uncalibratedMetric(
  "scene-laterality",
  "Hidden scene laterality",
  "right-half minus left-half omission rate",
);

export const GAZE_LEFT_FRACTION: MetricNorm = uncalibratedMetric(
  "gaze-left-fraction",
  "Gaze time on the left half",
  "fraction of tracked gaze time",
);

export const METRICS = {
  "bisection-signed-error-pct": BISECTION_SIGNED_ERROR_PCT,
  "bisection-lateral-index": BISECTION_LATERAL_INDEX,
  "greyscales-ltr": GREYSCALES_LTR,
  "greyscales-rtl": GREYSCALES_RTL,
  "greyscales-other": GREYSCALES_OTHER,
  "hollow-rings-omission-asymmetry": HOLLOW_RINGS_OMISSION_ASYMMETRY,
  "hollow-rings-lateral-index": HOLLOW_RINGS_LATERAL_INDEX,
  "star-cancellation-hit-asymmetry": STAR_CANCELLATION_HIT_ASYMMETRY,
  "star-cancellation-coc": STAR_CANCELLATION_COC,
  "clock-laterality": CLOCK_LATERALITY,
  "starry-night-laterality": STARRY_LATERALITY,
  "scene-laterality": SCENE_LATERALITY,
  "gaze-left-fraction": GAZE_LEFT_FRACTION,
} as const satisfies Record<string, MetricNorm>;

export type MetricId = keyof typeof METRICS;

export function greyscalesMetric(direction: "left-to-right" | "right-to-left" | "both-or-other"): MetricNorm {
  if (direction === "left-to-right") return GREYSCALES_LTR;
  if (direction === "right-to-left") return GREYSCALES_RTL;
  return GREYSCALES_OTHER;
}

export function toTestNorm(metric: MetricNorm, sensitivity = 1): TestNormShape {
  return {
    mean: metric.mean,
    healthySd: metric.sd,
    sensitivity,
    source: metric.source,
    note: metric.note,
    calibrated: metric.calibrated,
    cutoff: metric.cutoff,
    sample: metric.sample,
    citation: metric.citation,
  };
}

export function isCalibratedNorm(norm: {
  source: string;
  calibrated?: boolean;
  mean: number | null;
  healthySd: number | null;
}): boolean {
  if (norm.source === "uncalibrated" || norm.calibrated === false) return false;
  return norm.mean != null && Number.isFinite(norm.mean) && norm.healthySd != null && Number.isFinite(norm.healthySd) && norm.healthySd > 0;
}

export function isCalibratedMetric(metric: MetricNorm): boolean {
  if (!metric.calibrated || metric.source === "uncalibrated") return false;
  const spread = metric.mean != null && metric.sd != null && metric.sd > 0;
  const cut = metric.cutoff != null && Number.isFinite(metric.cutoff);
  return spread || cut;
}

function formatZ(z: number): string {
  const digits = Math.abs(z).toFixed(1);
  if (z > 0) return `+${digits}`;
  if (z < 0) return `−${digits}`;
  return "0.0";
}

export function compareToNorm(value: number | null | undefined, metric: MetricNorm): HealthyRangeReading {
  if (value == null || !Number.isFinite(value) || !isCalibratedMetric(metric)) {
    return {
      metricId: metric.id,
      calibrated: false,
      z: null,
      beyondCutoff: false,
      status: "uncalibrated",
      text: "Uncalibrated — this measure does not enter the evidence model.",
    };
  }

  const z = metric.mean != null && metric.sd != null && metric.sd > 0 ? (value - metric.mean) / metric.sd : null;
  let beyondCutoff = false;
  if (metric.cutoff != null && Number.isFinite(metric.cutoff)) {
    if (metric.cutoffDirection === "above") beyondCutoff = value > metric.cutoff;
    else if (metric.cutoffDirection === "below") beyondCutoff = value < metric.cutoff;
    else beyondCutoff = Math.abs(value) > Math.abs(metric.cutoff);
  } else if (z != null) {
    beyondCutoff = Math.abs(z) > 2;
  }

  const zPart = z == null ? "" : ` (z = ${formatZ(z)})`;
  let notice = "";
  if (metric.source === "assumed") notice = ` ${ASSUMED_NORM_NOTICE}`;
  else if (metric.source === "fitted") {
    const n = metric.sample?.n;
    notice = ` ${n != null ? fittedNormNotice(n) : "Healthy-range means and SDs are fitted (Eq. 9)."}`;
  }
  return {
    metricId: metric.id,
    calibrated: true,
    z,
    beyondCutoff,
    status: beyondCutoff ? "outside" : "within",
    text: `${beyondCutoff ? `Outside the healthy range${zPart}.` : `Within the healthy range${zPart}.`}${notice}`,
  };
}

/**
 * Map a value onto [0, 1] using |z|/2 against the scoring healthy range.
 * Uncalibrated metrics return null so callers drop them.
 */
export function deviationUnit(value: number | null | undefined, metric: MetricNorm): number | null {
  if (value == null || !Number.isFinite(value) || !isCalibratedMetric(metric)) return null;
  if (metric.cutoff != null && Number.isFinite(metric.cutoff)) {
    const center = metric.mean ?? 0;
    const span = Math.abs(metric.cutoff - center) || Math.abs(metric.cutoff);
    if (!(span > 0)) return null;
    const unit = Math.abs(value - center) / span;
    return unit < 0 ? 0 : unit > 1 ? 1 : unit;
  }
  const reading = compareToNorm(value, metric);
  if (reading.z == null) return reading.beyondCutoff ? 1 : 0;
  const unit = Math.abs(reading.z) / 2;
  return unit < 0 ? 0 : unit > 1 ? 1 : unit;
}

/**
 * Evidence-model defaults. Only Starry Night, Hollow Rings, and line bisection
 * are assumed placeholders and enter the posterior. The rest are uncalibrated.
 */
export const DEFAULT_NORMS: Record<"scene" | "clock" | "greyscales" | "bisection" | "detection" | "cancellation", TestNormShape> =
  {
    scene: toTestNorm(SCENE_LATERALITY),
    clock: toTestNorm(CLOCK_LATERALITY),
    greyscales: toTestNorm(GREYSCALES_LTR),
    bisection: toTestNorm(BISECTION_LATERAL_INDEX),
    detection: toTestNorm(STARRY_LATERALITY),
    cancellation: toTestNorm(HOLLOW_RINGS_LATERAL_INDEX),
  };
