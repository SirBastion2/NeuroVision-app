import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  findTargetSelectionTrial,
  scoreSession,
  type SessionRecord,
} from "@neurovision/domain";

interface SpatialBoardProps {
  session: SessionRecord;
  title?: string;
}

/** Board-space hit / omission map from scored target-selection events. */
export function SpatialBoard({ session, title = "Spatial response map" }: SpatialBoardProps) {
  const trial = findTargetSelectionTrial(session);
  const scored = scoreSession(session).targetSelection;
  if (!trial || !scored) {
    return (
      <div className="spatial-board empty">
        <p>No scored target-selection trial for this session.</p>
      </div>
    );
  }

  const hitIds = new Set(scored.orderedHits.map((hit) => hit.stimulusId));

  return (
    <figure className="spatial-board">
      <figcaption>
        {title}
        <span className="spatial-caption">
          {scored.hits}/{scored.available} hits · pattern {scoreSession(session).spatialPattern.kind}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        role="img"
        aria-label="Target selection board with hits and omissions"
      >
        <rect className="board-frame" x={0} y={0} width={BOARD_WIDTH} height={BOARD_HEIGHT} />
        <line className="midline" x1={BOARD_WIDTH / 2} y1={0} x2={BOARD_WIDTH / 2} y2={BOARD_HEIGHT} />
        <text className="side-label" x={120} y={36}>
          LEFT
        </text>
        <text className="side-label" x={BOARD_WIDTH - 120} y={36} textAnchor="end">
          RIGHT
        </text>
        {trial.layout.stimuli.map((stimulus) => {
          const hit = hitIds.has(stimulus.id);
          const isTarget = stimulus.kind === "target";
          const cls = !isTarget ? "distractor" : hit ? "hit" : "omission";
          return (
            <circle
              key={stimulus.id}
              className={cls}
              cx={stimulus.x}
              cy={stimulus.y}
              r={isTarget ? 14 : 10}
            />
          );
        })}
      </svg>
      <ul className="spatial-legend">
        <li>
          <span className="swatch hit" /> Hit
        </li>
        <li>
          <span className="swatch omission" /> Omission
        </li>
        <li>
          <span className="swatch distractor" /> Distractor
        </li>
      </ul>
    </figure>
  );
}
