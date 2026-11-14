import { useMemo, useState } from "react";
import {
  GAZE_ANALYSIS_VERSION,
  SIMULATED_LAB_PROVENANCE,
  analyzeSimulatedLabSlice,
  gazeSummary,
  labTraceToDomainStream,
  provenanceFor,
  simulatedTrace,
  skipToClickOnly,
  createCalibrationState,
} from "@neurovision/gaze";

/**
 * Minimal gaze-lab shell for Agent C.
 * D+E own full product UI; this only proves package wiring and labeling.
 */
export function GazeLab() {
  const [wide, setWide] = useState(false);
  const duration = 22000;
  const trace = useMemo(() => simulatedTrace(wide, duration), [wide]);
  const summary = useMemo(() => gazeSummary(trace, duration), [trace]);
  const integrated = useMemo(
    () => analyzeSimulatedLabSlice("demo-trial", trace, duration),
    [trace],
  );
  const stream = useMemo(
    () =>
      labTraceToDomainStream(
        wide ? "lab-wide" : "lab-left",
        `${SIMULATED_LAB_PROVENANCE.badge} · ${wide ? "both halves" : "left-biased"}`,
        trace,
      ),
    [trace, wide],
  );
  const clickOnly = skipToClickOnly(
    createCalibrationState(),
    "demo_shell_no_webcam",
  );

  return (
    <section aria-labelledby="gaze-lab-title">
      <h2 id="gaze-lab-title">Gaze lab</h2>
      <p>
        {SIMULATED_LAB_PROVENANCE.badge} · {GAZE_ANALYSIS_VERSION}
      </p>
      <p>
        Stream <code>{stream.id}</code> · {stream.samples.length} samples ·{" "}
        {stream.gaps.length} gaps
      </p>
      <p>
        Tracked {Math.round(summary.tracked / 1000)}s · left share{" "}
        {summary.tracked
          ? Math.round((100 * summary.left) / summary.tracked)
          : 0}
        % · integrated coverage {(integrated.coverageRatio * 100).toFixed(0)}%
      </p>
      <p>
        Webcam path: {provenanceFor("webcam").badge}. Camera denial keeps
        clicks usable ({clickOnly.phase}, clickOnly={String(clickOnly.clickOnly)}
        ).
      </p>
      <button type="button" onClick={() => setWide((v) => !v)}>
        Toggle {wide ? "left-biased" : "both-halves"} lab trace
      </button>
    </section>
  );
}
