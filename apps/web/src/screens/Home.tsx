import { useMemo, useState } from "react";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  DEMONSTRATION_SESSIONS,
  INPUT_MODALITIES,
  createTargetSelectionLayout,
  scoreSession,
  viewportClass,
  type InputModality,
  type LayoutVariant,
  type SessionRecord,
} from "@neurovision/domain";
import { STIMULUS_RADIUS } from "../components/Board";
import { Eyebrow } from "../components/Brand";
import { SessionThumb } from "../components/SessionThumb";

const INPUT_LABELS: Record<InputModality, string> = {
  "mouse-trackpad": "Mouse or trackpad",
  keyboard: "Keyboard cursor",
  touch: "Touch",
};

interface Props {
  onStart: (alias: string, input: InputModality, variant: LayoutVariant) => void;
  onOpen: (session: SessionRecord) => void;
  onHistory: () => void;
  onProfile: () => void;
  onGaze: () => void;
}

/** The real assessment board with one half fading away, circled by the logo's orbit and star. */
function HeroBoard() {
  const stimuli = useMemo(() => createTargetSelectionLayout("fixed-a").stimuli, []);
  return (
    <svg className="hero-board" viewBox={`-40 -50 ${BOARD_WIDTH + 80} ${BOARD_HEIGHT + 100}`} aria-hidden>
      <defs>
        <linearGradient id="hero-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="0.62" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="hero-mask">
          <rect x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="url(#hero-fade)" />
        </mask>
      </defs>
      <rect className="hero-plate" width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={22} />
      <line className="hero-mid" x1={BOARD_WIDTH / 2} x2={BOARD_WIDTH / 2} y1={24} y2={BOARD_HEIGHT - 24} />
      <g mask="url(#hero-mask)">
        {stimuli.map((s) => (
          <circle key={s.id} className={s.kind === "target" ? "ring" : "disk"} cx={s.x} cy={s.y} r={STIMULUS_RADIUS} />
        ))}
      </g>
      <g transform={`rotate(-11 ${BOARD_WIDTH / 2} ${BOARD_HEIGHT / 2})`}>
        <ellipse className="hero-orbit" cx={BOARD_WIDTH / 2} cy={BOARD_HEIGHT / 2} rx={BOARD_WIDTH / 2 + 22} ry={150} />
        <g className="hero-star">
          <path d="M0 -30q3 27 30 30-27 3-30 30-3-27-30-30 27-3 30-30Z" />
        </g>
      </g>
    </svg>
  );
}

const STEPS = [
  ["01", "Target selection", "Find hollow rings among solid disks on a fixed board."],
  ["02", "Line bisection", "Mark the centre of five lines. No feedback."],
  ["03", "Review", "See what was found, what was missed, and where."],
  ["04", "Practice", "An explained cue suggestion, then up to three rounds."],
] as const;

export function Home({ onStart, onOpen, onHistory, onProfile, onGaze }: Props) {
  const [alias, setAlias] = useState("");
  const [input, setInput] = useState<InputModality>("mouse-trackpad");
  const [variant, setVariant] = useState<LayoutVariant>("fixed-a");
  const supported = viewportClass(window.innerWidth, window.innerHeight) === "desktop-960";

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <Eyebrow>Spatial attention lab</Eyebrow>
          <h1>
            See where attention lands,
            <br />
            <em>and where it doesn’t.</em>
          </h1>
          <p className="lede">
            Two short board tasks record every response in space and time. The review shows what was found, what was
            missed, and on which side, then suggests a practice setup you can read and overrule.
          </p>
          <p className="fineprint">Research prototype. Describes one session’s responses; it is not a diagnosis.</p>
        </div>
        <HeroBoard />
      </section>

      <ol className="journey">
        {STEPS.map(([n, title, text]) => (
          <li key={n}>
            <span className="journey-n">{n}</span>
            <strong>{title}</strong>
            <span>{text}</span>
          </li>
        ))}
      </ol>

      <section className="home-grid">
        <form
          className="card start-card"
          onSubmit={(e) => {
            e.preventDefault();
            onStart(alias, input, variant);
          }}
        >
          <Eyebrow plain>New session</Eyebrow>
          <h2>Start an assessment</h2>
          <label className="field">
            <span>Participant alias</span>
            <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. P-014" autoComplete="off" maxLength={40} />
            <small>Use a pseudonym. Do not enter real names or clinical details.</small>
          </label>

          <fieldset className="field">
            <legend>Input</legend>
            <div className="segmented">
              {INPUT_MODALITIES.map((m) => (
                <label key={m} className={input === m ? "on" : ""}>
                  <input type="radio" name="input" value={m} checked={input === m} onChange={() => setInput(m)} />
                  {INPUT_LABELS[m]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Board layout</legend>
            <div className="segmented">
              {(["fixed-a", "fixed-b"] as const).map((v) => (
                <label key={v} className={variant === v ? "on" : ""}>
                  <input type="radio" name="variant" checked={variant === v} onChange={() => setVariant(v)} />
                  Layout {v === "fixed-a" ? "A" : "B"}
                </label>
              ))}
            </div>
          </fieldset>

          {!supported && (
            <p className="notice warn" role="status">
              This window is smaller than 1024×768, so the session will be recorded with an “unsupported” screen class.
            </p>
          )}
          <button className="primary large" type="submit">
            Begin assessment
            <span aria-hidden> →</span>
          </button>
          <p className="fineprint">About three minutes. Data stays in this browser.</p>
        </form>

        <div className="side-cards">
          <button className="card link-card" onClick={onHistory}>
            <Eyebrow plain>History</Eyebrow>
            <h3>Sessions over time</h3>
            <p>Saved sessions and the trend across comparable assessments.</p>
            <span className="link-arrow" aria-hidden>
              →
            </span>
          </button>
          <button className="card link-card" onClick={onProfile}>
            <Eyebrow plain>Profile</Eyebrow>
            <h3>Clinician dashboard</h3>
            <p>Gaze analysis, spatial board, practice, notes, and PDF report.</p>
            <span className="link-arrow" aria-hidden>
              →
            </span>
          </button>
          <button className="card link-card" onClick={onGaze}>
            <Eyebrow plain>Gaze lab</Eyebrow>
            <h3>Same clicks, different looking</h3>
            <p>Replay two simulated gaze streams against one click sequence.</p>
            <span className="link-arrow" aria-hidden>
              →
            </span>
          </button>
        </div>
      </section>

      <section className="demos">
        <div className="section-head">
          <div>
            <Eyebrow plain>Demonstration sessions</Eyebrow>
            <h2>Three patterns, read at a glance</h2>
          </div>
          <p className="small">Built-in examples, always labelled as demonstration. They never enter the trend.</p>
        </div>
        <div className="demo-grid">
          {DEMONSTRATION_SESSIONS.map((s) => {
            const ts = scoreSession(s).targetSelection;
            return (
              <button key={s.id} className="card demo-card" onClick={() => onOpen(s)}>
                <SessionThumb session={s} />
                <div className="demo-meta">
                  <strong>{s.alias}</strong>
                  {ts && (
                    <span>
                      Left {ts.left.hits}/{ts.left.available} · Right {ts.right.hits}/{ts.right.available}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
