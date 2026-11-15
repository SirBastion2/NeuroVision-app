export { CONTRACTS_VERSION, PROTOCOL_ID, SCORER_ID, PRACTICE_RULES_VERSION } from "./version.js";

export {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  BOARD_MIDLINE_X,
  TARGET_HIT_RADIUS,
  LINE_Y_TOLERANCE,
  BOARD_COLUMNS_PER_SIDE,
  BOARD_ROWS,
  BOARD_CELL_ORIGIN_X,
  BOARD_CELL_ORIGIN_Y,
  BOARD_CELL_STEP_X,
  BOARD_CELL_STEP_Y,
  BOARD_REGIONS,
  sideOfX,
  verticalRegionOfY,
  regionOfPoint,
  regionOfStimulus,
  toBoardCoordinates,
  viewportClass,
  describeViewport,
  cellPosition,
  mirrorX,
} from "./board.js";
export type { BoardSide, VerticalRegion, BoardRegion, Point, BoardBox } from "./board.js";

export {
  LINE_BISECTION_LINES,
  LINE_BISECTION_TRIAL_COUNT,
  DEMO_LINE_BISECTION_LINES,
  DEMO_LINE_BISECTION_TRIAL_COUNT,
  lineBisectionLines,
  lineBisectionTrialCount,
  createTargetSelectionLayout,
  createPracticeLayout,
  createLineBisectionLayout,
  layoutVariantFamily,
  lineMidpoint,
  lineLength,
  isOnLineSegment,
} from "./layouts.js";
export type {
  StimulusKind,
  TaskKind,
  LayoutVariant,
  LayoutVariantFamily,
  BoardDensity,
  Stimulus,
  TaskLayout,
  LineSegment,
  TargetSelectionLayoutOptions,
} from "./layouts.js";

export { RESPONSE_EVENT_TYPES, sortEvents, classifyResponse } from "./events.js";
export type { ResponseEventType, ResponseEvent, ClassifyResponseInput } from "./events.js";

export {
  TIMESTAMP_BASES,
  isGazeSample,
  parseGazeSample,
  isTimestampBasis,
  isGazeSampleProvenanceRequest,
  parseGazeSampleProvenanceRequest,
  attachGazeSampleProvenance,
} from "./gaze.js";
export type {
  GazeSample,
  TrackingGap,
  GazeStream,
  CalibrationPoint,
  CalibrationQualityReport,
  TimestampBasis,
  GazeSampleProvenanceRequest,
  GazeSampleWithProvenance,
} from "./gaze.js";

export {
  ROLES,
  PARTICIPANT_ID_MIN,
  PARTICIPANT_ID_MAX,
  PARTICIPANT_ID_PATTERN,
  isRole,
  parseRole,
  isOrganization,
  parseOrganization,
  isMembership,
  parseMembership,
  isParticipant,
  parseParticipant,
  isParticipantId,
  parseParticipantId,
} from "./organization.js";
export type { Role, Organization, Membership, Participant } from "./organization.js";

export {
  EXPOSURE_STATUSES,
  isExposureStatus,
  parseExposureStatus,
  isAssignmentManifest,
  parseAssignmentManifest,
  isTaskAssignment,
  parseTaskAssignment,
  appendAssignmentRevision,
} from "./assignment.js";
export type { ExposureStatus, AssignmentManifest, TaskAssignment, AssignmentRevisionInput } from "./assignment.js";

export {
  COMPLETION_STATES,
  SYNC_STATES,
  PROCESSING_STATES,
  COMPLETION_TRANSITIONS,
  SYNC_TRANSITIONS,
  PROCESSING_TRANSITIONS,
  isCompletionState,
  parseCompletionState,
  isSyncState,
  parseSyncState,
  isProcessingState,
  parseProcessingState,
  canTransitionCompletion,
  transitionCompletion,
  canTransitionSync,
  transitionSync,
  canTransitionProcessing,
  transitionProcessing,
  isTraceUploadRequest,
  parseTraceUploadRequest,
  isBatchPayload,
  parseBatchPayload,
  batchPayloadFromSession,
} from "./ingestion.js";
export type { CompletionState, SyncState, ProcessingState, TraceUploadRequest, BatchPayload } from "./ingestion.js";

export {
  REQUESTED_MODES,
  isRequestedMode,
  parseRequestedMode,
  mapRequestedMode,
  isTransferPracticeRound,
  practiceRoundForRequestedMode,
  parseRequestedModeMapping,
} from "./mode.js";
export type { RequestedMode, RequestedModeMapping } from "./mode.js";

export {
  IMPORTED_SOURCES,
  isImportedSource,
  parseImportedSource,
  isImportedSourceProvenance,
  parseImportedSourceProvenance,
  mapImportedSource,
  sessionSourceFromImport,
} from "./import-source.js";
export type { ImportedSource, ImportedSourceProvenance } from "./import-source.js";

export {
  SESSION_SOURCES,
  SESSION_STATUSES,
  INPUT_MODALITIES,
  TRIAL_END_REASONS,
  VIEWPORT_CLASSES,
  sessionSourceLabel,
  isScoredTrialEnd,
} from "./session.js";
export type {
  SessionSource,
  SessionStatus,
  InputModality,
  TrialEndReason,
  ViewportClass,
  Viewport,
  TrialRecord,
  PracticeSuggestion,
  PracticeRound,
  SessionRecord,
  PracticeCue,
} from "./session.js";

export {
  PRACTICE_CUES,
  PRACTICE_LEVELS,
  suggestPractice,
  configurePracticeRound,
  fadePracticeCue,
} from "./practice.js";
export type { PracticeScoreInput, PracticeChoice, PracticeRoundSetup } from "./practice.js";

export { reflectPracticeRound } from "./reflection.js";
export type { PracticeReflection, PracticeVersusAssessment } from "./reflection.js";

export {
  comparabilityKey,
  sameComparabilityKey,
  areSessionsComparable,
  summarizeAssessmentTrend,
} from "./history.js";
export type {
  ComparabilityKey,
  TrendExclusionReason,
  AssessmentTrendPoint,
  AssessmentTrend,
} from "./history.js";

export {
  EXAMPLE_CALIBRATION_REPORT,
  GAZE_LAB_TRACKING_GAPS,
  GAZE_LAB_CLICK_SEQUENCE,
  GAZE_LAB_STREAMS,
  GAZE_LAB_FIXTURE,
} from "./demonstration.js";

export {
  median,
  hollowRingsLateralIndex,
  hollowRingsObservation,
  cancellationObservationFromCounts,
  scoreTargetSelection,
  scoreLineBisection,
  summarizeLineBisection,
  summarizeSpatialPattern,
  findTargetSelectionTrial,
  scoreSession,
} from "./scoring.js";
export type {
  SelectionCounts,
  OrderedHit,
  TargetSelectionScore,
  LineBisectionScore,
  LineBisectionSummary,
  SpatialPatternKind,
  SpatialPatternSummary,
  ScoringResult,
} from "./scoring.js";

export { isSessionRecord, parseSessionRecord } from "./validate.js";

export {
  combineEvidence,
  standardize,
  verdictFor,
  seProportionDiff,
  fitNorms,
  scoringNormsFromSamples,
  DEFAULT_NORMS,
  MODEL_TEST_IDS,
  isModelTest,
  ASSUMED_NORM_NOTICE,
  fittedNormNotice,
  NORM_FIT_MIN_N,
  NORM_FIT_KAPPA,
} from "./evidence.js";
export type { TestId, Hypothesis, TestNorm, TestObservation, EvidenceOptions, TestEvidence, EvidenceResult, Verdict, ModelTestId, ModelIndexSample } from "./evidence.js";
export {
  METRICS,
  DEFAULT_NORMS as PUBLISHED_NORMS,
  ASSUMED_NORM_NOTICE as PLACEHOLDER_NORM_NOTICE,
  BISECTION_SIGNED_ERROR_PCT,
  BISECTION_LATERAL_INDEX,
  GREYSCALES_LTR,
  GREYSCALES_RTL,
  GREYSCALES_OTHER,
  HOLLOW_RINGS_LATERAL_INDEX,
  HOLLOW_RINGS_OMISSION_ASYMMETRY,
  STAR_CANCELLATION_HIT_ASYMMETRY,
  STAR_CANCELLATION_COC,
  CLOCK_LATERALITY,
  STARRY_LATERALITY,
  SCENE_LATERALITY,
  GAZE_LEFT_FRACTION,
  greyscalesMetric,
  toTestNorm,
  isCalibratedNorm,
  isCalibratedMetric,
  compareToNorm,
  deviationUnit,
} from "./norms.js";
export type {
  NormSource,
  CutoffDirection,
  HealthyRangeStatus,
  NormCitation,
  NormSample,
  MetricNorm,
  HealthyRangeReading,
  TestNormShape,
  MetricId,
} from "./norms.js";
export { generateScene, scoreScene, hitTest, centerOfCancellation, SCENE_DEFAULTS } from "./scene.js";
export type { HideSide, SceneConfig, Scene, Lantern, Building, SceneWindow, SceneTap, SceneTapResult, SceneScore } from "./scene.js";
export { generateClockTrials, scoreClock, numeralAngle, CLOCK_DEFAULTS } from "./clock.js";
export type { ClockSide, ClockErrorType, StackPosition, ClockNumeral, ClockFace, ClockTrial, ClockResponse, ClockScore } from "./clock.js";
export { generateGreyscalesTrials, scoreGreyscales, chosenDarkSide, greyscalesNormFor, greyscalesHealthyRange, GREYSCALES_DEFAULTS } from "./greyscales.js";
export type { DarkSide, BarPosition, ReadingDirection, GreyscalesTrial, GreyscalesResponse, GreyscalesScore } from "./greyscales.js";
export { generateBisectionLines, signedErrorPct, bisectionObservation } from "./bisection.js";
export type { BisectionLine, BisectionResponse } from "./bisection.js";

export {
  BATTERY_CONTRACT_VERSION,
  BATTERY_MODES,
  isBatteryRecord,
  parseBatteryRecord,
  scoreBatteryRecord,
  isHealthyControlSample,
  detectionObservationFromRecord,
  cancellationObservationFromRecord,
  modelIndicesFromBattery,
  applyScoringNorms,
  scoringNormsFromBatteries,
} from "./battery.js";
export type {
  BatteryMode,
  BatteryRecord,
  BatteryScore,
  SideHitCounts,
  SideOmissionCounts,
  DetectionCounts,
  CancellationCounts,
} from "./battery.js";

export { generateStarryTrials, scoreStarry, starryObservationFromCounts, starryDurationS, STARRY_DEFAULTS } from "./starry.js";
export type { StarrySide, StarryTrial, StarryResponse, StarryPress, StarryScore, StarrySideSummary } from "./starry.js";
