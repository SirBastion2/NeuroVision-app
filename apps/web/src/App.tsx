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
import { createLocalSessionStore, type LoadResult } from "./data/sessionStore";
import { scoredBatteryName, scoredBatteryStep } from "./lib/battery-labels";
import { flowReducer, initialFlow, type Screen } from "./lib/flow";
import {
  TIME_LIMIT_MS,
  createSession,
  newLineTrial,
  newPracticeTrial,
  newTargetSelectionTrial,
  sessionAliasForParticipant,
} from "./lib/session";
import { ProfileDashboard } from "./profile/ProfileDashboard";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { LineIntro, TargetIntro } from "./screens/Intros";
import { MyProfile } from "./screens/MyProfile";
import { ParticipantStart } from "./screens/ParticipantStart";
import { PracticeReflection, PracticeSetup } from "./screens/Practice";
import { Review } from "./screens/Review";
import {
  DEMO_LOCAL_IDENTITY,
  LOCAL_ORG_ID,
  createAppServices,
  createMemoryKeyValueStore,
  createScopedKeyValueStore,
  getBrowserKeyValueStore,
  participantIdForExport,
  readLastParticipantId,
  shouldEnqueueUpload,
  shouldPersistSession,
  showApiControls,
  writeLastParticipantId,
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
  { label: scoredBatteryName("lines"), screens: ["line-intro", "line-task"] },
  { label: "Review", screens: ["review"] },
];

const ASSESSMENT_STEPS: { label: string; screens: Screen[] }[] = [
  { label: scoredBatteryName("rings"), screens: ["target-intro", "target-task"] },
  { label: scoredBatteryName("lines"), screens: ["line-intro", "line-task"] },
  { label: "Review", screens: ["review"] },
];

export function App() {
  const [participantId, setParticipantId] = useState<string | null>(null);
  const browserKv = useMemo(() => getBrowserKeyValueStore(), []);
  const scopedKv = useMemo(() => {
    if (!participantId) return browserKv;
    if (!browserKv) return createMemoryKeyValueStore();
    return createScopedKeyValueStore(browserKv, participantId);
  }, [browserKv, participantId]);
  const services = useMemo(() => createAppServices({ keyValueStore: scopedKv }), [scopedKv]);
  const apiEnabled = showApiControls(services.apiEnabled);
  const localIdentity = apiEnabled && services.identityMode === "local";
  const store = useMemo(
    () =>
      createLocalSessionStore({
        history: {
          save: (session) => services.save(session),
          listHistory: () => services.listHistory(),
          remove: (id) => services.remove(id),
        },
        storage: scopedKv,
        standalone: services.storeKind === "memory",
      }),
    [services, scopedKv],
  );
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  const [stored, setStored] = useState<LoadResult>({ sessions: [], rejected: 0, error: null });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [signedIn, setSignedIn] = useState<Me | null>(null);
  const [authReady, setAuthReady] = useState(!apiEnabled);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [lastParticipantId, setLastParticipantId] = useState(() => readLastParticipantId(browserKv));
  const [queue, setQueue] = useState<UploadQueueState>(() => services.queueState());
  const [processing, setProcessing] = useState<Record<string, ProcessingSnapshot>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkRunning, setCheckRunning] = useState(false);
  const [activity, setActivity] = useState<Array<{ bucket: string; count: number }>>([]);
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

  useEffect(() => {
    if (localIdentity && !signedIn) return;
    void store.load().then(setStored);
  }, [store, localIdentity, signedIn]);
  useEffect(() => {
    setQueue(services.queueState());
    return services.subscribeQueue(setQueue);
  }, [services]);
  useEffect(() => {
    void services.drainQueue();
  }, [services]);

  useEffect(() => {
    if (!apiEnabled) {
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    const url = new URL(window.location.href);
    void (async () => {
      try {
        if (url.searchParams.get("code") && url.searchParams.get("state")) {
          const result = await services.completeSignIn(url);
          if (cancelled) return;
          if ("subject" in result) {
            setSignedIn(result);
            setParticipantId(result.subject);
            try {
              setLastParticipantId(writeLastParticipantId(result.subject, browserKv));
            } catch {
              setLastParticipantId(result.subject);
            }
          }
          url.searchParams.delete("code");
          url.searchParams.delete("state");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          return;
        }
        const me = await services.getMe();
        if (cancelled) return;
        if (me) {
          setSignedIn(me);
          setParticipantId(me.subject);
          try {
            setLastParticipantId(writeLastParticipantId(me.subject, browserKv));
          } catch {
            setLastParticipantId(me.subject);
          }
        }
      } catch (error: unknown) {
        if (!cancelled) setAuthError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiEnabled, services, browserKv]);

  useEffect(() => {
    if (!state.ended || !session || !shouldPersistSession(session)) return;
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
          await services.enqueueUpload({
            session,
            participantId: signedIn?.subject ?? participantId ?? DEMO_LOCAL_IDENTITY.subject,
            assignmentId: `assign-${signedIn?.subject ?? participantId ?? DEMO_LOCAL_IDENTITY.subject}`,
          });
        } catch (error) {
          if (cancelled) return;
          setSaveError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.ended, session, store, services, apiEnabled, signedIn, participantId]);

  useEffect(() => {
    if (screen === "history" || screen === "my-profile") {
      void store.load().then(setStored);
      void services.sessionActivity().then(setActivity);
    }
  }, [screen, store, services]);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (screen.endsWith("-task")) return;
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

  const participantLabel = sessionAliasForParticipant(signedIn?.subject ?? participantId);
  const start = (input: InputModality, variant: LayoutVariant) =>
    dispatch({
      type: "start",
      session: createSession({ alias: participantLabel, input, viewport: currentViewport() }),
      variant,
    });
  const onTrial = useCallback((trial: TrialRecord) => dispatch({ type: "trial-finished", trial }), []);
  const onPractice = useCallback((trial: TrialRecord) => dispatch({ type: "practice-finished", trial }), []);
  const home = () => dispatch({ type: "home" });
  const go = (s: Screen) => dispatch({ type: "go", screen: s });
  const saveRun = useCallback(
    (s: SessionRecord) => {
      if (!shouldPersistSession(s)) return;
      void (async () => {
        const result = await store.save(s);
        setSaveError(result.error);
        setStored(await store.load());
        if (shouldEnqueueUpload({ ended: true, session: s, apiEnabled }) && !enqueued.current.has(s.id)) {
          enqueued.current.add(s.id);
          try {
            await services.enqueueUpload({
              session: s,
              participantId: signedIn?.subject ?? participantId ?? DEMO_LOCAL_IDENTITY.subject,
              assignmentId: `assign-${signedIn?.subject ?? participantId ?? DEMO_LOCAL_IDENTITY.subject}`,
            });
          } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error));
          }
        }
      })();
    },
    [store, services, apiEnabled, signedIn, participantId],
  );

  const trial = useMemo(() => {
    if (!session) return null;
    if (screen === "target-task") return newTargetSelectionTrial(session, state.variant, currentViewport());
    if (screen === "line-task") return newLineTrial(session, state.lineIndex, currentViewport());
    if (screen === "practice-task" && state.practice) return newPracticeTrial(session, state.practice.layout, currentViewport());
    return null;
  }, [screen, state.lineIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const inAssessment = ["target-intro", "target-task", "line-intro", "line-task"].includes(screen);
  const focusMode = inAssessment || checkRunning || screen === "practice-task";
  const steps = state.linesOnly ? LINE_STEPS : ASSESSMENT_STEPS;
  const stepIndex = steps.findIndex((s) => s.screens.includes(screen));
  const cue = state.practice?.config;
  const showPrimaryNav = !focusMode && !inAssessment;
  const centerNavOn: Screen | null = screen === "home" || screen === "history" ? screen : null;
  const exportId = participantIdForExport({
    signedInParticipantId: signedIn?.subject ?? null,
    activeProfileId: stored.sessions[0]?.profileId ?? null,
  });

  const applySignedIn = (me: Me) => {
    setSignedIn(me);
    setParticipantId(me.subject);
    try {
      setLastParticipantId(writeLastParticipantId(me.subject, browserKv));
    } catch {
      setLastParticipantId(me.subject);
    }
    setAuthError(null);
  };

  const onParticipantStart = (id: string) => {
    setAuthBusy(true);
    setAuthError(null);
    void services
      .signInLocal({ subject: id, orgId: LOCAL_ORG_ID })
      .then(applySignedIn)
      .catch((error: unknown) => {
        setAuthError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setAuthBusy(false));
  };

  const onSwitchParticipant = () => {
    void services.signOut().finally(() => {
      setSignedIn(null);
      setParticipantId(null);
      setStored({ sessions: [], rejected: 0, error: null });
      setActivity([]);
      dispatch({ type: "home" });
    });
  };

  const onSignIn = () => {
    if (localIdentity) {
      setAuthReady(true);
      return;
    }
    void services.beginSignIn().then((redirect) => {
      window.location.assign(redirect.url);
    });
  };

  const needsParticipant = localIdentity && authReady && !signedIn;
  const checkingAuth = localIdentity && !authReady;

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

        {needsParticipant || checkingAuth ? (
          <div className="topbar-center-spacer" aria-hidden />
        ) : inAssessment ? (
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
            <button type="button" className={centerNavOn === "history" ? "on" : ""} onClick={() => go("history")}>
              History
            </button>
          </nav>
        ) : (
          <div className="topbar-center-spacer" aria-hidden />
        )}

        {!focusMode && (
          <div className="topbar-right">
            {apiEnabled &&
              signedIn && (
                <>
                  <span className="small">{signedIn.subject}</span>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      void services.signOut().then(() => {
                        setSignedIn(null);
                        if (localIdentity) setParticipantId(null);
                      })
                    }
                  >
                    Sign out
                  </button>
                </>
              )}
            {apiEnabled && !signedIn && !localIdentity && (
              <button type="button" onClick={onSignIn}>
                Sign in
              </button>
            )}
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
            {!needsParticipant && !checkingAuth && (
              <ProfileMenu
                initials={signedIn?.subject ? signedIn.subject.slice(0, 2).toUpperCase() : avatarInitials(stored.sessions)}
                onMyProfile={() => go("my-profile")}
                onClinicianDashboard={() => go("profile")}
                onSwitchParticipant={localIdentity && signedIn ? onSwitchParticipant : undefined}
              />
            )}
          </div>
        )}
      </header>

      <main ref={main} tabIndex={-1} key={needsParticipant ? "participant-start" : checkingAuth ? "auth-check" : screen} className="screen">
        {authError && !needsParticipant && (
          <p className="notice error" role="alert">
            {authError}
          </p>
        )}
        {checkingAuth && (
          <section className="intro card narrow">
            <h1>Opening session</h1>
            <p className="lede">Checking this browser for a signed-in participant.</p>
          </section>
        )}
        {needsParticipant && (
          <ParticipantStart
            initialId={lastParticipantId}
            busy={authBusy}
            error={authError}
            onSubmit={onParticipantStart}
          />
        )}
        {!needsParticipant && !checkingAuth && (
        <>
        {apiEnabled && queue.pending + queue.uploading + queue.blocked > 0 && (
          <p className="notice" role="status">
            Upload queue: {queue.pending} queued, {queue.uploading} uploading, {queue.blocked} blocked, {queue.acknowledged} sent.
          </p>
        )}
        {screen === "home" && (
          <Home
            onStart={start}
            onHistory={() => go("history")}
            onProfile={() => go("my-profile")}
            apiEnabled={apiEnabled}
            onDemo={() => go("demo")}
          />
        )}
        {screen === "assessment" && (
          <BatteryPage from="starry" alias={participantLabel} onHome={home} onRunning={setCheckRunning} onSave={saveRun} />
        )}
        {screen === "starry" && (
          <BatteryPage from="starry" alias={participantLabel} onHome={home} onRunning={setCheckRunning} onSave={saveRun} />
        )}
        {screen === "rings" && (
          <BatteryPage from="rings" alias={participantLabel} onHome={home} onRunning={setCheckRunning} onSave={saveRun} />
        )}
        {screen === "lines" && (
          <BatteryPage from="lines" alias={participantLabel} onHome={home} onRunning={setCheckRunning} onSave={saveRun} />
        )}
        {screen === "demo" && <BatteryPage from="starry" demo onHome={home} onRunning={setCheckRunning} />}
        {screen === "scene" && <HiddenScenePage onHome={home} onRunning={setCheckRunning} />}
        {screen === "target-intro" && session && <TargetIntro input={session.input} onBegin={() => go("target-task")} onCancel={home} />}
        {screen === "target-task" && session && trial && (
          <TaskRunner
            key={trial.id}
            sessionId={session.id}
            trial={trial}
            timeLimitMs={TIME_LIMIT_MS["target-selection"]}
            eyebrow={scoredBatteryStep("rings")}
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
            eyebrow={scoredBatteryStep("lines")}
            title={`Mark the middle of line ${state.lineIndex + 1} of ${LINE_BISECTION_TRIAL_COUNT}`}
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
            activity={activity}
            onOpen={(s) => dispatch({ type: "open", session: s })}
            onDelete={async (id) => {
              const result = await store.remove(id);
              setSaveError(result.error);
              setStored(await store.load());
            }}
            onHome={home}
            onClinicianDashboard={() => go("profile")}
            apiEnabled={apiEnabled}
            processing={processing}
            queue={queue}
            actionError={actionError}
            onExport={apiEnabled ? () => void onExport() : undefined}
            onDeleteParticipant={apiEnabled ? () => void onDeleteParticipant() : undefined}
          />
        )}
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
        </>
        )}
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
