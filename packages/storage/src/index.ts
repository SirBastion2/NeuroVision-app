import {
  isBatteryRecord,
  isSessionRecord,
  parseBatteryRecord,
  parseSessionRecord,
  type BatteryRecord,
  type SessionRecord,
} from "@neurovision/domain";

export const STORAGE_AVAILABLE = true;

/** Browser envelope. Records must already be domain SessionRecords. */
export const ENVELOPE_KEY = "spatial-patterns:envelope:v1";
export const PROFILE_KEY = "spatial-patterns:profile:v1";

export interface Envelope {
  version: 1;
  seeded: boolean;
  sessions: SessionRecord[];
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Pseudonymous local label. This is not an organization membership. */
export interface LocalProfile {
  id: string;
  alias: string;
}

export class EnvelopeError extends Error {
  constructor(message = "Saved data is malformed. It has been preserved.") {
    super(message);
    this.name = "EnvelopeError";
  }
}

export function sessionDedupeKey(session: Pick<SessionRecord, "source" | "profileId" | "id">): string {
  return `${session.source}:${session.profileId}:${session.id}`;
}

export function emptyEnvelope(): Envelope {
  return { version: 1, seeded: false, sessions: [] };
}

export function loadEnvelope(store: KeyValueStore): Envelope {
  const raw = store.getItem(ENVELOPE_KEY);
  if (raw === null) return emptyEnvelope();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EnvelopeError();
  }
  if (!isEnvelope(parsed)) throw new EnvelopeError();
  return parsed;
}

/** Byte budget for one envelope write. Oversized writes throw and leave the previous value. */
export const DEFAULT_ENVELOPE_MAX_BYTES = 5_000_000;

export interface SaveSessionOptions {
  maxBytes?: number;
}

export function saveSession(store: KeyValueStore, value: unknown, options: SaveSessionOptions = {}): Envelope {
  const session = parseSessionRecord(value);
  const current = loadEnvelope(store);
  const key = sessionDedupeKey(session);
  const sessions = current.sessions.filter((item) => sessionDedupeKey(item) !== key);
  sessions.push(session);
  const next: Envelope = { ...current, sessions };
  const serialized = JSON.stringify(next);
  const maxBytes = options.maxBytes ?? DEFAULT_ENVELOPE_MAX_BYTES;
  if (serialized.length > maxBytes) {
    throw new EnvelopeError("Saved data exceeds the storage quota. The previous envelope was preserved.");
  }
  store.setItem(ENVELOPE_KEY, serialized);
  return next;
}

/** Drop every stored record with this session id and write the envelope back. */
export function removeSession(store: KeyValueStore, id: string): Envelope {
  const current = loadEnvelope(store);
  const sessions = current.sessions.filter((item) => item.id !== id);
  const next: Envelope = { ...current, sessions };
  store.setItem(ENVELOPE_KEY, JSON.stringify(next));
  return next;
}

/**
 * Same save/load/list shape as the web HistoryStore (`kind: "package"`).
 * Agent F can pass this to `createAppServices({ store })`. This package does not import apps/web.
 */
export interface PackageHistoryStore {
  readonly kind: "package";
  save(record: SessionRecord): Promise<SessionRecord>;
  load(id: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
  remove(id: string): Promise<void>;
}

export function createPackageHistoryStore(store: KeyValueStore, options: SaveSessionOptions = {}): PackageHistoryStore {
  return {
    kind: "package",
    async save(record) {
      const saved = saveSession(store, record, options);
      const stored = saved.sessions.find((item) => sessionDedupeKey(item) === sessionDedupeKey(record));
      if (!stored) throw new EnvelopeError("Save did not retain the session.");
      return structuredClone(stored);
    },
    async load(id) {
      const matches = loadEnvelope(store).sessions.filter((item) => item.id === id);
      const chosen = matches.find((item) => item.source === "live") ?? matches[0];
      return chosen ? structuredClone(chosen) : null;
    },
    async list() {
      return loadEnvelope(store).sessions.map((item) => structuredClone(item));
    },
    async remove(id) {
      removeSession(store, id);
    },
  };
}

export function readProfile(store: KeyValueStore): LocalProfile | null {
  const raw = store.getItem(PROFILE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EnvelopeError("Saved profile is malformed. It has been preserved.");
  }
  if (!isProfile(parsed)) throw new EnvelopeError("Saved profile is malformed. It has been preserved.");
  return parsed;
}

export function writeProfile(store: KeyValueStore, profile: LocalProfile): void {
  if (!isProfile(profile)) throw new EnvelopeError("Profile id and alias are required.");
  store.setItem(PROFILE_KEY, JSON.stringify({ id: profile.id, alias: profile.alias }));
}

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { snapshot(): Record<string, string> } {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
    snapshot() {
      return { ...data };
    },
  };
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const envelope = value as Partial<Envelope>;
  return envelope.version === 1 && typeof envelope.seeded === "boolean" && Array.isArray(envelope.sessions) && envelope.sessions.every((session) => isSessionRecord(session));
}

function isProfile(value: unknown): value is LocalProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Partial<LocalProfile>;
  return typeof profile.id === "string" && profile.id.length > 0 && typeof profile.alias === "string" && profile.alias.length > 0;
}

/** Browser envelope for battery records. Independent of the session envelope. */
export const BATTERY_KEY = "neurovision:battery:v1";

export interface BatteryEnvelope {
  version: 1;
  records: BatteryRecord[];
}

export interface BatteryStore {
  save(record: BatteryRecord): Promise<BatteryRecord>;
  load(id: string): Promise<BatteryRecord | null>;
  list(): Promise<BatteryRecord[]>;
  remove(id: string): Promise<void>;
}

export function emptyBatteryEnvelope(): BatteryEnvelope {
  return { version: 1, records: [] };
}

export function loadBatteryEnvelope(store: KeyValueStore): BatteryEnvelope {
  const raw = store.getItem(BATTERY_KEY);
  if (raw === null) return emptyBatteryEnvelope();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EnvelopeError();
  }
  if (!isBatteryEnvelope(parsed)) throw new EnvelopeError();
  return parsed;
}

export function saveBatteryRecord(store: KeyValueStore, value: unknown): BatteryEnvelope {
  const record = parseBatteryRecord(value);
  const current = loadBatteryEnvelope(store);
  const records = current.records.filter((item) => item.id !== record.id);
  records.push(record);
  const next: BatteryEnvelope = { version: 1, records };
  store.setItem(BATTERY_KEY, JSON.stringify(next));
  return next;
}

/** Drop every stored battery with this id and write the envelope back. */
export function removeBatteryRecord(store: KeyValueStore, id: string): BatteryEnvelope {
  const current = loadBatteryEnvelope(store);
  const records = current.records.filter((item) => item.id !== id);
  const next: BatteryEnvelope = { version: 1, records };
  store.setItem(BATTERY_KEY, JSON.stringify(next));
  return next;
}

/**
 * Same save/load/list shape as the session history store, under `neurovision:battery:v1`.
 * Pass `memoryStore()` for the standalone in-memory backend.
 */
export function createBatteryStore(store: KeyValueStore): BatteryStore {
  return {
    async save(record) {
      const saved = saveBatteryRecord(store, record);
      const stored = saved.records.find((item) => item.id === record.id);
      if (!stored) throw new EnvelopeError("Save did not retain the battery record.");
      return structuredClone(stored);
    },
    async load(id) {
      const match = loadBatteryEnvelope(store).records.find((item) => item.id === id);
      return match ? structuredClone(match) : null;
    },
    async list() {
      return loadBatteryEnvelope(store).records.map((item) => structuredClone(item));
    },
    async remove(id) {
      removeBatteryRecord(store, id);
    },
  };
}

function isBatteryEnvelope(value: unknown): value is BatteryEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const envelope = value as Partial<BatteryEnvelope>;
  return envelope.version === 1 && Array.isArray(envelope.records) && envelope.records.every((record) => isBatteryRecord(record));
}
