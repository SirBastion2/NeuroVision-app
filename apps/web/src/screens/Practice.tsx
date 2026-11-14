import { useState } from "react";
import {
  configurePracticeRound,
  createPracticeLayout,
  findTargetSelectionTrial,
  reflectPracticeRound,
  scoreTargetSelection,
  type BoardDensity,
  type PracticeCue,
  type PracticeRoundSetup,
  type PracticeSuggestion,
  type SessionRecord,
} from "@neurovision/domain";
import { Board, SideCue } from "../components/Board";
import { Eyebrow } from "../components/Brand";
import { ResponseOrderPlot } from "../components/ResponseOrderPlot";
import { Stat } from "../components/ReviewFigures";
import { LEFT_RIGHT_MISSES_HINT, LEFT_RIGHT_MISSES_LABEL, missShareGap } from "../lib/format";
import { MAX_PRACTICE_ROUNDS, nextPracticeConfig } from "../lib/session";

interface SetupProps {
  session: SessionRecord;
  /** The scored suggestion, or the faded config after a round. */
  suggested: PracticeSuggestion;
  onStart: (setup: PracticeRoundSetup) => void;
  onBack: () => void;
}

const CUE_TITLE: Record<PracticeCue, string> = { left: "Left cue", none: "Unguided", right: "Right cue" };

export function PracticeSetup({ session, suggested, onStart, onBack }: SetupProps) {
  const [cue, setCue] = useState<PracticeCue>(suggested.cue);
  const [density, setDensity] = useState<BoardDensity>(suggested.density);
  const [scanGuide, setScanGuide] = useState(suggested.scanGuide ?? false);
  const setup = configurePracticeRound({ cue, density, scanGuide: cue !== "none" && scanGuide }, suggested);
  const layout = createPracticeLayout(density);

  return (
    <div className="practice-setup">
      <header className="page-head">
        <div>
          <Eyebrow>
            Practice setup · round {session.practice.length + 1} of {MAX_PRACTICE_ROUNDS}
          </Eyebrow>
          <h1>Choose the practice board</h1>
        </div>
      </header>

      <section className="card suggestion">
        <Eyebrow plain>Suggested · {suggested.version}</Eyebrow>
        <p className="suggestion-text">{suggested.explanation}</p>
      </section>

      <div className="cue-grid" role="radiogroup" aria-label="Side cue">
        {(["left", "none", "right"] as const).map((c) => {
          const preview = configurePracticeRound({ cue: c, density }, suggested).config;
          return (
            <button key={c} role="radio" aria-checked={cue === c} className={`card cue-card ${cue === c ? "on" : ""}`} onClick={() => setCue(c)}>
              <Board label={`${CUE_TITLE[c]} preview`} role="img" stimuli={layout.stimuli}>
                <SideCue cue={c} level={preview.level} />
              </Board>
              <span className="cue-card-foot">
                <strong>{CUE_TITLE[c]}</strong>
                {suggested.cue === c && <span className="badge suggested">Suggested</span>}
              </span>
            </button>
          );
        })}
      </div>

      <section className="card controls">
        <fieldset className="field">
          <legend>Board density</legend>
          <div className="segmented">
            {(["standard", "low"] as const).map((d) => (
              <label key={d} className={density === d ? "on" : ""}>
                <input type="radio" name="density" checked={density === d} onChange={() => setDensity(d)} />
                {d === "standard" ? "Standard" : "Low"}
                {suggested.density === d && <small> · suggested</small>}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={`check ${cue === "none" ? "disabled" : ""}`}>
          <input type="checkbox" checked={cue !== "none" && scanGuide} disabled={cue === "none"} onChange={(e) => setScanGuide(e.target.checked)} />
          Self-paced row marker
        </label>
        {setup.config.override && (
          <p className="notice" role="status">
            {setup.config.override} It will be recorded with the round.
          </p>
        )}
      </section>

      <div className="actions">
        <button className="ghost" onClick={onBack}>
          Back to review
        </button>
        <button className="primary large" onClick={() => onStart(setup)}>
          Start practice round
        </button>
      </div>
    </div>
  );
}

interface ReflectionProps {
  session: SessionRecord;
  config: PracticeSuggestion;
  onAnother: (next: PracticeSuggestion) => void;
  onReview: () => void;
}

const delta = (n: number, unit = "") => `${n > 0 ? "+" : ""}${n}${unit}`;

export function PracticeReflection({ session, config, onAnother, onReview }: ReflectionProps) {
  const last = session.practice[session.practice.length - 1];
  if (!last) return null;
  const assessmentTrial = findTargetSelectionTrial(session);
  const assessment = assessmentTrial ? scoreTargetSelection(assessmentTrial) : null;
  const r = reflectPracticeRound(last.trial, assessment?.valid ? assessment : null);
  const score = scoreTargetSelection(last.trial);
  const next = nextPracticeConfig(session, { ...config, override: null });
  const faded = next.level < config.level;
  const canContinue = session.practice.length < MAX_PRACTICE_ROUNDS;
  const vs = r.versusAssessment;

  return (
    <div className="reflection">
      <header className="page-head">
        <div>
          <Eyebrow>
            Practice round {session.practice.length} of {MAX_PRACTICE_ROUNDS} · reflection
          </Eyebrow>
          <h1>
            {score.hits} of {score.available} rings found
          </h1>
          <p className="meta">{r.pattern.description}</p>
        </div>
      </header>

      {!score.valid && <p className="notice warn">This round was interrupted, so it does not count towards fading the cue.</p>}

      <section className="review-grid">
        <div className="card pad-0">
          <ResponseOrderPlot
            layout={last.trial.layout}
            orderedHits={r.orderedHits}
            events={last.trial.events}
            heading="This round"
          />
        </div>
        <div className="stats">
          <Stat label="Left half found" value={`${r.hits.left} / ${score.left.available}`} sub={vs ? `${delta(vs.omissions.left)} omissions vs assessment` : undefined} />
          <Stat label="Right half found" value={`${r.hits.right} / ${score.right.available}`} sub={vs ? `${delta(vs.omissions.right)} omissions vs assessment` : undefined} />
          <Stat
            label={LEFT_RIGHT_MISSES_LABEL}
            value={missShareGap(r.omissionAsymmetry)}
            sub={LEFT_RIGHT_MISSES_HINT}
            title={LEFT_RIGHT_MISSES_HINT}
          />
          {vs && <Stat label="Hit rate vs assessment" value={delta(Math.round(vs.hitRateDelta * 100), " pts")} sub="different board, so indicative only" />}
        </div>
      </section>

      {faded && (
        <p className="notice ok" role="status">
          {next.explanation}
        </p>
      )}
      <p className="small">This describes the round only. Practice results never join the assessment trend.</p>

      <div className="actions">
        <button className="ghost" onClick={onReview}>
          Back to review
        </button>
        {canContinue && (
          <button className="primary large" onClick={() => onAnother(next)}>
            Set up round {session.practice.length + 1}
          </button>
        )}
      </div>
    </div>
  );
}
