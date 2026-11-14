/**
 * Published healthy-range norms for NeuroVision metrics.
 *
 * Numbers come from peer-reviewed healthy-control samples, converted into the
 * units this codebase already scores. Metrics without a defensible published
 * match are marked uncalibrated: scoring must not invent a mean, SD, or cutoff
 * for them.
 */

export type NormSource = "hacker-norms" | "literature" | "assumed" | "uncalibrated";
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
  /** Healthy-control n when the paper reports one; omitted for cutoff-only mappings. */
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

const AZOUVI_2006: NormCitation = {
  authors: "Azouvi P, Bartolomeo P, Beis J-M, Perennou D, Pradat-Diehl P, Rousseaux M",
  year: 2006,
  title: "A battery of tests for the quantitative assessment of unilateral neglect",
  journal: "Restorative Neurology and Neuroscience",
  doi: "10.3233/RNN-2006-354",
  url: "https://pubmed.ncbi.nlm.nih.gov/17119296/",
};

const FRIEDRICH_ELIAS_2014: NormCitation = {
  authors: "Friedrich TE, Elias LJ",
  year: 2014,
  title: "Behavioural asymmetries on the greyscales task: The influence of native reading direction",
  journal: "Culture and Brain",
  doi: "10.1007/s40167-014-0019-3",
  url: "https://doi.org/10.1007/s40167-014-0019-3",
};

const RORDEN_KARNATH_2010: NormCitation = {
  authors: "Rorden C, Karnath H-O",
  year: 2010,
  title: "A simple measure of neglect severity",
  journal: "Neuropsychologia",
  doi: "10.1016/j.neuropsychologia.2010.04.018",
  url: "https://doi.org/10.1016/j.neuropsychologia.2010.04.018",
};

const AZOUVI_CONTROLS = "adults 20–80+ years (French BEN healthy controls)";

/** Azouvi 2006 20 cm line: mm → percent of line length (200 mm). */
export const BISECTION_LINE_MM = 200;
export const AZOUVI_BISECTION_MEAN_MM = -0.95;
export const AZOUVI_BISECTION_SD_MM = 4.15;
export const AZOUVI_BISECTION_CUTOFF_MM = 6.5;

/** Signed midpoint error, percent of line length, right of centre positive. */
export const BISECTION_SIGNED_ERROR_PCT: MetricNorm = {
  id: "bisection-signed-error-pct",
  label: "Line bisection signed error",
  unit: "% of line length (right of centre positive)",
  mean: (100 * AZOUVI_BISECTION_MEAN_MM) / BISECTION_LINE_MM,
  sd: (100 * AZOUVI_BISECTION_SD_MM) / BISECTION_LINE_MM,
  cutoff: (100 * AZOUVI_BISECTION_CUTOFF_MM) / BISECTION_LINE_MM,
  cutoffDirection: "above",
  sample: {
    n: 457,
    ageRange: AZOUVI_CONTROLS,
    notes: "20 cm lines, Table 2. Cutoff is the published rightward (left-neglect) threshold.",
  },
  citation: AZOUVI_2006,
  source: "literature",
  calibrated: true,
  note: "Converted from millimetres on a 20 cm line. Rightward marks sit outside the healthy range above 6.5 mm (3.25% of line length).",
};

/**
 * Evidence-model lateral index = negated mean signed error, so left-weaker is
 * negative. Healthy mean therefore flips sign; SD is unchanged.
 */
export const BISECTION_LATERAL_INDEX: MetricNorm = {
  id: "bisection-lateral-index",
  label: "Line bisection lateral index",
  unit: "negated % of line length (negative = left weaker)",
  mean: BISECTION_SIGNED_ERROR_PCT.mean === null ? null : -BISECTION_SIGNED_ERROR_PCT.mean,
  sd: BISECTION_SIGNED_ERROR_PCT.sd,
  cutoff: BISECTION_SIGNED_ERROR_PCT.cutoff === null ? null : -BISECTION_SIGNED_ERROR_PCT.cutoff,
  cutoffDirection: "below",
  sample: BISECTION_SIGNED_ERROR_PCT.sample,
  citation: AZOUVI_2006,
  source: "literature",
  calibrated: true,
  note: "Same Azouvi 2006 20 cm sample as signed error, with the evidence-model sign flip.",
};

/**
 * Friedrich & Elias 2014 response bias is (rightward − leftward) choices on 96
 * trials, negative = leftward. Our bias is (darker-left − darker-right) / n,
 * positive = leftward, so we flip sign and divide by 96.
 */
export const GREYSCALES_TRIALS = 96;
export const FRIEDRICH_LTR_BIAS = -34.6;
export const FRIEDRICH_LTR_SD = 37.67;
export const FRIEDRICH_RTL_BIAS = -0.99;
export const FRIEDRICH_RTL_SD = 42.06;

export const GREYSCALES_LTR: MetricNorm = {
  id: "greyscales-ltr",
  label: "Greyscales bias (left-to-right readers)",
  unit: "bias −1…1 (positive = darker-left / leftward)",
  mean: -FRIEDRICH_LTR_BIAS / GREYSCALES_TRIALS,
  sd: FRIEDRICH_LTR_SD / GREYSCALES_TRIALS,
  cutoff: null,
  cutoffDirection: null,
  sample: {
    n: 54,
    ageRange: "young adults, university sample (LTR males 25.8±5.5 y)",
    notes: "Native left-to-right readers. Paper score −96…+96, negative = leftward.",
  },
  citation: FRIEDRICH_ELIAS_2014,
  source: "literature",
  calibrated: true,
  note: "Healthy left-to-right readers favour the darker-left bar (pseudoneglect).",
};

export const GREYSCALES_RTL: MetricNorm = {
  id: "greyscales-rtl",
  label: "Greyscales bias (right-to-left readers)",
  unit: "bias −1…1 (positive = darker-left / leftward)",
  mean: -FRIEDRICH_RTL_BIAS / GREYSCALES_TRIALS,
  sd: FRIEDRICH_RTL_SD / GREYSCALES_TRIALS,
  cutoff: null,
  cutoffDirection: null,
  sample: {
    n: 43,
    ageRange: "young adults, university sample (RTL males 25.2±5.3 y)",
    notes: "Native right-to-left readers. Paper score −96…+96, negative = leftward.",
  },
  citation: FRIEDRICH_ELIAS_2014,
  source: "literature",
  calibrated: true,
  note: "Native right-to-left readers showed no reliable leftward greyscales bias.",
};

export const GREYSCALES_OTHER: MetricNorm = {
  id: "greyscales-other",
  label: "Greyscales bias (mixed or other reading direction)",
  unit: "bias −1…1 (positive = darker-left / leftward)",
  mean: null,
  sd: null,
  cutoff: null,
  cutoffDirection: null,
  sample: null,
  citation: null,
  source: "uncalibrated",
  calibrated: false,
  note: "Friedrich & Elias 2014 reports LTR and RTL groups only. Mixed or other reading direction has no published healthy range here.",
};

/** Azouvi bells: left-minus-right omissions on 15 targets per side. */
export const BELLS_TARGETS_PER_SIDE = 15;
export const AZOUVI_BELLS_MEAN_LR = 0.05;
export const AZOUVI_BELLS_SD_LR = 1.39;
export const AZOUVI_BELLS_CUTOFF_LR = 2;

function bellsCountToPoints(count: number): number {
  return (100 * count) / BELLS_TARGETS_PER_SIDE;
}

/**
 * Hollow-ring (target-selection) omission laterality in percentage points:
 * left omission rate minus right omission rate. Mapped from Azouvi bells
 * laterality as a proportion of targets on each side.
 */
export const HOLLOW_RINGS_OMISSION_ASYMMETRY: MetricNorm = {
  id: "hollow-rings-omission-asymmetry",
  label: "Hollow rings omission laterality",
  unit: "percentage points (left omission rate − right omission rate)",
  mean: bellsCountToPoints(AZOUVI_BELLS_MEAN_LR),
  sd: bellsCountToPoints(AZOUVI_BELLS_SD_LR),
  cutoff: bellsCountToPoints(AZOUVI_BELLS_CUTOFF_LR),
  cutoffDirection: "absolute",
  sample: {
    n: 576,
    ageRange: AZOUVI_CONTROLS,
    notes: "Bells test left-minus-right omissions, Table 2. Converted to % of 15 targets per side.",
  },
  citation: AZOUVI_2006,
  source: "literature",
  calibrated: true,
  note: "Closest published cancellation laterality (Bells test). Cutoff |L−R| > 2 omissions → 13.33 percentage points.",
};

/** Hit-rate right minus hit-rate left, the screening-star companion of bells laterality. */
export const STAR_CANCELLATION_HIT_ASYMMETRY: MetricNorm = {
  id: "star-cancellation-hit-asymmetry",
  label: "Star cancellation hit-rate asymmetry",
  unit: "hitRateRight − hitRateLeft",
  mean: HOLLOW_RINGS_OMISSION_ASYMMETRY.mean === null ? null : HOLLOW_RINGS_OMISSION_ASYMMETRY.mean / 100,
  sd: HOLLOW_RINGS_OMISSION_ASYMMETRY.sd === null ? null : HOLLOW_RINGS_OMISSION_ASYMMETRY.sd / 100,
  cutoff: HOLLOW_RINGS_OMISSION_ASYMMETRY.cutoff === null ? null : HOLLOW_RINGS_OMISSION_ASYMMETRY.cutoff / 100,
  cutoffDirection: "absolute",
  sample: HOLLOW_RINGS_OMISSION_ASYMMETRY.sample,
  citation: AZOUVI_2006,
  source: "literature",
  calibrated: true,
  note: "Same Bells laterality as hollow-ring omission asymmetry, expressed as a hit-rate difference.",
};

/** Center of Cancellation: published BIT-equivalent cutoff, not a new mean/SD. */
export const STAR_CANCELLATION_COC: MetricNorm = {
  id: "star-cancellation-coc",
  label: "Star cancellation Center of Cancellation",
  unit: "normalized x (positive = found targets shifted right)",
  mean: null,
  sd: null,
  cutoff: 0.081,
  cutoffDirection: "above",
  sample: {
    ageRange: "mapped to the Behavioural Inattention Test star-cancellation cutoff",
    notes: "Rorden & Karnath (2010) report that CoC 0.081 corresponds to the conventional BIT cutoff. No separate healthy mean/SD is used.",
  },
  citation: RORDEN_KARNATH_2010,
  source: "literature",
  calibrated: true,
  note: "Cutoff-only. Values above 0.081 sit outside the healthy range used by the BIT mapping.",
};

export const CLOCK_LATERALITY: MetricNorm = {
  id: "clock-laterality",
  label: "Clock check laterality",
  unit: "left-half accuracy − right-half accuracy",
  mean: null,
  sd: null,
  cutoff: null,
  cutoffDirection: null,
  sample: null,
  citation: null,
  source: "uncalibrated",
  calibrated: false,
  note: "Published clock-drawing cutoffs (e.g. Azouvi CDT) are a different task. This two-clock comparison has no published healthy range.",
};

export const STARRY_LATERALITY: MetricNorm = {
  id: "starry-night-laterality",
  label: "Starry Night laterality",
  unit: "left hit rate − right hit rate",
  mean: null,
  sd: null,
  cutoff: null,
  cutoffDirection: null,
  sample: null,
  citation: null,
  source: "uncalibrated",
  calibrated: false,
  note: "Deouell, Sacher & Soroker (2005) introduced this paradigm with a small patient series and no healthy-control mean/SD for this left−right hit-rate index.",
};

export const SCENE_LATERALITY: MetricNorm = {
  id: "scene-laterality",
  label: "Hidden scene laterality",
  unit: "right-half minus left-half omission rate",
  mean: null,
  sd: null,
  cutoff: null,
  cutoffDirection: null,
  sample: null,
  citation: null,
  source: "uncalibrated",
  calibrated: false,
  note: "The Hidden scene is a demonstration. It is not scored against a healthy range.",
};

export const GAZE_LEFT_FRACTION: MetricNorm = {
  id: "gaze-left-fraction",
  label: "Gaze time on the left half",
  unit: "fraction of tracked gaze time",
  mean: null,
  sd: null,
  cutoff: null,
  cutoffDirection: null,
  sample: null,
  citation: null,
  source: "uncalibrated",
  calibrated: false,
  note: "Webcam dwell laterality has no matching published healthy-control mean, SD, or cutoff.",
};

export const METRICS = {
  "bisection-signed-error-pct": BISECTION_SIGNED_ERROR_PCT,
  "bisection-lateral-index": BISECTION_LATERAL_INDEX,
  "greyscales-ltr": GREYSCALES_LTR,
  "greyscales-rtl": GREYSCALES_RTL,
  "greyscales-other": GREYSCALES_OTHER,
  "hollow-rings-omission-asymmetry": HOLLOW_RINGS_OMISSION_ASYMMETRY,
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
      text: "Uncalibrated — no published healthy range for this measure.",
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
  return {
    metricId: metric.id,
    calibrated: true,
    z,
    beyondCutoff,
    status: beyondCutoff ? "outside" : "within",
    text: beyondCutoff ? `Outside the healthy range${zPart}.` : `Within the healthy range${zPart}.`,
  };
}

/**
 * Map a value onto [0, 1] using the published cutoff span, or |z|/2 when only
 * mean/SD exist. Uncalibrated metrics return null so callers drop them.
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

/** Evidence-model defaults. Uncalibrated tests are excluded from the posterior. */
export const DEFAULT_NORMS: Record<"scene" | "clock" | "greyscales" | "bisection" | "detection", TestNormShape> = {
  scene: toTestNorm(SCENE_LATERALITY),
  clock: toTestNorm(CLOCK_LATERALITY),
  greyscales: toTestNorm(GREYSCALES_LTR),
  bisection: toTestNorm(BISECTION_LATERAL_INDEX),
  detection: toTestNorm(STARRY_LATERALITY),
};
