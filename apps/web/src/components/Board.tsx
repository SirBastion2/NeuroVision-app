import { forwardRef, type ReactNode, type SVGProps } from "react";
import {
  BOARD_HEIGHT,
  BOARD_MIDLINE_X,
  BOARD_WIDTH,
  type LineSegment,
  type PracticeCue,
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

/** Side cue inside the board. Level 1: edge anchor. Level 2: anchor plus scan arrow. */
export function SideCue({ cue, level }: { cue: PracticeCue; level: number }) {
  if (cue === "none" || level <= 0) return null;
  const left = cue === "left";
  return (
    <g className="side-cue" aria-hidden>
      <rect x={left ? 0 : BOARD_WIDTH - 10} y={0} width={10} height={BOARD_HEIGHT} />
      {level >= 2 && (
        <path d={left ? "M22 254 L58 270 L22 286 Z" : `M${BOARD_WIDTH - 22} 254 L${BOARD_WIDTH - 58} 270 L${BOARD_WIDTH - 22} 286 Z`} />
      )}
    </g>
  );
}

export function RowGuide({ y }: { y: number }) {
  return <rect className="row-guide" x={0} y={y - 34} width={BOARD_WIDTH} height={68} aria-hidden />;
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
