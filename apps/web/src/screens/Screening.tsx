import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Eyebrow } from "../components/Brand";
import { GazeTracker } from "../gaze/webcam";
import { MouseGazeSource } from "../gaze/mouse";
import { SyntheticGazeSource } from "../gaze/synthetic-source";
import { parseRecording, ReplayGazeSource, RECORDING_SCHEMA, type GazeRecording } from "../gaze/replay";
import { refineSessionGaze } from "../gaze/refine";
import type { GazeSource } from "../gaze/types";
import { useCalibrationOverlay } from "../gaze/ui/CalibrationOverlay";
import { CameraPreview } from "../gaze/ui/CameraPreview";
import { FreeLook } from "../gaze/ui/FreeLook";
import { ValidationPanel } from "../gaze/ui/ValidationPanel";
import type { Difficulty, GazeSourceKind, SessionResult, SmoothingLevel, TestKind, TestLayout, ValidationReport } from "../metrics/types";
import { generateBisectionLayout } from "../tests/bisection";
import { DEFAULT_LEVEL, difficultyForLevel, MAX_LEVEL, MIN_LEVEL, nextDifficulty, type RunOutcome } from "../tests/difficulty";
import { buildSession, recomputeSession } from "../tests/session";
import { generateStarLayout } from "../tests/star";
import { generateRecoverySeries, generateSyntheticBisectionSession, generateSyntheticStarSession } from "../tests/synthetic";
import { downloadJson, ResultsView } from "../tests/ui/ResultsView";
import { TestRunner, type TestRunResult } from "../tests/ui/TestRunner";
import { VisitTable } from "../tests/ui/VisitTable";
import { visitStore } from "../tests/visitStore";
import "../tests/ui/screening.css";

type Choice = "mouse" | "webcam" | "synthetic" | "replay";
type Step = "setup" | "freelook" | "running";

const CHOICES: Array<{ id: Choice; title: string; text: string }> = [
  { id: "mouse", title: "Mouse", text: "The cursor stands in for gaze. No camera needed." },
  { id: "webcam", title: "Webcam", text: "Eye tracking in the browser. Calibrate, validate, then test." },
  { id: "synthetic", title: "Synthetic patient", text: "Generated sessions with a chosen severity, for demos." },
  { id: "replay", title: "Replay", text: "Replay a saved gaze recording as a backup." },
];
const TEST_NAMES: Record<TestKind, string> = { "star-cancellation": "Star cancellation", "line-bisection": "Line bisection" };

async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch {
    /* fullscreen is optional; the test still covers the viewport */
  }
  await new Promise((r) => setTimeout(r, 250));
}
function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
}

function outcomes(sessions: readonly SessionResult[], test: TestKind): RunOutcome[] {
  return sessions
    .filter((s) => s.test === test && s.source !== "synthetic")
    .map((s) => {
      const t = s.metrics.test;
      return {
        difficulty: s.difficulty,
        hitRate: t.kind === "star-cancellation" ? t.hitRate : t.lines ? t.answered / t.lines : 0,
        timedOut: t.kind === "star-cancellation" ? t.timedOut : false,
        commissions: t.kind === "star-cancellation" ? t.commissions : s.taps.filter((x) => x.kind === "commission").length,
      };
    });
}

export function Screening() {
  const sessions = useSyncExternalStore(visitStore.subscribe, visitStore.all);
  const [choice, setChoice] = useState<Choice>("mouse");
  const [test, setTest] = useState<TestKind>("star-cancellation");
  const [cued, setCued] = useState(false);
  const [autoLevel, setAutoLevel] = useState(true);
  const [manualLevel, setManualLevel] = useState(DEFAULT_LEVEL);
  const [smoothing, setSmoothingState] = useState<SmoothingLevel>("medium");
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [severity, setSeverity] = useState(0.6);
  const [step, setStep] = useState<Step>("setup");
  const [run, setRun] = useState<{ layout: TestLayout; difficulty: Difficulty; source: GazeSource | null; sourceKind: GazeSourceKind } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [camState, setCamState] = useState<"off" | "starting" | "on">("off");
  const [calibrated, setCalibrated] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [recording, setRecording] = useState<GazeRecording | null>(null);
  const [freeLookSource, setFreeLookSource] = useState<GazeSource | null>(null);

  const tracker = useRef<GazeTracker | null>(null);
  const mouse = useRef(new MouseGazeSource());
  const synthetic = useRef<SyntheticGazeSource | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const cal = useCalibrationOverlay();

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const nextLevel = useMemo(() => nextDifficulty(outcomes(sessions, test)), [sessions, test]);
  const difficulty = autoLevel ? nextLevel : difficultyForLevel(manualLevel);

  // Release the camera and any timers when leaving the page.
  useEffect(
    () => () => {
      tracker.current?.stop();
      mouse.current.stop();
      synthetic.current?.stop();
      exitFullscreen();
    },
    [],
  );

  const setSmoothing = (l: SmoothingLevel) => {
    setSmoothingState(l);
    tracker.current?.setSmoothing(l);
  };

  const focusResults = () => setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);

  const sourceFor = (c: Choice): { source: GazeSource | null; kind: GazeSourceKind } => {
    if (c === "webcam") return { source: tracker.current, kind: "webcam" };
    if (c === "synthetic") {
      synthetic.current = new SyntheticGazeSource(severity, Date.now() % 100_000);
      return { source: synthetic.current, kind: "synthetic" };
    }
    if (c === "replay" && recording) {
      const q = recording.quality?.source;
      return { source: new ReplayGazeSource(recording), kind: q === "mouse" || q === "synthetic" ? q : "webcam" };
    }
    return { source: mouse.current, kind: "mouse" };
  };

  const startTest = async () => {
    setMessage(null);
    await enterFullscreen();
    const area = { width: window.innerWidth, height: window.innerHeight };
    const seed = Math.floor(Math.random() * 1_000_000);
    const layout = test === "star-cancellation" ? generateStarLayout(area, difficulty, seed) : generateBisectionLayout(area, seed);
    const { source, kind } = sourceFor(choice);
    setRun({ layout, difficulty, source, sourceKind: kind });
    setStep("running");
  };

  const stopSource = (s: GazeSource | null) => {
    if (!s) return;
    if (s instanceof GazeTracker) s.pause();
    else s.stop();
  };

  const finishTest = useCallback(
    (r: TestRunResult) => {
      if (!run) return;
      stopSource(run.source);
      exitFullscreen();
      const quality = run.source?.getQuality() ?? {
        source: run.sourceKind,
        calibrated: false,
        smoothing,
        validation: null,
        calibrationHeadYawDeg: null,
        trackedFraction: null,
        fps: null,
        clickRefinement: null,
      };
      const sourceLabel = { webcam: "webcam gaze", mouse: "mouse as gaze", synthetic: "synthetic gaze" }[run.sourceKind];
      const session = buildSession({
        layout: run.layout,
        difficulty: run.difficulty,
        cued,
        source: run.sourceKind,
        label: `${TEST_NAMES[run.layout.kind]} · ${sourceLabel}${choice === "replay" ? " (replay)" : ""}${cued ? " · cued" : ""}`,
        taps: r.taps,
        gaze: r.gaze,
        quality,
        durationMs: r.durationMs,
        timedOut: r.timedOut,
      });
      visitStore.add(session);
      setActiveId(session.id);
      setRun(null);
      setStep("setup");
      focusResults();
    },
    [run, cued, choice, smoothing],
  );

  const abortTest = useCallback(() => {
    stopSource(run?.source ?? null);
    exitFullscreen();
    setRun(null);
    setStep("setup");
    setMessage("Test stopped. Nothing was saved.");
  }, [run]);

  const startCamera = async () => {
    setMessage(null);
    setCamState("starting");
    try {
      tracker.current ??= new GazeTracker({ smoothing });
      await tracker.current.init();
      setCamState("on");
    } catch (e) {
      setCamState("off");
      setMessage(`Camera could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const stopCamera = () => {
    tracker.current?.stop();
    setCamState("off");
  };

  const calibrate = async () => {
    const t = tracker.current;
    if (!t) return;
    setMessage(null);
    setReport(null);
    await enterFullscreen();
    cal.open();
    const res = await t.calibrate({ presenter: cal.presenter, autoAdvance });
    if (!res.ok) {
      cal.close();
      exitFullscreen();
      setMessage(res.cancelled ? "Calibration cancelled." : (res.message ?? "Calibration failed."));
      return;
    }
    setCalibrated(true);
    const rep = await t.validate({ presenter: cal.presenter });
    cal.close();
    exitFullscreen();
    if (rep) setReport(rep);
    else setMessage("Validation cancelled. You can still run a test, but accuracy is unknown.");
  };

  const openFreeLook = () => {
    const s = choice === "webcam" ? tracker.current : choice === "synthetic" ? new SyntheticGazeSource(severity, 7) : choice === "replay" && recording ? new ReplayGazeSource(recording) : mouse.current;
    if (!s) return;
    setFreeLookSource(s);
    setStep("freelook");
  };
  const closeFreeLook = useCallback(() => {
    stopSource(freeLookSource);
    setFreeLookSource(null);
    setStep("setup");
  }, [freeLookSource]);

  const generate = (kind: "star" | "bisection" | "series") => {
    const seed = Math.floor(Math.random() * 100_000);
    const made =
      kind === "series"
        ? generateRecoverySeries(5, seed)
        : [kind === "star" ? generateSyntheticStarSession(severity, seed) : generateSyntheticBisectionSession(severity, seed)];
    visitStore.add(made);
    setActiveId(made[made.length - 1]!.id);
    focusResults();
  };

  const loadRecording = async (file: File | undefined) => {
    if (!file) return;
    try {
      setRecording(parseRecording(await file.text()));
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not read that file.");
    }
  };

  const refinement = useMemo(() => {
    if (!active || active.test !== "star-cancellation" || active.gaze.length === 0) return null;
    const r = refineSessionGaze(active, active.gazeUnrefined ?? active.gaze).refinement;
    return { pairs: r.pairs, looRaw: r.looErrorRawPx, looCorrected: r.looErrorCorrectedPx, helps: r.correction !== null };
  }, [active]);

  const toggleRefinement = (on: boolean) => {
    if (!active) return;
    const base = active.gazeUnrefined ?? active.gaze;
    if (on) {
      const { refinement: r, refined } = refineSessionGaze(active, base);
      if (!refined) return;
      visitStore.replace(recomputeSession({ ...active, gazeUnrefined: base }, refined, { ...active.quality, clickRefinement: { ...r, applied: true } }));
      if (active.source === "webcam") tracker.current?.setClickRefinement(r.correction);
    } else {
      const { gazeUnrefined: _drop, ...rest } = active;
      visitStore.replace(recomputeSession(rest, base, { ...active.quality, clickRefinement: active.quality.clickRefinement ? { ...active.quality.clickRefinement, applied: false } : null }));
      if (active.source === "webcam") tracker.current?.setClickRefinement(null);
    }
  };

  const downloadRecording = (s: SessionResult) => {
    const rec: GazeRecording = { schema: RECORDING_SCHEMA, createdAt: s.createdAt, viewport: s.layout.area, quality: s.quality, samples: s.gazeUnrefined ?? s.gaze };
    downloadJson(`${s.id}-gaze-recording.json`, JSON.stringify(rec));
  };

  const canTest = choice === "mouse" || choice === "synthetic" || (choice === "webcam" && camState === "on" && calibrated) || (choice === "replay" && !!recording);

  return (
    <div className="scr-page">
      <header className="page-head">
        <div>
          <Eyebrow>Screening lab</Eyebrow>
          <h1>Neglect screening</h1>
          <p className="meta">Star cancellation and line bisection, with optional webcam eye tracking. Every metric uses horizontal position.</p>
        </div>
      </header>
      <p className="notice warn scr-disclaimer" role="note">
        <strong>Not clinically validated.</strong> For screening and monitoring research only. These results do not diagnose
        hemispatial neglect or any other condition.
      </p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <section className="scr-choices" role="radiogroup" aria-label="Gaze source">
        {CHOICES.map((c) => (
          <button key={c.id} role="radio" aria-checked={choice === c.id} className={`card scr-choice ${choice === c.id ? "on" : ""}`} onClick={() => setChoice(c.id)}>
            <strong>{c.title}</strong>
            <span>{c.text}</span>
          </button>
        ))}
      </section>

      <section className="scr-setup">
        <div className="card scr-source">
          {choice === "mouse" && (
            <>
              <h3>Mouse mode</h3>
              <p className="small">Move the cursor where you are looking. Gaze metrics are computed from the cursor and labelled as such.</p>
            </>
          )}

          {choice === "webcam" && (
            <>
              <h3>Webcam eye tracking</h3>
              <ol className="scr-steps">
                <li className={camState === "on" ? "done" : "current"}>
                  <span>1</span> Camera
                </li>
                <li className={calibrated ? "done" : camState === "on" ? "current" : ""}>
                  <span>2</span> Calibrate (13 + 3 dots)
                </li>
                <li className={report ? "done" : calibrated ? "current" : ""}>
                  <span>3</span> Validate (7 dots)
                </li>
                <li className={report ? "current" : ""}>
                  <span>4</span> Test
                </li>
              </ol>
              {camState === "on" && tracker.current && <CameraPreview tracker={tracker.current} />}
              <p className="small">
                Sit about an arm’s length from the screen, face evenly lit, camera at eye height. Only gaze coordinates are kept; video is
                never stored or uploaded. Look at every dot during calibration, wherever it appears.
              </p>
              <div className="scr-row">
                {camState !== "on" ? (
                  <button className="primary" onClick={startCamera} disabled={camState === "starting"}>
                    {camState === "starting" ? "Starting camera…" : "Start camera"}
                  </button>
                ) : (
                  <>
                    <button className="primary" onClick={calibrate}>
                      {calibrated ? "Recalibrate" : "Calibrate"}
                    </button>
                    <button className="ghost" onClick={stopCamera}>
                      Turn camera off
                    </button>
                  </>
                )}
                <label className="check">
                  <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
                  Auto-advance (no clicking)
                </label>
              </div>
              <fieldset className="field">
                <legend>Smoothing</legend>
                <div className="segmented tight">
                  {(["low", "medium", "high"] as const).map((l) => (
                    <label key={l} className={smoothing === l ? "on" : ""}>
                      <input type="radio" name="smooth" checked={smoothing === l} onChange={() => setSmoothing(l)} />
                      {l}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {choice === "synthetic" && (
            <>
              <h3>Synthetic patient</h3>
              <label className="field">
                <span>
                  Severity <strong>{severity.toFixed(2)}</strong>
                </span>
                <input type="range" min={0} max={1} step={0.05} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} />
                <small>0 = no neglect. Higher values miss more on the left, start searching on the right and look right more.</small>
              </label>
              <div className="scr-row">
                <button onClick={() => generate("star")}>Generate star session</button>
                <button onClick={() => generate("bisection")}>Generate bisection session</button>
                <button className="primary" onClick={() => generate("series")}>
                  Recovery series · 5 visits
                </button>
              </div>
              <p className="small">You can also run a live test below with synthetic gaze and your own taps.</p>
            </>
          )}

          {choice === "replay" && (
            <>
              <h3>Replay a gaze recording</h3>
              <p className="small">Use “Download gaze recording” on any result to save one. Replay is a demo backup if the camera or lighting fails.</p>
              <input type="file" accept="application/json,.json" onChange={(e) => loadRecording(e.target.files?.[0])} />
              {recording && (
                <p className="small">
                  Loaded {recording.samples.length} samples · {(recording.samples[recording.samples.length - 1]?.t ?? 0) / 1000}s · from {recording.quality?.source ?? "unknown"}
                </p>
              )}
            </>
          )}
        </div>

        <div className="card scr-testcfg">
          <h3>Test</h3>
          <fieldset className="field">
            <legend>Task</legend>
            <div className="segmented">
              {(["star-cancellation", "line-bisection"] as const).map((k) => (
                <label key={k} className={test === k ? "on" : ""}>
                  <input type="radio" name="test" checked={test === k} onChange={() => setTest(k)} />
                  {TEST_NAMES[k]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>Difficulty</legend>
            <label className="check">
              <input type="checkbox" checked={autoLevel} onChange={(e) => setAutoLevel(e.target.checked)} />
              Adaptive (staircase from this visit)
            </label>
            {!autoLevel && <input type="range" min={MIN_LEVEL} max={MAX_LEVEL} step={1} value={manualLevel} onChange={(e) => setManualLevel(Number(e.target.value))} aria-label="Level" />}
            <small>
              Level {difficulty.level} · distractors ×{difficulty.distractorDensity} · target size ×{difficulty.targetScale} · {Math.round(difficulty.timeLimitMs / 1000)} s
            </small>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={cued} onChange={(e) => setCued(e.target.checked)} />
            Cued mode (flashing bar on the left edge that fades)
          </label>
          <p className="small">During the test, search the whole page. The test opens full screen.</p>
          <div className="scr-row">
            <button className="ghost" onClick={openFreeLook} disabled={choice === "webcam" && !calibrated}>
              Free look
            </button>
            <button className="primary large" onClick={startTest} disabled={!canTest}>
              Start {TEST_NAMES[test].toLowerCase()}
            </button>
          </div>
        </div>
      </section>

      {report && choice === "webcam" && (
        <ValidationPanel
          report={report}
          viewport={{ width: window.innerWidth, height: window.innerHeight }}
          onAccept={startTest}
          onRecalibrate={calibrate}
          onFreeLook={openFreeLook}
        />
      )}

      <div ref={resultsRef} className="scr-results-anchor">
        {active && (
          <>
            <div className="scr-results-head">
              <div>
                <span className="eyebrow plain">Result · {TEST_NAMES[active.test]}</span>
                <h2>{active.label}</h2>
                <p className="meta">
                  {new Date(active.createdAt).toLocaleString()} · level {active.difficulty.level} · {active.cued ? "cued" : "uncued"} · {active.source}
                </p>
              </div>
            </div>
            <ResultsView session={active} refinementAvailable={refinement} onToggleRefinement={toggleRefinement} onDownloadRecording={() => downloadRecording(active)} />
          </>
        )}
      </div>

      <VisitTable
        sessions={sessions}
        activeId={activeId}
        onOpen={(s) => {
          setActiveId(s.id);
          focusResults();
        }}
        onClear={() => {
          visitStore.clear();
          setActiveId(null);
        }}
      />

      {cal.overlay}
      {step === "freelook" && freeLookSource && <FreeLook source={freeLookSource} smoothing={smoothing} onSmoothing={setSmoothing} onExit={closeFreeLook} />}
      {step === "running" && run && <TestRunner layout={run.layout} difficulty={run.difficulty} cued={cued} source={run.source} onFinish={finishTest} onAbort={abortTest} />}
    </div>
  );
}
