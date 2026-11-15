import { useMemo, useState } from "react";
import {
  scoreSession,
  sessionSourceLabel,
  summarizeAssessmentTrend,
  type BatteryRecord,
  type SessionRecord,
  type TrendExclusionReason,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { TrendChart } from "../components/TrendChart";
import type { LoadResult } from "../data/sessionStore";
import { LEFT_RIGHT_MISSES_HINT, LEFT_RIGHT_MISSES_LABEL, date, dateTime, missShareGap, pct } from "../lib/format";
import { jobForSession, processingLabel, showApiControls } from "../services/screen-wiring";
import type { ProcessingSnapshot } from "../services/api-client";
import type { UploadQueueState } from "../services/upload-queue";

interface Props {
  stored: LoadResult;
  batteries?: BatteryRecord[];
  activity?: Array<{ bucket: string; count: number }>;
  onOpen: (session: SessionRecord) => void;
  onDelete: (id: string) => void;
  onHome: () => void;
  apiEnabled?: boolean;
  processing?: Record<string, ProcessingSnapshot>;
  queue?: UploadQueueState;
  actionError?: string | null;
  onExport?: () => void;
  onDeleteParticipant?: () => void;
}

const EXCLUDED: Record<TrendExclusionReason, string> = {
  demonstration: "Demonstration",
  practice: "No assessment board",
  unscored: "Not scored (interrupted)",
  incomparable: "Different protocol",
};

function starryCell(battery: BatteryRecord | undefined): string {
  const detection = battery?.detection;
  if (!detection) return "n/a";
  return `${detection.left.hits}/${detection.left.targets} L · ${detection.right.hits}/${detection.right.targets} R`;
}

export function History({
  stored,
  batteries = [],
  activity = [],
  onOpen,
  onDelete,
  onHome,
  apiEnabled = false,
  processing = {},
  queue,
  actionError,
  onExport,
  onDeleteParticipant,
}: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmParticipant, setConfirmParticipant] = useState(false);
  const apiControls = showApiControls(apiEnabled);

  const liveSessions = useMemo(
    () => stored.sessions.filter((s) => s.source !== "demonstration"),
    [stored.sessions],
  );
  const profiles = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of liveSessions) map.set(s.profileId, s.alias);
    return [...map.entries()];
  }, [liveSessions]);
  const [profile, setProfile] = useState<string | null>(null);
  const activeProfile = profile && profiles.some(([id]) => id === profile) ? profile : (profiles[0]?.[0] ?? null);

  // The domain decides which live sessions share a trend; the UI only picks the participant.
  const trend = useMemo(
    () => summarizeAssessmentTrend(liveSessions.filter((s) => s.profileId === activeProfile)),
    [liveSessions, activeProfile],
  );
  const excluded = new Map(trend.excluded.map((e) => [e.sessionId, e.reason]));
  const included = new Set(trend.points.map((p) => p.sessionId));

  const rows = useMemo(
    () => [...liveSessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [liveSessions],
  );
  const batteryById = useMemo(() => new Map(batteries.map((record) => [record.id, record])), [batteries]);
  const activeAlias = profiles.find(([id]) => id === activeProfile)?.[1] ?? null;
  const latest = rows.find((s) => s.profileId === activeProfile) ?? rows[0] ?? null;

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
          <p className="meta">
            {activeAlias ? `${activeAlias} · ` : ""}
            {latest ? `last completed ${dateTime(latest.completedAt || latest.startedAt)} · ` : ""}
            {apiControls
              ? "saved assessments sync with this participant ID when the server is reachable"
              : "saved assessments stay in this browser"}
          </p>
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

      {actionError && (
        <p className="notice error" role="alert">
          {actionError}
        </p>
      )}
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
      {activity.length > 0 && (
        <p className="small">
          Server activity by day: {activity.map((row) => `${date(row.bucket)} (${row.count})`).join(" · ")}
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
            points={trend.points.map((p) => ({
              id: p.sessionId,
              at: p.completedAt,
              label: date(p.completedAt),
              value: p.hitRate,
            }))}
          />
          <TrendChart
            title={LEFT_RIGHT_MISSES_LABEL}
            subtitle={LEFT_RIGHT_MISSES_HINT}
            min={-100}
            max={100}
            zeroLine
            format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}`}
            points={trend.points.map((p) => ({
              id: p.sessionId,
              at: p.completedAt,
              label: date(p.completedAt),
              value: p.omissionAsymmetry,
            }))}
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
              Charts join a participant’s comparable live assessments. {trend.points.length === 1 ? "One is recorded so far." : "None are recorded yet."}
            </p>
          </div>
        </section>
      )}

      <section className="card pad-0">
        <div className="card-head">
          <h3>All sessions</h3>
        </div>
        <div className="table-scroll">
          <table className="sessions">
            <thead>
              <tr>
                <th>Date</th>
                <th>Participant</th>
                <th>Source</th>
                <th>Starry Night</th>
                <th>Rings found</th>
                <th>Left vs right</th>
                <th>Pattern</th>
                <th>Trend</th>
                {apiControls && <th>Server</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={apiControls ? 10 : 9} className="empty">
                    No sessions yet. Run an assessment from Home to build this history.
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
                      <span className={`badge ${session.source}`}>{sessionSourceLabel(session.source)}</span>{" "}
                      <span className={`badge ${session.status}`}>
                        {session.status === "complete" ? "Complete" : "Incomplete"}
                      </span>
                    </td>
                    <td>{starryCell(batteryById.get(session.id))}</td>
                    <td>{ts ? `${ts.hits}/${ts.available}` : "n/a"}</td>
                    <td>{missShareGap(ts?.omissionAsymmetry ?? null)}</td>
                    <td>{result.spatialPattern.kind.replace("-", " ")}</td>
                    <td className="small">{trendCell(session)}</td>
                    {apiControls && (
                      <td className="small">
                        {processingLabel(processing[session.id], queue ? jobForSession(queue, session.id) : undefined) ?? "Local"}
                      </td>
                    )}
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
        {apiControls && onExport && (
          <button className="ghost" type="button" onClick={onExport}>
            Export
          </button>
        )}
        {apiControls && onDeleteParticipant &&
          (confirmParticipant ? (
            <>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  onDeleteParticipant();
                  setConfirmParticipant(false);
                }}
              >
                Confirm delete
              </button>
              <button className="ghost" type="button" onClick={() => setConfirmParticipant(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="ghost" type="button" onClick={() => setConfirmParticipant(true)}>
              Delete participant
            </button>
          ))}
        <button onClick={onHome}>Home</button>
      </div>
    </div>
  );
}
