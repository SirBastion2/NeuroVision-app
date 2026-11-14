import { isSessionRecord, parseSessionRecord, type SessionRecord } from "@neurovision/domain";

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

export function saveSession(store: KeyValueStore, value: unknown): Envelope {
  const session = parseSessionRecord(value);
  const current = loadEnvelope(store);
  const key = sessionDedupeKey(session);
  const sessions = current.sessions.filter((item) => sessionDedupeKey(item) !== key);
  sessions.push(session);
  const next: Envelope = { ...current, sessions };
  store.setItem(ENVELOPE_KEY, JSON.stringify(next));
  return next;
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
