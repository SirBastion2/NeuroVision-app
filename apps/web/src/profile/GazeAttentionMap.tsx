import { useMemo } from "react";
import { BOARD_HEIGHT, BOARD_WIDTH, type GazeSample, type TrackingGap } from "@neurovision/domain";
import { gazeSummary } from "@neurovision/gaze";

interface Props {
  label: string;
  samples: readonly GazeSample[];
  gaps: readonly TrackingGap[];
  durationMs: number;
  badge: string;
}

/** Visual attention map for simulated-lab gaze — not a raw telemetry dump. */
export function GazeAttentionMap({ label, samples, gaps, durationMs, badge }: Props) {
  const summary = useMemo(
    () => gazeSummary({ samples: [...samples], gaps: gaps.map((gap) => ({ ...gap })) }, durationMs),
    [samples, gaps, durationMs],
  );
  const leftShare = summary.tracked ? summary.left / summary.tracked : 0;
  const rightShare = summary.tracked ? Math.max(0, 1 - leftShare) : 0;

  return (
    <figure className="gaze-attention">
      <figcaption>
        <div>
          <strong>{label}</strong>
          <span className="source-pill source-demonstration">{badge}</span>
        </div>
        <span className="spatial-caption">
          Attention share L {Math.round(leftShare * 100)}% · R {Math.round(rightShare * 100)}% · tracked{" "}
          {Math.round(summary.tracked / 1000)}s
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        role="img"
        aria-label={`${label}: left ${Math.round(leftShare * 100)} percent, right ${Math.round(rightShare * 100)} percent`}
      >
        <rect className="board-frame" x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} />
        <rect className="gaze-half left" x={0} y={0} width={BOARD_WIDTH / 2} height={BOARD_HEIGHT} />
        <rect className="gaze-half right" x={BOARD_WIDTH / 2} y={0} width={BOARD_WIDTH / 2} height={BOARD_HEIGHT} />
        <line className="midline" x1={BOARD_WIDTH / 2} y1={0} x2={BOARD_WIDTH / 2} y2={BOARD_HEIGHT} />
        <text className="side-label" x={120} y={36}>
          LEFT
        </text>
        <text className="side-label" x={BOARD_WIDTH - 120} y={36} textAnchor="end">
          RIGHT
        </text>
        {samples.map((sample, index) =>
          index % 3 === 0 ? (
            <circle
              key={`${sample.elapsed}-${index}`}
              className={sample.x < BOARD_WIDTH / 2 ? "gaze-dot left" : "gaze-dot right"}
              cx={sample.x}
              cy={sample.y}
              r={7}
            />
          ) : null,
        )}
      </svg>
      <div className="gaze-share" aria-hidden>
        <div className="gaze-share-left" style={{ width: `${Math.max(4, leftShare * 100)}%` }} />
        <div className="gaze-share-right" style={{ width: `${Math.max(4, rightShare * 100)}%` }} />
      </div>
      <p className="small muted">
        Tracking gaps ({gaps.length}) interrupt the stream and never count as dwell. This view is simulated-lab
        attention for demonstration — not webcam observation.
      </p>
    </figure>
  );
}
