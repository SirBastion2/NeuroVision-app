import { useState } from "react";
import {
  BATTERY_CONTRACT_VERSION,
  DEFAULT_NORMS,
  parseBatteryRecord,
  type BatteryMode,
  type BatteryRecord,
  type BisectionLine,
  type BisectionResponse,
  type ClockResponse,
  type ClockTrial,
  type GreyscalesResponse,
  type GreyscalesTrial,
  type HideSide,
  type ReadingDirection,
  type SceneTap,
  type TestId,
  type TestNorm,
} from "@neurovision/domain";
import { createBatteryStore, memoryStore, type BatteryStore, type KeyValueStore } from "@neurovision/storage";
import { getBrowserKeyValueStore } from "../services/package-store";
import { isStandaloneRuntime } from "../services/runtime-config";

export interface BatteryIntroConfig {
  mode: BatteryMode;
  hide: HideSide;
  seed: number;
  readingDirection: ReadingDirection | null;
  consent: boolean;
}

export type BatteryStep = "scene" | "clock" | "greyscales" | "bisection";

export function hideForBatteryMode(mode: BatteryMode, hide: HideSide): HideSide {
  return mode === "full" ? "none" : hide;
}

export interface BatteryTaskOutputs {
  scene: { taps: SceneTap[] };
  clock: { trials: ClockTrial[]; responses: ClockResponse[] };
  greyscales?: { trials: GreyscalesTrial[]; responses: GreyscalesResponse[] };
  bisection?: { lines: BisectionLine[]; responses: BisectionResponse[] };
}

export interface AssembleBatteryOptions {
  id?: string;
  startedAt?: string;
  completedAt?: string;
  now?: Date;
}

export interface BatteryStoreOptions {
  store?: BatteryStore;
  standalone?: boolean;
  keyValueStore?: KeyValueStore | null;
}

const DEMO_STEPS: readonly BatteryStep[] = ["scene", "clock"];
const FULL_STEPS: readonly BatteryStep[] = ["scene", "clock", "greyscales", "bisection"];

let standaloneMemory: KeyValueStore | null = null;

export function batteryStepOrder(mode: BatteryMode): readonly BatteryStep[] {
  return mode === "demo" ? DEMO_STEPS : FULL_STEPS;
}

/** The battery stays on Home whether or not the API client is configured. */
export function batteryEnabled(_apiClientEnabled?: boolean): boolean {
  return true;
}

/** Hidden scene (demo mode) is not a scored test and is never persisted. */
export function shouldPersistBattery(record: { mode: BatteryMode; source: string }): boolean {
  return record.mode === "full" && record.source === "live";
}

export function batteryKeyValueStore(options: BatteryStoreOptions = {}): KeyValueStore {
  if (options.keyValueStore) return options.keyValueStore;
  const standalone = options.standalone ?? isStandaloneRuntime();
  if (standalone) {
    standaloneMemory ??= memoryStore();
    return standaloneMemory;
  }
  return getBrowserKeyValueStore() ?? (standaloneMemory ??= memoryStore());
}

export function createWebBatteryStore(options: BatteryStoreOptions = {}): BatteryStore {
  if (options.store) return options.store;
  return createBatteryStore(batteryKeyValueStore(options));
}

function newBatteryId(now: Date): string {
  return `b-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normsUsedFor(mode: BatteryMode): Partial<Record<TestId, TestNorm>> {
  const used: Partial<Record<TestId, TestNorm>> = {};
  for (const test of batteryStepOrder(mode)) {
    used[test] = DEFAULT_NORMS[test];
  }
  return used;
}

export function assembleBatteryRecord(
  config: BatteryIntroConfig,
  outputs: BatteryTaskOutputs,
  options: AssembleBatteryOptions = {},
): BatteryRecord {
  const now = options.now ?? new Date();
  const startedAt = options.startedAt ?? now.toISOString();
  const completedAt = options.completedAt ?? now.toISOString();
  const full = config.mode === "full";
  const record: BatteryRecord = {
    contract: BATTERY_CONTRACT_VERSION,
    id: options.id ?? newBatteryId(now),
    mode: config.mode,
    hide: hideForBatteryMode(config.mode, config.hide),
    seed: config.seed,
    readingDirection: config.readingDirection,
    consent: config.consent,
    source: config.mode === "demo" ? "demonstration" : "live",
    startedAt,
    completedAt,
    scene: { taps: outputs.scene.taps },
    clock: { trials: outputs.clock.trials, responses: outputs.clock.responses },
    greyscales: full && outputs.greyscales ? outputs.greyscales : null,
    bisection: full && outputs.bisection ? outputs.bisection : null,
    normsUsed: normsUsedFor(config.mode),
  };
  return parseBatteryRecord(record);
}

export async function saveBatterySession(
  config: BatteryIntroConfig,
  outputs: BatteryTaskOutputs,
  options: AssembleBatteryOptions & BatteryStoreOptions = {},
): Promise<BatteryRecord> {
  const record = assembleBatteryRecord(config, outputs, options);
  if (!shouldPersistBattery(record)) return record;
  const store = createWebBatteryStore(options);
  return store.save(record);
}

export function useBatterySession(options: BatteryStoreOptions = {}) {
  const [store] = useState(() => createWebBatteryStore(options));
  return {
    store,
    enabled: batteryEnabled,
    stepOrder: batteryStepOrder,
    assemble: assembleBatteryRecord,
    save: (config: BatteryIntroConfig, outputs: BatteryTaskOutputs, extra: AssembleBatteryOptions = {}) =>
      saveBatterySession(config, outputs, { ...options, store, ...extra }),
  };
}
