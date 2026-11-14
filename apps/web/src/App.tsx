import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  CONTRACTS_VERSION,
  LINE_BISECTION_TRIAL_COUNT,
  describeViewport,
  type InputModality,
  type LayoutVariant,
  type TrialRecord,
} from "@neurovision/domain";
import { BrandMark, Wordmark } from "./components/Brand";
import { TaskRunner } from "./components/TaskRunner";
import { createLocalSessionStore, type LoadResult } from "./data/sessionStore";
import { flowReducer, initialFlow, type Screen } from "./lib/flow";
import { TIME_LIMIT_MS, createSession, newLineTrial, newPracticeTrial, newTargetSelectionTrial } from "./lib/session";
import { GazeLab } from "./screens/GazeLab";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { LineIntro, TargetIntro } from "./screens/Intros";
import { PracticeReflection, PracticeSetup } from "./screens/Practice";
import { Review } from "./screens/Review";
import "./styles.css";

type Theme = "light" | "dark";
const currentViewport = () => describeViewport(window.innerWidth, window.innerHeight, window.devicePixelRatio);

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("neurovision.web.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* storage unavailable: fall through to the system setting */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const ASSESSMENT_STEPS: { label: string; screens: Screen[] }[] = [
  { label: "Target selection", screens: ["target-intro", "target-task"] },
  { label: "Line bisection", screens: ["line-intro", "line-task"] },
  { label: "Review", screens: ["review"] },
];

export function App() {
  const store = useMemo(() => createLocalSessionStore(), []);
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  const [stored, setStored] = useState<LoadResult>(() => store.load());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const main = useRef<HTMLElement>(null);
  const { session, screen } = state;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("neurovision.web.theme", theme);
    } catch {
      /* preference just won't persist */
    }
  }, [theme]);

  // Save live sessions whenever they change after the assessment ends (practice rounds included).
  useEffect(() => {
    if (!state.ended || !session || session.source !== "live") return;
    setSaveError(store.save(session).error);
    setStored(store.load());
  }, [state.ended, session, store]);

  // Move focus to the new screen's heading for keyboard and screen-reader users.
  useEffect(() => {
    window.scrollTo(0, 0);
    if (screen.endsWith("-task")) return;
    const heading = main.current?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [screen]);

  const start = (alias: string, input: InputModality, variant: LayoutVariant) =>
    dispatch({ type: "start", session: createSession({ alias, input, viewport: currentViewport() }), variant });
  const onTrial = useCallback((trial: TrialRecord) => dispatch({ type: "trial-finished", trial }), []);
  const onPractice = useCallback((trial: TrialRecord) => dispatch({ type: "practice-finished", trial }), []);
  const home = () => dispatch({ type: "home" });
  const go = (s: Screen) => dispatch({ type: "go", screen: s });

  // Trials are created once per screen entry so the runner gets a stable record.
  const trial = useMemo(() => {
    if (!session) return null;
    if (screen === "target-task") return newTargetSelectionTrial(session, state.variant, currentViewport());
    if (screen === "line-task") return newLineTrial(session, state.lineIndex, currentViewport());
    if (screen === "practice-task" && state.practice) return newPracticeTrial(session, state.practice.layout, currentViewport());
    return null;
    // Recreated only on screen/line changes; session updates mid-trial must not reset the runner.
  }, [screen, state.lineIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const inAssessment = ["target-intro", "target-task", "line-intro", "line-task"].includes(screen);
  const focusMode = inAssessment || screen === "practice-task";
  const stepIndex = ASSESSMENT_STEPS.findIndex((s) => s.screens.includes(screen));
  const cue = state.practice?.config;

  return (
    <div className={`app ${focusMode ? "focus-mode" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={home} disabled={focusMode} aria-label="NeuroVision home">
          <BrandMark size={34} />
          <Wordmark />
        </button>
        {inAssessment ? (
          <ol className="stepper" aria-label="Assessment progress">
            {ASSESSMENT_STEPS.map((s, i) => (
              <li key={s.label} className={i < stepIndex ? "done" : i === stepIndex ? "current" : ""} aria-current={i === stepIndex ? "step" : undefined}>
                <span>{i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
        ) : (
          !focusMode && (
            <nav aria-label="Main">
              <button className={screen === "home" ? "on" : ""} onClick={home}>
                Home
              </button>
              <button className={screen === "history" ? "on" : ""} onClick={() => go("history")}>
                History
              </button>
              <button className={screen === "gaze" ? "on" : ""} onClick={() => go("gaze")}>
                Gaze lab
              </button>
            </nav>
          )
        )}
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          disabled={screen.endsWith("-task")}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            {theme === "dark" ? (
              <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.600 5.600l1.400 1.400m10 10 1.400 1.400m0-12.800L17 7M7 17l-1.400 1.400M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
            ) : (
              <path d="M20 14.500A8.500 8.500 0 0 1 9.500 4a8.500 8.500 0 1 0 10.500 10.500Z" />
            )}
          </svg>
        </button>
      </header>

      <main ref={main} tabIndex={-1} key={screen} className="screen">
        {screen === "home" && <Home onStart={start} onOpen={(s) => dispatch({ type: "open", session: s })} onHistory={() => go("history")} onGaze={() => go("gaze")} />}
        {screen === "target-intro" && session && <TargetIntro input={session.input} onBegin={() => go("target-task")} onCancel={home} />}
        {screen === "target-task" && session && trial && (
          <TaskRunner
            key={trial.id}
            sessionId={session.id}
            trial={trial}
            timeLimitMs={TIME_LIMIT_MS["target-selection"]}
            eyebrow="Assessment · target selection"
            title="Select every hollow ring"
            instruction="Leave the solid disks. Press Done when finished."
            onFinish={onTrial}
          />
        )}
        {screen === "line-intro" && session && <LineIntro input={session.input} onBegin={() => go("line-task")} />}
        {screen === "line-task" && session && trial && (
          <TaskRunner
            key={trial.id}
            sessionId={session.id}
            trial={trial}
            timeLimitMs={TIME_LIMIT_MS["line-bisection"]}
            eyebrow={`Assessment · line ${state.lineIndex + 1} of ${LINE_BISECTION_TRIAL_COUNT}`}
            title="Mark the middle of the line"
            instruction="One mark. No accuracy feedback."
            onFinish={onTrial}
          />
        )}
        {screen === "review" && session && (
          <Review
            session={session}
            saveError={session.source === "live" ? saveError : null}
            onPractice={() => go("practice-setup")}
            onHistory={() => go("history")}
            onHome={home}
          />
        )}
        {screen === "practice-setup" && session && (
          <PracticeSetup
            session={session}
            suggested={state.nextSuggestion ?? session.decision}
            onStart={(setup) => dispatch({ type: "practice-configured", setup })}
            onBack={() => go("review")}
          />
        )}
        {screen === "practice-task" && session && trial && cue && (
          <TaskRunner
            key={trial.id}
            sessionId={session.id}
            trial={trial}
            timeLimitMs={TIME_LIMIT_MS.practice}
            eyebrow={`Practice · round ${session.practice.length + 1}${session.source === "demonstration" ? " · demonstration, not saved" : ""}`}
            title="Select every hollow ring"
            instruction={
              cue.cue === "none" || cue.level === 0
                ? "Leave the solid disks. Press Done when finished."
                : `Begin at the ${cue.cue} side${cue.level === 2 ? ` and scan ${cue.cue === "left" ? "left to right" : "right to left"}` : ""}.`
            }
            practice={cue}
            onFinish={onPractice}
          />
        )}
        {screen === "practice-reflection" && session && cue && (
          <PracticeReflection session={session} config={cue} onAnother={(config) => dispatch({ type: "next-practice", config })} onReview={() => go("review")} />
        )}
        {screen === "history" && (
          <History
            stored={stored}
            onOpen={(s) => dispatch({ type: "open", session: s })}
            onDelete={(id) => {
              setSaveError(store.remove(id).error);
              setStored(store.load());
            }}
            onHome={home}
          />
        )}
        {screen === "gaze" && <GazeLab onHome={home} />}
      </main>

      {!focusMode && (
        <footer className="footer">
          <span>NeuroVision · Spatial Attention Lab</span>
          <span>Research prototype · not a diagnostic tool · contracts {CONTRACTS_VERSION} · data stays in this browser</span>
        </footer>
      )}
    </div>
  );
}
