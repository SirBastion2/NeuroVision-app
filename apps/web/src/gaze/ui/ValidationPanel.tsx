import type { ValidationReport } from "../../metrics/types";

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
const px = (v: number | null, signed = false) => (v === null ? "n/a" : `${signed && v > 0 ? "+" : ""}${Math.round(v)} px`);

/** Validation results: targets with raw and corrected estimates, plus the accuracy figures. */
export function ValidationPanel({
  report,
  viewport,
  onAccept,
  onRecalibrate,
  onFreeLook,
}: {
  report: ValidationReport;
  viewport: { width: number; height: number };
  onAccept: () => void;
  onRecalibrate: () => void;
  onFreeLook: () => void;
}) {
  const lr = report.leftRightAccuracy;
  const good = lr !== null && lr >= 0.9;
  return (
    <section className="card scr-validation">
      <div className="scr-validation-head">
        <div>
          <span className="eyebrow plain">Validation · 7 held-out dots</span>
          <h3>{good ? "Left/right tracking looks usable" : "Tracking needs another try"}</h3>
          <p className="small">
            Horizontal position drives every neglect metric, so left/right accuracy and horizontal bias matter most. Vertical
            accuracy is weak by design and only used for approximate checks.
          </p>
        </div>
        <span className={`badge ${good ? "complete" : "incomplete"}`}>{good ? "≥ 90% left/right" : "below 90% left/right"}</span>
      </div>

      <div className="scr-validation-body">
        <svg className="scr-val-plot" viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="img" aria-label="Validation targets with raw and corrected gaze estimates">
          <rect width={viewport.width} height={viewport.height} rx={16} className="scr-val-bg" />
          <line x1={viewport.width / 2} x2={viewport.width / 2} y1={0} y2={viewport.height} className="scr-val-mid" />
          {[1, 2].map((i) => (
            <g key={i} className="scr-val-grid">
              <line x1={(viewport.width * i) / 3} x2={(viewport.width * i) / 3} y1={0} y2={viewport.height} />
              <line y1={(viewport.height * i) / 3} y2={(viewport.height * i) / 3} x1={0} x2={viewport.width} />
            </g>
          ))}
          {report.points.map((p, i) => (
            <g key={i}>
              {p.raw && <line className="scr-val-err" x1={p.target.x} y1={p.target.y} x2={p.raw.x} y2={p.raw.y} />}
              {p.corrected && <line className="scr-val-fix" x1={p.target.x} y1={p.target.y} x2={p.corrected.x} y2={p.corrected.y} />}
              <circle className="scr-val-target" cx={p.target.x} cy={p.target.y} r={18} />
              {p.raw && <circle className="scr-val-raw" cx={p.raw.x} cy={p.raw.y} r={9} />}
              {p.corrected && <circle className="scr-val-corr" cx={p.corrected.x} cy={p.corrected.y} r={8} />}
            </g>
          ))}
        </svg>
        <dl className="scr-val-stats">
          <div>
            <dt>Left / right</dt>
            <dd>{pct(lr)}</dd>
          </div>
          <div>
            <dt>3×3 cell</dt>
            <dd>{pct(report.cellAccuracy)}</dd>
          </div>
          <div>
            <dt>Mean error</dt>
            <dd>{px(report.meanErrorPx)}</dd>
          </div>
          <div>
            <dt>Horizontal bias</dt>
            <dd>{px(report.horizontalBiasPx, true)}</dd>
          </div>
          <div>
            <dt>Left-edge bias</dt>
            <dd>{px(report.leftEdgeBiasPx, true)}</dd>
          </div>
          <div>
            <dt>Correction</dt>
            <dd className="scr-val-small">
              {report.correctionApplied ? "Applied" : "Not applied"}
              <small>
                LOO {px(report.looErrorRawPx)} → {px(report.looErrorCorrectedPx)}
              </small>
            </dd>
          </div>
        </dl>
      </div>
      <p className="scr-legend small">
        <i className="scr-key target" /> Target <i className="scr-key raw" /> Raw estimate <i className="scr-key corr" /> After correction
      </p>
      <div className="actions">
        <button className="ghost" onClick={onFreeLook}>
          Free look
        </button>
        <button onClick={onRecalibrate}>Recalibrate</button>
        <button className="primary" onClick={onAccept}>
          Continue
        </button>
      </div>
    </section>
  );
}
