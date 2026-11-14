import { isParticipantId, parseParticipantId } from "@neurovision/domain";

export const LAST_PARTICIPANT_ID_KEY = "neurovision.web.last-participant-id";
export const LOCAL_ORG_ID = "org-demo";

export { isParticipantId, parseParticipantId };

interface ReadableStore {
  getItem(key: string): string | null;
}

interface WritableStore {
  setItem(key: string, value: string): void;
}

function fallbackStore(): (ReadableStore & WritableStore) | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function participantIdMessage(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter a participant ID to continue.";
  if (!isParticipantId(trimmed)) {
    return "Use 3–32 letters, digits, or dashes.";
  }
  return null;
}

export function readLastParticipantId(store?: ReadableStore | null): string {
  try {
    const raw = (store ?? fallbackStore())?.getItem(LAST_PARTICIPANT_ID_KEY);
    if (typeof raw === "string" && isParticipantId(raw.trim())) return raw.trim();
  } catch {
    /* preference just won't persist */
  }
  return "";
}

export function writeLastParticipantId(id: string, store?: WritableStore | null): string {
  const parsed = parseParticipantId(id);
  try {
    (store ?? fallbackStore())?.setItem(LAST_PARTICIPANT_ID_KEY, parsed);
  } catch {
    /* preference just won't persist */
  }
  return parsed;
}
