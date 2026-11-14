import { parseSessionRecord } from "@neurovision/domain";
import type { HistoryStore } from "./history-store";
import {
  CLINICIAN_HISTORY_KEY,
  mergeBrowserSessions,
  removeFromClinicianHistory,
  upsertClinicianHistory,
  writeClinicianHistory,
} from "./browser-session-bridge";

/**
 * Browser localStorage history with domain validation on every write.
 * Lists merge the patient assessment store so a completed live session
 * appears in the clinician Profile without a separate export step.
 */
export function createLocalHistoryStore(): HistoryStore {
  return {
    kind: "package",
    async save(record) {
      const parsed = parseSessionRecord(record);
      upsertClinicianHistory(parsed);
      return structuredClone(parsed);
    },
    async load(id) {
      const found = mergeBrowserSessions().find((item) => item.id === id);
      return found ? structuredClone(found) : null;
    },
    async list() {
      const merged = mergeBrowserSessions();
      // Keep clinician key aligned so PDF/trend and later saves stay coherent.
      writeClinicianHistory(merged);
      return merged.map((item) => structuredClone(item));
    },
    async remove(id) {
      removeFromClinicianHistory(id);
    },
  };
}

export function canUseLocalHistoryStore(): boolean {
  return typeof localStorage !== "undefined";
}

/** Exposed for tests / diagnostics. */
export const LOCAL_HISTORY_KEY = CLINICIAN_HISTORY_KEY;

export function deleteLocalHistorySession(id: string): void {
  removeFromClinicianHistory(id);
}
