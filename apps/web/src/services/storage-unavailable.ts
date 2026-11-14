import { parseBatteryRecord, type BatteryRecord, type SessionRecord } from "@neurovision/domain";

/** Marker used when `packages/storage` is not in the workspace. */
export const STORAGE_AVAILABLE = false;

export const ENVELOPE_KEY = "spatial-patterns:envelope:v1";
export const PROFILE_KEY = "spatial-patterns:profile:v1";
export const DEFAULT_ENVELOPE_MAX_BYTES = 5_000_000;

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

export interface PackageHistoryStore {
  readonly kind: "package";
  save(record: SessionRecord): Promise<SessionRecord>;
  load(id: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
}

export class EnvelopeError extends Error {
  constructor(message = "Saved data is malformed. It has been preserved.") {
    super(message);
    this.name = "EnvelopeError";
  }
}

export function emptyEnvelope(): Envelope {
  return { version: 1, seeded: false, sessions: [] };
}

export function sessionDedupeKey(session: Pick<SessionRecord, "source" | "profileId" | "id">): string {
  return `${session.source}:${session.profileId}:${session.id}`;
}

export function loadEnvelope(_store: KeyValueStore): Envelope {
  void _store;
  throw new EnvelopeError("@neurovision/storage is not in this workspace");
}

export function saveSession(_store: KeyValueStore, _value: unknown): Envelope {
  void _store;
  void _value;
  throw new EnvelopeError("@neurovision/storage is not in this workspace");
}

export function createPackageHistoryStore(store: KeyValueStore): PackageHistoryStore {
  void store;
  throw new Error("@neurovision/storage is not in this workspace");
}

export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
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
  };
}

export const BATTERY_KEY = "neurovision:battery:v1";

export interface BatteryStore {
  save(record: BatteryRecord): Promise<BatteryRecord>;
  load(id: string): Promise<BatteryRecord | null>;
  list(): Promise<BatteryRecord[]>;
}

export function createBatteryStore(store: KeyValueStore): BatteryStore {
  const read = (): BatteryRecord[] => {
    const raw = store.getItem(BATTERY_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { records?: unknown }).records)) {
      throw new EnvelopeError();
    }
    return (parsed as { records: unknown[] }).records.map((record) => parseBatteryRecord(record));
  };
  return {
    async save(record) {
      const saved = parseBatteryRecord(record);
      const records = read().filter((item) => item.id !== saved.id);
      records.push(saved);
      store.setItem(BATTERY_KEY, JSON.stringify({ version: 1, records }));
      return saved;
    },
    async load(id) {
      return read().find((item) => item.id === id) ?? null;
    },
    async list() {
      return read();
    },
  };
}
