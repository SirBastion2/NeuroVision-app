import type { SessionRecord } from "@neurovision/domain";

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
