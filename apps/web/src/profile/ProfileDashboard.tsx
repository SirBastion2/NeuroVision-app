import { useEffect, useMemo, useState } from "react";
import {
  scoreSession,
  sessionSourceLabel,
  type BoardDensity,
  type PracticeCue,
  type SessionRecord,
} from "@neurovision/domain";
import {
  analyzeSimulatedLabSlice,
  gazeSummary,
  provenanceFor,
  simulatedTrace,
  SIMULATED_LAB_PROVENANCE,
} from "@neurovision/gaze";
import { createAppServices, type AppServices, type GazeLabData } from "../services";
import { canUseLocalHistoryStore, createLocalHistoryStore } from "../services/local-history-store";
import {
  deleteClinicalNote,
  listClinicalNotes,
  saveClinicalNote,
  type ClinicalNote,
} from "./notes-store";
import { SpatialBoard } from "./SpatialBoard";
import { buildClinicianReportPdf, downloadBlob } from "./report-pdf";
import "./profile.css";

type TabId =
  | "overview"
  | "history"
  | "gaze"
  | "practice"
  | "progress"
  | "notes"
  | "reports";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "Assessment History" },
  { id: "gaze", label: "Gaze Analysis" },
  { id: "practice", label: "Adaptive Practice" },
  { id: "progress", label: "Progress" },
  { id: "notes", label: "Clinical Notes" },
  { id: "reports", label: "Reports" },
];

const GAZE_DURATION_MS = 22_000;

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function createServices(): AppServices {
  return createAppServices({
    store: canUseLocalHistoryStore() ? createLocalHistoryStore() : undefined,
  });
}

function GazeQuickStats({ wide }: { wide: boolean }) {
  const trace = useMemo(() => simulatedTrace(wide, GAZE_DURATION_MS), [wide]);
  const summary = useMemo(() => gazeSummary(trace, GAZE_DURATION_MS), [trace]);
  const integrated = useMemo(
    () => analyzeSimulatedLabSlice("profile-gaze", trace, GAZE_DURATION_MS),
    [trace],
  );
  return (
    <p>
      Tracked {Math.round(summary.tracked / 1000)}s · left share{" "}
      {summary.tracked ? Math.round((100 * summary.left) / summary.tracked) : 0}% · coverage{" "}
      {(integrated.coverageRatio * 100).toFixed(0)}%
    </p>
  );
}

export function ProfileDashboard() {
  const services = useMemo(() => createServices(), []);
  const [tab, setTab] = useState<TabId>("overview");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [gaze, setGaze] = useState<GazeLabData | null>(null);
  const [wideGaze, setWideGaze] = useState(false);
  const [cue, setCue] = useState<PracticeCue>("none");
  const [density, setDensity] = useState<BoardDensity>("standard");
  const [scanGuide, setScanGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [trendState, setTrendState] = useState<Awaited<
    ReturnType<AppServices["comparableHistory"]>
  > | null>(null);

  const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;
  const scored = selected ? scoreSession(selected) : null;
  const suggested = scored?.practice ?? null;
  const practiceSetup = services.configurePractice({ cue, density, scanGuide }, suggested);

  async function refresh(preferredId?: string | null) {
    const list = await services.listHistory();
    setSessions(list);
    setNotes(listClinicalNotes());
    setGaze(services.loadGazeLabData());
    const nextId = preferredId ?? selectedId ?? list[0]?.id ?? null;
    setSelectedId(nextId);
    setTrendState(await services.comparableHistory(list));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    const practice = scoreSession(selected).practice;
    setCue(practice.cue);
    setDensity(practice.density);
    setScanGuide(Boolean(practice.scanGuide));
  }, [selected]);

  async function seedDemos() {
    setBusy(true);
    try {
      const list = await services.seedDemonstrationHistory();
      setSessions(list);
      setSelectedId(list[0]?.id ?? null);
      setTrendState(await services.comparableHistory(list));
      setMessage("Demonstration sessions loaded into local history.");
    } finally {
      setBusy(false);
    }
  }

  function saveNote() {
    if (!noteBody.trim()) return;
    saveClinicalNote({ sessionId: selected?.id ?? null, body: noteBody });
    setNoteBody("");
    setNotes(listClinicalNotes());
    setMessage("Note saved in this browser only.");
  }

  function exportPdf() {
    const blob = buildClinicianReportPdf({
      profileAlias: selected?.alias ?? "Local participant",
      sessions,
      selected,
      trend: trendState?.trend ?? { key: null, points: [], excluded: [] },
      notes,
    });
    downloadBlob(blob, `neurovision-report-${selected?.id ?? "profile"}.pdf`);
    setMessage("PDF downloaded.");
  }

  const activeGazeStream = gaze
    ? wideGaze
      ? gaze.simulated.bothHalves
      : gaze.simulated.leftBiased
    : null;

  return (
    <section className="profile-dashboard" aria-labelledby="profile-title">
      <div className="profile-heading">
        <div>
          <p className="eyebrow">Clinician profile</p>
          <h2 id="profile-title">Participant dashboard</h2>
          <p className="lede">
            Research observations from validated local sessions. No diagnoses or treatment claims.
          </p>
        </div>
        <div className="profile-actions">
          <button type="button" disabled={busy} onClick={() => void seedDemos()}>
            Load demonstration history
          </button>
          <button type="button" className="primary" onClick={exportPdf}>
            Download PDF report
          </button>
        </div>
      </div>

      <p className="storage-disclaimer" role="note">
        Local-storage disclaimer: history and clinical notes stay on this device/browser. They are not synced
        to a server in this prototype. Demonstration records are labeled separately from live assessments.
      </p>

      {message ? (
        <p className="toast" role="status">
          {message}
        </p>
      ) : null}

      <div className="profile-layout">
        <aside className="session-rail" aria-label="Sessions">
          <h3>Sessions</h3>
          {sessions.length === 0 ? (
            <p className="muted">No stored sessions yet. Load demonstrations to explore the dashboard.</p>
          ) : (
            <ul>
              {sessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className={session.id === selected?.id ? "active" : ""}
                    onClick={() => setSelectedId(session.id)}
                  >
                    <strong>{session.alias}</strong>
                    <span className={`source-pill source-${session.source}`}>
                      {sessionSourceLabel(session.source)}
                    </span>
                    <span className="muted">{session.completedAt.slice(0, 10) || "incomplete"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="profile-main">
          <nav className="profile-tabs" aria-label="Profile sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {tab === "overview" && (
            <div className="tab-panel">
              <h3>Overview</h3>
              {!selected || !scored ? (
                <p className="muted">Select or seed a session to review spatial patterns.</p>
              ) : (
                <>
                  <div className="stat-grid">
                    <article>
                      <h4>Source</h4>
                      <p>{sessionSourceLabel(selected.source)}</p>
                    </article>
                    <article>
                      <h4>Hit rate</h4>
                      <p>{formatPct(scored.targetSelection?.hitRate)}</p>
                    </article>
                    <article>
                      <h4>Pattern</h4>
                      <p>{scored.spatialPattern.kind}</p>
                    </article>
                    <article>
                      <h4>Practice cue</h4>
                      <p>
                        {scored.practice.cue} / {scored.practice.density}
                      </p>
                    </article>
                  </div>
                  <p>{scored.spatialPattern.description}</p>
                  <SpatialBoard session={selected} />
                </>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="tab-panel">
              <h3>Assessment history</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Alias</th>
                    <th>Source</th>
                    <th>Completed</th>
                    <th>Hits</th>
                    <th>Pattern</th>
                    <th>Comparable</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const result = scoreSession(session);
                    const comparable =
                      selected && session.id !== selected.id
                        ? services.sessionsComparable(selected, session)
                        : true;
                    return (
                      <tr key={session.id} className={session.id === selected?.id ? "selected" : ""}>
                        <td>
                          <button type="button" className="linkish" onClick={() => setSelectedId(session.id)}>
                            {session.alias}
                          </button>
                        </td>
                        <td>{sessionSourceLabel(session.source)}</td>
                        <td>{session.completedAt.slice(0, 19) || "—"}</td>
                        <td>
                          {result.targetSelection
                            ? `${result.targetSelection.hits}/${result.targetSelection.available}`
                            : "—"}
                        </td>
                        <td>{result.spatialPattern.kind}</td>
                        <td>{comparable ? "yes" : "no"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {selected ? <SpatialBoard session={selected} title="Selected session map" /> : null}
            </div>
          )}

          {tab === "gaze" && (
            <div className="tab-panel">
              <h3>Gaze analysis</h3>
              <p className="muted">
                Reuses `@neurovision/gaze` simulated-lab streams. Webcam path remains{" "}
                {provenanceFor("webcam").badge}; camera denial keeps click-only usable.
              </p>
              {gaze ? (
                <>
                  <p>
                    {SIMULATED_LAB_PROVENANCE.badge} · analysis {gaze.analysisVersion} · calibration avg error{" "}
                    {gaze.calibration.averageErrorPx}px
                  </p>
                  <button type="button" onClick={() => setWideGaze((v) => !v)}>
                    Show {wideGaze ? "left-biased" : "both-halves"} lab stream
                  </button>
                  {activeGazeStream ? (
                    <div className="gaze-card">
                      <h4>{activeGazeStream.label}</h4>
                      <p>
                        {activeGazeStream.samples.length} samples · {activeGazeStream.gaps.length} tracking gaps
                        (gaps never count as dwell)
                      </p>
                      <GazeQuickStats wide={wideGaze} />
                    </div>
                  ) : null}
                  <ol>
                    <li>Click sequence fixture length: {gaze.clicks.length}</li>
                    <li>Domain streams: {gaze.streams.map((s) => s.label).join(" · ")}</li>
                  </ol>
                </>
              ) : null}
            </div>
          )}

          {tab === "practice" && (
            <div className="tab-panel">
              <h3>Adaptive practice</h3>
              {suggested ? (
                <p>
                  Suggested from scoring: cue <strong>{suggested.cue}</strong>, density{" "}
                  <strong>{suggested.density}</strong>. {suggested.explanation}
                </p>
              ) : (
                <p className="muted">Select a scored session to see a suggestion.</p>
              )}
              <div className="practice-controls">
                <label>
                  Cue
                  <select value={cue} onChange={(e) => setCue(e.target.value as PracticeCue)}>
                    <option value="none">none</option>
                    <option value="left">left</option>
                    <option value="right">right</option>
                  </select>
                </label>
                <label>
                  Density
                  <select value={density} onChange={(e) => setDensity(e.target.value as BoardDensity)}>
                    <option value="standard">standard</option>
                    <option value="low">low</option>
                  </select>
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={scanGuide}
                    onChange={(e) => setScanGuide(e.target.checked)}
                  />
                  Self-paced row guide
                </label>
              </div>
              <div className="practice-result">
                <p>
                  Configured round: cue {practiceSetup.config.cue}, density {practiceSetup.config.density}, level{" "}
                  {practiceSetup.config.level}, stimuli {practiceSetup.layout.stimuli.length}.
                </p>
                <p>{practiceSetup.config.explanation}</p>
                {practiceSetup.config.override ? (
                  <p className="override" role="status">
                    Override: {practiceSetup.config.override}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {tab === "progress" && (
            <div className="tab-panel">
              <h3>Progress</h3>
              <p className="muted">
                Live comparable assessments only. Demonstration and practice layouts are excluded from the trend.
              </p>
              {!trendState || trendState.trend.points.length === 0 ? (
                <p>No comparable live points yet. Seed demos still appear under History as demonstration.</p>
              ) : (
                <ul className="progress-list">
                  {trendState.trend.points.map((point) => (
                    <li key={point.sessionId}>
                      <strong>{point.completedAt.slice(0, 10)}</strong> {point.alias}: hit{" "}
                      {formatPct(point.hitRate)}, omissions L/R {point.omissionsLeft}/{point.omissionsRight},{" "}
                      {point.patternKind}
                    </li>
                  ))}
                </ul>
              )}
              {trendState && trendState.trend.excluded.length > 0 ? (
                <details>
                  <summary>Excluded from trend ({trendState.trend.excluded.length})</summary>
                  <ul>
                    {trendState.trend.excluded.map((item) => (
                      <li key={`${item.sessionId}-${item.reason}`}>
                        {item.sessionId}: {item.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}

          {tab === "notes" && (
            <div className="tab-panel">
              <h3>Clinical notes</h3>
              <p className="storage-disclaimer">Stored only in this browser. Not a medical record system.</p>
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                rows={5}
                placeholder="Observation note (no diagnoses)…"
              />
              <div className="profile-actions">
                <button type="button" className="primary" onClick={saveNote}>
                  Save note
                </button>
              </div>
              <ul className="notes-list">
                {notes.map((note) => (
                  <li key={note.id}>
                    <div>
                      <strong>{note.updatedAt.slice(0, 19)}</strong>
                      <span className="muted"> · session {note.sessionId ?? "general"}</span>
                      <p>{note.body}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        deleteClinicalNote(note.id);
                        setNotes(listClinicalNotes());
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "reports" && (
            <div className="tab-panel">
              <h3>Reports</h3>
              <p>
                Generate a downloadable PDF from validated session scoring, comparable live trend points, and local
                clinical notes. Sources stay labeled.
              </p>
              <button type="button" className="primary" onClick={exportPdf}>
                Download clinician PDF
              </button>
              {selected && scored ? (
                <ul>
                  <li>
                    Selected: {selected.alias} ({sessionSourceLabel(selected.source)})
                  </li>
                  <li>Pattern: {scored.spatialPattern.kind}</li>
                  <li>Notes attached: {notes.length}</li>
                  <li>History rows: {sessions.length}</li>
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
