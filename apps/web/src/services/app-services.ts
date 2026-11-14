import {
  classifyResponse,
  configurePracticeRound,
  CONTRACTS_VERSION,
  createLineBisectionLayout,
  createTargetSelectionLayout,
  DEMONSTRATION_SESSIONS,
  EXAMPLE_CALIBRATION_REPORT,
  GAZE_LAB_CLICK_SEQUENCE,
  GAZE_LAB_FIXTURE,
  GAZE_LAB_STREAMS,
  LINE_BISECTION_LINES,
  PRACTICE_RULES_VERSION,
  PROTOCOL_ID,
  reflectPracticeRound,
  SCORER_ID,
  scoreSession,
  summarizeAssessmentTrend,
  areSessionsComparable,
  describeViewport,
  type AssessmentTrend,
  type InputModality,
  type LayoutVariant,
  type Point,
  type PracticeChoice,
  type PracticeReflection,
  type PracticeRoundSetup,
  type PracticeSuggestion,
  type ScoringResult,
  type SessionRecord,
  type TargetSelectionScore,
  type TrialEndReason,
  type TrialRecord,
  type Viewport,
} from "@neurovision/domain";
import {
  GAZE_ANALYSIS_VERSION,
  labTraceToDomainStream,
  simulatedTrace,
} from "@neurovision/gaze";
import { resolveHistoryStore, type HistoryStore } from "./history-store";

const DEFAULT_VIEWPORT: Viewport = describeViewport(1280, 900);
const GAZE_LAB_DURATION_MS = 22_000;

export interface StartSessionInput {
  alias?: string;
  profileId?: string;
  input?: InputModality;
  viewport?: Viewport;
  variant?: LayoutVariant;
  id?: string;
  startedAt?: string;
}

export interface GazeLabData {
  clicks: typeof GAZE_LAB_CLICK_SEQUENCE;
  streams: typeof GAZE_LAB_STREAMS;
  calibration: typeof EXAMPLE_CALIBRATION_REPORT;
  fixture: typeof GAZE_LAB_FIXTURE;
  analysisVersion: string;
  simulated: {
    leftBiased: ReturnType<typeof labTraceToDomainStream>;
    bothHalves: ReturnType<typeof labTraceToDomainStream>;
  };
}

export interface ComparableHistory {
  sessions: SessionRecord[];
  trend: AssessmentTrend;
}

export interface CreateAppServicesOptions {
  store?: HistoryStore;
  now?: () => Date;
  createId?: () => string;
}

export interface AppServices {
  readonly storeKind: HistoryStore["kind"];
  readonly contractsVersion: string;
  startSession(input?: StartSessionInput): SessionRecord;
  recordClick(session: SessionRecord, trialId: string, point: Point, elapsed: number): SessionRecord;
  recordTrialClick(trial: TrialRecord, sessionId: string, point: Point, elapsed: number): TrialRecord;
  finishTrial(session: SessionRecord, trialId: string, end: TrialEndReason, duration: number): SessionRecord;
  finishStandaloneTrial(trial: TrialRecord, end: TrialEndReason, duration: number): TrialRecord;
  completeSession(session: SessionRecord, input?: { completedAt?: string }): SessionRecord;
  score(session: SessionRecord): ScoringResult;
  save(session: SessionRecord): Promise<SessionRecord>;
  load(id: string): Promise<SessionRecord | null>;
  listHistory(): Promise<SessionRecord[]>;
  comparableHistory(sessions?: readonly SessionRecord[]): Promise<ComparableHistory>;
  sessionsComparable(a: SessionRecord, b: SessionRecord): boolean;
  loadDemonstrationSessions(): readonly SessionRecord[];
  seedDemonstrationHistory(): Promise<SessionRecord[]>;
  loadGazeLabData(): GazeLabData;
  configurePractice(choice: PracticeChoice, suggested?: PracticeSuggestion | null): PracticeRoundSetup;
  startPracticeTrial(session: SessionRecord, choice: PracticeChoice): { trial: TrialRecord; setup: PracticeRoundSetup };
  appendPracticeRound(session: SessionRecord, trial: TrialRecord, config: PracticeSuggestion): SessionRecord;
  reflectPractice(trial: TrialRecord, assessment?: TargetSelectionScore | null): PracticeReflection;
}

function emptyDecision(): PracticeSuggestion {
  return {
    version: PRACTICE_RULES_VERSION,
    cue: "none",
    density: "standard",
    level: 0,
    explanation: "",
    metrics: null,
    override: null,
  };
}

function emptyTrial(input: {
  id: string;
  task: TrialRecord["task"];
  layout: TrialRecord["layout"];
  line?: TrialRecord["line"];
  modality: InputModality;
  viewport: Viewport;
}): TrialRecord {
  return {
    id: input.id,
    task: input.task,
    layout: input.layout,
    line: input.line,
    events: [],
    duration: 0,
    end: "skip",
    input: input.modality,
    viewport: input.viewport,
  };
}

function trialById(session: SessionRecord, trialId: string): TrialRecord {
  const trial = session.trials.find((item) => item.id === trialId);
  if (!trial) {
    throw new Error(`Unknown trial ${trialId}`);
  }
  return trial;
}

function replaceTrial(session: SessionRecord, trial: TrialRecord): SessionRecord {
  if (!session.trials.some((item) => item.id === trial.id)) {
    throw new Error(`Unknown trial ${trial.id}`);
  }
  return {
    ...session,
    trials: session.trials.map((item) => (item.id === trial.id ? trial : item)),
  };
}

export function createAppServices(options: CreateAppServicesOptions = {}): AppServices {
  const store = resolveHistoryStore(options.store);
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => crypto.randomUUID());

  const recordTrialClick = (
    trial: TrialRecord,
    sessionId: string,
    point: Point,
    elapsed: number,
  ): TrialRecord => {
    const event = classifyResponse({
      sessionId,
      trialId: trial.id,
      task: trial.task,
      layout: trial.layout,
      line: trial.line,
      existing: trial.events,
      point,
      elapsed,
    });
    return { ...trial, events: [...trial.events, event] };
  };

  const finishStandaloneTrial = (
    trial: TrialRecord,
    end: TrialEndReason,
    duration: number,
  ): TrialRecord => ({ ...trial, end, duration });

  return {
    storeKind: store.kind,
    contractsVersion: CONTRACTS_VERSION,

    startSession(input: StartSessionInput = {}): SessionRecord {
      const id = input.id ?? createId();
      const startedAt = input.startedAt ?? now().toISOString();
      const viewport = input.viewport ?? DEFAULT_VIEWPORT;
      const modality = input.input ?? "mouse-trackpad";
      const targetLayout = createTargetSelectionLayout(input.variant ?? "fixed-a");
      const targetTrial = emptyTrial({
        id: `${id}-target`,
        task: "target-selection",
        layout: targetLayout,
        modality,
        viewport,
      });
      const lineTrials = LINE_BISECTION_LINES.map((_, index) => {
        const { layout, line } = createLineBisectionLayout(index);
        return emptyTrial({
          id: `${id}-line-${index}`,
          task: "line-bisection",
          layout,
          line,
          modality,
          viewport,
        });
      });
      return {
        id,
        profileId: input.profileId ?? "local",
        alias: input.alias ?? "Assessment",
        source: "live",
        protocol: PROTOCOL_ID,
        scorer: SCORER_ID,
        taskIds: ["target-selection", "line-bisection"],
        status: "incomplete",
        input: modality,
        viewport,
        startedAt,
        completedAt: startedAt,
        trials: [targetTrial, ...lineTrials],
        practice: [],
        decision: emptyDecision(),
        pointerSampling: false,
        calibration: null,
      };
    },

    recordClick(session, trialId, point, elapsed) {
      return replaceTrial(session, recordTrialClick(trialById(session, trialId), session.id, point, elapsed));
    },

    recordTrialClick,

    finishTrial(session, trialId, end, duration) {
      return replaceTrial(session, finishStandaloneTrial(trialById(session, trialId), end, duration));
    },

    finishStandaloneTrial,

    completeSession(session, input = {}) {
      const completedAt = input.completedAt ?? now().toISOString();
      const next: SessionRecord = {
        ...session,
        status: "complete",
        completedAt,
      };
      next.decision = scoreSession(next).practice;
      return next;
    },

    score: scoreSession,

    save(session) {
      return store.save(session);
    },

    load(id) {
      return store.load(id);
    },

    listHistory() {
      return store.list();
    },

    async comparableHistory(sessions) {
      const list = sessions ? [...sessions] : await store.list();
      return {
        sessions: list,
        trend: summarizeAssessmentTrend(list),
      };
    },

    sessionsComparable: areSessionsComparable,

    loadDemonstrationSessions() {
      return DEMONSTRATION_SESSIONS;
    },

    async seedDemonstrationHistory() {
      for (const session of DEMONSTRATION_SESSIONS) {
        await store.save(session);
      }
      return store.list();
    },

    loadGazeLabData() {
      return {
        clicks: GAZE_LAB_CLICK_SEQUENCE,
        streams: GAZE_LAB_STREAMS,
        calibration: EXAMPLE_CALIBRATION_REPORT,
        fixture: GAZE_LAB_FIXTURE,
        analysisVersion: GAZE_ANALYSIS_VERSION,
        simulated: {
          leftBiased: labTraceToDomainStream(
            "lab-left",
            "SIMULATED LAB — left-biased",
            simulatedTrace(false, GAZE_LAB_DURATION_MS),
          ),
          bothHalves: labTraceToDomainStream(
            "lab-wide",
            "SIMULATED LAB — both halves",
            simulatedTrace(true, GAZE_LAB_DURATION_MS),
          ),
        },
      };
    },

    configurePractice: configurePracticeRound,

    startPracticeTrial(session, choice) {
      const setup = configurePracticeRound(choice, scoreSession(session).practice);
      const trial = emptyTrial({
        id: `${session.id}-practice-${session.practice.length + 1}`,
        task: "target-selection",
        layout: setup.layout,
        modality: session.input,
        viewport: session.viewport,
      });
      return { trial, setup };
    },

    appendPracticeRound(session, trial, config) {
      return {
        ...session,
        practice: [...session.practice, { trial, config }],
      };
    },

    reflectPractice: reflectPracticeRound,
  };
}
