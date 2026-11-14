import { useMemo, useState } from "react";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  INPUT_MODALITIES,
  createTargetSelectionLayout,
  viewportClass,
  type InputModality,
  type LayoutVariant,
} from "@neurovision/domain";
import { STIMULUS_RADIUS } from "../components/Board";
import { Eyebrow } from "../components/Brand";
import { HOME_JOURNEY_STEPS } from "../lib/battery-labels";

const INPUT_LABELS: Record<InputModality, string> = {
  "mouse-trackpad": "Mouse or trackpad",
  keyboard: "Keyboard cursor",
  touch: "Touch",
};

interface Props {
  onStart: (input: InputModality, variant: LayoutVariant) => void;
  onHistory: () => void;
  apiEnabled?: boolean;
  onDemo?: () => void;
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

export function Home({ onStart, onHistory, apiEnabled = false, onDemo }: Props) {
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
            Three short tasks record every response in space and time. The review shows what was found, what was
            missed, and on which side, then suggests a practice setup you can read and overrule.
          </p>
          <p className="fineprint">Research tool. Describes one session’s responses; it is not a diagnosis.</p>
        </div>
        <HeroBoard />
      </section>

      <ol className="journey">
        {HOME_JOURNEY_STEPS.map(({ n, title, text }) => (
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
            onStart(input, variant);
          }}
        >
          <Eyebrow plain>New session</Eyebrow>
          <h2>Start an assessment</h2>

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
          <p className="fineprint">
            Starry Night, hollow rings, then line bisection. A few minutes.{" "}
            {apiEnabled
              ? "Completed runs save to this participant ID when the server is reachable; this browser is the offline fallback."
              : "Data stays in this browser."}
          </p>
        </form>

        <div className="side-cards">
          <button className="card link-card" onClick={onHistory}>
            <Eyebrow plain>History</Eyebrow>
            <h3>Sessions over time</h3>
            <p>Your saved assessments, the trend across comparable runs, and practice rounds.</p>
            <span className="link-arrow" aria-hidden>
              →
            </span>
          </button>
          {onDemo && (
            <button className="card link-card" onClick={onDemo}>
              <Eyebrow plain>Demo run</Eyebrow>
              <h3>Every test, back to back</h3>
              <p>Starry Night, hollow rings and line bisection. Each starts by itself when the last one ends.</p>
              <span className="link-arrow" aria-hidden>
                →
              </span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
