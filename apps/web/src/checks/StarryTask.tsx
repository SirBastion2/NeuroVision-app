import { useCallback, useEffect, useRef, useState } from "react";
import { STARRY_DEFAULTS as D, starryDurationS, type StarryPress, type StarryResponse, type StarryTrial } from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { TrialDial } from "./StackedTask";

/*
 * Starry Night (after Deouell et al., 2005). Everything is drawn on one canvas
 * in a single animation loop: green distractors that keep blinking on and off,
 * and the red target at its scheduled time.
 *
 * Timing (STARRY_DEFAULTS): the target is up for 1 s; a press 150–1500 ms after
 * onset is a hit; the quiet gap before the next target is 0.8–2.5 s, uniform, so
 * the rhythm can't be learned. Onset is the timestamp of the frame after the one
 * that first drew the target (≈ its first painted frame), the same idea as the
 * double-rAF in the other tasks. Reaction time = press event timeStamp − onset.
 *
 * The response is a single button (Space or a tap anywhere), never left/right,
 * so a weak hand can't fake a lean. Switching tabs pauses the run and the target
 * that was up is shown again later; nothing half-seen is recorded.
 */

/** Fixed colours: the field is part of the measurement, so it doesn't follow the theme. */
const SKY = "#050a14";
const GREEN = "#46d17e";
const RED = "#ff3b3b";

export interface StarryRun {
  responses: StarryResponse[];
  presses: StarryPress[];
}

type Phase = "ready" | "running" | "paused" | "done";

interface Dot {
  x: number;
  y: number;
  until: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Faint fixed background stars: decoration only, identical on both halves on average. */
function backgroundStars(n: number) {
  return Array.from({ length: n }, () => ({ x: rand(0, D.width), y: rand(0, D.height), r: rand(0.4, 1.3), a: rand(0.08, 0.28) }));
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, glow: number) {
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/* ------------------------------------------------------------------ intro */

export function StarryIntro({ trials, step, onBegin, onCancel }: { trials: StarryTrial[]; step: string; onBegin: () => void; onCancel: () => void }) {
  return (
    <section className="intro card narrow">
      <Eyebrow>{step} · Starry Night</Eyebrow>
      <h1>Catch the red star</h1>
      <p className="lede">
        A night sky full of green dots that blink on and off. Every few seconds one <strong className="starry-red">red dot</strong> flashes
        somewhere in the sky. Press as soon as you see it.
      </p>
      <figure className="starry-legend" aria-hidden>
        <svg viewBox="0 0 320 90">
          <rect width="320" height="90" rx="12" fill={SKY} />
          {[
            [30, 22], [64, 60], [98, 30], [140, 70], [176, 18], [214, 52], [256, 26], [292, 66], [120, 44], [236, 78],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={3.2} fill={GREEN} />
          ))}
          <circle cx={196} cy={40} r={6} fill={RED} className="starry-legend-target" />
        </svg>
      </figure>
      <ul className="steps">
        <li>
          Look anywhere you like. The red dot can appear on any part of the sky and stays for {D.targetMs / 1000} second.
        </li>
        <li>
          Press <kbd>Space</kbd> or tap anywhere on the sky once for each red dot. Ignore the green ones.
        </li>
        <li>No feedback during the run, and pressing when nothing is there is counted, so wait until you see it.</li>
        <li>
          {trials.length} red dots, about {Math.round(starryDurationS(trials) / 10) * 10} seconds. Switching tabs pauses the run.
        </li>
      </ul>
      <p className="small">The red dot is a little larger than the green ones too, so red-green colour blindness should not stop you seeing it.</p>
      <div className="actions">
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary large" onClick={onBegin}>
          Start Starry Night
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- task */

interface TaskProps {
  trials: StarryTrial[];
  eyebrow: string;
  onFinish: (run: StarryRun) => void;
  onStop: () => void;
  /** Demo run: start on its own after a short pause instead of waiting for Start. */
  autoStart?: boolean;
}

export function StarryTask({ trials, eyebrow, onFinish, onStop, autoStart = false }: TaskProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhaseState] = useState<Phase>("ready");
  const [shown, setShown] = useState(0);
  const [pulse, setPulse] = useState(0);

  // Engine state lives in refs so the animation loop never waits on React.
  const phaseRef = useRef<Phase>("ready");
  const index = useRef(0);
  const scheduledAt = useRef(0);
  const drawnAt = useRef<number | null>(null);
  const onsetAt = useRef<number | null>(null);
  const answered = useRef<number | null>(null);
  const runStart = useRef(0);
  const pausedTotal = useRef(0);
  const pausedAt = useRef(0);
  const responses = useRef<StarryResponse[]>([]);
  const presses = useRef<StarryPress[]>([]);
  const dots = useRef<Dot[]>([]);
  const stars = useRef(backgroundStars(140));
  const raf = useRef(0);
  const finish = useRef(onFinish);
  finish.current = onFinish;

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const clearTarget = () => {
    drawnAt.current = null;
    onsetAt.current = null;
    answered.current = null;
  };

  const spawn = (now: number, avoid: StarryTrial | null): Dot => {
    for (let k = 0; k < 8; k++) {
      const x = rand(D.margin / 2, D.width - D.margin / 2);
      const y = rand(D.margin / 2, D.height - D.margin / 2);
      if (!avoid || Math.hypot(x - avoid.x, y - avoid.y) > 36) return { x, y, until: now + rand(D.distractorLifeMinMs, D.distractorLifeMaxMs) };
    }
    return { x: rand(0, D.width), y: rand(0, D.height), until: now + D.distractorLifeMinMs };
  };

  // Size the backing store to the element and the screen's pixel ratio.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The loop: distractors always (so the sky is alive before Start), scheduling only while running.
  useEffect(() => {
    const now0 = performance.now();
    dots.current = Array.from({ length: D.distractorCount }, () => ({ ...spawn(now0, null), until: now0 + rand(0, D.distractorLifeMaxMs) }));

    const frame = (ts: number) => {
      raf.current = requestAnimationFrame(frame);
      const el = canvas.current;
      const ctx = el?.getContext("2d");
      if (!el || !ctx) return;
      const now = performance.now();
      const running = phaseRef.current === "running";
      const trial = trials[index.current] ?? null;

      if (running && trial) {
        if (drawnAt.current !== null && onsetAt.current === null) onsetAt.current = ts; // first painted frame
        if (drawnAt.current === null && now >= scheduledAt.current) drawnAt.current = ts;
        if (onsetAt.current !== null && now - onsetAt.current >= D.responseWindowMs) {
          const rt = answered.current;
          responses.current.push({ trialId: trial.id, rtMs: rt });
          clearTarget();
          index.current += 1;
          if (index.current >= trials.length) {
            setPhase("done");
            finish.current({ responses: responses.current, presses: presses.current });
          } else {
            scheduledAt.current = now + trials[index.current]!.gapMs;
          }
        }
      }

      const targetUp = running && trial && drawnAt.current !== null && (onsetAt.current === null || now - onsetAt.current < D.targetMs);

      for (let i = 0; i < dots.current.length; i++) {
        if (dots.current[i]!.until <= now) dots.current[i] = spawn(now, targetUp ? trial : null);
      }

      const dpr = window.devicePixelRatio || 1;
      const s = (el.width / D.width) || dpr;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.shadowBlur = 0;
      ctx.fillStyle = SKY;
      ctx.fillRect(0, 0, D.width, D.height);
      for (const st of stars.current) {
        ctx.fillStyle = `rgba(230,236,255,${st.a})`;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const d of dots.current) drawDot(ctx, d.x, d.y, D.distractorRadius, GREEN, 6);
      if (targetUp && trial) drawDot(ctx, trial.x, trial.y, D.targetRadius, RED, 10);
      ctx.shadowBlur = 0;
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [trials, setPhase]);

  const begin = useCallback(() => {
    const now = performance.now();
    if (phaseRef.current === "ready") {
      runStart.current = now;
      scheduledAt.current = now + trials[0]!.gapMs;
    } else if (phaseRef.current === "paused") {
      pausedTotal.current += now - pausedAt.current;
      scheduledAt.current = now + 1500; // re-run the interrupted target after a short settle
    } else return;
    setPhase("running");
  }, [trials, setPhase]);

  const press = useCallback(
    (timeStamp: number) => {
      if (phaseRef.current !== "running") return;
      const at = timeStamp > 0 ? timeStamp : performance.now();
      const atMs = Math.round(at - runStart.current - pausedTotal.current);
      const trial = trials[index.current];
      const since = onsetAt.current !== null ? at - onsetAt.current : null;
      setPulse((n) => n + 1);
      if (trial && since !== null && since >= D.minRtMs && since <= D.responseWindowMs && answered.current === null) {
        answered.current = Math.round(since);
        presses.current.push({ atMs, trialId: trial.id, sinceOnsetMs: Math.round(since) });
      } else {
        // Anticipations, repeats and presses with nothing on screen are all false alarms.
        presses.current.push({ atMs, trialId: null, sinceOnsetMs: since === null ? null : Math.round(since) });
      }
    },
    [trials],
  );

  // Keep the dial in step with the engine without re-rendering every frame.
  useEffect(() => {
    if (phase !== "running") return;
    const t = window.setInterval(() => setShown(index.current), 200);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if (phaseRef.current === "running") {
        e.preventDefault();
        if (!e.repeat) press(e.timeStamp);
      } else if (phaseRef.current === "ready" || phaseRef.current === "paused") {
        if (e.target instanceof HTMLButtonElement) return; // the focused Start button handles it
        e.preventDefault();
        begin();
      }
    };
    const onVisibility = () => {
      if (!document.hidden || phaseRef.current !== "running") return;
      pausedAt.current = performance.now();
      clearTarget(); // the target that was up (if any) is not recorded and is shown again
      setPhase("paused");
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [begin, press, setPhase]);

  useEffect(() => {
    if (!autoStart) return;
    const t = window.setTimeout(begin, 1600);
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount

  return (
    <section className="task" aria-labelledby="task-title">
      <div className="task-head">
        <div>
          <Eyebrow plain>{eyebrow}</Eyebrow>
          <h1 id="task-title">Press when you see the red dot</h1>
          <p className="lede">Look anywhere. Ignore the green dots. No feedback.</p>
        </div>
        <TrialDial done={phase === "done" ? trials.length : shown} total={trials.length} label="Red dot" />
      </div>

      <div className="board-frame starry-frame">
        <canvas
          ref={canvas}
          className="starry-sky"
          role="application"
          aria-label="Night sky with blinking green dots. Press Space or tap whenever a red dot appears."
          onPointerDown={(e) => {
            if (!e.isPrimary) return;
            e.preventDefault();
            press(e.timeStamp);
          }}
        />
        {/* Acknowledges every press (not whether it was right) with a brief glow around the edge. */}
        {pulse > 0 && <span key={pulse} className="starry-pulse" aria-hidden />}
        {(phase === "ready" || phase === "paused") && (
          <div className="board-wait stack-wait starry-wait">
            <div>
              <p>{phase === "ready" ? `${trials.length} red dots. Look anywhere.` : "Paused while the tab was hidden. The last red dot will be shown again."}</p>
              {autoStart && phase === "ready" ? (
                <p className="stack-auto" role="status">
                  Starting by itself…
                </p>
              ) : (
                <button className="primary" onClick={begin} autoFocus>
                  {phase === "ready" ? "Start" : "Resume"}
                  <kbd className="on-accent">Space</kbd>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <p className="key-hints">
        <span>
          <kbd>Space</kbd> red dot
        </span>
        <span>or tap the sky</span>
      </p>

      <div className="task-actions">
        <button className="ghost" onClick={onStop}>
          Stop
        </button>
      </div>
    </section>
  );
}
