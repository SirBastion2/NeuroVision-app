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
} from "./layouts.js";

export { RESPONSE_EVENT_TYPES, sortEvents, classifyResponse } from "./events.js";
export type { ResponseEventType, ResponseEvent, ClassifyResponseInput } from "./events.js";

export type { GazeSample, TrackingGap, GazeStream, CalibrationPoint, CalibrationQualityReport } from "./gaze.js";

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
  DEMONSTRATION_BALANCED,
  DEMONSTRATION_LEFT_OMISSION,
  DEMONSTRATION_RIGHT_OMISSION,
  DEMONSTRATION_SESSIONS,
  GAZE_LAB_TRACKING_GAPS,
  GAZE_LAB_CLICK_SEQUENCE,
  GAZE_LAB_STREAMS,
  GAZE_LAB_FIXTURE,
} from "./demonstration.js";

export {
  median,
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

export { combineEvidence, standardize, verdictFor, seProportionDiff, fitNorms, DEFAULT_NORMS } from "./evidence.js";
export type { TestId, Hypothesis, TestNorm, TestObservation, EvidenceOptions, TestEvidence, EvidenceResult, Verdict } from "./evidence.js";
export { generateClockTrials, scoreClock, numeralAngle, CLOCK_DEFAULTS } from "./clock.js";
export type { ClockSide, ClockErrorType, StackPosition, ClockNumeral, ClockFace, ClockTrial, ClockResponse, ClockScore } from "./clock.js";
export { generateGreyscalesTrials, scoreGreyscales, chosenDarkSide, greyscalesNormFor, GREYSCALES_DEFAULTS } from "./greyscales.js";
export type { DarkSide, BarPosition, ReadingDirection, GreyscalesTrial, GreyscalesResponse, GreyscalesScore } from "./greyscales.js";
export { generateStarryTrials, scoreStarry, starryDurationS, STARRY_DEFAULTS } from "./starry.js";
export type { StarrySide, StarryTrial, StarryResponse, StarryPress, StarryScore, StarrySideSummary } from "./starry.js";
