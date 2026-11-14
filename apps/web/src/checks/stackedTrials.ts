import { useCallback, useEffect, useRef, useState } from "react";
import type { StackPosition } from "@neurovision/domain";

/**
 * Trial loop shared by the stacked two-choice tasks (clock check, greyscales).
 *
 * ready → blank → stimulus → (mask) → ack → blank → … → done
 *
 * Onset is taken with the same double-requestAnimationFrame pattern as
 * TaskRunner, so it marks the first painted frame of the stimulus. Reaction
 * time is the response event's timeStamp minus that onset. The response is
 * always top or bottom (never left or right), so one-sided hand weakness
 * cannot fake a lean. If the tab is hidden mid-trial the trial is discarded
 * and re-run after the person resumes; nothing half-seen is recorded.
 */
export type StackedPhase = "ready" | "blank" | "stimulus" | "mask" | "ack" | "paused" | "done";

export interface StackedTiming {
  /** Fixation or blank screen before each stimulus. */
  blankMs: number;
  /** How long the stimulus stays up before it is masked. Omit to keep it up for the whole window. */
  exposureMs?: number;
  /** Total response window, measured from onset. A trial with no answer by then is recorded as a timeout. */
  windowMs: number;
  /** Brief acknowledgement of the choice (not of correctness) before moving on. */
  ackMs?: number;
  /** Start by itself after this long (used by the demo run). Omit to wait for Start. */
  autoStartMs?: number;
}

interface Options extends StackedTiming {
  count: number;
  onResponse: (index: number, choice: StackPosition | null, rtMs: number | null) => void;
  onComplete: () => void;
}

const ANSWERING: StackedPhase[] = ["stimulus", "mask"];
const RUNNING: StackedPhase[] = ["blank", "stimulus", "mask", "ack"];

export function keyToChoice(key: string): StackPosition | null {
  if (key === "ArrowUp" || key === "w" || key === "W") return "top";
  if (key === "ArrowDown" || key === "s" || key === "S") return "bottom";
  return null;
}

/** Maps a pointer to the top or bottom half of an SVG, in viewBox units. */
export function pointerToChoice(svg: SVGSVGElement, clientX: number, clientY: number, splitY: number): StackPosition {
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    const box = svg.getBoundingClientRect();
    return clientY - box.top < box.height / 2 ? "top" : "bottom";
  }
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return p.y < splitY ? "top" : "bottom";
}

export function useStackedTrials({ count, blankMs, exposureMs, windowMs, ackMs = 240, autoStartMs, onResponse, onComplete }: Options) {
  const [phase, setPhase] = useState<StackedPhase>("ready");
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<StackPosition | null>(null);

  const phaseRef = useRef<StackedPhase>("ready");
  const indexRef = useRef(0);
  const answeredRef = useRef(-1);
  const onset = useRef<number | null>(null);
  const timers = useRef<number[]>([]);
  const frames = useRef<number[]>([]);
  const callbacks = useRef({ onResponse, onComplete });
  callbacks.current = { onResponse, onComplete };

  const move = useCallback((next: StackedPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    frames.current.forEach((f) => cancelAnimationFrame(f));
    timers.current = [];
    frames.current = [];
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const runTrial = useCallback(() => {
    clear();
    onset.current = null;
    setChosen(null);
    move("blank");
    later(() => move("stimulus"), blankMs);
  }, [blankMs, clear, later, move]);

  const advance = useCallback(() => {
    const next = indexRef.current + 1;
    if (next >= count) {
      clear();
      move("done");
      callbacks.current.onComplete();
      return;
    }
    indexRef.current = next;
    setIndex(next);
    runTrial();
  }, [clear, count, move, runTrial]);

  const close = useCallback(
    (choice: StackPosition | null, rtMs: number | null) => {
      if (!ANSWERING.includes(phaseRef.current) || answeredRef.current === indexRef.current) return;
      clear();
      answeredRef.current = indexRef.current;
      callbacks.current.onResponse(indexRef.current, choice, rtMs);
      setChosen(choice);
      move("ack");
      later(advance, choice ? ackMs : Math.min(ackMs, 160));
    },
    [ackMs, advance, clear, later, move],
  );

  // Stimulus onset: the second animation frame after the stimulus is committed is its first painted frame.
  useEffect(() => {
    if (phase !== "stimulus") return;
    const first = requestAnimationFrame(() => {
      frames.current.push(
        requestAnimationFrame(() => {
          onset.current = performance.now();
          if (exposureMs !== undefined && exposureMs < windowMs) {
            later(() => phaseRef.current === "stimulus" && move("mask"), exposureMs);
          }
          later(() => close(null, null), windowMs);
        }),
      );
    });
    frames.current.push(first);
  }, [phase, exposureMs, windowMs, later, move, close]);

  const respond = useCallback(
    (choice: StackPosition, timeStamp?: number) => {
      if (onset.current === null || !ANSWERING.includes(phaseRef.current)) return;
      const at = timeStamp && timeStamp > 0 ? timeStamp : performance.now();
      close(choice, Math.max(0, Math.round(at - onset.current)));
    },
    [close],
  );

  /** Starts the run, or resumes it after a pause (re-running a discarded trial). */
  const begin = useCallback(() => {
    if (phaseRef.current !== "ready" && phaseRef.current !== "paused") return;
    if (answeredRef.current === indexRef.current) advance();
    else runTrial();
  }, [advance, runTrial]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.repeat || e.altKey || e.metaKey || e.ctrlKey) return;
      const choice = keyToChoice(e.key);
      if (choice && ANSWERING.includes(phaseRef.current)) {
        e.preventDefault();
        respond(choice, e.timeStamp);
      } else if ((e.key === " " || e.key === "Enter") && (phaseRef.current === "ready" || phaseRef.current === "paused")) {
        if (e.target instanceof HTMLButtonElement) return; // the focused Start button handles it
        e.preventDefault();
        begin();
      } else if (choice && RUNNING.includes(phaseRef.current)) {
        e.preventDefault(); // keep arrows from scrolling the page mid-run
      }
    };
    const onVisibility = () => {
      if (!document.hidden || !RUNNING.includes(phaseRef.current)) return;
      clear();
      onset.current = null;
      move("paused");
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [begin, clear, move, respond]);

  useEffect(() => {
    if (autoStartMs === undefined) return;
    const t = window.setTimeout(() => begin(), autoStartMs);
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount

  useEffect(() => clear, [clear]);

  return { phase, index, chosen, begin, respond };
}
