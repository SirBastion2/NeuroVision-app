# Neglect screening: tests, metrics, gaze (for teammates)

Screening and monitoring only. **Not clinically validated, not a diagnosis.**

Everything lives in three folders plus one page, so it doesn't collide with other work:

| Folder | What | Depends on |
| --- | --- | --- |
| `src/metrics/` | Shared types (`types.ts`) and pure metric functions | nothing |
| `src/gaze/` | Gaze sources (webcam, mouse, synthetic, replay), calibration model, filters, fixations; UI in `gaze/ui/` | `metrics` |
| `src/tests/` | Star cancellation, line bisection, difficulty staircase, synthetic patients, session builder; UI in `tests/ui/` | `metrics`, `gaze` |
| `src/screens/Screening.tsx` | The page, linked as **Screening** in the top nav | all three |

Unit tests: `apps/web/test/screening-metrics.test.ts` and `screening-gaze.test.ts`.

## Run

```bash
npm install                          # repo root
npm run dev -w @neurovision/web      # open the app, click "Screening"
npm test -w @neurovision/web         # all web unit tests
```

The webcam needs HTTPS or localhost. On first camera start the browser downloads the MediaPipe WASM (jsDelivr, pinned to 1.2.3) and the face model (Google storage), so the first webcam run needs internet. Mouse, synthetic and replay modes are fully offline.

## The one object you'll consume: `SessionResult`

Defined in `src/metrics/types.ts` (`schema: "neurovision.screening.session/1"`). Every session from every mode has the same shape:

```ts
{
  id, test: "star-cancellation" | "line-bisection",
  source: "webcam" | "mouse" | "synthetic",
  label, createdAt /* ISO */, screen: { width, height, dpr, screenWidth, screenHeight },
  layout,          // StarLayout | BisectionLayout, including area {width,height}
  difficulty, cued,
  taps: TapEvent[],     // { t, x, y, targetId, kind: "cancel" | "revisit" | "commission" }
  gaze: GazeSample[],   // { t, x, y (null = no face/blink), confidence, blink, isFixation, headYawDeg, headPitchDeg }
  metrics: { test: StarMetrics | BisectionMetrics, gaze: GazeMetrics | null, severity: { score, components } },
  quality: GazeQuality  // validation report, smoothing, calibration head yaw, click refinement
}
```

- All coordinates are CSS px of the test area (the full viewport while testing), origin top-left. `t` is ms from test start.
- Normalized x is `2x/width − 1` (left edge −1, right edge +1). **Every neglect metric uses x only.**
- `sessionToJson()` serializes one session or an array. The page's "Download JSON" buttons produce exactly this.
- `computeSessionMetrics(session)` recomputes metrics from a stored session, so the backend can rescore old data.

## Metrics (`src/metrics/`)

| Metric | Meaning |
| --- | --- |
| `centerOfCancellation` | Mean normalized x of found targets minus mean x of all targets. Positive = shifted right. `cocFlag` when > 0.08 (unvalidated cut-off). |
| `hitRateLeft/Right`, `hitRateByBin` | Hit rate per half and per 6 equal horizontal bins |
| `firstTap`, `pathCrossings`, `revisits`, `commissions` | Search start, disorganisation, re-cancellations, wrong taps |
| Gaze: `leftGazeFraction`, `gazeCenterOfCancellation`, `firstLookDirection`, `leftmostReach` (5th pct), `meanHeadYawDeg` (vs calibration, + = toward left), `missedLookedAt` (≥ 250 ms within an adaptive radius, **approximate**), `trackedFraction` | |
| Bisection: `meanDeviation`, `sdDeviation`, left- vs right-line means | % of line length, + = rightward |
| `severity.score` | 0–1 weighted sum: CoC 0.35, hit asymmetry 0.30, gaze-left deficit 0.20, bisection 0.15; missing parts are dropped and weights renormalized. `components` lists each value and weight so the dashboard can show the working. |

## Gaze sources (`src/gaze/`)

All implement `GazeSource`: `init()`, `calibrate({ presenter, autoAdvance })`, `validate({ presenter })`, `start()`, `stop()`, `subscribe(cb)`, `subscribeStatus(cb)`, `getQuality()`, `setSmoothing()`.

- `GazeTracker` (webcam): MediaPipe Face Landmarker (VIDEO mode, transformation matrices, GPU then CPU fallback), processing a frame only when `video.currentTime` advances. `stop()` stops every camera track, so the light turns off. `pause()` stops emitting but keeps the camera on between steps.
- `MouseGazeSource`, `SyntheticGazeSource(severity)`, and `ReplayGazeSource(recording)` (with `recordGaze(source)` / `parseRecording(json)`).
- The calibration UI is `gaze/ui/CalibrationOverlay.tsx` (`useCalibrationOverlay()` returns the presenter the tracker drives).

Pipeline: iris offsets per eye (468 vs 33/133, 473 vs 362/263), eye openness, head yaw/pitch/roll and translation from the matrix (row- vs column-major detected), face position and size → standardize, clip ±3.5σ → ridge per axis, λ by leave-one-point-out CV over 0.3–1000 (largest within 10% of best) → validation affine correction (only if leave-one-out error improves) → click refinement → screen → page coords → median-of-3 → One Euro (Low/Medium/High) → clamp. Blinks (openness < 0.65 × rolling median) are dropped. Fixations use I-DT (70 px, 100 ms).

Calibration: 13 points (dot glides from the centre with a beep; click or dwell, then ~0.9 s sampling), then 3 head-motion points (~4 s each while turning and nodding). Esc cancels. Targets are stored in **screen** coordinates so the model survives fullscreen toggles. Validation: 7 held-out dots (two on the left edge) report left/right and 3×3 accuracy, mean error, horizontal bias and left-edge bias, with a raw-vs-corrected plot.

## Synthetic patients (`src/tests/synthetic.ts`)

- `generateSyntheticStarSession(severity, seed)`, `generateSyntheticBisectionSession(severity, seed)`: detection falls off to the left (logistic cut-off moves right with severity), search starts on the right, gaze concentrates right, and revisits, crossings and wrong taps rise.
- `generateRecoverySeries(n, seed)`: n weekly visits, severity 0.8 → 0.2, one star and one bisection session each. Ready-made data for the dashboard.

## Known limitations

- **Webcam accuracy is unverified on real hardware in this build** (see the list in the PR / chat). Horizontal accuracy is expected to be fair and vertical weak, so vertical gaze only feeds the approximate "looked at" check.
- Head-yaw sign: positive should mean toward screen left. Use **Free look → Check head-turn sign** once per setup; it flips and saves the sign if needed.
- Browser chrome offsets for screen coordinates are estimated from outer/inner window sizes; use fullscreen for best results.
- Visit sessions live in memory for the current tab only; persistence belongs to the backend.
- Thresholds (CoC 0.08, severity weights, staircase rules) are engineering choices, not clinical norms.
