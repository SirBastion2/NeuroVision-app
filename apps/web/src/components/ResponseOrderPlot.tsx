import { useState, type ReactNode } from "react";
import {
  BOARD_HEIGHT,
  BOARD_MIDLINE_X,
  BOARD_REGIONS,
  BOARD_WIDTH,
  regionOfStimulus,
  type BoardRegion,
  type OrderedHit,
  type ResponseEvent,
  type TaskLayout,
} from "@neurovision/domain";
import { Board, StimulusMark } from "./Board";

const REGION_BOX: Record<BoardRegion, { x: number; y: number; width: number; height: number }> = {
  "left-top": { x: 0, y: 0, width: BOARD_MIDLINE_X, height: BOARD_HEIGHT / 3 },
  "left-middle": { x: 0, y: BOARD_HEIGHT / 3, width: BOARD_MIDLINE_X, height: BOARD_HEIGHT / 3 },
  "left-bottom": { x: 0, y: (2 * BOARD_HEIGHT) / 3, width: BOARD_MIDLINE_X, height: BOARD_HEIGHT / 3 },
  "right-top": { x: BOARD_MIDLINE_X, y: 0, width: BOARD_WIDTH - BOARD_MIDLINE_X, height: BOARD_HEIGHT / 3 },
  "right-middle": { x: BOARD_MIDLINE_X, y: BOARD_HEIGHT / 3, width: BOARD_WIDTH - BOARD_MIDLINE_X, height: BOARD_HEIGHT / 3 },
  "right-bottom": { x: BOARD_MIDLINE_X, y: (2 * BOARD_HEIGHT) / 3, width: BOARD_WIDTH - BOARD_MIDLINE_X, height: BOARD_HEIGHT / 3 },
};

function omissionRates(layout: TaskLayout, found: Set<string>): Record<BoardRegion, number> {
  const counts = Object.fromEntries(BOARD_REGIONS.map((region) => [region, { missed: 0, n: 0 }])) as Record<
    BoardRegion,
    { missed: number; n: number }
  >;
  for (const stimulus of layout.stimuli) {
    if (stimulus.kind !== "target") continue;
    const region = regionOfStimulus(stimulus);
    counts[region].n += 1;
    if (!found.has(stimulus.id)) counts[region].missed += 1;
  }
  return Object.fromEntries(
    BOARD_REGIONS.map((region) => [region, counts[region].n ? counts[region].missed / counts[region].n : 0]),
  ) as Record<BoardRegion, number>;
}

/**
 * Found vs missed targets on a clean board. Search order numbers and the path line
 * sit behind a toggle (off by default) so a judge can read the spatial picture first.
 */
export function ResponseOrderPlot({
  layout,
  orderedHits,
  events,
  compact = false,
  showSearchOrder = false,
  heading = "Targets",
  headingMeta,
}: {
  layout: TaskLayout;
  orderedHits: readonly OrderedHit[];
  events: readonly ResponseEvent[];
  /** Thumbnail mode: no numbers, no legend, no toggle. */
  compact?: boolean;
  /** Initial toggle state; stays off in the app, used on in tests. */
  showSearchOrder?: boolean;
  heading?: string;
  headingMeta?: ReactNode;
}) {
  const [showOrder, setShowOrder] = useState(showSearchOrder);
  const found = new Set(orderedHits.map((h) => h.stimulusId));
  const distractorHits = events.filter((e) => e.type === "distractor");
  const path = orderedHits.map((h, i) => `${i === 0 ? "M" : "L"}${h.x} ${h.y}`).join(" ");
  const missed = layout.stimuli.filter((s) => s.kind === "target" && !found.has(s.id)).length;
  const rates = omissionRates(layout, found);
  const label = showOrder
    ? `Targets with search order: ${orderedHits.length} found, ${missed} missed`
    : `Targets: ${orderedHits.length} found, ${missed} missed`;

  return (
    <>
      {!compact && (
        <div className="card-head">
          <h3>{heading}</h3>
          <div className="plot-tools">
            {headingMeta}
            <label className="check">
              <input type="checkbox" checked={showOrder} onChange={(event) => setShowOrder(event.target.checked)} />
              Show search order
            </label>
          </div>
        </div>
      )}
      <figure className={compact ? "plot compact" : "plot"}>
        <Board label={label} role="img">
        <rect className="half-fill left" x={0} y={0} width={BOARD_MIDLINE_X} height={BOARD_HEIGHT} />
        <rect className="half-fill right" x={BOARD_MIDLINE_X} y={0} width={BOARD_WIDTH - BOARD_MIDLINE_X} height={BOARD_HEIGHT} />
        {BOARD_REGIONS.map((region) => {
          const rate = rates[region];
          if (rate <= 0) return null;
          const box = REGION_BOX[region];
          return (
            <rect
              key={region}
              className="region-tint"
              {...box}
              style={{ ["--miss" as string]: String(rate) }}
            >
              <title>{`${region.replace("-", " ")}: ${Math.round(rate * 100)}% missed`}</title>
            </rect>
          );
        })}
        <line className="midline" x1={BOARD_MIDLINE_X} x2={BOARD_MIDLINE_X} y1={0} y2={BOARD_HEIGHT} />
        {layout.stimuli.map((s) => (
          <StimulusMark key={s.id} stimulus={s} className={s.kind === "target" ? (found.has(s.id) ? "found" : "missed") : "muted"} />
        ))}
        {showOrder && path && <path className="search-path" d={path} />}
        {showOrder &&
          distractorHits.map((e) => (
            <g key={e.seq} className="distractor-hit">
              <line x1={e.x - 9} y1={e.y - 9} x2={e.x + 9} y2={e.y + 9} />
              <line x1={e.x - 9} y1={e.y + 9} x2={e.x + 9} y2={e.y - 9} />
              <title>{`Disk selected at ${(e.elapsed / 1000).toFixed(1)} s`}</title>
            </g>
          ))}
        {showOrder &&
          orderedHits.map((h) => (
            <g key={h.stimulusId} className="order-badge">
              <circle cx={h.x} cy={h.y - 25} r={10.5} />
              <text x={h.x} y={h.y - 21} textAnchor="middle">
                {h.order}
              </text>
              <title>{`#${h.order} · ${(h.elapsed / 1000).toFixed(1)} s · ${h.region.replace("-", " ")}`}</title>
            </g>
          ))}
      </Board>
      {!compact && (
        <figcaption className="plot-legend">
          <span>
            <i className="key found" /> {showOrder ? "Found, numbered in order" : "Found"}
          </span>
          <span>
            <i className="key missed" /> Missed
          </span>
          {showOrder && distractorHits.length > 0 && (
            <span>
              <i className="key cross" /> Disk selected
            </span>
          )}
          {showOrder && path && (
            <span>
              <i className="key path" /> Search path
            </span>
          )}
        </figcaption>
      )}
    </figure>
    </>
  );
}
