import { useMemo } from "react";
import {
  LINE_BISECTION_TRIAL_COUNT,
  findTargetSelectionTrial,
  scoreSession,
  scoreTargetSelection,
  sessionSourceLabel,
  type SessionRecord,
  type SpatialPatternKind,
  type TrialRecord,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { ResponseOrderPlot } from "../components/ResponseOrderPlot";
import { BalanceBar, LineDeviations, RegionGrid, Stat } from "../components/ReviewFigures";
import { dateTime, pct, points, seconds, signedPct } from "../lib/format";
import { MAX_PRACTICE_ROUNDS } from "../lib/session";

interface Props {
  session: SessionRecord;
  saveError: string | null;
  onPractice: () => void;
  onHistory: () => void;
  onHome: () => void;
}

const END_LABEL: Record<TrialRecord["end"], string> = {
  done: "Done",
  timeout: "Time limit",
  stop: "Stopped",
  resize: "Window resized",
  hidden: "Tab hidden",
  skip: "Skipped",
};

const PATTERN_TITLE: Record<SpatialPatternKind, string> = {
  balanced: "Balanced selection",
  "left-omission": "Left-side omissions",
  "right-omission": "Right-side omissions",
  "low-selection": "Low selection",
  insufficient: "Not enough data",
};

export function Review({ session, saveError, onPractice, onHistory, onHome }: Props) {
  const result = useMemo(() => scoreSession(session), [session]);
  const ts = result.targetSelection;
  const tsTrial = findTargetSelectionTrial(session);
  const lineTrials = session.trials.filter((t) => t.task === "line-bisection");
  const lb = result.lineBisection;

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `${session.id}.json` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="review">
      <header className="page-head">
        <div>
          <Eyebrow>Session review</Eyebrow>
          <h1>{session.alias}</h1>
          <p className="meta">
            {dateTime(session.startedAt)} · {session.input} · layout {tsTrial?.layout.id ?? "n/a"}
          </p>
        </div>
        <div className="badges">
          <span className={`badge ${session.source}`}>{sessionSourceLabel(session.source)}</span>
          <span className={`badge ${session.status}`}>{session.status === "complete" ? "Complete" : "Incomplete"}</span>
        </div>
      </header>

      {saveError && (
        <p className="notice error" role="alert">
          This session could not be saved: {saveError}. Export it below to keep a copy.
        </p>
      )}
      {session.status === "incomplete" && (
        <p className="notice warn">This session was interrupted. What was recorded is shown below.</p>
      )}

      <section className={`verdict card kind-${result.spatialPattern.kind}`}>
        <div className="verdict-text">
          <Eyebrow plain>Spatial pattern</Eyebrow>
          <h2>{PATTERN_TITLE[result.spatialPattern.kind]}</h2>
          <p>{result.spatialPattern.description}</p>
        </div>
        {ts && <BalanceBar score={ts} />}
      </section>

      {ts && tsTrial ? (
        <>
          <section className="stat-row">
            <Stat label="Targets found" value={`${ts.hits} / ${ts.available}`} sub={pct(ts.hitRate)} />
            <Stat label="Omission gap, left − right" value={points(ts.omissionAsymmetry)} sub="percentage points" />
            <Stat label="First target" value={seconds(ts.firstLatencyMs)} />
            <Stat label="Disks selected" value={String(ts.distractors)} sub={`${ts.repeats} repeat${ts.repeats === 1 ? "" : "s"}`} />
            <Stat label="Search path" value={String(Math.round(ts.pathDistance))} sub="board units" />
          </section>

          <section className="review-grid">
            <div className="card pad-0">
              <ResponseOrderPlot
                layout={tsTrial.layout}
                orderedHits={ts.orderedHits}
                events={tsTrial.events}
                headingMeta={<span className="small">Ended: {END_LABEL[tsTrial.end]}</span>}
              />
            </div>
            <div className="card regions-card">
              <h3>Omissions by region</h3>
              <p className="small">Darker = more missed.</p>
              <RegionGrid regions={ts.regions} />
            </div>
          </section>
        </>
      ) : (
        <p className="notice">No target-selection trial was recorded.</p>
      )}

      <section className="card">
        <div className="card-head">
          <h3>Line bisection</h3>
          <span className="small">
            Median {signedPct(lb.signedMedian)} · absolute {signedPct(lb.absoluteMedian).replace("+", "")} · {lb.validCount} of{" "}
            {LINE_BISECTION_TRIAL_COUNT} valid
          </span>
        </div>
        <LineDeviations trials={lineTrials} total={LINE_BISECTION_TRIAL_COUNT} />
        <p className="small dev-key">
          <i className="key centre" /> True centre <i className="key mark" /> Mark placed. Positive = right of centre, as a
          share of line length. Medians need at least three valid lines.
        </p>
        {lb.healthyRange ? (
          <p className={lb.healthyRange.status === "outside" ? "notice warn" : "notice"}>{lb.healthyRange.text}</p>
        ) : null}
      </section>

      <section className="card practice-summary">
        <div>
          <Eyebrow plain>Practice suggestion · {session.decision.version}</Eyebrow>
          <h3>
            {session.decision.cue === "none" ? "Unguided" : `Cue the ${session.decision.cue} side`} · {session.decision.density} density
          </h3>
          <p>{session.decision.explanation}</p>
          {session.practice.length > 0 && (
            <ol className="rounds">
              {session.practice.map((round, i) => {
                const s = scoreTargetSelection(round.trial);
                return (
                  <li key={round.trial.id}>
                    <span>Round {i + 1}</span>
                    <strong>
                      {s.hits}/{s.available}
                    </strong>
                    <span>gap {points(s.omissionAsymmetry)}</span>
                    <span>
                      cue {round.config.cue}
                      {round.config.cue !== "none" && ` · level ${round.config.level}`}
                    </span>
                    {round.config.override && <span className="badge">override</span>}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="small">Practice rounds are stored separately and never join the assessment trend.</p>
        </div>
        <button className="primary large" onClick={onPractice} disabled={session.practice.length >= MAX_PRACTICE_ROUNDS}>
          {session.practice.length === 0
            ? "Set up practice"
            : session.practice.length >= MAX_PRACTICE_ROUNDS
              ? "Practice limit reached"
              : "Another practice round"}
        </button>
      </section>

      <details className="card events">
        <summary>Underlying events</summary>
        {[...session.trials, ...session.practice.map((p) => p.trial)].map((trial) => (
          <div key={trial.id} className="event-block">
            <h4>
              {trial.id} · {trial.task} · {END_LABEL[trial.end]} · {seconds(trial.duration)}
            </h4>
            {trial.events.length === 0 ? (
              <p className="small">No responses.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Elapsed</th>
                    <th>x</th>
                    <th>y</th>
                    <th>Stimulus</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {trial.events.map((e) => (
                    <tr key={e.seq}>
                      <td>{e.seq}</td>
                      <td>{Math.round(e.elapsed)} ms</td>
                      <td>{e.x.toFixed(1)}</td>
                      <td>{e.y.toFixed(1)}</td>
                      <td>{e.stimulusId ?? "none"}</td>
                      <td>{e.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </details>

      <div className="actions">
        <button className="ghost" onClick={download}>
          Export JSON
        </button>
        <button className="ghost" onClick={onHistory}>
          History
        </button>
        <button onClick={onHome}>Home</button>
      </div>
    </div>
  );
}
