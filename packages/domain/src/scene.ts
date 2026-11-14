/**
 * Scene search with a hidden part ("You didn't notice").
 *
 * One wide night harbor, 3 panels of 960 x 720 logical px. Two panels are
 * shown; the third (left by default) is hidden until the reveal. Because it is
 * one generated scene cropped to two-thirds, there is no seam to hide.
 *
 * Targets are lit lanterns. Distractors are unlit lanterns and lit windows.
 * A tall tower sits exactly on the visible edge so the crop looks like the
 * scene's natural end, and nothing else is allowed to cross that edge.
 *
 * Pure functions only. Self-contained except for a type-only import.
 */
import type { TestObservation } from "./evidence.js";

export type HideSide = "left" | "right" | "none";

export interface SceneConfig {
  seed?: number;
  hide?: HideSide;
  targetsPerPanel?: number;
  unlitPerPanel?: number;
}

export interface SceneWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  lit: boolean;
}

export interface Building {
  x: number;
  w: number;
  h: number;
  kind: "block" | "tower";
  windows: SceneWindow[];
}

export interface Lantern {
  id: string;
  x: number;
  y: number;
  lit: boolean;
  panel: 0 | 1 | 2;
  mount: "roof" | "post";
}

export interface Scene {
  width: number;
  height: number;
  panelWidth: number;
  groundY: number;
  hide: HideSide;
  /** Region shown before the reveal. */
  visible: { x0: number; x1: number };
  hidden: { x0: number; x1: number } | null;
  buildings: Building[];
  posts: number[];
  stars: Array<{ x: number; y: number; r: number }>;
  moon: { x: number; y: number; r: number };
  lighthouse: { x: number; baseY: number; h: number };
  lanterns: Lantern[];
}

export interface SceneTap {
  t: number;
  x: number;
  y: number;
}

export interface SceneTapResult extends SceneTap {
  kind: "target" | "repeat" | "distractor" | "empty";
  lanternId: string | null;
}

export interface SceneScore {
  taps: SceneTapResult[];
  foundIds: string[];
  byPanel: Array<{ found: number; total: number }>;
  totalTargets: number;
  visibleTargets: number;
  foundVisible: number;
  /** Real measure: left vs right halves of the region the person could see. */
  observationVisible: TestObservation;
  /** Demonstration only: the whole scene including the hidden part. Null when nothing was hidden. */
  observationInduced: TestObservation | null;
  /** Center of Cancellation, adjusted for target layout. Negative = found targets sit left of the target center. */
  coc: { visible: number | null; full: number | null };
}

export const SCENE_DEFAULTS = {
  panelWidth: 960,
  height: 720,
  groundY: 560,
  targetsPerPanel: 7,
  unlitPerPanel: 5,
  hitRadius: 34,
  minLanternSpacing: 64,
  edgeMargin: 56,
  searchCapMs: 60000,
  revealMs: 1800,
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(r: () => number, items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function windowsFor(r: () => number, x: number, w: number, h: number, groundY: number): SceneWindow[] {
  const out: SceneWindow[] = [];
  const cols = Math.max(1, Math.floor((w - 16) / 22));
  const rows = Math.max(1, Math.floor((h - 34) / 30));
  const x0 = x + (w - cols * 22 + 12) / 2;
  for (let c = 0; c < cols; c++) {
    for (let k = 0; k < rows; k++) {
      out.push({ x: x0 + c * 22, y: groundY - h + 18 + k * 30, w: 10, h: 14, lit: r() < 0.28 });
    }
  }
  return out;
}

function fillSegment(r: () => number, start: number, end: number, groundY: number, out: Building[]): void {
  let x = start;
  while (x < end - 60) {
    let w = 70 + Math.round(r() * 110);
    if (x + w > end) w = end - x;
    if (w < 60) break;
    const h = 150 + Math.round(r() * 260);
    out.push({ x, w, h, kind: "block", windows: windowsFor(r, x, w, h, groundY) });
    x += w + 6 + Math.round(r() * 22);
  }
}

/** Build the scene. The same seed and side always give the same scene. */
export function generateScene(config: SceneConfig = {}): Scene {
  const seed = config.seed ?? 7;
  const hide: HideSide = config.hide ?? "left";
  const r = rng(seed);
  const P = SCENE_DEFAULTS.panelWidth;
  const W = P * 3;
  const H = SCENE_DEFAULTS.height;
  const G = SCENE_DEFAULTS.groundY;
  const mirror = hide === "right";
  const mx = (x: number) => (mirror ? W - x : x);

  // Layout is authored for "hide left" and mirrored for "hide right".
  const towerX0 = P;
  const towerW = 100;
  const lighthouseX = 380;
  const buildingsL: Building[] = [];
  fillSegment(r, 20, lighthouseX - 90, G, buildingsL);
  fillSegment(r, lighthouseX + 90, P - 40, G, buildingsL);
  buildingsL.push({ x: towerX0, w: towerW, h: 470, kind: "tower", windows: windowsFor(r, towerX0, towerW, 470, G) });
  fillSegment(r, towerX0 + towerW + 10, W - 20, G, buildingsL);

  const buildings = buildingsL.map((b) => {
    if (!mirror) return b;
    const x = W - b.x - b.w;
    return { ...b, x, windows: b.windows.map((w) => ({ ...w, x: W - w.x - w.w })) };
  });

  const posts: number[] = [];
  for (let x = 50; x < W - 40; x += 88) {
    const ax = mx(x);
    const nearTower = Math.abs(ax - mx(towerX0 + towerW / 2)) < 90;
    const nearLight = Math.abs(ax - mx(lighthouseX)) < 100;
    const nearEdge = hide !== "none" && Math.abs(ax - (mirror ? 2 * P : P)) < SCENE_DEFAULTS.edgeMargin;
    if (!nearTower && !nearLight && !nearEdge) posts.push(ax);
  }

  const stars: Scene["stars"] = [];
  for (let i = 0; i < 150; i++) stars.push({ x: Math.round(r() * W), y: 10 + Math.round(r() * 320), r: 0.8 + r() * 1.3 });

  const boundary = hide === "none" ? null : mirror ? 2 * P : P;
  const candidates: Array<{ x: number; y: number; mount: Lantern["mount"] }> = [];
  for (const b of buildings) {
    if (b.kind === "tower") continue;
    candidates.push({ x: Math.round(b.x + b.w * (0.3 + r() * 0.4)), y: G - b.h - 16, mount: "roof" });
  }
  for (const x of posts) candidates.push({ x, y: G - 74, mount: "post" });

  const lanterns: Lantern[] = [];
  const tooClose = (x: number, y: number) =>
    lanterns.some((l) => Math.hypot(l.x - x, l.y - y) < SCENE_DEFAULTS.minLanternSpacing);
  for (let p = 0 as 0 | 1 | 2; p < 3; p = (p + 1) as 0 | 1 | 2) {
    const inPanel = shuffle(
      r,
      candidates.filter((c) => {
        if (c.x < p * P + 30 || c.x > (p + 1) * P - 30) return false;
        if (boundary !== null && Math.abs(c.x - boundary) < SCENE_DEFAULTS.edgeMargin) return false;
        return true;
      }),
    );
    let lit = 0;
    let unlit = 0;
    const tPer = config.targetsPerPanel ?? SCENE_DEFAULTS.targetsPerPanel;
    const uPer = config.unlitPerPanel ?? SCENE_DEFAULTS.unlitPerPanel;
    for (const c of inPanel) {
      if (lit >= tPer && unlit >= uPer) break;
      if (tooClose(c.x, c.y)) continue;
      const makeLit = lit < tPer && (unlit >= uPer || r() < 0.6);
      lanterns.push({ id: `L${p}-${lanterns.length + 1}`, x: c.x, y: c.y, lit: makeLit, panel: p, mount: c.mount });
      if (makeLit) lit++;
      else unlit++;
    }
  }

  const visible = hide === "left" ? { x0: P, x1: W } : hide === "right" ? { x0: 0, x1: 2 * P } : { x0: 0, x1: W };
  const hidden = hide === "left" ? { x0: 0, x1: P } : hide === "right" ? { x0: 2 * P, x1: W } : null;
  const moonX = hide === "right" ? W - 1820 : 1820;

  return {
    width: W,
    height: H,
    panelWidth: P,
    groundY: G,
    hide,
    visible,
    hidden,
    buildings,
    posts,
    stars,
    moon: { x: hide === "none" ? W / 2 : moonX, y: 140, r: 46 },
    lighthouse: { x: mx(lighthouseX), baseY: G, h: 300 },
    lanterns,
  };
}

export function hitTest(scene: Scene, x: number, y: number): Lantern | null {
  let best: Lantern | null = null;
  let bestD = SCENE_DEFAULTS.hitRadius;
  for (const l of scene.lanterns) {
    const d = Math.hypot(l.x - x, l.y - y);
    if (d <= bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

function seDiff(x1: number, n1: number, x2: number, n2: number): number {
  const p1 = (x1 + 0.5) / (n1 + 1);
  const p2 = (x2 + 0.5) / (n2 + 1);
  return Math.sqrt((p1 * (1 - p1)) / Math.max(1, n1) + (p2 * (1 - p2)) / Math.max(1, n2));
}

function halvesObservation(targets: Lantern[], found: Set<string>, split: number, label: string, induced: boolean): TestObservation {
  const left = targets.filter((t) => t.x < split);
  const right = targets.filter((t) => t.x >= split);
  const missL = left.filter((t) => !found.has(t.id)).length;
  const missR = right.filter((t) => !found.has(t.id)).length;
  const oL = left.length ? missL / left.length : 0;
  const oR = right.length ? missR / right.length : 0;
  return {
    test: "scene",
    label,
    value: oR - oL,
    se: seDiff(missL, left.length, missR, right.length),
    n: targets.length,
    induced,
  };
}

/**
 * Center of Cancellation (Rorden & Karnath, 2010): mean horizontal position of
 * found targets with the leftmost target at -1 and rightmost at +1. Here it is
 * also adjusted by the layout's own target center, since this layout is not
 * perfectly symmetric. Published cutoffs come from specific validated tests and
 * do NOT transfer to this scene.
 */
export function centerOfCancellation(targets: Lantern[], found: Set<string>): number | null {
  if (targets.length < 2) return null;
  const xs = targets.map((t) => t.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi === lo) return null;
  const norm = (x: number) => (2 * (x - lo)) / (hi - lo) - 1;
  const hits = targets.filter((t) => found.has(t.id));
  if (!hits.length) return null;
  const center = targets.reduce((a, t) => a + norm(t.x), 0) / targets.length;
  return hits.reduce((a, t) => a + norm(t.x), 0) / hits.length - center;
}

export function scoreScene(scene: Scene, taps: SceneTap[]): SceneScore {
  const found = new Set<string>();
  const results: SceneTapResult[] = [];
  for (const tap of taps.slice().sort((a, b) => a.t - b.t)) {
    const l = hitTest(scene, tap.x, tap.y);
    if (!l) results.push({ ...tap, kind: "empty", lanternId: null });
    else if (!l.lit) results.push({ ...tap, kind: "distractor", lanternId: l.id });
    else if (found.has(l.id)) results.push({ ...tap, kind: "repeat", lanternId: l.id });
    else {
      found.add(l.id);
      results.push({ ...tap, kind: "target", lanternId: l.id });
    }
  }
  const targets = scene.lanterns.filter((l) => l.lit);
  const inVisible = (l: Lantern) => l.x >= scene.visible.x0 && l.x < scene.visible.x1;
  const visibleTargets = targets.filter(inVisible);
  const byPanel = [0, 1, 2].map((p) => ({
    found: targets.filter((t) => t.panel === p && found.has(t.id)).length,
    total: targets.filter((t) => t.panel === p).length,
  }));
  const vMid = (scene.visible.x0 + scene.visible.x1) / 2;
  return {
    taps: results,
    foundIds: Array.from(found),
    byPanel,
    totalTargets: targets.length,
    visibleTargets: visibleTargets.length,
    foundVisible: visibleTargets.filter((t) => found.has(t.id)).length,
    observationVisible: halvesObservation(visibleTargets, found, vMid, "Scene search", false),
    observationInduced:
      scene.hide === "none" ? null : halvesObservation(targets, found, scene.width / 2, "Scene search, hidden area included", true),
    coc: {
      visible: centerOfCancellation(visibleTargets, found),
      full: scene.hide === "none" ? null : centerOfCancellation(targets, found),
    },
  };
}
