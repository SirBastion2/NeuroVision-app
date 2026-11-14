import { isSessionRecord, parseSessionRecord, type SessionRecord } from "@neurovision/domain";

/** Clinician Profile / app-services history key. */
export const CLINICIAN_HISTORY_KEY = "neurovision:history:v1";

/** Patient assessment flow key (apps/web sessionStore). */
export const PATIENT_SESSION_KEY = "neurovision.web.sessions";

interface PatientEnvelope {
  version: number;
  records: unknown[];
}

function safeGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode — caller already has its primary write path */
  }
}

function sortSessions(records: SessionRecord[]): SessionRecord[] {
  return [...records].sort(
    (a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id),
  );
}

/** Sessions written by the clinician HistoryStore. */
export function readClinicianHistory(): SessionRecord[] {
  try {
    const raw = safeGet(CLINICIAN_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => parseSessionRecord(item));
  } catch {
    return [];
  }
}

export function writeClinicianHistory(records: SessionRecord[]): void {
  safeSet(CLINICIAN_HISTORY_KEY, JSON.stringify(sortSessions(records)));
}

/** Valid sessions from the patient assessment envelope. */
export function readPatientSessions(): SessionRecord[] {
  try {
    const raw = safeGet(PATIENT_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PatientEnvelope>;
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) return [];
    return parsed.records.filter(isSessionRecord);
  } catch {
    return [];
  }
}

/**
 * Union of patient assessment saves and clinician history (including seeded demos).
 * Same id wins by later completedAt, then keeps one copy.
 */
export function mergeBrowserSessions(): SessionRecord[] {
  const byId = new Map<string, SessionRecord>();
  for (const session of [...readClinicianHistory(), ...readPatientSessions()]) {
    const existing = byId.get(session.id);
    if (!existing || session.completedAt >= existing.completedAt) {
      byId.set(session.id, session);
    }
  }
  return sortSessions([...byId.values()]);
}

/** Mirror a validated patient/clinician save into the clinician history key. */
export function upsertClinicianHistory(session: SessionRecord): void {
  const parsed = parseSessionRecord(session);
  const next = readClinicianHistory().filter((item) => item.id !== parsed.id);
  next.push(parsed);
  writeClinicianHistory(next);
}

export function removeFromClinicianHistory(id: string): void {
  writeClinicianHistory(readClinicianHistory().filter((item) => item.id !== id));
}
