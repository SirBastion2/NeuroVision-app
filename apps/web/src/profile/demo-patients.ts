import {
  DEMONSTRATION_BALANCED,
  DEMONSTRATION_LEFT_OMISSION,
  DEMONSTRATION_RIGHT_OMISSION,
  parseSessionRecord,
  type SessionRecord,
} from "@neurovision/domain";

export type DemoPatientId = "A" | "B" | "C";

export interface DemoPatientProfile {
  id: DemoPatientId;
  label: string;
  summary: string;
  /** Labeled demonstration sessions only — no invented demographics. */
  sessions: SessionRecord[];
}

function asDemoPatient(
  letter: DemoPatientId,
  label: string,
  summary: string,
  base: SessionRecord,
  extras: SessionRecord[] = [],
): DemoPatientProfile {
  const profileId = `demo-patient-${letter.toLowerCase()}`;
  const sessions = [base, ...extras].map((session, index) =>
    parseSessionRecord({
      ...structuredClone(session),
      id: `demo-patient-${letter.toLowerCase()}-s${index + 1}`,
      profileId,
      alias: label,
      source: "demonstration" as const,
    }),
  );
  return { id: letter, label, summary, sessions };
}

/**
 * Three labeled demonstration patient packs for clinician review.
 * Built only from existing domain demonstration sessions (patterns), not invented clinical data.
 */
export const DEMO_PATIENT_PROFILES: readonly DemoPatientProfile[] = [
  asDemoPatient(
    "A",
    "Demo Patient A",
    "Balanced target selection pattern (demonstration).",
    DEMONSTRATION_BALANCED,
  ),
  asDemoPatient(
    "B",
    "Demo Patient B",
    "Left-omission pattern (demonstration).",
    DEMONSTRATION_LEFT_OMISSION,
  ),
  asDemoPatient(
    "C",
    "Demo Patient C",
    "Right-omission pattern (demonstration).",
    DEMONSTRATION_RIGHT_OMISSION,
  ),
];

export function demoPatientById(id: DemoPatientId): DemoPatientProfile {
  const found = DEMO_PATIENT_PROFILES.find((profile) => profile.id === id);
  if (!found) throw new Error(`Unknown demo patient ${id}`);
  return found;
}
