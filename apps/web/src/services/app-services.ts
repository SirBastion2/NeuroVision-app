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
import {
  createApiClient,
  type ApiClient,
  type DeleteResult,
  type ExportResult,
  type HealthResult,
  type ProcessingSnapshot,
  type PutSessionInput,
  type SessionResource,
  type TraceUploadRequest,
  type TraceUploadResult,
} from "./api-client";
import { resolveHistoryStore, type HistoryStore } from "./history-store";
import { createOidcClient, type AuthorizationRedirect, type OidcClient, type OidcToken } from "./oidc";
import { getBrowserKeyValueStore, type KeyValueStore, type PackageStoreFactory } from "./package-store";
import { deleteParticipant, exportParticipant, pollProcessingState, type PollProcessingOptions } from "./processing";
import { readRuntimeConfig, type WebRuntimeConfig } from "./runtime-config";

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
  config?: WebRuntimeConfig;
  standalone?: boolean;
  keyValueStore?: KeyValueStore | null;
  packageStoreFactory?: PackageStoreFactory | null;
  api?: ApiClient;
  oidc?: OidcClient;
  fetch?: typeof fetch;
}

export interface AppServices {
  readonly storeKind: HistoryStore["kind"];
  readonly contractsVersion: string;
  readonly apiEnabled: boolean;
  readonly api: ApiClient;
  readonly oidc: OidcClient;
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
  health(): Promise<HealthResult>;
  uploadSession(input: PutSessionInput): Promise<SessionResource>;
  uploadTrace(sessionId: string, request: TraceUploadRequest, bytes: Uint8Array): Promise<TraceUploadResult>;
  pollProcessingState(sessionId: string, options?: PollProcessingOptions): Promise<ProcessingSnapshot>;
  exportParticipant(participantId: string): Promise<ExportResult>;
  deleteParticipant(participantId: string, input?: { confirm?: true }): Promise<DeleteResult>;
  beginOidcRedirect(): Promise<AuthorizationRedirect>;
  completeOidcCallback(url: string | URL): Promise<OidcToken>;
  getAccessToken(): string | null;
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
  const config = options.config ?? readRuntimeConfig();
  const standalone = options.standalone ?? config.standalone;
  const store = resolveHistoryStore({
    preferred: options.store,
    standalone,
    keyValueStore: options.keyValueStore === undefined ? getBrowserKeyValueStore() : options.keyValueStore,
    packageStoreFactory: options.packageStoreFactory,
  });
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => crypto.randomUUID());
  const oidc =
    options.oidc ??
    createOidcClient({
      config: standalone ? null : config.oidc,
      fetch: options.fetch,
    });
  const api =
    options.api ??
    createApiClient({
      baseUrl: config.apiBaseUrl,
      standalone,
      fetch: options.fetch,
      getAccessToken: () => oidc.getAccessToken(),
    });

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
    apiEnabled: api.enabled,
    api,
    oidc,

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

    health() {
      return api.health();
    },

    uploadSession(input) {
      return api.putSession(input);
    },

    uploadTrace(sessionId, request, bytes) {
      return api.uploadTrace(sessionId, request, bytes);
    },

    pollProcessingState(sessionId, pollOptions) {
      return pollProcessingState(api, sessionId, pollOptions);
    },

    exportParticipant(participantId) {
      return exportParticipant(api, participantId);
    },

    deleteParticipant(participantId, input) {
      return deleteParticipant(api, participantId, input);
    },

    beginOidcRedirect() {
      return oidc.buildAuthorizationUrl();
    },

    completeOidcCallback(url) {
      return oidc.handleCallback(url);
    },

    getAccessToken() {
      return oidc.getAccessToken();
    },
  };
}
