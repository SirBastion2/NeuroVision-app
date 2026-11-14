import type {
  CalibrationResult,
  CalibrationTarget,
  QualityPolicy,
} from "./contracts.js";
import { calibrationFromGates, evaluateQualityGates } from "./quality.js";
import { distancePx } from "./transform.js";

export interface CalibrationSessionState {
  phase: "idle" | "training" | "validating" | "complete" | "failed" | "skipped";
  trainPoints: CalibrationTarget[];
  validatePoints: CalibrationTarget[];
  result: CalibrationResult | null;
  clickOnly: boolean;
  message: string;
}

export function createCalibrationState(): CalibrationSessionState {
  return {
    phase: "idle",
    trainPoints: [],
    validatePoints: [],
    result: null,
    clickOnly: false,
    message: "Calibration not started",
  };
}

export function partitionCalibrationPoints(points: CalibrationTarget[]): {
  train: CalibrationTarget[];
  validate: CalibrationTarget[];
} {
  const train = points.filter((p) => p.role === "train");
  const validate = points.filter((p) => p.role === "validate");
  const trainIds = new Set(train.map((p) => p.id));
  for (const v of validate) {
    if (trainIds.has(v.id)) {
      throw new Error(
        `Validation point "${v.id}" must not also be a training point`,
      );
    }
  }
  return { train, validate };
}

export interface FixationEstimate {
  pointId: string;
  estimatedX: number;
  estimatedY: number;
}

export function computeValidationErrors(
  validatePoints: CalibrationTarget[],
  estimates: FixationEstimate[],
): number[] {
  const byId = new Map(estimates.map((e) => [e.pointId, e]));
  return validatePoints.map((p) => {
    const est = byId.get(p.id);
    if (!est) return Number.POSITIVE_INFINITY;
    return distancePx(
      { x: p.x, y: p.y },
      { x: est.estimatedX, y: est.estimatedY },
    );
  });
}

export function beginTraining(
  state: CalibrationSessionState,
  points: CalibrationTarget[],
): CalibrationSessionState {
  const { train, validate } = partitionCalibrationPoints(points);
  if (train.length === 0) {
    return {
      ...state,
      phase: "failed",
      message: "No training points supplied",
      clickOnly: true,
    };
  }
  return {
    ...state,
    phase: "training",
    trainPoints: train,
    validatePoints: validate,
    result: null,
    clickOnly: false,
    message: "Present deliberate fixation targets (training)",
  };
}

export function beginValidation(
  state: CalibrationSessionState,
): CalibrationSessionState {
  if (state.phase !== "training") {
    return {
      ...state,
      phase: "failed",
      message: "Validation requires completed training phase",
      clickOnly: true,
    };
  }
  if (state.validatePoints.length === 0) {
    return {
      ...state,
      phase: "failed",
      message: "No independent validation points",
      clickOnly: true,
    };
  }
  return {
    ...state,
    phase: "validating",
    message: "Independent validation (points not used as training)",
  };
}

export function completeValidation(
  state: CalibrationSessionState,
  estimates: FixationEstimate[],
  opts: { id: string; providerVersion: string; policy?: QualityPolicy },
): CalibrationSessionState {
  if (state.phase !== "validating") {
    return {
      ...state,
      phase: "failed",
      message: "completeValidation called outside validating phase",
      clickOnly: true,
    };
  }
  const errors = computeValidationErrors(state.validatePoints, estimates);
  const finite = errors.filter((e) => Number.isFinite(e));
  const decision = evaluateQualityGates({
    validationErrorPx: finite,
    policy: opts.policy,
  });
  const result = calibrationFromGates(
    opts.id,
    opts.providerVersion,
    finite,
    decision,
  );

  if (decision.resolution === "none") {
    return {
      ...state,
      phase: "failed",
      result,
      clickOnly: true,
      message:
        "Independent validation below quality gates — continue click-only or recalibrate",
    };
  }

  return {
    ...state,
    phase: "complete",
    result,
    clickOnly: false,
    message: `Calibration ok at resolution=${decision.resolution}`,
  };
}

export function skipToClickOnly(
  state: CalibrationSessionState,
  reason = "camera_denied_or_unavailable",
): CalibrationSessionState {
  return {
    ...state,
    phase: "skipped",
    result: null,
    clickOnly: true,
    message: `Click-only continuation (${reason})`,
  };
}
