import { parseSessionRecord, type SessionRecord } from "@neurovision/domain";

/** Persistence used by the app service layer. */
export interface HistoryStore {
  readonly kind: "memory" | "package";
  save(record: SessionRecord): Promise<SessionRecord>;
  load(id: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
}

/**
 * In-memory history. Used when `packages/storage` is not in the workspace,
 * and as the default store for tests and the standalone file.
 */
export function createMemoryStore(): HistoryStore {
  const records = new Map<string, SessionRecord>();
  return {
    kind: "memory",
    async save(record) {
      const parsed = parseSessionRecord(record);
      records.set(parsed.id, structuredClone(parsed));
      return structuredClone(parsed);
    },
    async load(id) {
      const record = records.get(id);
      return record ? structuredClone(record) : null;
    },
    async list() {
      return [...records.values()].map((record) => structuredClone(record));
    },
  };
}

/** Ensure every write is validated, including stores supplied by `packages/storage`. */
export function guardedStore(store: HistoryStore): HistoryStore {
  return {
    kind: store.kind,
    async save(record) {
      return store.save(parseSessionRecord(record));
    },
    load: (id) => store.load(id),
    list: () => store.list(),
  };
}

export function resolveHistoryStore(preferred?: HistoryStore): HistoryStore {
  return guardedStore(preferred ?? createMemoryStore());
}
