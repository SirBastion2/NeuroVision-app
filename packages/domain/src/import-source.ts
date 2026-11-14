import { isObject, isOneOf, parseFail } from "./guard.js";
import { SESSION_SOURCES, type SessionSource } from "./session.js";

/** Original source string kept when a session is imported. Not a SessionSource value. */
export const IMPORTED_SOURCES = ["live", "simulated"] as const;
export type ImportedSource = (typeof IMPORTED_SOURCES)[number];

export interface ImportedSourceProvenance {
  original: ImportedSource;
}

export function isImportedSource(value: unknown): value is ImportedSource {
  return isOneOf(value, IMPORTED_SOURCES);
}

export function parseImportedSource(value: unknown): ImportedSource {
  if (!isImportedSource(value)) parseFail("imported source");
  return value;
}

export function isImportedSourceProvenance(value: unknown): value is ImportedSourceProvenance {
  return isObject(value) && isImportedSource(value.original);
}

export function parseImportedSourceProvenance(value: unknown): ImportedSourceProvenance {
  if (!isImportedSourceProvenance(value)) parseFail("imported source provenance");
  return { original: value.original };
}

/**
 * Map an imported original onto domain SessionSource.
 * `live` stays `live`. `simulated` becomes `demonstration`.
 * A simulated import never becomes `live`.
 */
export function mapImportedSource(original: ImportedSource): SessionSource {
  const imported = parseImportedSource(original);
  if (imported === "simulated") return "demonstration";
  return "live";
}

export function sessionSourceFromImport(provenance: ImportedSourceProvenance): SessionSource {
  const parsed = parseImportedSourceProvenance(provenance);
  const source = mapImportedSource(parsed.original);
  if (parsed.original === "simulated" && source === "live") {
    throw new Error("A simulated import cannot be stored as live.");
  }
  if (parsed.original === "simulated" && source !== "demonstration") {
    throw new Error("A simulated import must be stored as demonstration.");
  }
  if (!SESSION_SOURCES.includes(source)) {
    throw new Error("Imported source mapped to an unknown session source.");
  }
  return source;
}
