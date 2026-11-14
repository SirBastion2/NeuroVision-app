import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve `@neurovision/storage` for Vite. When the workspace package is
 * present, point at its source. Otherwise use the web stub so the hosted
 * and standalone builds still compile.
 *
 * @param {string} webRoot
 * @param {{ forceUnavailable?: boolean }} [options]
 * @returns {Record<string, string>}
 */
export function storagePackageAlias(webRoot, options = {}) {
  const source = join(webRoot, "../../packages/storage/src/index.ts");
  const fallback = join(webRoot, "src/services/storage-unavailable.ts");
  const usePackage = !options.forceUnavailable && existsSync(source);
  return {
    "@neurovision/storage": usePackage ? source : fallback,
  };
}
