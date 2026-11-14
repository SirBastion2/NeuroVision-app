import type { KeyValueStore } from "./package-store";

export const PARTICIPANT_SCOPE_PREFIX = "nv:participant:";

export function scopedStorageKey(participantId: string, key: string): string {
  return `${PARTICIPANT_SCOPE_PREFIX}${participantId}:${key}`;
}

/** Prefix every key so two people on one laptop keep separate offline caches. */
export function createScopedKeyValueStore(inner: KeyValueStore, participantId: string): KeyValueStore {
  const prefix = `${PARTICIPANT_SCOPE_PREFIX}${participantId}:`;
  return {
    getItem(key) {
      return inner.getItem(prefix + key);
    },
    setItem(key, value) {
      inner.setItem(prefix + key, value);
    },
    removeItem(key) {
      inner.removeItem(prefix + key);
    },
  };
}
