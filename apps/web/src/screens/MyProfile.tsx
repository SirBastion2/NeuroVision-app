import { useMemo } from "react";
import {
  scoreSession,
  sessionSourceLabel,
  type SessionRecord,
} from "@neurovision/domain";
import { Eyebrow } from "../components/Brand";
import { dateTime, pct } from "../lib/format";

interface Props {
  sessions: readonly SessionRecord[];
  onHome: () => void;
  onHistory: () => void;
  onOpen: (session: SessionRecord) => void;
  onClinicianDashboard: () => void;
}

/** Patient-facing profile built from saved browser sessions (no mock identity). */
export function MyProfile({ sessions, onHome, onHistory, onOpen, onClinicianDashboard }: Props) {
  const live = useMemo(
    () => sessions.filter((session) => session.source === "live").slice().reverse(),
    [sessions],
  );
  const demos = useMemo(
    () => sessions.filter((session) => session.source === "demonstration"),
    [sessions],
  );
  const latest = live[0] ?? null;
  const alias = latest?.alias ?? "No live assessments yet";

  return (
    <div className="my-profile">
      <header className="page-head">
        <div>
          <Eyebrow>My Profile</Eyebrow>
          <h1>{alias}</h1>
          <p className="meta">
            Patient view · sessions stay in this browser · demonstration records stay labeled separately
          </p>
        </div>
        <div className="badges">
          <span className="badge live">{live.length} live</span>
          <span className="badge demonstration">{demos.length} demonstration</span>
        </div>
      </header>

      <section className="card my-profile-summary">
        <Eyebrow plain>Participant</Eyebrow>
        {latest ? (
          <>
            <h2>{latest.alias}</h2>
            <p>
              Profile id <code>{latest.profileId}</code> · last completed {dateTime(latest.completedAt)} ·{" "}
              {sessionSourceLabel(latest.source)}
            </p>
            <p className="small">
              This page reads the same saved assessments History and the clinician dashboard use. No separate
              account store.
            </p>
          </>
        ) : (
          <>
            <h2>Start an assessment to build your profile</h2>
            <p>
              Complete a live session from Home. It will appear here with scoring, then also in the clinician
              dashboard under the same browser store.
            </p>
          </>
        )}
        <div className="actions">
          <button className="primary" type="button" onClick={onHome}>
            Go to Home
          </button>
          <button type="button" onClick={onHistory}>
            Open History
          </button>
          <button className="ghost" type="button" onClick={onClinicianDashboard}>
            Clinician Dashboard
          </button>
        </div>
      </section>

      <section className="my-profile-list" aria-labelledby="my-live-title">
        <div className="section-head">
          <div>
            <Eyebrow plain>Live assessments</Eyebrow>
            <h2 id="my-live-title">Your recorded sessions</h2>
          </div>
        </div>
        {live.length === 0 ? (
          <p className="notice">No live sessions saved yet.</p>
        ) : (
          <ul className="my-profile-sessions">
            {live.map((session) => {
              const scored = scoreSession(session);
              const ts = scored.targetSelection;
              return (
                <li key={session.id}>
                  <button type="button" className="card link-card my-session-card" onClick={() => onOpen(session)}>
                    <div>
                      <strong>{session.alias}</strong>
                      <span className={`badge ${session.source}`}>{sessionSourceLabel(session.source)}</span>
                      <span className={`badge ${session.status}`}>
                        {session.status === "complete" ? "Complete" : "Incomplete"}
                      </span>
                    </div>
                    <p>
                      {dateTime(session.completedAt || session.startedAt)}
                      {ts ? ` · targets ${ts.hits}/${ts.available} (${pct(ts.hitRate)})` : ""}
                      {session.practice.length ? ` · ${session.practice.length} practice round(s)` : ""}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {demos.length > 0 ? (
        <section className="my-profile-list" aria-labelledby="my-demo-title">
          <div className="section-head">
            <div>
              <Eyebrow plain>Demonstration</Eyebrow>
              <h2 id="my-demo-title">Labeled demo records in this browser</h2>
            </div>
          </div>
          <p className="small">
            These are not patient-recorded assessments. They remain marked as demonstration in History and the
            clinician dashboard.
          </p>
          <ul className="my-profile-sessions">
            {demos.map((session) => (
              <li key={session.id}>
                <button type="button" className="card link-card my-session-card" onClick={() => onOpen(session)}>
                  <div>
                    <strong>{session.alias}</strong>
                    <span className={`badge ${session.source}`}>{sessionSourceLabel(session.source)}</span>
                  </div>
                  <p>{dateTime(session.completedAt || session.startedAt)}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
