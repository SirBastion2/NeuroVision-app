import { useEffect, useRef, useState } from "react";
import type { TrackerStatus } from "../types";
import type { GazeTracker } from "../webcam";

/** Mirrored live preview for positioning. Frames are shown locally only, never stored or sent. */
export function CameraPreview({ tracker }: { tracker: GazeTracker }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  useEffect(() => {
    const v = tracker.getVideo();
    if (!v || !host.current) return;
    v.className = "scr-preview-video";
    host.current.appendChild(v);
    const off = tracker.subscribeStatus(setStatus);
    return () => {
      off();
      v.remove();
    };
  }, [tracker]);
  return (
    <figure className="scr-preview">
      <div ref={host} className="scr-preview-frame" />
      <figcaption>
        <span className={`badge ${status?.faceVisible ? "complete" : "incomplete"}`}>{status?.faceVisible ? "Face found" : "No face"}</span>
        {status?.fps ? <span className="small">{Math.round(status.fps)} fps</span> : null}
      </figcaption>
    </figure>
  );
}
