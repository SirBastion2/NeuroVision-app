/**
 * Ridge regression on standardized, clipped features, with leave-one-point-out
 * cross-validation to choose lambda. Pure.
 */

export const CLIP_SIGMA = 3.5;
export const DEFAULT_LAMBDAS = logspace(0.3, 1000, 16);

export function logspace(lo: number, hi: number, n: number): number[] {
  const a = Math.log10(lo);
  const b = Math.log10(hi);
  return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)));
}

export interface Standardizer {
  mean: number[];
  sd: number[];
}

/**
 * `sdFloor` sets a minimum scale per feature. Without it, a feature that barely moved
 * during calibration (e.g. a head held still) gets a tiny SD, and any later movement
 * looks enormous after standardizing, so the prediction follows the head.
 */
export function fitStandardizer(X: readonly number[][], sdFloor?: readonly number[]): Standardizer {
  const d = X[0]?.length ?? 0;
  const mean = Array<number>(d).fill(0);
  const sd = Array<number>(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j]! += row[j]!;
  for (let j = 0; j < d; j++) mean[j]! /= X.length || 1;
  for (const row of X) for (let j = 0; j < d; j++) sd[j]! += (row[j]! - mean[j]!) ** 2;
  for (let j = 0; j < d; j++) {
    const s = Math.max(Math.sqrt(sd[j]! / Math.max(1, X.length - 1)), sdFloor?.[j] ?? 0);
    sd[j] = s > 1e-9 ? s : 1;
  }
  return { mean, sd };
}

/** Standardize and clip to ±CLIP_SIGMA. Clipping in both fit and predict keeps out-of-range heads from flinging the estimate. */
export function standardize(row: readonly number[], st: Standardizer): number[] {
  return row.map((v, j) => Math.max(-CLIP_SIGMA, Math.min(CLIP_SIGMA, (v - st.mean[j]!) / st.sd[j]!)));
}

/** Solves A x = b for a small dense symmetric system (Gaussian elimination, partial pivoting). */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const piv = M[c]![c]!;
    if (Math.abs(piv) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / piv;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = Math.abs(M[r]![r]!) < 1e-12 ? 0 : s / M[r]![r]!;
  }
  return x;
}

export interface RidgeModel {
  st: Standardizer;
  w: number[];
  b: number;
  lambda: number;
}

export interface RidgeOptions {
  /** Minimum SD per feature (see fitStandardizer). */
  sdFloor?: readonly number[];
  /** Per-feature penalty multiplier (default 1). Larger = the model must earn that weight. */
  penalty?: readonly number[];
}

/** Fits y ≈ w·z + b with an unpenalized intercept. */
export function fitRidge(X: readonly number[][], y: readonly number[], lambda: number, opts: RidgeOptions = {}): RidgeModel {
  const st = fitStandardizer(X, opts.sdFloor);
  const Z = X.map((r) => standardize(r, st));
  const d = st.mean.length;
  const n = Z.length;
  const zbar = Array<number>(d).fill(0);
  for (const r of Z) for (let j = 0; j < d; j++) zbar[j]! += r[j]! / n;
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const A = Array.from({ length: d }, () => Array<number>(d).fill(0));
  const rhs = Array<number>(d).fill(0);
  for (let i = 0; i < n; i++) {
    const zc = Z[i]!.map((v, j) => v - zbar[j]!);
    const yc = y[i]! - ybar;
    for (let j = 0; j < d; j++) {
      rhs[j]! += zc[j]! * yc;
      for (let k = j; k < d; k++) A[j]![k]! += zc[j]! * zc[k]!;
    }
  }
  for (let j = 0; j < d; j++) {
    for (let k = 0; k < j; k++) A[j]![k] = A[k]![j]!;
    A[j]![j]! += lambda * (opts.penalty?.[j] ?? 1);
  }
  const w = solve(A, rhs);
  const b = ybar - zbar.reduce((s, v, j) => s + v * w[j]!, 0);
  return { st, w, b, lambda };
}

export function predictRidge(m: RidgeModel, row: readonly number[]): number {
  const z = standardize(row, m.st);
  let s = m.b;
  for (let j = 0; j < z.length; j++) s += z[j]! * m.w[j]!;
  return s;
}

export interface CvResult {
  lambda: number;
  /** RMSE per lambda, same order as the lambdas tried. */
  errors: number[];
  bestError: number;
}

/**
 * Leave-one-point-out CV: every calibration point (group) is held out in turn, the
 * model is refit on the rest (standardizer included) and scored on the held-out frames.
 * Returns the LARGEST lambda whose error is within `tolerance` of the best, for stability.
 */
export function chooseLambda(
  X: readonly number[][],
  y: readonly number[],
  groups: readonly number[],
  lambdas: readonly number[] = DEFAULT_LAMBDAS,
  tolerance = 0.1,
  opts: RidgeOptions = {},
): CvResult {
  const ids = [...new Set(groups)];
  const errors = lambdas.map((lambda) => {
    let se = 0;
    let n = 0;
    for (const g of ids) {
      const trainX: number[][] = [];
      const trainY: number[] = [];
      const testIdx: number[] = [];
      groups.forEach((gi, i) => (gi === g ? testIdx.push(i) : (trainX.push(X[i] as number[]), trainY.push(y[i]!))));
      if (trainX.length < 2 || testIdx.length === 0) continue;
      const m = fitRidge(trainX, trainY, lambda, opts);
      for (const i of testIdx) {
        se += (predictRidge(m, X[i]!) - y[i]!) ** 2;
        n++;
      }
    }
    return n ? Math.sqrt(se / n) : Infinity;
  });
  const bestError = Math.min(...errors);
  let lambda = lambdas[errors.indexOf(bestError)] ?? lambdas[0]!;
  lambdas.forEach((l, i) => {
    if (errors[i]! <= bestError * (1 + tolerance) && l > lambda) lambda = l;
  });
  return { lambda, errors, bestError };
}
