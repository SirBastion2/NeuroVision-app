# apps/web: product UI (Agents D+E)

Every surface in `docs/ARCHITECTURE.md`, built on `@neurovision/domain` and `@neurovision/gaze`. The UI holds no scoring, practice or comparison rules of its own.

## Run

```bash
npm install                        # from repo root
npm run dev -w @neurovision/web    # http://localhost:5173
npm test -w @neurovision/web       # UI logic tests
npm run build -w @neurovision/web
```

## Design

Drawn from the NeuroVision logo: forest green ink, brass accent, warm ivory paper, and a high-contrast serif for display (system serif stack, so the static build needs no font downloads). Light and dark themes share one token set in `src/styles.css`; the header toggle remembers the choice.

- `components/Brand.tsx`: the logo mark redrawn as inline SVG so it stays crisp and follows the theme.
- The found / missed colour pair passes colour-blind separation checks in both themes, and is always backed by a second cue (solid vs dashed, numbers, labels).
- Assessment boards stay neutral: stimuli are plain ink, response marks never show correctness, and the app chrome drops away during a trial.

## Screens

| Surface | File | Domain calls |
| --- | --- | --- |
| Home | `screens/Home.tsx` | `DEMONSTRATION_SESSIONS`, `createTargetSelectionLayout` |
| Task intros and boards | `screens/Intros.tsx`, `components/TaskRunner.tsx` | `classifyResponse`, `toBoardCoordinates` |
| Session review | `screens/Review.tsx`, `components/ReviewFigures.tsx`, `components/ResponseOrderPlot.tsx` | `scoreSession`, `scoreLineBisection` |
| Practice setup, round, reflection | `screens/Practice.tsx` | `configurePracticeRound`, `fadePracticeCue`, `reflectPracticeRound` |
| History | `screens/History.tsx`, `components/TrendChart.tsx` | `summarizeAssessmentTrend` (live sessions only) |
| Gaze lab | `screens/GazeLab.tsx` | `GAZE_LAB_STREAMS`, `GAZE_LAB_CLICK_SEQUENCE`, `EXAMPLE_CALIBRATION_REPORT`, `gazeSummary`, `SIMULATED_LAB_PROVENANCE` |

## Behaviour

- **Timing:** `performance.now()` from the first painted frame. Limits are 60 s for target selection, 15 s per line and 30 s for practice (`lib/session.ts`).
- **Interruptions:** Stop, window resize and a hidden tab end the trial with that `TrialEndReason`, and the session is saved as `incomplete`.
- **Input:** mouse/trackpad, touch, or a keyboard cursor (arrows, Shift for fine steps, Enter).
- **Saving:** live sessions are saved after the assessment and after each practice round, always through `parseSessionRecord`. Demonstration sessions are never saved.

## To hand over

- `data/sessionStore.ts` is an interim localStorage store behind a `SessionStore` interface. Swap in **Agent B's** `packages/storage` when it lands.
- `src/GazeLab.tsx` and `src/app.css` are Agent C's original wiring shell. They are no longer imported; the full gaze lab is `screens/GazeLab.tsx`. Left in place to avoid conflicts with Agent C's open PR.
