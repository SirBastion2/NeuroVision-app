import type { SessionRecord } from "@neurovision/domain";
import { ENVELOPE_KEY, loadEnvelope } from "@neurovision/storage";
import { installStoragePackage } from "./storage-install";
import type { HistoryStore } from "./history-store";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PackageStoreFactory = (store: KeyValueStore) => {
  readonly kind: "package";
  save(record: SessionRecord): Promise<SessionRecord>;
  load(id: string): Promise<SessionRecord | null>;
  list(): Promise<SessionRecord[]>;
  remove?(id: string): Promise<void>;
};

let registeredFactory: PackageStoreFactory | null = null;

export function setPackageHistoryStoreFactory(factory: PackageStoreFactory | null): void {
  registeredFactory = factory;
}

export function getPackageHistoryStoreFactory(): PackageStoreFactory | null {
  return registeredFactory;
}

installStoragePackage(setPackageHistoryStoreFactory);

export function getBrowserKeyValueStore(): KeyValueStore | null {
  try {
    const storage = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    if (!storage) return null;
    const probe = "__nv_history_probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function createMemoryKeyValueStore(initial: Record<string, string> = {}): KeyValueStore {
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

/** Wrap a storage-package store as the web HistoryStore (`kind: "package"`). */
export function createPackageHistoryStoreAdapter(
  kv: KeyValueStore,
  factory: PackageStoreFactory = registeredFactory ?? missingFactory,
): HistoryStore {
  const store = factory(kv);
  return {
    kind: "package",
    save: (record) => store.save(record),
    load: (id) => store.load(id),
    list: () => store.list(),
    async remove(id) {
      if (typeof store.remove === "function") {
        await store.remove(id);
        return;
      }
      const envelope = loadEnvelope(kv);
      const sessions = envelope.sessions.filter((item) => item.id !== id);
      kv.setItem(ENVELOPE_KEY, JSON.stringify({ ...envelope, sessions }));
    },
  };
}

function missingFactory(): never {
  throw new Error("@neurovision/storage is not available");
}

export function tryCreatePackageHistoryStore(
  kv: KeyValueStore | null,
  factory: PackageStoreFactory | null = registeredFactory,
): HistoryStore | null {
  if (!kv || !factory) return null;
  return createPackageHistoryStoreAdapter(kv, factory);
}
