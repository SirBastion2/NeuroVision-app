import type { SessionResult } from "../../metrics/types";
import { sessionToJson } from "../../metrics/types";
import { downloadJson } from "./ResultsView";

const signed = (v: number | null | undefined, d = 2, unit = "") => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(d)}${unit}`);

/** This visit's sessions, newest first, with per-row open and a download of all as JSON. */
export function VisitTable({ sessions, activeId, onOpen, onClear }: { sessions: readonly SessionResult[]; activeId: string | null; onOpen: (s: SessionResult) => void; onClear: () => void }) {
  if (!sessions.length) return null;
  const rows = [...sessions].reverse();
  return (
    <section className="card pad-0">
      <div className="card-head">
        <h3>This visit · {sessions.length} session{sessions.length === 1 ? "" : "s"}</h3>
        <div className="scr-toggles">
          <button className="ghost" onClick={onClear}>
            Clear
          </button>
          <button onClick={() => downloadJson(`visit-${new Date().toISOString().slice(0, 10)}.json`, sessionToJson([...sessions]))}>Download all JSON</button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="sessions">
          <thead>
            <tr>
              <th>When</th>
              <th>Test</th>
              <th>Source</th>
              <th>Label</th>
              <th>CoC / bisection</th>
              <th>Gaze left</th>
              <th>Deviation</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const t = s.metrics.test;
              const g = s.metrics.gaze;
              return (
                <tr key={s.id} className={s.id === activeId ? "scr-row-on" : ""}>
                  <td>{new Date(s.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
                  <td>
                    {t.kind === "star-cancellation" ? "Stars" : "Bisection"}
                    {s.cued ? " · cued" : ""}
                    <small> L{s.difficulty.level}</small>
                  </td>
                  <td>
                    <span className={`badge ${s.source === "synthetic" ? "demonstration" : "live"}`}>{s.source}</span>
                  </td>
                  <td className="scr-label-cell">{s.label}</td>
                  <td>{t.kind === "star-cancellation" ? signed(t.centerOfCancellation) : signed(t.meanDeviation, 1, "%")}</td>
                  <td>{g?.leftGazeFraction == null ? "n/a" : `${Math.round(g.leftGazeFraction * 100)}%`}</td>
                  <td>{s.metrics.deviation.score.toFixed(2)}</td>
                  <td className="row-actions">
                    <button onClick={() => onOpen(s)}>Open</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
