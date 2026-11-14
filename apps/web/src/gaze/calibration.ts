/** Calibration targets as fractions of the viewport: 4 corners, 4 edges, 4 interior, centre. */
export const CALIBRATION_POINTS: ReadonlyArray<{ fx: number; fy: number }> = [
  { fx: 0.5, fy: 0.5 },
  { fx: 0.05, fy: 0.07 },
  { fx: 0.5, fy: 0.07 },
  { fx: 0.95, fy: 0.07 },
  { fx: 0.73, fy: 0.3 },
  { fx: 0.27, fy: 0.3 },
  { fx: 0.05, fy: 0.5 },
  { fx: 0.95, fy: 0.5 },
  { fx: 0.27, fy: 0.7 },
  { fx: 0.73, fy: 0.7 },
  { fx: 0.05, fy: 0.93 },
  { fx: 0.5, fy: 0.93 },
  { fx: 0.95, fy: 0.93 },
];

/** Extra points where the participant keeps looking at the dot while slowly turning and nodding. */
export const HEAD_MOTION_POINTS: ReadonlyArray<{ fx: number; fy: number }> = [
  { fx: 0.5, fy: 0.45 },
  { fx: 0.18, fy: 0.55 },
  { fx: 0.82, fy: 0.55 },
];

export const SAMPLE_MS = 900;
export const HEAD_MOTION_MS = 4000;
/** Frames in the first part of each window are skipped while the eyes settle. */
export const SETTLE_MS = 150;
export const AUTO_ADVANCE_MS = 1300;

/** Short tone. Motion plus sound helps guide attention to each new dot. */
export function beep(freq = 880, ms = 90) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (beep as unknown as { ctx?: AudioContext }).ctx ?? new Ctx();
    (beep as unknown as { ctx?: AudioContext }).ctx = ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000 + 0.02);
  } catch {
    /* audio is optional */
  }
}
