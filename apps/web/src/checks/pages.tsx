import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LINE_BISECTION_TRIAL_COUNT,
  type InputModality,
  STARRY_DEFAULTS,
  describeViewport,
  findTargetSelectionTrial,
  generateStarryTrials,
  scoreSession,
  scoreStarry,
  type SessionRecord,
  type StarryTrial,
  type TrialRecord,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { ResponseOrderPlot } from "../components/ResponseOrderPlot";
import { BalanceBar, LineDeviations, RegionGrid, Stat } from "../components/ReviewFigures";
import { TaskRunner } from "../components/TaskRunner";
import { scoredBatteryName, scoredBatteryStep, SCORED_BATTERY, type ScoredBatteryTest } from "../lib/battery-labels";
import { LEFT_RIGHT_MISSES_HINT, LEFT_RIGHT_MISSES_LABEL, missShareGap, pct, points, seconds, signedPct } from "../lib/format";
import { TIME_LIMIT_MS, createSession, newLineTrial, newTargetSelectionTrial, recordAssessmentTrial } from "../lib/session";
import { LineIntro, TargetIntro } from "../screens/Intros";
import { StarryIntro, StarryTask, type StarryRun } from "./StarryTask";
import { StarryResult } from "./StarryResult";
import { armNextUpAdvance } from "./next-up";
import { downloadJson, fileStamp } from "./results";

/*
 * The test run: Starry Night → hollow rings → line bisection, back to back.
 * Only the first test shows its full intro; after that each test starts by
 * itself behind a short "up next" card. No results in between: one combined
 * report at the very end. Opening the run from a later test (nav "Hollow rings"
 * or "Line bisection") runs from that test onward.
 */

const newSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0]! % 2_000_000_000) + 1;
const toTop = () => window.scrollTo(0, 0);
const viewport = () => describeViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio);

/** Lets App switch on focus mode (no nav, theme locked) while a test is running. */
export type RunningChange = (running: boolean) => void;

export type BatteryTest = ScoredBatteryTest;

const TESTS: Record<BatteryTest, { name: string; hint: string }> = {
  starry: { name: scoredBatteryName("starry"), hint: "Press Space or tap whenever a red dot appears." },
  rings: { name: scoredBatteryName("rings"), hint: "Select every hollow ring, leave the solid disks, then press Done." },
  lines: { name: scoredBatteryName("lines"), hint: `Mark the middle of each line. ${LINE_BISECTION_TRIAL_COUNT} lines, one mark each.` },
};
const ORDER: BatteryTest[] = SCORED_BATTERY.map((test) => test.id);

type Step = { kind: "intro" } | { kind: "next"; test: BatteryTest } | { kind: "run"; test: BatteryTest } | { kind: "report" };

/** A short "up next" card between tests that moves on by itself. */
export function NextUp({ name, hint, onGo }: { name: string; hint: string; onGo: () => void }) {
  const onGoRef = useRef(onGo);
  onGoRef.current = onGo;
  const [showContinue, setShowContinue] = useState(false);

  useEffect(() => {
    // Empty deps: re-renders that pass a new `onGo` (App save/queue/auth) must
    // not clear the timeout. StrictMode unmount still re-arms via this cleanup.
    return armNextUpAdvance(
      () => onGoRef.current(),
      () => setShowContinue(true),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- onGo is read from a ref; re-arming on identity change is the stuck-card bug

  return (
    <section className="intro card narrow next-up" role="status">
      <Eyebrow plain>Up next</Eyebrow>
      <h1>{name}</h1>
      <p className="lede">{hint}</p>
      <div className="next-up-bar" aria-hidden>
        <i />
      </div>
      {showContinue ? (
        <div className="actions">
          <button type="button" className="primary" onClick={() => onGoRef.current()}>
            Continue
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface BatteryProps {
  /** Test the run starts at; it always continues through the rest in order. */
  from: BatteryTest;
  /** Demo: shorter Starry Night, tests start by themselves, nothing saved. */
  demo?: boolean;
  onHome: () => void;
  onRunning: RunningChange;
  /** Called with the finished hollow-ring/line session (live runs only) so App can keep it in History. */
  onSave?: (session: SessionRecord) => void;
  /** Signed-in participant ID; live runs store this as the session alias. */
  alias?: string;
  input?: InputModality;
}

export function BatteryPage({ from, demo = false, onHome, onRunning, onSave, alias = "", input = "mouse-trackpad" }: BatteryProps) {
  const tests = ORDER.slice(ORDER.indexOf(from));
  const [step, setStep] = useState<Step>({ kind: "intro" });
  const [starryTrials, setStarryTrials] = useState<StarryTrial[]>(() =>
    generateStarryTrials(demo ? STARRY_DEFAULTS.demoTargets : STARRY_DEFAULTS.fullTargets, newSeed()),
  );
  const [starry, setStarry] = useState<StarryRun | null>(null);
  const freshSession = () => createSession({ alias: demo ? "Demo" : alias, input, viewport: viewport(), source: demo ? "demonstration" : undefined });
  const [session, setSession] = useState<SessionRecord>(freshSession);
  const [lineIndex, setLineIndex] = useState(0);

  const running = step.kind === "run" || step.kind === "next";
  useEffect(() => onRunning(running), [running, onRunning]);
  useEffect(() => () => onRunning(false), [onRunning]);

  const stepLabel = (t: BatteryTest) => (demo ? `Demo · ${scoredBatteryStep(t)}` : scoredBatteryStep(t));

  /** Moves past `done`: the next test's "up next" card, or the report after the last one. */
  const after = useCallback(
    (done: BatteryTest) => {
      const next = tests[tests.indexOf(done) + 1];
      toTop();
      setStep(next ? { kind: "next", test: next } : { kind: "report" });
    },
    [tests.join()], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const lineRef = useRef(lineIndex);
  lineRef.current = lineIndex;

  const onBoardTrial = useCallback(
    (trial: TrialRecord) => {
      const { session: next, finished } = recordAssessmentTrial(sessionRef.current, trial);
      setSession(next);
      if (finished) {
        if (!demo && onSave) {
          try {
            onSave(next);
          } catch {
            /* History save / upload must not block leaving the board */
          }
        }
        toTop();
        setStep({ kind: "report" });
      } else if (trial.task === "target-selection") {
        after("rings");
      } else {
        setLineIndex(lineRef.current + 1);
      }
    },
    [after, demo, onSave],
  );

  // Board trials are created once per test/line so the runner gets a stable record.
  const boardTrial = useMemo(() => {
    if (step.kind !== "run") return null;
    if (step.test === "rings") return newTargetSelectionTrial(session, "fixed-a", viewport());
    if (step.test === "lines") return newLineTrial(session, lineIndex, viewport());
    return null;
  }, [step, lineIndex]); // eslint-disable-line react-hooks/exhaustive-deps -- session updates mid-trial must not reset the runner

  const restart = () => {
    setStarryTrials(generateStarryTrials(demo ? STARRY_DEFAULTS.demoTargets : STARRY_DEFAULTS.fullTargets, newSeed()));
    setStarry(null);
    setSession(freshSession());
    setLineIndex(0);
    setStep({ kind: "intro" });
  };

  const stop = () => {
    restart();
    onHome();
  };

  /* --- intro of the first test (full instructions, once) --- */
  if (step.kind === "intro") {
    const begin = () => setStep({ kind: "run", test: tests[0]! });
    const first = tests[0]!;
    if (from === "starry") return <StarryIntro trials={starryTrials} step={stepLabel("starry")} onBegin={begin} onCancel={onHome} />;
    if (from === "rings") return <TargetIntro input={session.input} step={stepLabel("rings")} onBegin={begin} onCancel={onHome} />;
    return <LineIntro input={session.input} step={stepLabel(first)} onBegin={begin} />;
  }

  if (step.kind === "next")
    return <NextUp key={step.test} name={TESTS[step.test].name} hint={TESTS[step.test].hint} onGo={() => setStep({ kind: "run", test: step.test })} />;

  if (step.kind === "run" && step.test === "starry")
    return (
      <StarryTask
        trials={starryTrials}
        eyebrow={stepLabel("starry")}
        autoStart={demo}
        onFinish={(run) => {
          setStarry(run);
          after("starry");
        }}
        onStop={stop}
      />
    );

  if (step.kind === "run" && boardTrial) {
    const rings = step.test === "rings";
    return (
      <TaskRunner
        key={boardTrial.id}
        sessionId={session.id}
        trial={boardTrial}
        timeLimitMs={TIME_LIMIT_MS[rings ? "target-selection" : "line-bisection"]}
        eyebrow={stepLabel(step.test)}
        title={rings ? "Select every hollow ring" : `Mark the middle of line ${lineIndex + 1} of ${LINE_BISECTION_TRIAL_COUNT}`}
        instruction={rings ? "Leave the solid disks. Press Done when finished." : "One mark. No accuracy feedback."}
        onFinish={onBoardTrial}
      />
    );
  }

  return (
    <CombinedReport
      demo={demo}
      tests={tests}
      starryTrials={starryTrials}
      starry={starry}
      session={session}
      onHome={onHome}
      onAgain={restart}
    />
  );
}

/* ------------------------------------------------------------ combined report */

function CombinedReport({
  demo,
  tests,
  starryTrials,
  starry,
  session,
  onHome,
  onAgain,
}: {
  demo: boolean;
  tests: BatteryTest[];
  starryTrials: StarryTrial[];
  starry: StarryRun | null;
  session: SessionRecord;
  onHome: () => void;
  onAgain: () => void;
}) {
  const result = useMemo(() => scoreSession(session), [session]);
  const sky = useMemo(() => (starry ? scoreStarry(starryTrials, starry.responses, starry.presses) : null), [starry, starryTrials]);
  const ts = result.targetSelection;
  const tsTrial = findTargetSelectionTrial(session);
  const lineTrials = session.trials.filter((t) => t.task === "line-bisection");
  const lb = result.lineBisection;

  return (
    <div className="check-page demo-summary">
      <header className="page-head">
        <div>
          <Eyebrow>Combined report</Eyebrow>
          <h1>{tests.length === 1 ? "One test, one picture" : `${tests.length} tests, one picture`}</h1>
          <p className="meta">
            {demo
              ? "Demonstration run · not saved"
              : "Hollow rings and line bisection save to History; Starry Night is shown on this report"}{" "}
            · research tool, not a diagnosis
          </p>
        </div>
        <div className="badges">
          {demo && <span className="badge demonstration">Demonstration</span>}
          {session.status === "incomplete" && <span className="badge incomplete">Incomplete</span>}
        </div>
      </header>

      <section className="stat-row card">
        {sky && <Stat label="Starry Night · gap, left − right" value={points(sky.observation.value * 100)} sub={`${sky.left.hits}/${sky.left.n} left · ${sky.right.hits}/${sky.right.n} right`} />}
        {ts && (
          <Stat
            label={`Hollow rings · ${LEFT_RIGHT_MISSES_LABEL}`}
            value={missShareGap(ts.omissionAsymmetry)}
            sub={LEFT_RIGHT_MISSES_HINT}
            title={LEFT_RIGHT_MISSES_HINT}
          />
        )}
        {tests.includes("lines") && <Stat label="Line bisection · median" value={signedPct(lb.signedMedian)} sub="positive = right of centre" />}
      </section>

      {sky && starry && (
        <StarryResult trials={starryTrials} responses={starry.responses} presses={starry.presses} eyebrow={scoredBatteryStep("starry")} />
      )}

      {tests.includes("rings") &&
        (ts && tsTrial ? (
          <>
            <section className="verdict card">
              <div className="verdict-text">
                <Eyebrow plain>{scoredBatteryStep("rings")}</Eyebrow>
                <h2>
                  {ts.hits} of {ts.available} rings found
                </h2>
                <p>{result.spatialPattern.description}</p>
              </div>
              <BalanceBar score={ts} />
            </section>
            <section className="review-grid">
              <div className="card pad-0">
                <ResponseOrderPlot
                  layout={tsTrial.layout}
                  orderedHits={ts.orderedHits}
                  events={tsTrial.events}
                  headingMeta={
                    <span className="small">
                      Found {pct(ts.hitRate)} · first ring after {seconds(ts.firstLatencyMs)}
                    </span>
                  }
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
          <p className="notice">No hollow-ring trial was recorded.</p>
        ))}

      {tests.includes("lines") && (
        <section className="card">
          <div className="card-head">
            <h3>{scoredBatteryStep("lines")}</h3>
            <span className="small">
              Median {signedPct(lb.signedMedian)} · absolute {signedPct(lb.absoluteMedian).replace("+", "")} · {lb.validCount} of {LINE_BISECTION_TRIAL_COUNT} valid
            </span>
          </div>
          <LineDeviations trials={lineTrials} total={LINE_BISECTION_TRIAL_COUNT} />
          <p className="small dev-key">
            <i className="key centre" /> True centre <i className="key mark" /> Mark placed. Positive = right of centre.
          </p>
          {lb.healthyRange ? (
            <p className={lb.healthyRange.status === "outside" ? "notice warn" : "notice"}>{lb.healthyRange.text}</p>
          ) : null}
        </section>
      )}

      <div className="actions">
        <button className="ghost" onClick={onHome}>
          Home
        </button>
        <button
          onClick={() =>
            downloadJson(`neurovision-run-${fileStamp()}.json`, {
              starryNight: starry ? { settings: STARRY_DEFAULTS, trials: starryTrials, ...starry } : null,
              session,
            })
          }
        >
          Export data
        </button>
        <button className="primary" onClick={onAgain}>
          Run again
        </button>
      </div>
    </div>
  );
}
