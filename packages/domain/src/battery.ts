import { bisectionObservation, type BisectionLine, type BisectionResponse } from "./bisection.js";
import { scoreClock, type ClockErrorType, type ClockFace, type ClockNumeral, type ClockResponse, type ClockScore, type ClockSide, type ClockTrial, type StackPosition } from "./clock.js";
import {
  combineEvidence,
  scoringNormsFromSamples,
  type EvidenceResult,
  type ModelIndexSample,
  type ModelTestId,
  type TestId,
  type TestNorm,
  type TestObservation,
} from "./evidence.js";
import { greyscalesNormFor, scoreGreyscales, type BarPosition, type DarkSide, type GreyscalesResponse, type GreyscalesScore, type GreyscalesTrial, type ReadingDirection } from "./greyscales.js";
import { isFiniteNumber, isInteger, isIsoTimestamp, isNonEmptyString, isObject, isOneOf, parseFail } from "./guard.js";
import { generateScene, scoreScene, type HideSide, type SceneScore, type SceneTap } from "./scene.js";
import { cancellationObservationFromCounts } from "./scoring.js";
import { SESSION_SOURCES, type SessionSource } from "./session.js";
import { starryObservationFromCounts } from "./starry.js";

export const BATTERY_CONTRACT_VERSION = "battery-1.0.0";

export const BATTERY_MODES = ["demo", "full"] as const;
export type BatteryMode = (typeof BATTERY_MODES)[number];

const HIDE_SIDES: readonly HideSide[] = ["left", "right", "none"];
const READING_DIRECTIONS: readonly ReadingDirection[] = ["left-to-right", "right-to-left", "both-or-other"];
const CLOCK_SIDES: readonly ClockSide[] = ["left", "right"];
const CLOCK_ERROR_TYPES: readonly ClockErrorType[] = ["swap", "missing", "shift"];
const STACK_POSITIONS: readonly StackPosition[] = ["top", "bottom"];
const DARK_SIDES: readonly DarkSide[] = ["left", "right"];
const BAR_POSITIONS: readonly BarPosition[] = ["top", "bottom"];
const TEST_IDS: readonly TestId[] = ["scene", "clock", "greyscales", "bisection", "detection", "cancellation"];
const NORM_SOURCES: readonly TestNorm["source"][] = ["hacker-norms", "literature", "assumed", "fitted", "uncalibrated"];
const BISECTION_ERROR_COUNT = 5;

export interface SideHitCounts {
  hits: number;
  targets: number;
}

export interface SideOmissionCounts {
  omissions: number;
  targets: number;
}

export interface DetectionCounts {
  left: SideHitCounts;
  right: SideHitCounts;
}

export interface CancellationCounts {
  left: SideOmissionCounts;
  right: SideOmissionCounts;
}

export interface BatteryRecord {
  contract: typeof BATTERY_CONTRACT_VERSION;
  id: string;
  mode: BatteryMode;
  hide: HideSide;
  seed: number;
  readingDirection: ReadingDirection | null;
  consent: boolean;
  source: SessionSource;
  startedAt: string;
  completedAt: string;
  scene: { taps: SceneTap[] };
  clock: { trials: ClockTrial[]; responses: ClockResponse[] };
  greyscales: { trials: GreyscalesTrial[]; responses: GreyscalesResponse[] } | null;
  bisection: { lines: BisectionLine[]; responses: BisectionResponse[] } | null;
  /** Per-side hits/targets for Starry Night Eq. (1). Null when the test was not run. */
  detection: DetectionCounts | null;
  /** Per-side omissions/targets for Hollow Rings Eq. (1). Null when the test was not run. */
  cancellation: CancellationCounts | null;
  /** True when this run is a healthy-control sample for Eq. (9) fitting. */
  healthyControl: boolean;
  /** True when this run is a synthetic test fixture, not a field session. */
  fixture: boolean;
  normsUsed: Partial<Record<TestId, TestNorm>>;
}

export interface BatteryScore {
  scene: SceneScore;
  clock: ClockScore;
  greyscales: GreyscalesScore | null;
  bisection: { errors: number[]; observation: TestObservation } | null;
  detection: TestObservation | null;
  cancellation: TestObservation | null;
  evidence: EvidenceResult;
}

function parseSceneTap(value: unknown): SceneTap {
  if (!isObject(value) || !isFiniteNumber(value.t) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    parseFail("battery record");
  }
  return { t: value.t, x: value.x, y: value.y };
}

function parseClockNumeral(value: unknown): ClockNumeral {
  if (!isObject(value) || typeof value.label !== "string" || !isFiniteNumber(value.angleDeg) || !isFiniteNumber(value.radius)) {
    parseFail("battery record");
  }
  return { label: value.label, angleDeg: value.angleDeg, radius: value.radius };
}

function parseClockFace(value: unknown): ClockFace {
  if (!isObject(value) || !Array.isArray(value.numerals) || !isFiniteNumber(value.hourAngle) || !isFiniteNumber(value.minuteAngle)) {
    parseFail("battery record");
  }
  return {
    numerals: value.numerals.map(parseClockNumeral),
    hourAngle: value.hourAngle,
    minuteAngle: value.minuteAngle,
  };
}

function parseClockTrial(value: unknown): ClockTrial {
  if (
    !isObject(value) ||
    !isNonEmptyString(value.id) ||
    !isOneOf(value.errorSide, CLOCK_SIDES) ||
    !isOneOf(value.errorType, CLOCK_ERROR_TYPES) ||
    typeof value.errorDetail !== "string" ||
    !isOneOf(value.correctPosition, STACK_POSITIONS) ||
    !isObject(value.time) ||
    !isFiniteNumber(value.time.h) ||
    !isFiniteNumber(value.time.m)
  ) {
    parseFail("battery record");
  }
  return {
    id: value.id,
    errorSide: value.errorSide,
    errorType: value.errorType,
    errorDetail: value.errorDetail,
    correctPosition: value.correctPosition,
    correct: parseClockFace(value.correct),
    faulty: parseClockFace(value.faulty),
    time: { h: value.time.h, m: value.time.m },
  };
}

function parseClockResponse(value: unknown): ClockResponse {
  if (
    !isObject(value) ||
    !isNonEmptyString(value.trialId) ||
    !(value.choice === null || isOneOf(value.choice, STACK_POSITIONS)) ||
    !(value.rtMs === null || isFiniteNumber(value.rtMs))
  ) {
    parseFail("battery record");
  }
  return { trialId: value.trialId, choice: value.choice, rtMs: value.rtMs };
}

function parseGreyscalesTrial(value: unknown): GreyscalesTrial {
  if (!isObject(value) || !isNonEmptyString(value.id) || !isOneOf(value.topDarkSide, DARK_SIDES)) {
    parseFail("battery record");
  }
  return { id: value.id, topDarkSide: value.topDarkSide };
}

function parseGreyscalesResponse(value: unknown): GreyscalesResponse {
  if (
    !isObject(value) ||
    !isNonEmptyString(value.trialId) ||
    !(value.choice === null || isOneOf(value.choice, BAR_POSITIONS)) ||
    !(value.rtMs === null || isFiniteNumber(value.rtMs))
  ) {
    parseFail("battery record");
  }
  return { trialId: value.trialId, choice: value.choice, rtMs: value.rtMs };
}

function parseBisectionLine(value: unknown): BisectionLine {
  if (!isObject(value) || !isNonEmptyString(value.id) || !isFiniteNumber(value.x1) || !isFiniteNumber(value.x2) || !isFiniteNumber(value.y)) {
    parseFail("battery record");
  }
  return { id: value.id, x1: value.x1, x2: value.x2, y: value.y };
}

function parseBisectionResponse(value: unknown): BisectionResponse {
  if (!isObject(value) || !isNonEmptyString(value.lineId) || !(value.x === null || isFiniteNumber(value.x))) {
    parseFail("battery record");
  }
  return { lineId: value.lineId, x: value.x };
}

function parseOptionalFinite(value: unknown): number | null {
  if (value === null) return null;
  if (!isFiniteNumber(value)) parseFail("battery record");
  return value;
}

function parseNormSample(value: unknown): NonNullable<TestNorm["sample"]> {
  if (!isObject(value) || typeof value.ageRange !== "string") parseFail("battery record");
  const sample: NonNullable<TestNorm["sample"]> = { ageRange: value.ageRange };
  if (value.n !== undefined) {
    if (!isFiniteNumber(value.n)) parseFail("battery record");
    sample.n = value.n;
  }
  if (value.notes !== undefined) {
    if (typeof value.notes !== "string") parseFail("battery record");
    sample.notes = value.notes;
  }
  return sample;
}

function parseNormCitation(value: unknown): NonNullable<TestNorm["citation"]> {
  if (
    !isObject(value) ||
    typeof value.authors !== "string" ||
    !isFiniteNumber(value.year) ||
    typeof value.title !== "string" ||
    typeof value.journal !== "string" ||
    typeof value.doi !== "string" ||
    typeof value.url !== "string"
  ) {
    parseFail("battery record");
  }
  return {
    authors: value.authors,
    year: value.year,
    title: value.title,
    journal: value.journal,
    doi: value.doi,
    url: value.url,
  };
}

function parseTestNorm(value: unknown): TestNorm {
  if (!isObject(value) || !isFiniteNumber(value.sensitivity) || !isOneOf(value.source, NORM_SOURCES)) {
    parseFail("battery record");
  }
  const uncalibrated = value.source === "uncalibrated";
  const mean = uncalibrated ? parseOptionalFinite(value.mean ?? null) : parseOptionalFinite(value.mean);
  const healthySd = uncalibrated ? parseOptionalFinite(value.healthySd ?? null) : parseOptionalFinite(value.healthySd);
  if (!uncalibrated && (mean == null || healthySd == null)) parseFail("battery record");
  const norm: TestNorm = {
    mean,
    healthySd,
    sensitivity: value.sensitivity,
    source: value.source,
  };
  if (value.note !== undefined) {
    if (typeof value.note !== "string") parseFail("battery record");
    norm.note = value.note;
  }
  if (value.calibrated !== undefined) {
    if (typeof value.calibrated !== "boolean") parseFail("battery record");
    norm.calibrated = value.calibrated;
  }
  if (value.cutoff !== undefined) {
    norm.cutoff = parseOptionalFinite(value.cutoff);
  }
  if (value.sample !== undefined) {
    norm.sample = value.sample === null ? null : parseNormSample(value.sample);
  }
  if (value.citation !== undefined) {
    norm.citation = value.citation === null ? null : parseNormCitation(value.citation);
  }
  return norm;
}

function parseNormsUsed(value: unknown): Partial<Record<TestId, TestNorm>> {
  if (!isObject(value)) parseFail("battery record");
  const norms: Partial<Record<TestId, TestNorm>> = {};
  for (const key of Object.keys(value)) {
    if (!isOneOf(key, TEST_IDS)) parseFail("battery record");
    norms[key] = parseTestNorm(value[key]);
  }
  return norms;
}

function parseSceneBlock(value: unknown): BatteryRecord["scene"] {
  if (!isObject(value) || !Array.isArray(value.taps)) parseFail("battery record");
  return { taps: value.taps.map(parseSceneTap) };
}

function parseClockBlock(value: unknown): BatteryRecord["clock"] {
  if (!isObject(value) || !Array.isArray(value.trials) || !Array.isArray(value.responses)) parseFail("battery record");
  return {
    trials: value.trials.map(parseClockTrial),
    responses: value.responses.map(parseClockResponse),
  };
}

function parseGreyscalesBlock(value: unknown): BatteryRecord["greyscales"] {
  if (value === null) return null;
  if (!isObject(value) || !Array.isArray(value.trials) || !Array.isArray(value.responses)) parseFail("battery record");
  return {
    trials: value.trials.map(parseGreyscalesTrial),
    responses: value.responses.map(parseGreyscalesResponse),
  };
}

function parseBisectionBlock(value: unknown): BatteryRecord["bisection"] {
  if (value === null) return null;
  if (!isObject(value) || !Array.isArray(value.lines) || !Array.isArray(value.responses)) parseFail("battery record");
  return {
    lines: value.lines.map(parseBisectionLine),
    responses: value.responses.map(parseBisectionResponse),
  };
}

function parseCount(value: unknown, key: "hits" | "omissions" | "targets"): number {
  if (!isInteger(value) || value < 0) parseFail("battery record");
  if (key === "targets" && value === 0) parseFail("battery record");
  return value;
}

function parseSideHits(value: unknown): SideHitCounts {
  if (!isObject(value)) parseFail("battery record");
  const hits = parseCount(value.hits, "hits");
  const targets = parseCount(value.targets, "targets");
  if (hits > targets) parseFail("battery record");
  return { hits, targets };
}

function parseSideOmissions(value: unknown): SideOmissionCounts {
  if (!isObject(value)) parseFail("battery record");
  const omissions = parseCount(value.omissions, "omissions");
  const targets = parseCount(value.targets, "targets");
  if (omissions > targets) parseFail("battery record");
  return { omissions, targets };
}

function parseDetectionBlock(value: unknown): DetectionCounts | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) parseFail("battery record");
  return { left: parseSideHits(value.left), right: parseSideHits(value.right) };
}

function parseCancellationBlock(value: unknown): CancellationCounts | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) parseFail("battery record");
  return { left: parseSideOmissions(value.left), right: parseSideOmissions(value.right) };
}

function parseFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") parseFail("battery record");
  return value;
}

export function isBatteryRecord(value: unknown): value is BatteryRecord {
  try {
    parseBatteryRecord(value);
    return true;
  } catch {
    return false;
  }
}

export function parseBatteryRecord(value: unknown): BatteryRecord {
  if (!isObject(value)) parseFail("battery record");
  if (value.contract !== BATTERY_CONTRACT_VERSION) parseFail("battery record");
  if (!isNonEmptyString(value.id)) parseFail("battery record");
  if (!isOneOf(value.mode, BATTERY_MODES)) parseFail("battery record");
  if (!isOneOf(value.hide, HIDE_SIDES)) parseFail("battery record");
  if (!isFiniteNumber(value.seed)) parseFail("battery record");
  if (!(value.readingDirection === null || isOneOf(value.readingDirection, READING_DIRECTIONS))) parseFail("battery record");
  if (typeof value.consent !== "boolean") parseFail("battery record");
  if (!isOneOf(value.source, SESSION_SOURCES)) parseFail("battery record");
  if (!isIsoTimestamp(value.startedAt)) parseFail("battery record");
  if (!isIsoTimestamp(value.completedAt)) parseFail("battery record");
  if (value.mode === "demo" && value.source === "live") parseFail("battery record");

  return {
    contract: BATTERY_CONTRACT_VERSION,
    id: value.id,
    mode: value.mode,
    hide: value.hide,
    seed: value.seed,
    readingDirection: value.readingDirection,
    consent: value.consent,
    source: value.source,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    scene: parseSceneBlock(value.scene),
    clock: parseClockBlock(value.clock),
    greyscales: parseGreyscalesBlock(value.greyscales),
    bisection: parseBisectionBlock(value.bisection),
    detection: parseDetectionBlock(value.detection),
    cancellation: parseCancellationBlock(value.cancellation),
    healthyControl: parseFlag(value.healthyControl, false),
    fixture: parseFlag(value.fixture, false),
    normsUsed: parseNormsUsed(value.normsUsed),
  };
}

export function isHealthyControlSample(record: BatteryRecord): boolean {
  return record.healthyControl && record.consent && record.mode === "full" && record.source === "live";
}

export function detectionObservationFromRecord(counts: DetectionCounts): TestObservation {
  return starryObservationFromCounts(
    { hits: counts.left.hits, n: counts.left.targets },
    { hits: counts.right.hits, n: counts.right.targets },
  );
}

export function cancellationObservationFromRecord(counts: CancellationCounts): TestObservation | null {
  return cancellationObservationFromCounts(counts.left, counts.right);
}

/** Eq. (1) indices from stored counts and the five signed bisection errors. Null if any model test is incomplete. */
export function modelIndicesFromBattery(record: BatteryRecord): ModelIndexSample | null {
  if (!record.detection || !record.cancellation || !record.bisection) return null;
  const detection = detectionObservationFromRecord(record.detection);
  const cancellation = cancellationObservationFromRecord(record.cancellation);
  const bisection = bisectionObservation(record.bisection.lines, record.bisection.responses);
  if (!cancellation || bisection.errors.length < BISECTION_ERROR_COUNT) return null;
  return {
    detection: detection.value,
    cancellation: cancellation.value,
    bisection: bisection.observation.value,
  };
}

export function applyScoringNorms(record: BatteryRecord, norms: Partial<Record<ModelTestId, TestNorm>>): BatteryRecord {
  return parseBatteryRecord({
    ...record,
    normsUsed: { ...record.normsUsed, ...norms },
  });
}

export function scoringNormsFromBatteries(records: readonly BatteryRecord[]): {
  n: number;
  source: "assumed" | "fitted";
  norms: Record<ModelTestId, TestNorm>;
} {
  const samples: ModelIndexSample[] = [];
  for (const record of records) {
    if (!isHealthyControlSample(record)) continue;
    const indices = modelIndicesFromBattery(record);
    if (indices) samples.push(indices);
  }
  const norms = scoringNormsFromSamples(samples);
  return {
    n: samples.length,
    source: samples.length >= 5 ? "fitted" : "assumed",
    norms,
  };
}

function normsFor(record: BatteryRecord): Partial<Record<TestId, TestNorm>> {
  const norms: Partial<Record<TestId, TestNorm>> = { ...record.normsUsed };
  if (record.readingDirection && norms.greyscales === undefined) {
    norms.greyscales = greyscalesNormFor(record.readingDirection);
  }
  return norms;
}

/** Recompute every test score and combined evidence from stored raw data. Never persist the result. */
export function scoreBatteryRecord(record: BatteryRecord): BatteryScore {
  const scene = generateScene({ seed: record.seed, hide: record.hide });
  const sceneScore = scoreScene(scene, record.scene.taps);
  const clockScore = scoreClock(record.clock.trials, record.clock.responses);
  const greyscalesScore = record.greyscales
    ? scoreGreyscales(record.greyscales.trials, record.greyscales.responses)
    : null;
  const bisectionScore = record.bisection
    ? bisectionObservation(record.bisection.lines, record.bisection.responses)
    : null;

  const observations: TestObservation[] = [sceneScore.observationVisible];
  if (sceneScore.observationInduced) observations.push(sceneScore.observationInduced);
  observations.push(clockScore.observation);
  if (greyscalesScore) observations.push(greyscalesScore.observation);
  if (bisectionScore) observations.push(bisectionScore.observation);
  const detection = record.detection ? detectionObservationFromRecord(record.detection) : null;
  const cancellation = record.cancellation ? cancellationObservationFromRecord(record.cancellation) : null;
  if (detection) observations.push(detection);
  if (cancellation) observations.push(cancellation);

  return {
    scene: sceneScore,
    clock: clockScore,
    greyscales: greyscalesScore,
    bisection: bisectionScore,
    detection,
    cancellation,
    evidence: combineEvidence(observations, normsFor(record)),
  };
}
