import { useMemo, useState } from "react";
import {
  DEMONSTRATION_SESSIONS,
  scoreSession,
  sessionSourceLabel,
  summarizeAssessmentTrend,
  type SessionRecord,
  type TrendExclusionReason,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { TrendChart } from "../components/TrendChart";
import type { LoadResult } from "../data/sessionStore";
import { date, dateTime, pct, points } from "../lib/format";

interface Props {
  stored: LoadResult;
  onOpen: (session: SessionRecord) => void;
  onDelete: (id: string) => void;
  onHome: () => void;
}

const EXCLUDED: Record<TrendExclusionReason, string> = {
  demonstration: "Demonstration",
  practice: "No assessment board",
  unscored: "Not scored (interrupted)",
  incomparable: "Different protocol",
};

export function History({ stored, onOpen, onDelete, onHome }: Props) {
  const [showDemo, setShowDemo] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  const profiles = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stored.sessions) map.set(s.profileId, s.alias);
    return [...map.entries()];
  }, [stored.sessions]);
  const [profile, setProfile] = useState<string | null>(null);
  const activeProfile = profile && profiles.some(([id]) => id === profile) ? profile : (profiles[0]?.[0] ?? null);

  // The domain decides which live sessions share a trend; the UI only picks the participant.
  const trend = useMemo(
    () => summarizeAssessmentTrend(stored.sessions.filter((s) => s.profileId === activeProfile)),
    [stored.sessions, activeProfile],
  );
  const excluded = new Map(trend.excluded.map((e) => [e.sessionId, e.reason]));
  const included = new Set(trend.points.map((p) => p.sessionId));

  const rows = useMemo(
    () => [...stored.sessions, ...(showDemo ? DEMONSTRATION_SESSIONS : [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [stored.sessions, showDemo],
  );

  const trendCell = (s: SessionRecord) => {
    if (s.source === "demonstration") return EXCLUDED.demonstration;
    if (s.profileId !== activeProfile) return "Other participant";
    if (included.has(s.id)) return "In trend";
    return EXCLUDED[excluded.get(s.id) ?? "unscored"];
  };

  return (
    <div className="history">
      <header className="page-head">
        <div>
          <Eyebrow>History</Eyebrow>
          <h1>Sessions over time</h1>
        </div>
        {profiles.length > 1 && (
          <label className="field inline">
            <span>Participant</span>
            <select value={activeProfile ?? ""} onChange={(e) => setProfile(e.target.value)}>
              {profiles.map(([id, alias]) => (
                <option key={id} value={id}>
                  {alias}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {stored.error && (
        <p className="notice error" role="alert">
          Stored sessions could not be read: {stored.error}
        </p>
      )}
      {stored.rejected > 0 && (
        <p className="notice warn">
          {stored.rejected} stored record{stored.rejected === 1 ? "" : "s"} failed validation and {stored.rejected === 1 ? "is" : "are"} hidden. Nothing was deleted.
        </p>
      )}

      {trend.points.length >= 2 ? (
        <section className="trends">
          <TrendChart
            title="Targets found"
            subtitle={`${profiles.find(([id]) => id === activeProfile)?.[1] ?? ""} · live assessments`}
            min={0}
            max={1}
            format={(v) => pct(v)}
            points={trend.points.map((p) => ({ id: p.sessionId, label: date(p.completedAt), value: p.hitRate }))}
          />
          <TrendChart
            title="Omission gap, left − right"
            subtitle="percentage points · 0 = balanced"
            min={-100}
            max={100}
            zeroLine
            format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}`}
            points={trend.points.map((p) => ({ id: p.sessionId, label: date(p.completedAt), value: p.omissionAsymmetry }))}
          />
        </section>
      ) : (
        <section className="card empty-trend">
          <svg viewBox="0 0 120 48" aria-hidden>
            <path d="M6 38 L40 26 L74 30 L114 10" />
            <circle cx="6" cy="38" r="4" />
            <circle cx="40" cy="26" r="4" />
          </svg>
          <div>
            <h3>The trend starts at two sessions</h3>
            <p className="small">
              Charts join a participant’s comparable live assessments. {trend.points.length === 1 ? "One is recorded so far." : "None are recorded yet."}{" "}
              Demonstration and practice records never enter the trend.
            </p>
          </div>
        </section>
      )}

      <section className="card pad-0">
        <div className="card-head">
          <h3>All sessions</h3>
          <label className="check">
            <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
            Show demonstrations
          </label>
        </div>
        <div className="table-scroll">
          <table className="sessions">
            <thead>
              <tr>
                <th>Date</th>
                <th>Alias</th>
                <th>Source</th>
                <th>Found</th>
                <th>Gap</th>
                <th>Pattern</th>
                <th>Trend</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    No sessions yet. Run an assessment from Home.
                  </td>
                </tr>
              )}
              {rows.map((session) => {
                const result = scoreSession(session);
                const ts = result.targetSelection;
                return (
                  <tr key={session.id}>
                    <td>{dateTime(session.startedAt)}</td>
                    <td>
                      <strong>{session.alias}</strong>
                    </td>
                    <td>
                      <span className={`badge ${session.source}`}>{sessionSourceLabel(session.source)}</span>
                    </td>
                    <td>{ts ? `${ts.hits}/${ts.available}` : "n/a"}</td>
                    <td>{points(ts?.omissionAsymmetry ?? null, 0)}</td>
                    <td>{result.spatialPattern.kind.replace("-", " ")}</td>
                    <td className="small">{trendCell(session)}</td>
                    <td className="row-actions">
                      <button onClick={() => onOpen(session)}>Open</button>
                      {session.source === "live" &&
                        (confirming === session.id ? (
                          <>
                            <button className="danger" onClick={() => (onDelete(session.id), setConfirming(null))}>
                              Confirm delete
                            </button>
                            <button className="ghost" onClick={() => setConfirming(null)}>
                              Keep
                            </button>
                          </>
                        ) : (
                          <button className="ghost" onClick={() => setConfirming(session.id)}>
                            Delete
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="actions">
        <button onClick={onHome}>Home</button>
      </div>
    </div>
  );
}
