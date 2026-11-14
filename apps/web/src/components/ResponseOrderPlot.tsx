import type { OrderedHit, ResponseEvent, TaskLayout } from "@neurovision/domain";
import { Board, StimulusMark } from "./Board";

/**
 * Found targets numbered in selection order and joined by the search path; missed
 * targets dashed; disk selections crossed. Drawn from the domain's orderedHits, so
 * the picture always matches the scored result.
 */
export function ResponseOrderPlot({
  layout,
  orderedHits,
  events,
  compact = false,
}: {
  layout: TaskLayout;
  orderedHits: readonly OrderedHit[];
  events: readonly ResponseEvent[];
  /** Thumbnail mode: no numbers, no legend. */
  compact?: boolean;
}) {
  const found = new Set(orderedHits.map((h) => h.stimulusId));
  const distractorHits = events.filter((e) => e.type === "distractor");
  const path = orderedHits.map((h, i) => `${i === 0 ? "M" : "L"}${h.x} ${h.y}`).join(" ");
  const missed = layout.stimuli.filter((s) => s.kind === "target" && !found.has(s.id)).length;

  return (
    <figure className={`plot ${compact ? "compact" : ""}`}>
      <Board label={`Response order: ${orderedHits.length} targets found, ${missed} missed`} showMidline role="img">
        {layout.stimuli.map((s) => (
          <StimulusMark key={s.id} stimulus={s} className={s.kind === "target" ? (found.has(s.id) ? "found" : "missed") : "muted"} />
        ))}
        {path && <path className="search-path" d={path} />}
        {distractorHits.map((e) => (
          <g key={e.seq} className="distractor-hit">
            <line x1={e.x - 9} y1={e.y - 9} x2={e.x + 9} y2={e.y + 9} />
            <line x1={e.x - 9} y1={e.y + 9} x2={e.x + 9} y2={e.y - 9} />
            <title>{`Disk selected at ${(e.elapsed / 1000).toFixed(1)} s`}</title>
          </g>
        ))}
        {!compact &&
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
            <i className="key found" /> Found, numbered in order
          </span>
          <span>
            <i className="key missed" /> Missed
          </span>
          <span>
            <i className="key cross" /> Disk selected
          </span>
          <span>
            <i className="key path" /> Search path
          </span>
        </figcaption>
      )}
    </figure>
  );
}
