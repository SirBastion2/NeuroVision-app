import { forwardRef, type ReactNode, type SVGProps } from "react";
import {
  BOARD_HEIGHT,
  BOARD_MIDLINE_X,
  BOARD_WIDTH,
  type LineSegment,
  type Point,
  type ResponseEvent,
  type Stimulus,
} from "@neurovision/domain";

export const STIMULUS_RADIUS = 14;

export function Ring({ x, y, className = "" }: Point & { className?: string }) {
  return <circle className={`ring ${className}`} cx={x} cy={y} r={STIMULUS_RADIUS} />;
}

export function Disk({ x, y, className = "" }: Point & { className?: string }) {
  return <circle className={`disk ${className}`} cx={x} cy={y} r={STIMULUS_RADIUS} />;
}

export function StimulusMark({ stimulus, className }: { stimulus: Stimulus; className?: string }) {
  return stimulus.kind === "target" ? <Ring {...stimulus} className={className} /> : <Disk {...stimulus} className={className} />;
}

/** Neutral response marks: show where a selection landed without revealing correctness. */
export function ResponseMarks({ events }: { events: readonly ResponseEvent[] }) {
  return (
    <g className="response-marks" aria-hidden>
      {events
        .filter((e) => e.type !== "pointer")
        .map((e) =>
          e.type === "bisection" || e.type === "out-of-band" ? (
            <line key={e.seq} x1={e.x} x2={e.x} y1={e.y - 18} y2={e.y + 18} className="tick" />
          ) : (
            <line key={e.seq} x1={e.x - 11} y1={e.y + 11} x2={e.x + 11} y2={e.y - 11} className="slash" />
          ),
        )}
    </g>
  );
}

export function BisectionLine({ line }: { line: LineSegment }) {
  return <line className="bisection-line" x1={line.x1} x2={line.x2} y1={line.y} y2={line.y} />;
}

type BoardProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  stimuli?: readonly Stimulus[];
  line?: LineSegment;
  label: string;
  showMidline?: boolean;
  /** Class applied to every stimulus (e.g. "faint" for backdrops). */
  stimulusClass?: string;
  children?: ReactNode;
};

/** The fixed 960×540 logical board. CSS keeps the 16:9 box so pointer mapping has no letterboxing. */
export const Board = forwardRef<SVGSVGElement, BoardProps>(function Board(
  { stimuli = [], line, label, showMidline = false, stimulusClass, children, className = "", ...rest },
  ref,
) {
  return (
    <svg ref={ref} className={`board ${className}`} viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} aria-label={label} {...rest}>
      <rect className="board-surface" width={BOARD_WIDTH} height={BOARD_HEIGHT} rx={10} />
      {showMidline && <line className="midline" x1={BOARD_MIDLINE_X} x2={BOARD_MIDLINE_X} y1={0} y2={BOARD_HEIGHT} />}
      {line && <BisectionLine line={line} />}
      {stimuli.map((s) => (
        <StimulusMark key={s.id} stimulus={s} className={stimulusClass} />
      ))}
      {children}
    </svg>
  );
});
