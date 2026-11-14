import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyAffine, fitAffine, fitAffineIfBetter, IDENTITY, pageToScreenAffine } from "../src/gaze/affine.ts";
import { extractFeatures, eyeFeatures, parseTransform, type Landmark } from "../src/gaze/features.ts";
import { BlinkDetector, GazeSmoother, Median3, OneEuro } from "../src/gaze/filters.ts";
import { LiveFixationDetector, markFixations } from "../src/gaze/fixations.ts";
import { clickRefinementPairs, refineSessionGaze } from "../src/gaze/refine.ts";
import { CLIP_SIGMA, DEFAULT_LAMBDAS, chooseLambda, fitRidge, fitStandardizer, predictRidge, solve, standardize } from "../src/gaze/ridge.ts";
import { pageOrigin, pageToScreen, screenToPage } from "../src/gaze/screen.ts";
import { computeValidationReport } from "../src/gaze/validation.ts";
import { GazeModel, type TrainingRow } from "../src/gaze/model.ts";
import { gauss, rng, type GazeSample } from "../src/metrics/index.ts";
import { generateSyntheticStarSession } from "../src/tests/synthetic.ts";

const s = (t: number, x: number | null, y: number | null = 100): GazeSample => ({
  t,
  x,
  y,
  confidence: 1,
  blink: false,
  isFixation: false,
  headYawDeg: 0,
  headPitchDeg: 0,
});

describe("ridge regression", () => {
  test("solve() handles a small system", () => {
    const x = solve(
      [
        [4, 1],
        [1, 3],
      ],
      [1, 2],
    );
    assert.ok(Math.abs(4 * x[0]! + x[1]! - 1) < 1e-12 && Math.abs(x[0]! + 3 * x[1]! - 2) < 1e-12);
  });

  test("recovers a linear map from noisy features and picks a stable lambda by leave-one-point-out CV", () => {
    const r = rng(1);
    const X: number[][] = [];
    const y: number[] = [];
    const groups: number[] = [];
    for (let g = 0; g < 13; g++) {
      const a = r() * 2 - 1;
      const b = r() * 2 - 1;
      for (let k = 0; k < 25; k++) {
        const row = [a + gauss(r) * 0.03, b + gauss(r) * 0.03, r() * 0.01, a * 0.5 + gauss(r) * 0.05];
        X.push(row);
        y.push(800 * a + 200 * b + 600 + gauss(r) * 10);
        groups.push(g);
      }
    }
    const cv = chooseLambda(X, y, groups);
    assert.ok(cv.lambda >= 0.3 && cv.lambda <= 1000);
    // The chosen lambda is the largest whose CV error is within 10% of the best.
    const i = DEFAULT_LAMBDAS.indexOf(cv.lambda);
    assert.ok(cv.errors[i]! <= cv.bestError * 1.1 + 1e-9);
    assert.ok(DEFAULT_LAMBDAS.every((l, k) => l <= cv.lambda || cv.errors[k]! > cv.bestError * 1.1));
    const m = fitRidge(X, y, cv.lambda);
    assert.ok(Math.abs(predictRidge(m, [0.5, -0.5, 0.005, 0.25]) - (400 - 100 + 600)) < 40);
  });

  test("a head held still during calibration doesn't drag the gaze estimate later (regression: dot followed the head)", () => {
    // Calibration: eyes move to each target; head features barely move but drift slightly
    // with the target (people lean a little), which used to win the fit.
    const r = rng(11);
    const rows: TrainingRow[] = [];
    for (let g = 0; g < 13; g++) {
      const tx = 100 + (g % 5) * 300;
      const ty = 100 + Math.floor(g / 5) * 300;
      const irisH = (tx - 700) / 6000; // ~±0.1 of eye width across the screen
      const irisV = (ty - 400) / 9000;
      for (let k = 0; k < 25; k++) {
        const v = [irisH + gauss(r) * 0.012, irisV + gauss(r) * 0.012, irisH + gauss(r) * 0.012, irisV + gauss(r) * 0.012, 0.3 + gauss(r) * 0.01];
        // Head: yaw/pitch/roll, tx/ty/tz, faceX/faceY/faceSize, tiny spread correlated with the target.
        const lean = (tx - 700) / 700;
        v.push(lean * 0.4 + gauss(r) * 0.1, gauss(r) * 0.1, gauss(r) * 0.1, lean * 0.05, 0, -50, 0.5 + lean * 0.002, 0.5, 0.25);
        rows.push({ features: v, target: { x: tx, y: ty }, group: g });
      }
    }
    const model = GazeModel.fit(rows);
    const base = [0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, -50, 0.5, 0.5, 0.25];
    const centre = model.predict(base);
    // Turning the head 8° with the eyes still on the same point should barely move the estimate...
    const headTurned = model.predict([...base.slice(0, 5), 8, 0, 0, 1, 0, -50, 0.52, 0.5, 0.25]);
    // ...while moving only the eyes to the far right should move it a lot.
    const eyesRight = model.predict([0.1, 0, 0.1, 0, 0.3, ...base.slice(5)]);
    assert.ok(Math.abs(headTurned.x - centre.x) < 150, `head moved estimate ${Math.round(headTurned.x - centre.x)} px`);
    assert.ok(eyesRight.x - centre.x > 350, `eyes moved estimate only ${Math.round(eyesRight.x - centre.x)} px`);
    const parts = model.explain([0.1, 0, 0.1, 0, 0.3, ...base.slice(5)]);
    assert.ok(Math.abs(parts.eye.x) > 3 * Math.abs(parts.head.x));
  });

  test("standardized features are clipped to ±3.5σ so outliers can't fling predictions", () => {
    const X = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    const st = fitStandardizer(X);
    const z = standardize([1000, -1000], st);
    assert.deepEqual(z, [CLIP_SIGMA, -CLIP_SIGMA]);
    const m = fitRidge(X, [0, 10, 20, 30], 0.3);
    assert.ok(predictRidge(m, [1e6, 1e6]) < 200);
  });
});

describe("affine correction", () => {
  const size = { width: 1000, height: 800 };
  test("removes a constant rightward bias, clamped near identity", () => {
    const pts = [100, 300, 500, 700, 900].flatMap((x) => [200, 600].map((y) => ({ p: { x: x + 40, y }, t: { x, y } })));
    const c = fitAffine(pts, size);
    const q = applyAffine(c, { x: 540, y: 400 });
    assert.ok(Math.abs(q.x - 500) < 10, `got ${q.x}`);
    assert.ok(c.ax >= 0.85 && c.ax <= 1.15);
    const huge = fitAffine(pts.map((p) => ({ p: { x: p.p.x * 3, y: p.p.y }, t: p.t })), size);
    assert.ok(huge.ax >= 0.85 && huge.ax <= 1.15);
  });

  test("is kept only when leave-one-out error improves", () => {
    const biased = [100, 300, 500, 700, 900, 200, 800].map((x, i) => ({ p: { x: x + 50, y: 100 + i * 90 }, t: { x, y: 100 + i * 90 } }));
    assert.ok(fitAffineIfBetter(biased, size).correction);
    const r = rng(4);
    const noisy = [100, 300, 500, 700, 900, 200, 800].map((x, i) => ({ p: { x: x + gauss(r) * 30, y: 100 + i * 90 + gauss(r) * 30 }, t: { x, y: 100 + i * 90 } }));
    const d = fitAffineIfBetter(noisy, size);
    if (d.correction) assert.ok(d.looErrorCorrectedPx! < d.looErrorRawPx!);
    assert.equal(fitAffineIfBetter(biased.slice(0, 3), size).correction, null);
  });

  test("page-space corrections convert to screen space", () => {
    const c = { ax: 0.9, bx: 20, ay: 1.05, by: -10 };
    const off = { x: 300, y: 120 };
    const screenC = pageToScreenAffine(c, off);
    const page = { x: 400, y: 200 };
    const viaPage = applyAffine(c, page);
    const viaScreen = applyAffine(screenC, { x: page.x + off.x, y: page.y + off.y });
    assert.ok(Math.abs(viaScreen.x - off.x - viaPage.x) < 1e-9 && Math.abs(viaScreen.y - off.y - viaPage.y) < 1e-9);
    assert.deepEqual(applyAffine(IDENTITY, page), page);
  });
});

describe("screen coordinates", () => {
  test("page ↔ screen round-trips and fullscreen is the identity", () => {
    const windowed = { screenX: 100, screenY: 50, outerWidth: 1300, outerHeight: 900, innerWidth: 1280, innerHeight: 790 };
    assert.deepEqual(pageOrigin(windowed), { x: 110, y: 50 + 900 - 790 - 10 });
    const p = { x: 321, y: 123 };
    assert.deepEqual(screenToPage(pageToScreen(p, windowed), windowed), p);
    const full = { screenX: 0, screenY: 0, outerWidth: 1440, outerHeight: 900, innerWidth: 1440, innerHeight: 900 };
    assert.deepEqual(pageToScreen(p, full), p);
    // A calibration target stored in screen coords maps to the right page point after going fullscreen.
    const target = pageToScreen({ x: 50, y: 60 }, windowed);
    assert.deepEqual(screenToPage(target, full), { x: 160, y: 210 });
  });
});

describe("features and head pose", () => {
  function face(irisShift: number): Landmark[] {
    const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    // Right eye (image left): corners 33 → 133. Left eye: 362 → 263.
    lm[33] = { x: 0.35, y: 0.45 };
    lm[133] = { x: 0.45, y: 0.45 };
    lm[468] = { x: 0.4 + irisShift, y: 0.45 };
    lm[159] = { x: 0.4, y: 0.43 };
    lm[145] = { x: 0.4, y: 0.47 };
    lm[362] = { x: 0.55, y: 0.45 };
    lm[263] = { x: 0.65, y: 0.45 };
    lm[473] = { x: 0.6 + irisShift, y: 0.45 };
    lm[386] = { x: 0.6, y: 0.43 };
    lm[374] = { x: 0.6, y: 0.47 };
    lm[0] = { x: 0.3, y: 0.3 };
    lm[1] = { x: 0.7, y: 0.7 };
    return lm;
  }
  test("each iris is measured against its own eye, with matching signs", () => {
    const centred = extractFeatures(face(0), null, 1)!;
    assert.ok(Math.abs(centred.right.h) < 1e-9 && Math.abs(centred.left.h) < 1e-9);
    const shifted = extractFeatures(face(0.02), null, 1)!;
    assert.ok(Math.abs(shifted.right.h - 0.2) < 1e-9 && Math.abs(shifted.left.h - 0.2) < 1e-9);
    assert.ok(Math.abs(shifted.openness - 0.4) < 1e-9);
    assert.equal(shifted.vector.length, 14);
    assert.equal(eyeFeatures([], { a: 33, b: 133, iris: 468, upper: 159, lower: 145 }), null);
  });

  function matrix(yawDeg: number, pitchDeg: number, columnMajor: boolean): number[] {
    const y = (yawDeg * Math.PI) / 180;
    const p = (pitchDeg * Math.PI) / 180;
    // R = Ry(yaw) · Rx(pitch)
    const R = [
      [Math.cos(y), Math.sin(y) * Math.sin(p), Math.sin(y) * Math.cos(p)],
      [0, Math.cos(p), -Math.sin(p)],
      [-Math.sin(y), Math.cos(y) * Math.sin(p), Math.cos(y) * Math.cos(p)],
    ];
    const t = [2, -3, -45];
    const M = [
      [...R[0]!, t[0]!],
      [...R[1]!, t[1]!],
      [...R[2]!, t[2]!],
      [0, 0, 0, 1],
    ];
    const out: number[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out.push(columnMajor ? M[j]![i]! : M[i]![j]!);
    return out;
  }
  test("detects row- vs column-major and recovers yaw/pitch with the documented sign", () => {
    for (const cm of [true, false]) {
      const h = parseTransform(matrix(20, -10, cm))!;
      assert.equal(h.layout, cm ? "column-major" : "row-major");
      assert.ok(Math.abs(h.yawDeg - 20) < 1e-6, `yaw ${h.yawDeg}`);
      assert.ok(Math.abs(h.pitchDeg + 10) < 1e-6, `pitch ${h.pitchDeg}`);
      assert.deepEqual([h.tx, h.ty, h.tz], [2, -3, -45]);
    }
    const flipped = extractFeatures(face(0), matrix(15, 0, true), 1, -1)!;
    assert.ok(Math.abs(flipped.head!.yawDeg + 15) < 1e-6);
  });
});

describe("filters", () => {
  test("median-of-3 removes a single spike", () => {
    const m = new Median3();
    assert.deepEqual([10, 10, 500, 10, 10].map((v) => m.push(v)), [10, 10, 10, 10, 10]);
  });
  test("One Euro smooths jitter but follows a step", () => {
    const f = new OneEuro(1, 0.006);
    const r = rng(3);
    let maxDev = 0;
    for (let i = 0; i < 60; i++) maxDev = Math.max(maxDev, Math.abs(f.filter(500 + gauss(r) * 20, i * 33) - 500));
    assert.ok(maxDev < 25);
    let v = 0;
    for (let i = 60; i < 120; i++) v = f.filter(900, i * 33);
    assert.ok(Math.abs(v - 900) < 5);
    const sm = new GazeSmoother("high");
    assert.deepEqual(sm.push(1, 2, 0), { x: 1, y: 2 });
  });
  test("blinks are openness drops below 0.65 of the rolling median", () => {
    const b = new BlinkDetector();
    for (let i = 0; i < 20; i++) assert.equal(b.isBlink(0.3), false);
    assert.equal(b.isBlink(0.15), true);
    assert.equal(b.isBlink(0.28), false);
  });
});

describe("fixations (I-DT)", () => {
  test("marks stable runs >= 100 ms within 70 px, not saccades or untracked samples", () => {
    const seq = [
      ...Array.from({ length: 6 }, (_, i) => s(i * 33, 100 + (i % 2) * 5)),
      s(200, 600),
      s(233, null, null),
      ...Array.from({ length: 6 }, (_, i) => s(266 + i * 33, 900 + (i % 3) * 4)),
    ];
    const out = markFixations(seq);
    assert.deepEqual(out.map((o) => o.isFixation), [true, true, true, true, true, true, false, false, true, true, true, true, true, true]);
    const live = new LiveFixationDetector();
    const flags = seq.map((x) => live.push(x));
    assert.equal(flags[0], false);
    assert.equal(flags[5], true);
    assert.equal(flags[6], false);
  });
});

describe("validation report", () => {
  const vp = { width: 1000, height: 600 };
  test("scores accuracy and applies an affine fix for a rightward bias", () => {
    const r = rng(8);
    const targets = [
      { x: 80, y: 170 },
      { x: 920, y: 370 },
      { x: 350, y: 310 },
      { x: 620, y: 130 },
      { x: 80, y: 450 },
      { x: 500, y: 510 },
      { x: 780, y: 240 },
    ];
    const inputs = targets.map((t) => ({ target: t, frames: Array.from({ length: 25 }, () => ({ x: t.x + 45 + gauss(r) * 15, y: t.y + gauss(r) * 30 })) }));
    const { report, correction } = computeValidationReport(inputs, vp);
    assert.ok(correction);
    assert.equal(report.correctionApplied, true);
    assert.ok(report.looErrorCorrectedPx! < report.looErrorRawPx!);
    assert.ok(Math.abs(report.horizontalBiasPx!) < 15, `bias ${report.horizontalBiasPx}`);
    assert.ok(report.leftRightAccuracy! > 0.95);
    assert.ok(report.points.every((p) => p.raw && p.corrected));
  });
});

describe("click refinement", () => {
  test("pairs each correct click with the median gaze before it and improves a biased session", () => {
    const base = generateSyntheticStarSession(0.1, 5);
    const biased = base.gaze.map((g) => (g.x === null ? g : { ...g, x: Math.min(base.layout.area.width, g.x + 60) }));
    const pairs = clickRefinementPairs(base, biased);
    assert.ok(pairs.length > 10);
    const { refinement, refined } = refineSessionGaze(base, biased);
    assert.ok(refined && refinement.correction);
    assert.ok(refinement.looErrorCorrectedPx! < refinement.looErrorRawPx!);
  });
});
