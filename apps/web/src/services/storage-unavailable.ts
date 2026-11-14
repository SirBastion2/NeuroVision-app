import type { SessionRecord } from "@neurovision/domain";

/** Marker used when `packages/storage` is not in the workspace. */
export const STORAGE_AVAILABLE = false;

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

export function createPackageHistoryStore(store: KeyValueStore): PackageHistoryStore {
  void store;
  throw new Error("@neurovision/storage is not in this workspace");
}
