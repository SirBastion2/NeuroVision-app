import { parseSessionRecord, type SessionRecord } from "@neurovision/domain";
import {
  getBrowserKeyValueStore,
  getPackageHistoryStoreFactory,
  tryCreatePackageHistoryStore,
  type KeyValueStore,
  type PackageStoreFactory,
} from "./package-store";
import { isStandaloneRuntime } from "./runtime-config";

/** Persistence used by the app service layer. */
export interface HistoryStore {
  readonly kind: "memory" | "package";
  save(record: SessionRecord): Promise<SessionRecord>;
  load(id: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
}

export interface ResolveHistoryStoreOptions {
  preferred?: HistoryStore;
  standalone?: boolean;
  keyValueStore?: KeyValueStore | null;
  packageStoreFactory?: PackageStoreFactory | null;
}

/**
 * In-memory history. Fallback when `packages/storage` is not in the workspace,
 * and the store used by the standalone file (no durable browser envelope).
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

/**
 * Default history store: the storage-package HistoryStore when that package
 * is present and a key-value backend exists. Standalone builds and tests
 * without the package fall back to in-memory.
 */
export function resolveHistoryStore(preferredOrOptions?: HistoryStore | ResolveHistoryStoreOptions): HistoryStore {
  const options: ResolveHistoryStoreOptions =
    preferredOrOptions && "save" in preferredOrOptions && "kind" in preferredOrOptions
      ? { preferred: preferredOrOptions }
      : (preferredOrOptions as ResolveHistoryStoreOptions | undefined) ?? {};

  if (options.preferred) return guardedStore(options.preferred);

  const standalone = options.standalone ?? isStandaloneRuntime();
  if (standalone) return guardedStore(createMemoryStore());

  const factory =
    options.packageStoreFactory === undefined
      ? getPackageHistoryStoreFactory()
      : options.packageStoreFactory;
  const kv =
    options.keyValueStore === undefined ? getBrowserKeyValueStore() : options.keyValueStore;
  const fromPackage = tryCreatePackageHistoryStore(kv ?? null, factory);
  return guardedStore(fromPackage ?? createMemoryStore());
}
