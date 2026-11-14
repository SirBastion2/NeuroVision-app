import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMONSTRATION_SESSIONS } from "@neurovision/domain";
import { createLocalSessionStore } from "../src/data/sessionStore.js";
import {
  CLINICIAN_HISTORY_KEY,
  PATIENT_SESSION_KEY,
  mergeBrowserSessions,
  readClinicianHistory,
} from "../src/services/browser-session-bridge.js";
import { createLocalHistoryStore } from "../src/services/local-history-store.js";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("patient → clinician session bridge", () => {
  it("mirrors a patient assessment save into clinician history", async () => {
    const storage = new MemoryStorage();
    // Bridge helpers read global localStorage; install the memory backend.
    const previous = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    try {
      storage.removeItem(CLINICIAN_HISTORY_KEY);
      storage.removeItem(PATIENT_SESSION_KEY);

      const patient = createLocalSessionStore(storage);
      const live = structuredClone(DEMONSTRATION_SESSIONS[0]);
      live.id = "live-bridge-1";
      live.source = "live";
      live.alias = "Judge-01";

      const saved = patient.save(live);
      assert.equal(saved.ok, true);
      assert.equal(readClinicianHistory().some((s) => s.id === "live-bridge-1"), true);

      const clinician = createLocalHistoryStore();
      const listed = await clinician.list();
      assert.equal(listed.some((s) => s.id === "live-bridge-1" && s.source === "live"), true);
      assert.equal(mergeBrowserSessions().some((s) => s.alias === "Judge-01"), true);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: previous, configurable: true });
    }
  });
});
