import {
  BOARD_REGIONS,
  lineLength,
  scoreLineBisection,
  type BoardRegion,
  type SelectionCounts,
  type TargetSelectionScore,
  type TrialRecord,
} from "@neurovision/domain";
import { seconds, signedPct } from "../lib/format";

/** Left and right hits growing outward from the board midline, on one shared scale. */
export function BalanceBar({ score }: { score: TargetSelectionScore }) {
  const side = (label: string, c: SelectionCounts, cls: string) => (
    <div className={`balance-side ${cls}`}>
      <div className="balance-track" title={`${label}: ${c.hits} of ${c.available} found, ${c.omissions} missed`}>
        <div className="balance-fill" style={{ width: `${c.available ? (100 * c.hits) / c.available : 0}%` }} />
      </div>
      <div className="balance-label">
        <span>{label}</span>
        <strong>
          {c.hits}
          <small> / {c.available}</small>
        </strong>
      </div>
    </div>
  );
  return (
    <div className="balance" role="img" aria-label={`Left ${score.left.hits} of ${score.left.available} found; right ${score.right.hits} of ${score.right.available} found`}>
      {side("Left half", score.left, "left")}
      <span className="balance-mid" aria-hidden />
      {side("Right half", score.right, "right")}
    </div>
  );
}

/** Six board regions laid out as they sit on the board; one hue, darker = more missed. */
export function RegionGrid({ regions }: { regions: Record<BoardRegion, SelectionCounts> }) {
  return (
    <div className="regions" role="table" aria-label="Omissions by board region">
      {BOARD_REGIONS.map((region) => {
        const r = regions[region];
        const rate = (r.omissionRate ?? 0) / 100;
        return (
          <div
            key={region}
            className="region"
            role="cell"
            style={{ ["--miss" as string]: String(rate) }}
            title={`${region.replace("-", " ")}: ${r.omissions} of ${r.available} missed`}
          >
            <span className="region-name">{region.replace("-", " · ")}</span>
            <strong>
              {r.omissions}
              <small> / {r.available}</small>
            </strong>
            <span className="region-sub">missed</span>
          </div>
        );
      })}
    </div>
  );
}

const END_TEXT: Record<TrialRecord["end"], string> = {
  done: "",
  timeout: "Time limit",
  stop: "Stopped",
  resize: "Window resized",
  hidden: "Tab hidden",
  skip: "Skipped",
};

/** Each line drawn to scale with the true centre and the participant's mark. */
export function LineDeviations({ trials, total }: { trials: readonly TrialRecord[]; total: number }) {
  return (
    <ol className="deviations">
      {Array.from({ length: total }, (_, i) => {
        const trial = trials[i];
        const line = trial?.line;
        const score = trial ? scoreLineBisection(trial) : null;
        const W = 700;
        const scale = 0.72;
        const x1 = line ? (W - lineLength(line) * scale) / 2 : 0;
        const x2 = line ? x1 + lineLength(line) * scale : 0;
        const mid = (x1 + x2) / 2;
        const mark = line && score?.error != null ? mid + (score.error / 100) * (x2 - x1) : null;
        return (
          <li key={i} className="deviation">
            <span className="deviation-n">{i + 1}</span>
            <svg viewBox={`0 0 ${W} 44`} role="img" aria-label={`Line ${i + 1}: ${score ? signedPct(score.error) : "not reached"}`}>
              {line ? (
                <>
                  <line className="dev-line" x1={x1} x2={x2} y1={22} y2={22} />
                  <line className="dev-centre" x1={mid} x2={mid} y1={8} y2={36} />
                  {mark !== null && (
                    <>
                      <line className="dev-gap" x1={mid} x2={mark} y1={22} y2={22} />
                      <line className="dev-mark" x1={mark} x2={mark} y1={5} y2={39} />
                    </>
                  )}
                </>
              ) : (
                <line className="dev-line none" x1={160} x2={540} y1={22} y2={22} />
              )}
            </svg>
            <span className="deviation-val">
              <strong>{!trial ? "Not reached" : score?.error != null ? signedPct(score.error) : END_TEXT[trial.end] || "No mark"}</strong>
              <small>
                {score?.responseElapsedMs != null ? seconds(score.responseElapsedMs) : ""}
                {score && score.outOfBand > 0 ? ` · ${score.outOfBand} off-line` : ""}
              </small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
