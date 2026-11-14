import { isSessionRecord, parseSessionRecord, type SessionRecord } from "@neurovision/domain";

/**
 * TEMPORARY browser storage for D+E screens. Agent B owns `packages/storage`;
 * when it lands, replace `createLocalSessionStore` with B's adapter behind this
 * same interface. Every write goes through `parseSessionRecord` (ARCHITECTURE.md),
 * and malformed stored records are kept and counted, never silently discarded.
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
  load(): LoadResult;
  save(session: SessionRecord): SaveResult;
  remove(id: string): SaveResult;
}

const KEY = "neurovision.web.sessions";
const VERSION = 1;

interface Envelope {
  version: number;
  records: unknown[];
}

export function createLocalSessionStore(storage: Pick<Storage, "getItem" | "setItem"> | null = safeLocalStorage()): SessionStore {
  let memory: Envelope = { version: VERSION, records: [] };

  const read = (): Envelope => {
    if (!storage) return memory;
    const raw = storage.getItem(KEY);
    if (!raw) return { version: VERSION, records: [] };
    const parsed = JSON.parse(raw) as Partial<Envelope>;
    if (parsed.version !== VERSION || !Array.isArray(parsed.records)) {
      throw new Error(`Unsupported stored data (version ${String(parsed.version)}). It was left untouched.`);
    }
    return { version: VERSION, records: parsed.records };
  };

  const write = (envelope: Envelope): SaveResult => {
    try {
      if (storage) storage.setItem(KEY, JSON.stringify(envelope));
      else memory = envelope;
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const idOf = (record: unknown) =>
    typeof record === "object" && record !== null && "id" in record ? (record as { id: unknown }).id : undefined;

  return {
    load() {
      try {
        const { records } = read();
        const sessions = records.filter(isSessionRecord);
        return { sessions, rejected: records.length - sessions.length, error: null };
      } catch (e) {
        return { sessions: [], rejected: 0, error: e instanceof Error ? e.message : String(e) };
      }
    },
    save(session) {
      try {
        const valid = parseSessionRecord(session);
        const envelope = read();
        const others = envelope.records.filter((r) => idOf(r) !== valid.id);
        return write({ version: VERSION, records: [...others, valid] });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    remove(id) {
      try {
        const envelope = read();
        return write({ version: VERSION, records: envelope.records.filter((r) => idOf(r) !== id) });
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
