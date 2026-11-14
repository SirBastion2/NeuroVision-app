import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  CONTRACTS_VERSION,
  LINE_BISECTION_TRIAL_COUNT,
  describeViewport,
  type InputModality,
  type LayoutVariant,
  type SessionRecord,
  type TrialRecord,
} from "@neurovision/domain";
import { HiddenScenePage } from "./checks/HiddenScene";
import { BatteryPage } from "./checks/pages";
import { BrandMark, Wordmark } from "./components/Brand";
import { ProfileMenu } from "./components/ProfileMenu";
import { TaskRunner } from "./components/TaskRunner";
import { batteryEnabled } from "./data/batterySession";
import { createLocalSessionStore, type LoadResult } from "./data/sessionStore";
import { flowReducer, initialFlow, type Screen } from "./lib/flow";
import { TIME_LIMIT_MS, createSession, newLineTrial, newPracticeTrial, newTargetSelectionTrial } from "./lib/session";
import { ProfileDashboard } from "./profile/ProfileDashboard";
import { BatteryIntro } from "./screens/BatteryIntro";
import { BatteryResults, serializeBatteryRecord } from "./screens/BatteryResults";
import { BatteryRun } from "./screens/BatteryRun";
import { GazeLab } from "./screens/GazeLab";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { LineIntro, TargetIntro } from "./screens/Intros";
import { MyProfile } from "./screens/MyProfile";
import { PracticeReflection, PracticeSetup } from "./screens/Practice";
import { Review } from "./screens/Review";
import {
  createAppServices,
  participantIdForExport,
  shouldEnqueueUpload,
  showApiControls,
  type Me,
  type ProcessingSnapshot,
  type UploadQueueState,
} from "./services";
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

function avatarInitials(sessions: LoadResult["sessions"]): string {
  const live = [...sessions].reverse().find((item) => item.source === "live");
  const alias = live?.alias?.trim();
  if (!alias) return "NV";
  const parts = alias.split(/[\s-_]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return alias.slice(0, 2).toUpperCase();
}

const LINE_STEPS: { label: string; screens: Screen[] }[] = [
  { label: "Line bisection", screens: ["line-intro", "line-task"] },
  { label: "Review", screens: ["review"] },
];

const ASSESSMENT_STEPS: { label: string; screens: Screen[] }[] = [
  { label: "Target selection", screens: ["target-intro", "target-task"] },
  { label: "Line bisection", screens: ["line-intro", "line-task"] },
  { label: "Review", screens: ["review"] },
];

export function App() {
  const services = useMemo(() => createAppServices(), []);
  const apiEnabled = showApiControls(services.apiEnabled);
  const showBattery = batteryEnabled(apiEnabled);
  const store = useMemo(
    () =>
      createLocalSessionStore({
        history: {
          save: (session) => services.save(session),
          listHistory: () => services.listHistory(),
          remove: (id) => services.remove(id),
        },
        standalone: services.storeKind === "memory",
      }),
    [services],
  );
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  const [stored, setStored] = useState<LoadResult>({ sessions: [], rejected: 0, error: null });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [signedIn, setSignedIn] = useState<Me | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [queue, setQueue] = useState<UploadQueueState>(() => services.queueState());
  const [processing, setProcessing] = useState<Record<string, ProcessingSnapshot>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkRunning, setCheckRunning] = useState(false);
  const main = useRef<HTMLElement>(null);
  const enqueued = useRef(new Set<string>());
  const { session, screen } = state;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("neurovision.web.theme", theme);
    } catch {
      /* preference just won't persist */
    }
  }, [theme]);

  useEffect(() => void store.load().then(setStored), [store]);
  useEffect(() => services.subscribeQueue(setQueue), [services]);
  useEffect(() => {
    void services.drainQueue();
  }, [services]);

  useEffect(() => {
    if (!apiEnabled) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("code") && url.searchParams.get("state")) {
      void services
        .completeSignIn(url)
        .then((result) => {
          if ("subject" in result) setSignedIn(result);
          url.searchParams.delete("code");
          url.searchParams.delete("state");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        })
        .catch((error: unknown) => {
          setAuthError(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    void services.getMe().then(setSignedIn);
  }, [apiEnabled, services]);

  useEffect(() => {
    if (!state.ended || !session || session.source !== "live") return;
    let cancelled = false;
    void (async () => {
      const result = await store.save(session);
      if (cancelled) return;
      setSaveError(result.error);
      setStored(await store.load());
      if (
        shouldEnqueueUpload({ ended: true, session, apiEnabled }) &&
        !enqueued.current.has(session.id)
      ) {
        enqueued.current.add(session.id);
        try {
          await services.enqueueUpload({ session });
        } catch (error) {
          if (cancelled) return;
          setSaveError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.ended, session, store, services, apiEnabled]);

  useEffect(() => {
    if (screen === "history" || screen === "my-profile") {
      void store.load().then(setStored);
    }
  }, [screen, store]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (screen.endsWith("-task") || screen === "battery-run") return;
    const heading = main.current?.querySelector<HTMLElement>("h1, h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [screen]);

  useEffect(() => {
    if (!apiEnabled) return;
    const ac = new AbortController();
    const ids = queue.jobs
      .filter((job) => job.status === "acknowledged" || job.status === "uploading")
      .map((job) => job.sessionId);
    for (const id of ids) {
      void services
        .pollProcessingState(id, {
          signal: ac.signal,
          onUpdate: (snapshot) => {
            setProcessing((current) => ({ ...current, [id]: snapshot }));
          },
        })
        .catch(() => undefined);
    }
    return () => ac.abort();
  }, [apiEnabled, services, queue]);

  const start = (alias: string, input: InputModality, variant: LayoutVariant) =>
    dispatch({ type: "start", session: createSession({ alias, input, viewport: currentViewport() }), variant });
  const onTrial = useCallback((trial: TrialRecord) => dispatch({ type: "trial-finished", trial }), []);
  const onPractice = useCallback((trial: TrialRecord) => dispatch({ type: "practice-finished", trial }), []);
  const home = () => dispatch({ type: "home" });
  const go = (s: Screen) => dispatch({ type: "go", screen: s });
  const saveRun = useCallback(
    (s: SessionRecord) => {
      void (async () => {
        const result = await store.save(s);
        setSaveError(result.error);
        setStored(await store.load());
      })();
    },
    [store],
  );

  const trial = useMemo(() => {
    if (!session) return null;
    if (screen === "target-task") return newTargetSelectionTrial(session, state.variant, currentViewport());
    if (screen === "line-task") return newLineTrial(session, state.lineIndex, currentViewport());
    if (screen === "practice-task" && state.practice) return newPracticeTrial(session, state.practice.layout, currentViewport());
    return null;
  }, [screen, state.lineIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const inAssessment = ["target-intro", "target-task", "line-intro", "line-task"].includes(screen);
  const focusMode = inAssessment || checkRunning || screen === "practice-task" || screen === "battery-run";
  const steps = state.linesOnly ? LINE_STEPS : ASSESSMENT_STEPS;
  const stepIndex = steps.findIndex((s) => s.screens.includes(screen));
  const cue = state.practice?.config;
  const showPrimaryNav = !focusMode && !inAssessment;
  const centerNavOn: Screen | null =
    screen === "home" || screen === "history" || screen === "gaze" ? screen : null;
  const exportId = participantIdForExport({
    signedInParticipantId: signedIn?.subject ?? null,
    activeProfileId: stored.sessions[0]?.profileId ?? null,
  });

  const onSignIn = () => {
    void services.beginSignIn().then((redirect) => {
      window.location.assign(redirect.url);
    });
  };

  const onExport = async () => {
    if (!exportId) return;
    setActionError(null);
    try {
      const result = await services.exportParticipant(exportId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.bundle, null, 2)], { type: "application/json" }));
      Object.assign(document.createElement("a"), { href: url, download: `${exportId}-export.json` }).click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const onDeleteParticipant = async () => {
    if (!exportId) return;
    setActionError(null);
    try {
      await services.deleteParticipant(exportId);
      setStored(await store.load());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={`app ${focusMode ? "focus-mode" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={home} disabled={focusMode} aria-label="NeuroVision home">
          <BrandMark size={34} />
          <Wordmark />
        </button>

        {inAssessment ? (
          <ol className="stepper" aria-label="Assessment progress">
            {steps.map((s, i) => (
              <li
                key={s.label}
                className={i < stepIndex ? "done" : i === stepIndex ? "current" : ""}
                aria-current={i === stepIndex ? "step" : undefined}
              >
                <span>{i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
        ) : showPrimaryNav ? (
          <nav className="topbar-center" aria-label="Primary">
            <button type="button" className={centerNavOn === "home" ? "on" : ""} onClick={home}>
              Home
            </button>
            <button type="button" className={centerNavOn === "history" ? "on" : ""} onClick={() => go("history")}>
              History
            </button>
            <button type="button" className={screen === "starry" ? "on" : ""} onClick={() => go("starry")}>
              Starry Night
            </button>
            <button type="button" className={screen === "rings" ? "on" : ""} onClick={() => go("rings")}>
              Hollow rings
            </button>
            <button type="button" className={screen === "lines" ? "on" : ""} onClick={() => go("lines")}>
              Line bisection
            </button>
            <button type="button" className={screen === "scene" ? "on" : ""} onClick={() => go("scene")}>
              Hidden scene
            </button>
          </nav>
        ) : (
          <div className="topbar-center-spacer" aria-hidden />
        )}

        {!focusMode && (
          <div className="topbar-right">
            {apiEnabled &&
              (signedIn ? (
                <>
                  <span className="small">{signedIn.subject}</span>
                  <button className="ghost" type="button" onClick={() => void services.signOut().then(() => setSignedIn(null))}>
                    Sign out
                  </button>
                </>
              ) : (
                <button type="button" onClick={onSignIn}>
                  Sign in
                </button>
              ))}
            <button
              className="theme-toggle"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              disabled={screen.endsWith("-task") || checkRunning}
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
            <ProfileMenu
              initials={avatarInitials(stored.sessions)}
              onMyProfile={() => go("my-profile")}
              onClinicianDashboard={() => go("profile")}
            />
          </div>
        )}
      </header>

      <main ref={main} tabIndex={-1} key={screen} className="screen">
        {authError && (
          <p className="notice error" role="alert">
            {authError}
          </p>
        )}
        {apiEnabled && queue.pending + queue.uploading + queue.blocked > 0 && (
          <p className="notice" role="status">
            Upload queue: {queue.pending} queued, {queue.uploading} uploading, {queue.blocked} blocked, {queue.acknowledged} sent.
          </p>
        )}
        {screen === "home" && (
          <Home
            onStart={start}
            onOpen={(s) => dispatch({ type: "open", session: s })}
            onHistory={() => go("history")}
            onProfile={() => go("my-profile")}
            onGaze={() => go("gaze")}
            showBattery={showBattery}
            onBattery={showBattery ? () => go("battery-intro") : undefined}
            onStarry={() => go("starry")}
            onDemo={() => go("demo")}
          />
        )}
        {screen === "battery-intro" && showBattery && (
          <BatteryIntro onStart={(config) => dispatch({ type: "battery-start", config })} onBack={home} />
        )}
        {screen === "battery-run" && state.batteryConfig && showBattery && (
          <BatteryRun
            config={state.batteryConfig}
            onFinished={(record) => dispatch({ type: "battery-finished", record })}
            onStop={home}
            onRunning={setCheckRunning}
          />
        )}
        {screen === "battery-results" && state.batteryRecord && (
          <BatteryResults
            record={state.batteryRecord}
            onExport={() => {
              const json = serializeBatteryRecord(state.batteryRecord!);
              const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
              Object.assign(document.createElement("a"), { href: url, download: `${state.batteryRecord!.id}.json` }).click();
              URL.revokeObjectURL(url);
            }}
            onBack={home}
          />
        )}
        {screen === "assessment" && (
          <BatteryPage from="starry" onHome={home} onRunning={setCheckRunning} onSave={saveRun} />
        )}
        {screen === "starry" && <BatteryPage from="starry" onHome={home} onRunning={setCheckRunning} onSave={saveRun} />}
        {screen === "rings" && <BatteryPage from="rings" onHome={home} onRunning={setCheckRunning} onSave={saveRun} />}
        {screen === "lines" && <BatteryPage from="lines" onHome={home} onRunning={setCheckRunning} onSave={saveRun} />}
        {screen === "demo" && <BatteryPage from="starry" demo onHome={home} onRunning={setCheckRunning} />}
        {screen === "scene" && <HiddenScenePage onHome={home} onRunning={setCheckRunning} />}
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
            onProfile={() => go("profile")}
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
          <PracticeReflection
            session={session}
            config={cue}
            onAnother={(config) => dispatch({ type: "next-practice", config })}
            onReview={() => go("review")}
          />
        )}
        {screen === "history" && (
          <History
            stored={stored}
            onOpen={(s) => dispatch({ type: "open", session: s })}
            onDelete={async (id) => {
              const result = await store.remove(id);
              setSaveError(result.error);
              setStored(await store.load());
            }}
            onHome={home}
            apiEnabled={apiEnabled}
            processing={processing}
            queue={queue}
            actionError={actionError}
            onExport={apiEnabled ? () => void onExport() : undefined}
            onDeleteParticipant={apiEnabled ? () => void onDeleteParticipant() : undefined}
          />
        )}
        {screen === "gaze" && <GazeLab onHome={home} />}
        {screen === "my-profile" && (
          <MyProfile
            sessions={stored.sessions}
            onHome={home}
            onHistory={() => go("history")}
            onOpen={(s) => dispatch({ type: "open", session: s })}
            onClinicianDashboard={() => go("profile")}
          />
        )}
        {screen === "profile" && <ProfileDashboard onBackToPatient={() => go("my-profile")} />}
      </main>

      {!focusMode && (
        <footer className="footer">
          <span>NeuroVision · Spatial Attention Lab</span>
          <span>
            Research tool · not a diagnostic tool · contracts {CONTRACTS_VERSION} · data stays in this
            browser
          </span>
        </footer>
      )}
    </div>
  );
}
