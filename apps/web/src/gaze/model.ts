import { EYE_FEATURE_INDICES, FEATURE_PENALTY, FEATURE_SD_FLOOR, HEAD_FEATURE_INDICES } from "./features";
import { CLIP_SIGMA, DEFAULT_LAMBDAS, chooseLambda, fitRidge, predictRidge, standardize, type RidgeModel, type RidgeOptions } from "./ridge";

const OPTS: RidgeOptions = { sdFloor: FEATURE_SD_FLOOR, penalty: FEATURE_PENALTY };

export interface TrainingRow {
  features: number[];
  /** Target in SCREEN coordinates. */
  target: { x: number; y: number };
  /** Calibration point index, for leave-one-point-out CV. */
  group: number;
}

/** Two ridge models (x and y), each with its own CV-chosen lambda. Predicts screen coordinates. */
export class GazeModel {
  private constructor(
    private mx: RidgeModel,
    private my: RidgeModel,
    readonly cvErrorPx: { x: number; y: number },
  ) {}

  static fit(rows: readonly TrainingRow[]): GazeModel {
    const X = rows.map((r) => r.features);
    const groups = rows.map((r) => r.group);
    const xs = rows.map((r) => r.target.x);
    const ys = rows.map((r) => r.target.y);
    const cvx = chooseLambda(X, xs, groups, DEFAULT_LAMBDAS, 0.1, OPTS);
    const cvy = chooseLambda(X, ys, groups, DEFAULT_LAMBDAS, 0.1, OPTS);
    return new GazeModel(fitRidge(X, xs, cvx.lambda, OPTS), fitRidge(X, ys, cvy.lambda, OPTS), { x: cvx.bestError, y: cvy.bestError });
  }

  get lambda() {
    return { x: this.mx.lambda, y: this.my.lambda };
  }

  predict(features: readonly number[]): { x: number; y: number } {
    return { x: predictRidge(this.mx, features), y: predictRidge(this.my, features) };
  }

  /**
   * How far the current prediction sits from the calibration-average prediction, split
   * into the part driven by the eyes and the part driven by the head. For diagnostics.
   */
  explain(features: readonly number[]): { eye: { x: number; y: number }; head: { x: number; y: number } } {
    const part = (m: RidgeModel, idx: readonly number[]) => {
      const z = standardize(features, m.st);
      return idx.reduce((s, j) => s + z[j]! * m.w[j]!, 0);
    };
    const head = FEATURE_SD_FLOOR.map((_, j) => j).filter((j) => !EYE_FEATURE_INDICES.includes(j));
    return {
      eye: { x: part(this.mx, EYE_FEATURE_INDICES), y: part(this.my, EYE_FEATURE_INDICES) },
      head: { x: part(this.mx, head), y: part(this.my, head) },
    };
  }

  /** True when any head-placement feature is beyond the clip range of calibration. */
  outOfRange(features: readonly number[]): boolean {
    const { mean, sd } = this.mx.st;
    return HEAD_FEATURE_INDICES.some((j) => Math.abs((features[j]! - mean[j]!) / sd[j]!) > CLIP_SIGMA);
  }
}
