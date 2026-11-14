import { useEffect, useRef, useState, type PointerEvent } from "react";
import scene from "../assets/dawn-birds.jpg";
import { Eyebrow } from "../components/Brand";
import { downloadJson, fileStamp } from "./results";

/*
 * Hidden scene: a cancellation test disguised as a picture.
 *
 * The person sees what looks like a complete dawn landscape and taps every bird,
 * then presses Done. Only then does the left third of the scene fade in, with
 * birds they never had a chance to see. The point is not that they missed them
 * (the screen hid them) but that nothing felt incomplete when they pressed Done:
 * that is how neglect feels from the inside, and why patients stop a cancellation
 * sheet with half the page untouched.
 *
 * Everything is in the photo's own pixel space (612 × 391). Bird centres were
 * measured from the image. Every tap is recorded with its time and position.
 */

const IW = 612;
const IH = 391;
/** Everything left of this x is hidden until the reveal (35% of the scene). */
const CUT = 215;
/** A tap within this many image pixels of a bird's centre marks it. */
const HIT_RADIUS = 20;

const BIRDS: ReadonlyArray<{ id: number; x: number; y: number }> = [
  { x: 54, y: 100 },
  { x: 161, y: 95 },
  { x: 155, y: 169 },
  { x: 183, y: 162 },
  { x: 138, y: 212 },
  { x: 168, y: 214 },
  { x: 249, y: 161 },
  { x: 279, y: 111 },
  { x: 277, y: 185 },
  { x: 356, y: 91 },
  { x: 381, y: 95 },
  { x: 390, y: 78 },
  { x: 449, y: 93 },
].map((b, id) => ({ id, ...b }));

const VISIBLE = BIRDS.filter((b) => b.x >= CUT);
const HIDDEN = BIRDS.filter((b) => b.x < CUT);

interface Tap {
  /** ms since Start. */
  atMs: number;
  /** Image pixels. */
  x: number;
  y: number;
  /** Bird marked by this tap, or null (empty sky, or a bird already marked). */
  bird: number | null;
}

type Phase = "intro" | "search" | "reveal";

export function HiddenScenePage({ onHome, onRunning }: { onHome: () => void; onRunning: (running: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [found, setFound] = useState<number[]>([]);
  /** Reveal beats: 0 = "you pressed Done", 1 = scene widens, 2 = missed birds light up, 3 = the count and the line. */
  const [beat, setBeat] = useState(0);
  const taps = useRef<Tap[]>([]);
  const startedAt = useRef(0);
  const durationMs = useRef(0);
  const overlay = useRef<SVGSVGElement>(null);

  useEffect(() => onRunning(phase === "search"), [phase, onRunning]);
  useEffect(() => () => onRunning(false), [onRunning]);

  useEffect(() => {
    if (phase !== "reveal") return;
    const timers = [window.setTimeout(() => setBeat(1), 1500), window.setTimeout(() => setBeat(2), 4600), window.setTimeout(() => setBeat(3), 6800)];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [phase]);

  const start = () => {
    taps.current = [];
    startedAt.current = performance.now();
    setFound([]);
    setBeat(0);
    setPhase("search");
  };

  const done = () => {
    durationMs.current = Math.round(performance.now() - startedAt.current);
    setPhase("reveal");
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (phase !== "search" || !e.isPrimary || !overlay.current) return;
    const box = overlay.current.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * IW;
    const y = ((e.clientY - box.top) / box.height) * IH;
    const near = BIRDS.filter((b) => !found.includes(b.id))
      .map((b) => ({ b, d: Math.hypot(b.x - x, b.y - y) }))
      .filter((c) => c.d <= HIT_RADIUS)
      .sort((a, c) => a.d - c.d)[0];
    taps.current.push({ atMs: Math.round(e.timeStamp - startedAt.current), x: Math.round(x), y: Math.round(y), bird: near?.b.id ?? null });
    if (near) setFound((f) => [...f, near.b.id]);
  };

  const visibleMissed = VISIBLE.filter((b) => !found.includes(b.id)).length;
  const path = found.map((id) => BIRDS[id]!).map((b) => `${b.x},${b.y}`).join(" ");
  const revealing = phase === "reveal" && beat >= 1;

  return (
    <section className={`scene-page phase-${phase} beat-${beat}`} aria-labelledby="scene-title">
      <header className="scene-head">
        <Eyebrow plain>Hidden scene</Eyebrow>
        {phase !== "reveal" ? (
          <>
            <h1 id="scene-title">Tap every bird</h1>
            <p className="lede">Mark each bird in the sky once. Press Done when you have found them all.</p>
          </>
        ) : beat < 3 ? (
          <>
            <h1 id="scene-title">{beat === 0 ? "You pressed Done." : "But the scene was never complete."}</h1>
            <p className="lede">{beat === 0 ? `${found.length} bird${found.length === 1 ? "" : "s"} marked. It felt finished.` : "Watch the left."}</p>
          </>
        ) : (
          <>
            <h1 id="scene-title" className="scene-count">
              You found <strong>{found.length}</strong> of <strong>{BIRDS.length}</strong>
            </h1>
            <p className="lede">
              {HIDDEN.length} birds were in a part of the scene you never saw
              {visibleMissed > 0 ? `, and ${visibleMissed} more ${visibleMissed === 1 ? "was" : "were"} in plain sight` : ""}. Nothing felt missing.
            </p>
          </>
        )}
      </header>

      <div className="scene-stage">
        <div className={`scene-window ${revealing ? "wide" : ""}`}>
          <img className="scene-img" src={scene} alt="" draggable={false} />
          <div className="scene-mist" aria-hidden />
          <div className="scene-curtain" aria-hidden />
          <svg
            ref={overlay}
            className="scene-overlay"
            viewBox={`0 0 ${IW} ${IH}`}
            role="application"
            aria-label="Dawn sky over misty mountains with birds flying. Tap each bird."
            onPointerDown={onPointerDown}
          >
            {phase === "reveal" && beat >= 3 && found.length > 1 && <polyline className="scene-path" points={path} pathLength={1} />}
            {found.map((id, i) => {
              const b = BIRDS[id]!;
              return (
                <g key={id} className="scene-found">
                  <circle cx={b.x} cy={b.y} r={14} />
                  {phase === "reveal" && beat >= 3 && (
                    <text x={b.x} y={b.y - 19} textAnchor="middle">
                      {i + 1}
                    </text>
                  )}
                </g>
              );
            })}
            {phase === "reveal" &&
              beat >= 2 &&
              BIRDS.filter((b) => !found.includes(b.id)).map((b, i) => (
                <g key={b.id} className="scene-missed" style={{ animationDelay: `${i * 0.22}s` }}>
                  <circle className="halo" cx={b.x} cy={b.y} r={14} />
                  <circle cx={b.x} cy={b.y} r={14} />
                </g>
              ))}
            {revealing && <line className="scene-seam" x1={CUT} x2={CUT} y1={0} y2={IH} />}
          </svg>
          {phase === "intro" && (
            <div className="scene-intro">
              <div>
                <p>
                  A quiet dawn. <strong>{"Tap every bird you can find."}</strong>
                </p>
                <button className="primary large" onClick={start} autoFocus>
                  Start
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {phase === "search" && (
        <div className="scene-bar">
          <span className="scene-tally" aria-live="polite">
            <b>{found.length}</b> marked
          </span>
          <button className="primary large" onClick={done}>
            Done, I found them all
          </button>
        </div>
      )}

      {phase === "reveal" && beat >= 3 && (
        <div className="scene-after">
          <blockquote>
            The screen hid it from you. In neglect, the <em>brain</em> hides it, and just like you, patients don’t feel that anything is missing.
          </blockquote>
          <p className="small">
            {found.length} marked in {(durationMs.current / 1000).toFixed(1)} s · numbers show the order you searched in · {HIDDEN.length} of {BIRDS.length} birds sat in the hidden third ·
            demonstration, not a diagnosis
          </p>
          <div className="actions">
            <button className="ghost" onClick={onHome}>
              Home
            </button>
            <button
              onClick={() =>
                downloadJson(`neurovision-hidden-scene-${fileStamp()}.json`, {
                  test: "hidden-scene",
                  image: { width: IW, height: IH, hiddenLeftOfX: CUT },
                  birds: BIRDS,
                  foundOrder: found,
                  durationMs: durationMs.current,
                  taps: taps.current,
                })
              }
            >
              Export data
            </button>
            <button
              className="primary"
              onClick={() => {
                setFound([]);
                setBeat(0);
                setPhase("intro");
              }}
            >
              Run again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
