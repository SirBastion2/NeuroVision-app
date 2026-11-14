export interface ClinicalNote {
  id: string;
  sessionId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** Always local-only in this build. */
  storage: "local";
}

const KEY = "neurovision:clinical-notes:v1";

function readNotes(): ClinicalNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClinicalNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeNotes(notes: ClinicalNote[]): void {
  localStorage.setItem(KEY, JSON.stringify(notes));
}

export function listClinicalNotes(): ClinicalNote[] {
  return readNotes().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveClinicalNote(input: {
  id?: string;
  sessionId?: string | null;
  body: string;
}): ClinicalNote {
  const now = new Date().toISOString();
  const notes = readNotes();
  const existing = input.id ? notes.find((n) => n.id === input.id) : undefined;
  const note: ClinicalNote = {
    id: existing?.id ?? crypto.randomUUID(),
    sessionId: input.sessionId ?? existing?.sessionId ?? null,
    body: input.body.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    storage: "local",
  };
  const next = notes.filter((n) => n.id !== note.id);
  next.push(note);
  writeNotes(next);
  return note;
}

export function deleteClinicalNote(id: string): void {
  writeNotes(readNotes().filter((n) => n.id !== id));
}
