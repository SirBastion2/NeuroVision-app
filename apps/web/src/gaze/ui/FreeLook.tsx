import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { GazeSample, SmoothingLevel } from "../../metrics/types";
import type { GazeSource, TrackerStatus } from "../types";
import { GazeTracker } from "../webcam";

/**
 * Debug view: live gaze dot, 3×3 cell highlight, head turn readout, smoothing selector,
 * and a quick check of the head-yaw sign convention (positive = toward screen left).
 */
export function FreeLook({ source, smoothing, onSmoothing, onExit }: { source: GazeSource; smoothing: SmoothingLevel; onSmoothing: (l: SmoothingLevel) => void; onExit: () => void }) {
  const [g, setG] = useState<GazeSample | null>(null);
  const [status, setStatus] = useState<TrackerStatus>({ faceVisible: true, movedTooMuch: false, fps: null });
  const [yawCheck, setYawCheck] = useState<string | null>(null);
  const webcam = source instanceof GazeTracker ? source : null;

  useEffect(() => {
    source.start();
    const off = source.subscribe(setG);
    const offS = source.subscribeStatus(setStatus);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onExit();
    window.addEventListener("keydown", onKey);
    return () => {
      off();
      offS();
      window.removeEventListener("keydown", onKey);
    };
  }, [source, onExit]);

  const W = window.innerWidth;
  const H = window.innerHeight;
  const cell = g?.x != null && g.y != null ? Math.min(2, Math.floor((3 * g.y) / H)) * 3 + Math.min(2, Math.floor((3 * g.x) / W)) : -1;

  const checkYaw = async () => {
    if (!webcam) return;
    setYawCheck("Turn your head toward the LEFT side of the screen and hold…");
    await new Promise((r) => setTimeout(r, 1200));
    const yaws: number[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 900) {
      const p = webcam.headPose();
      if (p) yaws.push(p.yawDeg);
      await new Promise((r) => setTimeout(r, 50));
    }
    const m = yaws.length ? yaws.reduce((a, b) => a + b, 0) / yaws.length : null;
    if (m === null) setYawCheck("No face found. Try again.");
    else if (m > 5) setYawCheck(`Sign is correct: ${m.toFixed(0)}° (positive = toward screen left).`);
    else if (m < -5) {
      webcam.setYawSign(webcam.getYawSign() === 1 ? -1 : 1);
      setYawCheck(`Read ${m.toFixed(0)}°, so the sign was flipped and saved. Please recalibrate.`);
    } else setYawCheck(`Only ${m.toFixed(0)}°. Turn further and try again.`);
  };

  const debug = webcam?.debugEstimate() ?? null;
  const atEdge = !!g && g.x != null && g.y != null && (g.x <= 1 || g.y <= 1 || g.x >= W - 1 || g.y >= H - 1);
  const why: Record<string, string> = {
    "no-face": "No face found. Check lighting and that your face is in view.",
    blink: "Blink",
    "not-calibrated": "Not calibrated yet. Run calibration first.",
    "camera-off": "Camera is off. Start it from the Webcam panel.",
  };
  const estimateText = !webcam
    ? g?.x != null
      ? "Following the cursor"
      : "Move the cursor over the page"
    : debug?.reason !== "ok"
      ? why[debug?.reason ?? "no-face"]
      : debug.raw
        ? atEdge
          ? `Estimate is off-screen (${Math.round(debug.raw.x)}, ${Math.round(debug.raw.y)}) and pinned to the edge. Recalibrate.`
          : `Estimate ${Math.round(debug.raw.x)}, ${Math.round(debug.raw.y)}`
        : "Waiting for frames…";
  const head = webcam?.headPose();
  const parts = webcam?.contributions() ?? null;
  const eyeShare = parts ? Math.abs(parts.eye.x) / Math.max(1, Math.abs(parts.eye.x) + Math.abs(parts.head.x)) : null;
  return createPortal(
    <div className="scr-freelook" role="dialog" aria-label="Free look">
      <div className="scr-fl-grid" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={i === cell ? "on" : ""} />
        ))}
      </div>
      <div className="scr-fl-panel card">
        <strong>Free look</strong>
        <span className="small">Source: {source.kind}</span>
        <span className={`small scr-fl-why ${debug && debug.reason !== "ok" ? "bad" : ""}`} role="status">
          {estimateText}
        </span>
        <span>
          Head yaw {head ? `${head.yawDeg > 0 ? "+" : ""}${head.yawDeg.toFixed(1)}°` : g?.headYawDeg != null ? `${g.headYawDeg.toFixed(1)}°` : "n/a"} · pitch{" "}
          {head ? `${head.pitchDeg.toFixed(1)}°` : "n/a"}
        </span>
        <span className="small">{status.fps ? `${Math.round(status.fps)} fps` : ""}</span>
        {parts && eyeShare !== null && (
          <div className="scr-fl-drive" title="How far the dot is from centre, split into the part your eyes explain and the part your head explains (horizontal).">
            <span className="small">
              Horizontal shift driven by eyes {Math.round(eyeShare * 100)}% · head {Math.round((1 - eyeShare) * 100)}%
            </span>
            <span className="scr-fl-drive-bar" aria-hidden>
              <i style={{ width: `${eyeShare * 100}%` }} />
            </span>
            <span className="small">Iris offset {parts.irisH > 0 ? "+" : ""}{parts.irisH.toFixed(3)} of eye width</span>
          </div>
        )}
        <div className="segmented tight" role="group" aria-label="Smoothing">
          {(["low", "medium", "high"] as const).map((l) => (
            <label key={l} className={smoothing === l ? "on" : ""}>
              <input type="radio" name="fl-smooth" checked={smoothing === l} onChange={() => onSmoothing(l)} />
              {l}
            </label>
          ))}
        </div>
        {webcam && (
          <button type="button" onClick={checkYaw}>
            Check head-turn sign
          </button>
        )}
        {yawCheck && <span className="small">{yawCheck}</span>}
        <button type="button" className="primary" onClick={onExit}>
          Done
        </button>
      </div>
      {/* Drawn after the panel so it is never hidden behind it. */}
      {g?.x != null && g.y != null && (
        <span className={`scr-fl-dot ${g.isFixation ? "fix" : ""} ${atEdge ? "edge" : ""}`} style={{ transform: `translate(${g.x}px, ${g.y}px)` }} />
      )}
      <GazeWarnings status={status} />
    </div>,
    document.body,
  );
}

export function GazeWarnings({ status }: { status: TrackerStatus }) {
  if (status.faceVisible && !status.movedTooMuch) return null;
  return (
    <div className="scr-warn" role="status">
      {!status.faceVisible ? "Face lost. Look toward the screen and keep your face in view." : "You moved a lot since calibration. Return to your starting position, or recalibrate."}
    </div>
  );
}
