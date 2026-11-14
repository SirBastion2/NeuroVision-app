import type { BisectionLayout, StarItem, StarLayout, TapEvent } from "../../metrics/types";

export const PEN = "#d1242f";

function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rotationDeg: number) {
  const inner = r * 0.45;
  const rot = (rotationDeg * Math.PI) / 180 - Math.PI / 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : inner;
    const a = rot + (i * Math.PI) / 5;
    ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
}

function drawItem(ctx: CanvasRenderingContext2D, it: StarItem, ink: string) {
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  if (it.kind === "target" || it.kind === "big-star") {
    starPath(ctx, it.x, it.y, it.size, it.rotation);
    ctx.fill();
  } else if (it.kind === "triangle") {
    const r = it.size;
    const a = (it.rotation * Math.PI) / 180;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) ctx.lineTo(it.x + r * Math.cos(a + (i * 2 * Math.PI) / 3), it.y + r * Math.sin(a + (i * 2 * Math.PI) / 3));
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.font = `600 ${Math.round(it.size * 1.7)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(it.letter ?? "A", it.x, it.y + 1);
  }
}

/** Prepares a canvas for crisp drawing at the device pixel ratio. */
export function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Star test page: items in ink, every tapped item circled in red (like a pen). */
export function drawStarTest(ctx: CanvasRenderingContext2D, layout: StarLayout, taps: readonly TapEvent[], colors: { paper: string; ink: string }) {
  const { width, height } = layout.area;
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, width, height);
  for (const it of layout.items) drawItem(ctx, it, colors.ink);
  const items = new Map(layout.items.map((i) => [i.id, i]));
  ctx.strokeStyle = PEN;
  ctx.lineWidth = 2.5;
  const circled = new Set<string>();
  for (const t of taps) {
    if (!t.targetId || circled.has(t.targetId)) continue;
    const it = items.get(t.targetId);
    if (!it) continue;
    circled.add(t.targetId);
    ctx.beginPath();
    ctx.arc(it.x, it.y, Math.max(it.size * 1.55, 13), 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Bisection page: lines in ink, each tap drawn as a short red tick. */
export function drawBisectionTest(ctx: CanvasRenderingContext2D, layout: BisectionLayout, taps: readonly TapEvent[], colors: { paper: string; ink: string }) {
  const { width, height } = layout.area;
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const l of layout.lines) {
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y);
    ctx.lineTo(l.x2, l.y);
    ctx.stroke();
  }
  const lines = new Map(layout.lines.map((l) => [l.id, l]));
  ctx.strokeStyle = PEN;
  ctx.lineWidth = 2.5;
  for (const t of taps) {
    const l = t.targetId ? lines.get(t.targetId) : null;
    const y = l ? l.y : t.y;
    ctx.beginPath();
    ctx.moveTo(t.x, y - 11);
    ctx.lineTo(t.x, y + 11);
    ctx.stroke();
  }
}
