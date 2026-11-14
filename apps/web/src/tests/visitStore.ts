import type { SessionResult } from "../metrics/types";

/**
 * Sessions recorded during this visit, kept in memory (module scope) so they survive
 * navigating away from the page and back. Not persisted: teammates' backend owns storage.
 */
let sessions: SessionResult[] = [];
const listeners = new Set<() => void>();

export const visitStore = {
  all: (): SessionResult[] => sessions,
  add(s: SessionResult | SessionResult[]) {
    sessions = [...sessions, ...(Array.isArray(s) ? s : [s])];
    listeners.forEach((l) => l());
  },
  replace(s: SessionResult) {
    sessions = sessions.map((x) => (x.id === s.id ? s : x));
    listeners.forEach((l) => l());
  },
  clear() {
    sessions = [];
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
