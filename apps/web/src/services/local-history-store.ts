import { parseSessionRecord, type SessionRecord } from "@neurovision/domain";
import type { HistoryStore } from "./history-store";

const KEY = "neurovision:history:v1";

function readAll(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => parseSessionRecord(item));
  } catch {
    return [];
  }
}

function writeAll(records: SessionRecord[]): void {
  localStorage.setItem(KEY, JSON.stringify(records));
}

/** Browser localStorage history with domain validation on every write. */
export function createLocalHistoryStore(): HistoryStore {
  return {
    kind: "package",
    async save(record) {
      const parsed = parseSessionRecord(record);
      const next = readAll().filter((item) => item.id !== parsed.id);
      next.push(parsed);
      next.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
      writeAll(next);
      return structuredClone(parsed);
    },
    async load(id) {
      const found = readAll().find((item) => item.id === id);
      return found ? structuredClone(found) : null;
    },
    async list() {
      return readAll().map((item) => structuredClone(item));
    },
  };
}

export function canUseLocalHistoryStore(): boolean {
  return typeof localStorage !== "undefined";
}
