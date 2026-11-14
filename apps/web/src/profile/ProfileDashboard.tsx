import { useEffect, useMemo, useState } from "react";
import {
  scoreSession,
  sessionSourceLabel,
  type BoardDensity,
  type PracticeCue,
  type SessionRecord,
} from "@neurovision/domain";
import { SIMULATED_LAB_PROVENANCE } from "@neurovision/gaze";
import { TrendChart } from "../components/TrendChart";
import { createAppServices, type AppServices, type GazeLabData } from "../services";
import { canUseLocalHistoryStore, createLocalHistoryStore } from "../services/local-history-store";
import { LEFT_RIGHT_MISSES_HINT, LEFT_RIGHT_MISSES_LABEL, missShareGap } from "../lib/format";
import { GazeAttentionMap } from "./GazeAttentionMap";
import { DEMO_PATIENT_PROFILES, type DemoPatientId } from "./demo-patients";
import {
  deleteClinicalNote,
  listClinicalNotes,
  saveClinicalNote,
  type ClinicalNote,
} from "./notes-store";
import { SpatialBoard } from "./SpatialBoard";
import { buildClinicianReportPdf, downloadBlob } from "./report-pdf";
import "./profile.css";

type TabId = "overview" | "assessments" | "gaze" | "practice" | "progress" | "reports";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "assessments", label: "Assessments" },
  { id: "gaze", label: "Gaze & Attention" },
  { id: "practice", label: "Practice" },
  { id: "progress", label: "Progress" },
  { id: "reports", label: "Reports & Notes" },
];

const GAZE_DURATION_MS = 22_000;

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatSigned(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function createServices(): AppServices {
  return createAppServices({
    store: canUseLocalHistoryStore() ? createLocalHistoryStore() : undefined,
  });
}

function groupByProfile(sessions: SessionRecord[]): Array<{ profileId: string; alias: string; sessions: SessionRecord[] }> {
  const map = new Map<string, { profileId: string; alias: string; sessions: SessionRecord[] }>();
  for (const session of sessions) {
    const existing = map.get(session.profileId);
    if (existing) existing.sessions.push(session);
    else map.set(session.profileId, { profileId: session.profileId, alias: session.alias, sessions: [session] });
  }
  return [...map.values()].map((group) => ({
    ...group,
    sessions: [...group.sessions].sort(
      (a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id),
    ),
  }));
}

interface ProfileDashboardProps {
  onBackToPatient?: () => void;
}

/**
 * Clinician dashboard presentation overhaul (IA + visuals).
 * Scoring, practice configuration, gaze helpers, and PDF remain existing algorithms.
 */
export function ProfileDashboard({ onBackToPatient }: ProfileDashboardProps) {
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
  const patients = useMemo(() => groupByProfile(sessions), [sessions]);
  const selectedPatient = selected
    ? patients.find((patient) => patient.profileId === selected.profileId) ?? null
    : patients[0] ?? null;

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

  async function loadDemoPatient(id: DemoPatientId) {
    setBusy(true);
    try {
      const profile = DEMO_PATIENT_PROFILES.find((item) => item.id === id)!;
      let latest: SessionRecord | null = null;
      for (const session of profile.sessions) {
        latest = await services.save(session);
      }
      await refresh(latest?.id ?? null);
      setTab("overview");
      setMessage(`${profile.label} loaded (demonstration). ${profile.summary}`);
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
      profileAlias: selectedPatient?.alias ?? selected?.alias ?? "Local participant",
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

  const metrics = [
    {
      label: "Hit rate",
      value: formatPct(scored?.targetSelection?.hitRate),
      hint: "Targets found",
    },
    {
      label: "Left omissions",
      value: scored?.targetSelection ? String(scored.targetSelection.left.omissions) : "—",
      hint: "Left half misses",
    },
    {
      label: "Right omissions",
      value: scored?.targetSelection ? String(scored.targetSelection.right.omissions) : "—",
      hint: "Right half misses",
    },
    {
      label: LEFT_RIGHT_MISSES_LABEL,
      value: missShareGap(scored?.targetSelection?.omissionAsymmetry ?? null),
      hint: LEFT_RIGHT_MISSES_HINT,
    },
    {
      label: "Line median",
      value: formatSigned(scored?.lineBisection.signedMedian),
      hint: "Signed bisection",
    },
  ];

  const hitTrend =
    trendState?.trend.points.map((point) => ({
      id: point.sessionId,
      label: point.completedAt.slice(0, 10),
      value: point.hitRate,
    })) ?? [];

  const omissionTrend =
    trendState?.trend.points.map((point) => ({
      id: `${point.sessionId}-omit`,
      label: point.completedAt.slice(0, 10),
      value: point.omissionsLeft - point.omissionsRight,
    })) ?? [];

  return (
    <section className="profile-dashboard clinician-shell" aria-labelledby="profile-title">
      {/* A — page chrome */}
      <header className="clinician-band">
        <div>
          <p className="eyebrow">Clinician dashboard</p>
          <h2 id="profile-title">Care review workspace</h2>
          <p className="lede">
            Research observations from validated local sessions. No diagnoses or treatment claims.
          </p>
        </div>
        <div className="profile-actions">
          {onBackToPatient ? (
            <button type="button" onClick={onBackToPatient}>
              Back to Patient View
            </button>
          ) : null}
          <button type="button" className="primary" onClick={exportPdf}>
            Download PDF
          </button>
        </div>
      </header>

      <p className="storage-disclaimer" role="note">
        Local-storage disclaimer: history and clinical notes stay on this device/browser. Demonstration and
        simulated-lab records stay labeled separately from live assessments.
      </p>

      {/* Demo patients */}
      <div className="demo-patient-bar" role="group" aria-label="Load demonstration patients">
        <span className="demo-patient-label">Load Demo Patient</span>
        {DEMO_PATIENT_PROFILES.map((profile) => (
          <button
            key={profile.id}
            type="button"
            disabled={busy}
            title={profile.summary}
            onClick={() => void loadDemoPatient(profile.id)}
          >
            {profile.id}
          </button>
        ))}
        <span className="muted small">A balanced · B left-omission · C right-omission (all demonstration)</span>
      </div>

      {message ? (
        <p className="toast" role="status">
          {message}
        </p>
      ) : null}

      {/* B — patient summary + five metrics */}
      <section className="patient-summary" aria-label="Selected patient summary">
        {selected && scored ? (
          <>
            <div className="patient-identity">
              <h3>{selected.alias}</h3>
              <div className="patient-meta">
                <span className={`source-pill source-${selected.source}`}>
                  {sessionSourceLabel(selected.source)}
                </span>
                <span className={`source-pill status-${selected.status}`}>{selected.status}</span>
                <span className="muted">
                  {selected.completedAt ? selected.completedAt.slice(0, 19).replace("T", " ") : "incomplete"}
                </span>
                <span className="muted">pattern {scored.spatialPattern.kind}</span>
              </div>
              <p>{scored.spatialPattern.description}</p>
            </div>
            <div className="metric-strip" role="list">
              {metrics.map((metric) => (
                <article key={metric.label} role="listitem">
                  <h4>{metric.label}</h4>
                  <p>{metric.value}</p>
                  <span>{metric.hint}</span>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h3>No patient session selected</h3>
            <p>
              Run a live assessment from Home, or load Demo Patient A, B, or C to explore the clinician
              workspace with labeled demonstration data.
            </p>
          </div>
        )}
      </section>

      {/* C / D — roster + tabbed workspace */}
      <div className="profile-layout">
        <aside className="session-rail" aria-label="Patients and sessions">
          <h3>Patients</h3>
          {patients.length === 0 ? (
            <p className="muted">Empty roster. Load a demo patient or complete a live assessment.</p>
          ) : (
            <ul className="patient-roster">
              {patients.map((patient) => (
                <li key={patient.profileId}>
                  <button
                    type="button"
                    className={patient.profileId === selectedPatient?.profileId ? "active" : ""}
                    onClick={() => setSelectedId(patient.sessions[patient.sessions.length - 1]?.id ?? null)}
                  >
                    <strong>{patient.alias}</strong>
                    <span className="muted">
                      {patient.sessions.length} session{patient.sessions.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  <ul className="session-sublist">
                    {patient.sessions.map((session) => (
                      <li key={session.id}>
                        <button
                          type="button"
                          className={session.id === selected?.id ? "active" : ""}
                          onClick={() => setSelectedId(session.id)}
                        >
                          <span className={`source-pill source-${session.source}`}>
                            {sessionSourceLabel(session.source)}
                          </span>
                          <span className="muted">{session.completedAt.slice(0, 10) || "incomplete"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="profile-main">
          <nav className="profile-tabs" aria-label="Clinician sections">
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
                <div className="empty-state compact">
                  <p>Select a patient session to review spatial patterns and the response map.</p>
                </div>
              ) : (
                <>
                  <p className="panel-lede">{scored.spatialPattern.description}</p>
                  <SpatialBoard session={selected} title="Spatial response map" />
                  <div className="overview-chips">
                    <span>Practice cue {scored.practice.cue}</span>
                    <span>Density {scored.practice.density}</span>
                    <span>Level {scored.practice.level}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "assessments" && (
            <div className="tab-panel">
              <h3>Assessments</h3>
              {sessions.length === 0 ? (
                <div className="empty-state compact">
                  <p>No assessments in local history yet.</p>
                </div>
              ) : (
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
              )}
              {selected ? <SpatialBoard session={selected} title="Selected assessment map" /> : null}
            </div>
          )}

          {tab === "gaze" && (
            <div className="tab-panel">
              <h3>Gaze &amp; Attention</h3>
              <p className="panel-lede">
                Visual attention from simulated-lab streams. Webcam observation stays separately labeled if
                available later; tracking gaps never count as dwell.
              </p>
              {gaze && activeGazeStream ? (
                <>
                  <div className="profile-actions">
                    <button type="button" onClick={() => setWideGaze((value) => !value)}>
                      Show {wideGaze ? "left-biased" : "both-halves"} attention map
                    </button>
                  </div>
                  <GazeAttentionMap
                    label={activeGazeStream.label}
                    samples={activeGazeStream.samples}
                    gaps={activeGazeStream.gaps}
                    durationMs={GAZE_DURATION_MS}
                    badge={SIMULATED_LAB_PROVENANCE.badge}
                  />
                </>
              ) : (
                <div className="empty-state compact">
                  <p>Gaze lab streams are unavailable in this runtime.</p>
                </div>
              )}
            </div>
          )}

          {tab === "practice" && (
            <div className="tab-panel">
              <h3>Practice</h3>
              {suggested ? (
                <p className="panel-lede">
                  Suggested from scoring: cue <strong>{suggested.cue}</strong>, density{" "}
                  <strong>{suggested.density}</strong>. {suggested.explanation}
                </p>
              ) : (
                <div className="empty-state compact">
                  <p>Select a scored session to see an adaptive practice suggestion.</p>
                </div>
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
              <p className="panel-lede">
                Live comparable assessments only. Demonstration and practice layouts stay out of the trend.
              </p>
              {!trendState || trendState.trend.points.length === 0 ? (
                <div className="empty-state compact">
                  <p>
                    No comparable live points yet. Demo patients appear under Assessments as demonstration and
                    do not enter this trend.
                  </p>
                </div>
              ) : (
                <div className="progress-charts">
                  <TrendChart
                    title="Hit rate over time"
                    subtitle="Comparable live assessments"
                    points={hitTrend}
                    min={0}
                    max={1}
                    format={(value) => `${Math.round(value * 100)}%`}
                  />
                  <TrendChart
                    title={LEFT_RIGHT_MISSES_LABEL}
                    subtitle={LEFT_RIGHT_MISSES_HINT}
                    points={omissionTrend}
                    min={Math.min(-8, ...omissionTrend.map((point) => point.value ?? 0))}
                    max={Math.max(8, ...omissionTrend.map((point) => point.value ?? 0))}
                    format={(value) => formatSigned(value, 0)}
                    zeroLine
                  />
                </div>
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

          {tab === "reports" && (
            <div className="tab-panel">
              <h3>Reports &amp; Notes</h3>
              <div className="reports-grid">
                <div className="report-card">
                  <h4>PDF report</h4>
                  <p>
                    Download a polished clinician PDF from validated scoring, comparable live trend points, and
                    local notes. Sources stay labeled.
                  </p>
                  <button type="button" className="primary" onClick={exportPdf}>
                    Download clinician PDF
                  </button>
                  {selected && scored ? (
                    <ul className="report-meta">
                      <li>
                        Selected: {selected.alias} ({sessionSourceLabel(selected.source)})
                      </li>
                      <li>Pattern: {scored.spatialPattern.kind}</li>
                      <li>Notes attached: {notes.length}</li>
                      <li>History rows: {sessions.length}</li>
                    </ul>
                  ) : null}
                </div>
                <div className="report-card">
                  <h4>Clinical notes</h4>
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
                  {notes.length === 0 ? (
                    <p className="muted">No notes yet for this browser profile.</p>
                  ) : (
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
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
