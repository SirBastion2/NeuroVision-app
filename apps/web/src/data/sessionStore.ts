import { isSessionRecord, parseSessionRecord, type SessionRecord } from "@neurovision/domain";
import { ENVELOPE_KEY, EnvelopeError, loadEnvelope, saveSession } from "@neurovision/storage";
import { removeFromClinicianHistory, upsertClinicianHistory } from "../services/browser-session-bridge";
import type { HistoryStore } from "../services/history-store";
import { isEnvelopeError } from "../services/history-store";
import type { KeyValueStore } from "../services/package-store";

/**
 * Screen-facing session store. Persistence goes through the service layer's
 * storage-backed HistoryStore (the `@neurovision/storage` envelope). The
 * in-memory path is only for the standalone build. Successful browser saves
 * also mirror into clinician history so Profile lists the same live sessions.
 */
export interface LoadResult {
  sessions: SessionRecord[];
  rejected: number;
  error: string | null;
}

export interface SaveResult {
  ok: boolean;
  error: string | null;
}

export interface SessionStore {
  load(): Promise<LoadResult>;
  save(session: SessionRecord): Promise<SaveResult>;
  remove(id: string): Promise<SaveResult>;
}

export interface ServiceHistory {
  save(session: SessionRecord): Promise<SessionRecord>;
  listHistory(): Promise<SessionRecord[]>;
  remove(id: string): Promise<void>;
}

export const SCREEN_SESSIONS_KEY = "neurovision.web.sessions";
export const REJECTED_ASIDE_KEY = "neurovision.web.sessions.rejected";
export const SCREEN_IMPORT_KEY = "neurovision.web.sessions.imported";

export interface CreateLocalSessionStoreOptions {
  storage?: KeyValueStore | null;
  history?: HistoryStore | ServiceHistory | null;
  standalone?: boolean;
}

function isServiceHistory(value: HistoryStore | ServiceHistory): value is ServiceHistory {
  return "listHistory" in value;
}

function rejectedCount(storage: KeyValueStore | null): number {
  if (!storage) return 0;
  const aside = storage.getItem(REJECTED_ASIDE_KEY);
  if (!aside) return 0;
  try {
    const parsed = JSON.parse(aside) as { records?: unknown };
    return Array.isArray(parsed.records) ? parsed.records.length : 1;
  } catch {
    return 1;
  }
}

function shouldMirrorClinician(standalone: boolean): boolean {
  return !standalone;
}

/**
 * Copy malformed screen-store records aside, then write valid ones into the
 * storage-package envelope. Runs once per browser.
 */
export function importScreenSessions(storage: KeyValueStore): void {
  if (storage.getItem(SCREEN_IMPORT_KEY) === "1") return;
  const raw = storage.getItem(SCREEN_SESSIONS_KEY);
  if (raw === null) {
    storage.setItem(SCREEN_IMPORT_KEY, "1");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.setItem(REJECTED_ASIDE_KEY, raw);
    storage.setItem(SCREEN_IMPORT_KEY, "1");
    return;
  }
  const envelope = parsed as { version?: unknown; records?: unknown };
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    envelope.version !== 1 ||
    !Array.isArray(envelope.records)
  ) {
    storage.setItem(REJECTED_ASIDE_KEY, raw);
    storage.setItem(SCREEN_IMPORT_KEY, "1");
    return;
  }
  const records: unknown[] = envelope.records;
  const rejected = records.filter((record) => !isSessionRecord(record));
  const valid = records.filter(isSessionRecord);
  if (rejected.length > 0) {
    storage.setItem(REJECTED_ASIDE_KEY, JSON.stringify({ version: 1, records: rejected }));
  }
  for (const session of valid) {
    try {
      saveSession(storage, session);
    } catch (error) {
      if (error instanceof EnvelopeError || (error instanceof Error && error.name === "EnvelopeError")) {
        break;
      }
      throw error;
    }
  }
  storage.removeItem(SCREEN_SESSIONS_KEY);
  storage.setItem(SCREEN_IMPORT_KEY, "1");
}

export function createLocalSessionStore(options: CreateLocalSessionStoreOptions = {}): SessionStore {
  const standalone = options.standalone ?? false;
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage;
  const history = options.history ?? null;
  const memory = new Map<string, SessionRecord>();

  if (storage && !standalone) {
    try {
      importScreenSessions(storage);
    } catch {
      /* import is best-effort; load will surface envelope errors */
    }
  }

  const listFromHistory = async (): Promise<SessionRecord[]> => {
    if (!history) return [];
    return isServiceHistory(history) ? history.listHistory() : history.list();
  };

  return {
    async load() {
      try {
        if (history) {
          const sessions = await listFromHistory();
          return { sessions, rejected: standalone ? 0 : rejectedCount(storage), error: null };
        }
        if (standalone || !storage) {
          return { sessions: [...memory.values()].map((record) => structuredClone(record)), rejected: 0, error: null };
        }
        const envelope = loadEnvelope(storage);
        return { sessions: envelope.sessions, rejected: rejectedCount(storage), error: null };
      } catch (error) {
        if (isEnvelopeError(error)) {
          return { sessions: [], rejected: 0, error: error.message };
        }
        return { sessions: [], rejected: 0, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async save(session) {
      try {
        const valid = parseSessionRecord(session);
        if (history) {
          await history.save(valid);
        } else if (standalone || !storage) {
          memory.set(valid.id, structuredClone(valid));
        } else {
          saveSession(storage, valid);
        }
        if (shouldMirrorClinician(standalone)) upsertClinicianHistory(valid);
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async remove(id) {
      try {
        if (history) {
          await history.remove(id);
        } else if (standalone || !storage) {
          memory.delete(id);
        } else {
          const envelope = loadEnvelope(storage);
          const sessions = envelope.sessions.filter((item) => item.id !== id);
          storage.setItem(ENVELOPE_KEY, JSON.stringify({ ...envelope, sessions }));
        }
        if (shouldMirrorClinician(standalone)) removeFromClinicianHistory(id);
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

function safeLocalStorage(): KeyValueStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
