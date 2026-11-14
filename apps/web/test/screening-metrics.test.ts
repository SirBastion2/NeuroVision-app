import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeBisectionMetrics,
  computeGazeMetrics,
  computeSessionMetrics,
  computeDeviation,
  computeStarMetrics,
  countPathCrossings,
  normX,
  quantile,
  signedDeviationPct,
  type BisectionLayout,
  type GazeSample,
  type StarLayout,
  type TapEvent,
} from "../src/metrics/index.ts";
import { generateBisectionLayout, resolveBisectionTap } from "../src/tests/bisection.ts";
import { difficultyForLevel, nextDifficulty } from "../src/tests/difficulty.ts";
import { generateStarLayout, resolveStarTap, STAR_TARGETS } from "../src/tests/star.ts";
import {
  detectionProbability,
  generateRecoverySeries,
  generateSyntheticBisectionSession,
  generateSyntheticStarSession,
} from "../src/tests/synthetic.ts";

const AREA = { width: 1200, height: 800 };

/** Hand-made layout: 4 targets at x = 150, 450, 750, 1050 (nx = -0.75, -0.25, 0.25, 0.75). */
function tinyLayout(): StarLayout {
  const xs = [150, 450, 750, 1050];
  return {
    kind: "star-cancellation",
    seed: 1,
    area: AREA,
    items: [
      ...xs.map((x, i) => ({ id: `t${i}`, kind: "target" as const, x, y: 300, size: 8, rotation: 0 })),
      { id: "d0", kind: "letter" as const, x: 600, y: 600, size: 10, rotation: 0, letter: "A" },
    ],
    hitRadius: 40,
    spacing: { x: 100, y: 100 },
  };
}
const tap = (t: number, targetId: string | null, kind: TapEvent["kind"], x = 0, y = 300): TapEvent => ({ t, x, y, targetId, kind });
const sample = (t: number, x: number | null, y: number | null = 300, extra: Partial<GazeSample> = {}): GazeSample => ({
  t,
  x,
  y,
  confidence: 1,
  blink: false,
  isFixation: false,
  headYawDeg: 0,
  headPitchDeg: 0,
  ...extra,
});

describe("star metrics", () => {
  test("Center of Cancellation is 0 when everything is found and positive when the left is missed", () => {
    const L = tinyLayout();
    const all = ["t0", "t1", "t2", "t3"].map((id, i) => tap(i * 100, id, "cancel"));
    const m = computeStarMetrics(L, all, 1000, false);
    assert.equal(m.hits, 4);
    assert.ok(Math.abs(m.centerOfCancellation!) < 1e-12);
    assert.equal(m.cocFlag, false);

    const rightOnly = computeStarMetrics(L, [tap(0, "t2", "cancel"), tap(100, "t3", "cancel")], 1000, false);
    assert.equal(rightOnly.centerOfCancellation, 0.5); // mean(0.25, 0.75) - mean(all) 0
    assert.equal(rightOnly.cocFlag, true);
    assert.equal(rightOnly.hitRateLeft, 0);
    assert.equal(rightOnly.hitRateRight, 1);
    assert.deepEqual(rightOnly.hitRateByBin, [0, null, 0, 1, null, 1]);
  });

  test("CoC is null with no hits; revisits, commissions and first tap side are counted", () => {
    const L = tinyLayout();
    assert.equal(computeStarMetrics(L, [], 0, true).centerOfCancellation, null);
    const m = computeStarMetrics(L, [tap(50, "t3", "cancel", 1050), tap(80, "t3", "revisit", 1050), tap(90, "d0", "commission", 600)], 500, false);
    assert.equal(m.revisits, 1);
    assert.equal(m.commissions, 1);
    assert.deepEqual(m.firstTap, { x: 0.75, side: "right" });
  });

  test("path crossings count proper self-intersections only", () => {
    assert.equal(countPathCrossings([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), 0);
    // Z then back across the diagonal: 0,0 → 10,10 → 10,0 → 0,10 crosses once.
    assert.equal(countPathCrossings([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), 1);
  });
});

describe("bisection metrics", () => {
  test("signed deviation is a percent of line length, positive to the right", () => {
    assert.equal(signedDeviationPct({ x1: 100, x2: 300 }, 220), 10);
    assert.equal(signedDeviationPct({ x1: 100, x2: 300 }, 180), -10);
  });

  test("mean, spread and left/right line means; first tap per line counts", () => {
    const L: BisectionLayout = {
      kind: "line-bisection",
      seed: 1,
      area: AREA,
      tolerance: 20,
      lines: [
        { id: "a", x1: 100, x2: 300, y: 100 }, // left line, mid 200
        { id: "b", x1: 800, x2: 1000, y: 200 }, // right line, mid 900
        { id: "c", x1: 500, x2: 700, y: 300 }, // unanswered
      ],
    };
    const m = computeBisectionMetrics(L, [tap(1, "a", "cancel", 220), tap(2, "a", "revisit", 290), tap(3, "b", "cancel", 940)], 5000);
    assert.deepEqual(m.deviations, [10, 20, null]);
    assert.equal(m.answered, 2);
    assert.equal(m.meanDeviation, 15);
    assert.equal(m.meanDeviationLeftLines, 10);
    assert.equal(m.meanDeviationRightLines, 20);
    assert.ok(Math.abs(m.sdDeviation! - Math.SQRT2 * 5) < 1e-9);
  });
});

describe("gaze metrics", () => {
  test("left gaze share is time-weighted over tracked samples; gaps and blinks don't count", () => {
    const L = tinyLayout();
    const g = [
      sample(0, 100), // left, 100 ms
      sample(100, 100), // left, 100 ms
      sample(200, 1100), // right, 100 ms
      sample(300, null, null), // lost
      sample(400, 1100, 300, { blink: true }),
      sample(500, 1100), // right, last sample: 0 ms
    ];
    const m = computeGazeMetrics(L, g, []);
    assert.equal(m.leftGazeFraction, 2 / 3);
    assert.equal(m.trackedFraction, 4 / 6);
    assert.equal(m.firstLookDirection, "left");
  });

  test("leftmost reach is the 5th percentile; head yaw is relative to calibration", () => {
    const L = tinyLayout();
    const g = Array.from({ length: 100 }, (_, i) => sample(i * 33, 600 + i * 6, 300, { headYawDeg: -10 }));
    const m = computeGazeMetrics(L, g, [], { calibrationHeadYawDeg: -4 });
    const nxs = g.map((s) => normX(s.x!, AREA.width));
    assert.equal(m.leftmostReach, quantile(nxs, 0.05));
    assert.equal(m.meanHeadYawDeg, -6);
  });

  test("missed targets with >= 250 ms of nearby gaze are 'looked at'; found ones are not", () => {
    const L = tinyLayout();
    const g = [
      ...Array.from({ length: 10 }, (_, i) => sample(i * 33, 155, 305)), // ~300 ms on t0
      ...Array.from({ length: 4 }, (_, i) => sample(400 + i * 33, 452, 300)), // ~130 ms on t1
      ...Array.from({ length: 12 }, (_, i) => sample(600 + i * 33, 1050, 300)), // on t3, but t3 is found
      sample(2000, 600, 600),
    ];
    const m = computeGazeMetrics(L, g, [tap(500, "t3", "cancel")]);
    assert.deepEqual(m.missedLookedAt, ["t0"]);
  });
});

describe("deviation from the healthy range", () => {
  test("is 0 for a symmetric run, rises with asymmetry, and renormalises missing parts", () => {
    const L = tinyLayout();
    const all = computeStarMetrics(L, ["t0", "t1", "t2", "t3"].map((id, i) => tap(i, id, "cancel")), 1, false);
    assert.ok(computeDeviation(all, null).score < 0.05);
    const right = computeStarMetrics(L, [tap(0, "t2", "cancel"), tap(1, "t3", "cancel")], 1, false);
    const s = computeDeviation(right, null);
    assert.equal(s.components.length, 2);
    assert.ok(Math.abs(s.components.reduce((a, c) => a + c.weight, 0) - 1) < 1e-12);
    assert.ok(s.score > 0.95);
  });
});

describe("layouts and tap resolution", () => {
  test("star layout spreads 36 targets evenly across 12 columns and stays clear of the Done band", () => {
    const L = generateStarLayout(AREA, difficultyForLevel(3), 7);
    const targets = L.items.filter((i) => i.kind === "target");
    assert.equal(targets.length, STAR_TARGETS);
    const perCol = new Map<string, number>();
    for (const t of targets) perCol.set(t.id.split("-")[1]!, (perCol.get(t.id.split("-")[1]!) ?? 0) + 1);
    assert.deepEqual([...perCol.values()], Array(12).fill(3));
    assert.ok(L.items.every((i) => i.y < AREA.height - 60 && i.x > 0 && i.x < AREA.width));
    // Same seed, same layout.
    assert.deepEqual(generateStarLayout(AREA, difficultyForLevel(3), 7), L);
  });

  test("higher difficulty means more distractors and smaller targets", () => {
    const easy = generateStarLayout(AREA, difficultyForLevel(1), 3);
    const hard = generateStarLayout(AREA, difficultyForLevel(5), 3);
    assert.ok(hard.items.length > easy.items.length);
    assert.ok(hard.items.find((i) => i.kind === "target")!.size < easy.items.find((i) => i.kind === "target")!.size);
  });

  test("star taps resolve to cancel, revisit or commission", () => {
    const L = generateStarLayout(AREA, difficultyForLevel(2), 11);
    const t = L.items.find((i) => i.kind === "target")!;
    const d = L.items.find((i) => i.kind !== "target")!;
    const first = resolveStarTap(L, t.x + 2, t.y - 2, 10, []);
    assert.equal(first.kind, "cancel");
    assert.equal(first.targetId, t.id);
    assert.equal(resolveStarTap(L, t.x, t.y, 20, [first]).kind, "revisit");
    assert.equal(resolveStarTap(L, d.x, d.y, 30, [first]).kind, "commission");
    assert.equal(resolveStarTap(L, -500, -500, 40, []).targetId, null);
  });

  test("bisection layout has 18 lines balanced across thirds; taps resolve to lines", () => {
    const L = generateBisectionLayout(AREA, 5);
    assert.equal(L.lines.length, 18);
    const thirds = [0, 0, 0];
    for (const l of L.lines) thirds[Math.min(2, Math.floor(((l.x1 + l.x2) / 2 / AREA.width) * 3))]!++;
    assert.deepEqual(thirds, [6, 6, 6]);
    const line = L.lines[3]!;
    const a = resolveBisectionTap(L, (line.x1 + line.x2) / 2, line.y + 3, 1, []);
    assert.equal(a.kind, "cancel");
    assert.equal(a.targetId, line.id);
    assert.equal(resolveBisectionTap(L, (line.x1 + line.x2) / 2, line.y, 2, [a]).kind, "revisit");
  });
});

describe("difficulty staircase", () => {
  const run = (level: number, hitRate: number, timedOut = false, commissions = 0) => ({ difficulty: difficultyForLevel(level), hitRate, timedOut, commissions });
  test("starts at the default, goes up after easy runs, down after struggling, holds otherwise, and stays in range", () => {
    assert.equal(nextDifficulty([]).level, 2);
    assert.equal(nextDifficulty([run(2, 0.97)]).level, 3);
    assert.equal(nextDifficulty([run(3, 0.5)]).level, 2);
    assert.equal(nextDifficulty([run(3, 0.75, true)]).level, 2);
    assert.equal(nextDifficulty([run(3, 0.8)]).level, 3);
    assert.equal(nextDifficulty([run(3, 0.95, false, 5)]).level, 3);
    assert.equal(nextDifficulty([run(5, 1)]).level, 5);
    assert.equal(nextDifficulty([run(1, 0.1)]).level, 1);
  });
});

describe("synthetic patients", () => {
  test("detection falls off to the left as left-side lean rises", () => {
    assert.ok(detectionProbability(-0.8, 0) > 0.9);
    assert.ok(detectionProbability(-0.8, 0.8) < 0.1);
    assert.ok(detectionProbability(0.8, 0.8) > 0.8);
  });

  test("a severe synthetic run looks like left neglect; a mild one doesn't", () => {
    const severe = generateSyntheticStarSession(0.85, 3);
    const mild = generateSyntheticStarSession(0.05, 3);
    const sm = severe.metrics.test;
    const mm = mild.metrics.test;
    assert.equal(sm.kind, "star-cancellation");
    assert.equal(mm.kind, "star-cancellation");
    if (sm.kind !== "star-cancellation" || mm.kind !== "star-cancellation") return;
    assert.ok(sm.centerOfCancellation! > 0.15, `severe CoC ${sm.centerOfCancellation}`);
    assert.ok(Math.abs(mm.centerOfCancellation!) < 0.08, `mild CoC ${mm.centerOfCancellation}`);
    assert.ok(severe.metrics.gaze!.leftGazeFraction! < 0.35);
    assert.ok(mild.metrics.gaze!.leftGazeFraction! > 0.35);
    assert.ok(severe.metrics.deviation.score > mild.metrics.deviation.score + 0.3);
    assert.ok(severe.gaze.some((g) => g.isFixation));
  });

  test("synthetic bisection deviates rightward with left-side lean", () => {
    const m = generateSyntheticBisectionSession(0.8, 9).metrics.test;
    const h = generateSyntheticBisectionSession(0, 9).metrics.test;
    assert.ok(m.kind === "line-bisection" && h.kind === "line-bisection");
    if (m.kind !== "line-bisection" || h.kind !== "line-bisection") return;
    assert.ok(m.meanDeviation! > 8);
    assert.ok(Math.abs(h.meanDeviation!) < 4);
  });

  test("recovery series: N visits, deviation trending down, sessions round-trip through JSON", () => {
    const series = generateRecoverySeries(5);
    assert.equal(series.length, 10);
    const stars = series.filter((s) => s.test === "star-cancellation");
    const scores = stars.map((s) => s.metrics.deviation.score);
    assert.ok(scores[0]! > scores[4]! + 0.3, scores.join(","));
    assert.ok(stars.every((s, i) => i === 0 || s.createdAt > stars[i - 1]!.createdAt));
    const round = JSON.parse(JSON.stringify(series[0]));
    assert.deepEqual(round, series[0]);
    assert.equal(series[0]!.schema, "neurovision.screening.session/1");
    assert.equal(series[0]!.source, "synthetic");
  });

  test("computeSessionMetrics is reproducible from the stored session", () => {
    const s = generateSyntheticStarSession(0.5, 21);
    const t = s.metrics.test;
    const again = computeSessionMetrics({ ...s, durationMs: t.durationMs, timedOut: t.kind === "star-cancellation" && t.timedOut });
    assert.deepEqual(again, s.metrics);
  });
});
