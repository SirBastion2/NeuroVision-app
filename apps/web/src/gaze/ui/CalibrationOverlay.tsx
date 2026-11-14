import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { beep } from "../calibration";
import type { CalibrationPresenter } from "../types";

type Mode = "moving" | "confirm" | "hold" | "idle";

interface DotState {
  visible: boolean;
  x: number;
  y: number;
  mode: Mode;
  kind: string;
  durationMs: number;
  instruction: string;
  /** Changes on every phase so CSS animations restart. */
  key: number;
}

const MOVE_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calibration / validation overlay plus the presenter the tracker drives. The dot glides
 * from point to point (motion + beep guide attention), waits for a click on it (or a
 * dwell in auto-advance mode), then holds still with a progress ring while frames are
 * sampled. Esc cancels at any time.
 */
export function useCalibrationOverlay() {
  const [dot, setDot] = useState<DotState>({ visible: false, x: 0, y: 0, mode: "idle", kind: "", durationMs: 0, instruction: "", key: 0 });
  const pending = useRef<((v: boolean) => void) | null>(null);
  const timer = useRef<number | null>(null);
  const cancelled = useRef(false);

  const settle = (v: boolean) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    p?.(v);
  };

  useEffect(() => {
    if (!dot.visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelled.current = true;
        settle(false);
      } else if ((e.key === " " || e.key === "Enter") && pending.current && dot.mode === "confirm") {
        e.preventDefault();
        settle(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dot.visible, dot.mode]);

  const presenter: CalibrationPresenter = useMemo(
    () => ({
      async moveTo(p, opts) {
        if (cancelled.current) return;
        setDot((d) => ({ ...d, visible: true, x: p.x, y: p.y, mode: "moving", instruction: opts?.instruction ?? d.instruction, key: d.key + 1 }));
        await sleep(MOVE_MS);
        if (opts?.beep !== false) beep();
      },
      waitForConfirm({ autoAdvanceMs, instruction }) {
        return new Promise<boolean>((resolve) => {
          if (cancelled.current) return resolve(false);
          pending.current = resolve;
          setDot((d) => ({ ...d, mode: "confirm", durationMs: autoAdvanceMs ?? 0, instruction: instruction ?? d.instruction, key: d.key + 1 }));
          if (autoAdvanceMs) timer.current = window.setTimeout(() => settle(true), autoAdvanceMs);
        });
      },
      hold(ms, opts) {
        return new Promise<boolean>((resolve) => {
          if (cancelled.current) return resolve(false);
          pending.current = resolve;
          setDot((d) => ({ ...d, mode: "hold", kind: opts?.kind ?? "sample", durationMs: ms, instruction: opts?.instruction ?? d.instruction, key: d.key + 1 }));
          timer.current = window.setTimeout(() => settle(true), ms);
        });
      },
    }),
    [],
  );

  const open = () => {
    cancelled.current = false;
    setDot((d) => ({ ...d, visible: true, x: window.innerWidth / 2, y: window.innerHeight / 2, mode: "idle", instruction: "" }));
  };
  const close = () => {
    settle(false);
    setDot((d) => ({ ...d, visible: false, mode: "idle" }));
  };

  const overlay = dot.visible ? createPortal(
    <div className="scr-cal" role="dialog" aria-label="Eye-tracking calibration">
      {dot.instruction && (
        <p className="scr-cal-instruction" aria-live="polite">
          {dot.instruction}
        </p>
      )}
      <button
        type="button"
        className={`scr-cal-dot mode-${dot.mode} kind-${dot.kind}`}
        style={{ transform: `translate(${dot.x}px, ${dot.y}px)` }}
        onClick={() => dot.mode === "confirm" && settle(true)}
        tabIndex={-1}
        aria-label="Calibration target"
      >
        <span className="scr-cal-ring" key={dot.key} style={{ animationDuration: `${dot.durationMs}ms` }} />
        <span className="scr-cal-core" />
      </button>
      <p className="scr-cal-hint">Esc cancels</p>
    </div>,
    document.body,
  ) : null;

  return { presenter, overlay, open, close };
}
