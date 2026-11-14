import * as storage from "@neurovision/storage";
import type { PackageStoreFactory } from "./package-store";

/**
 * Bind the storage package factory when the workspace includes
 * `@neurovision/storage`. The Vite alias (and tsconfig path) point at
 * `storage-unavailable.ts` when that package is absent.
 */
export function installStoragePackage(set: (factory: PackageStoreFactory | null) => void): void {
  const available = (storage as { STORAGE_AVAILABLE?: boolean }).STORAGE_AVAILABLE;
  if (available === false) {
    set(null);
    return;
  }
  if (typeof storage.createPackageHistoryStore === "function") {
    set(storage.createPackageHistoryStore);
    return;
  }
  set(null);
}
