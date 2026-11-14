/**
 * Gaze module public API. See src/gaze/README.md.
 *   GazeTracker          webcam (MediaPipe) — init, calibrate, validate, start, stop, subscribe, getQuality
 *   MouseGazeSource      cursor stands in for gaze
 *   SyntheticGazeSource  scripted right-biased gaze
 *   ReplayGazeSource     replays a JSON recording (demo backup); recordGaze() makes one
 */
export * from "./types";
export { GazeTracker } from "./webcam";
export { MouseGazeSource } from "./mouse";
export { SyntheticGazeSource } from "./synthetic-source";
export { ReplayGazeSource, recordGaze, parseRecording, RECORDING_SCHEMA, type GazeRecording } from "./replay";
export { markFixations, LiveFixationDetector } from "./fixations";
export { refineSessionGaze, clickRefinementPairs } from "./refine";
export { computeValidationReport, VALIDATION_POINTS } from "./validation";
export { SMOOTHING_PRESETS } from "./filters";
