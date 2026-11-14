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
  lineMidpoint,
  lineLength,
  isOnLineSegment,
} from "./layouts.js";
export type {
  StimulusKind,
  TaskKind,
  LayoutVariant,
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

export { PRACTICE_CUES, PRACTICE_LEVELS, suggestPractice, fadePracticeCue } from "./practice.js";
export type { PracticeScoreInput } from "./practice.js";

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
