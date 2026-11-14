# Demonstration rehearsal

Use this script with the exported demonstration sessions in `@neurovision/domain`. Scoring, history, and gaze-lab data are available through `createAppServices()` in `apps/web/src/services/` even before product screens land. The current `apps/web` shell shows the brand header, contracts version, and gaze-lab wiring.

## 0. Confirm the build

1. From the repo root run `npm run verify`.
2. Open `docs/RELEASE_EVIDENCE.md` and read the contracts version, test counts, and standalone path.
3. For a disk demo, open `apps/web/dist/standalone/index.html` directly (`file:`). No network requests, no extra JS/CSS files.
4. For a hosted static demo, serve `apps/web/dist/`.

## 1. Three spatial patterns

Load `loadDemonstrationSessions()` (history screen, once D+E land). Walk the three records in order. Each is `source: "demonstration"` and must not join the live assessment trend.

| Order | Alias | Id | What to say |
| --- | --- | --- | --- |
| 1 | Balanced pattern | `demo-balanced` | Hits on both sides. Practice suggestion is unguided, standard density. |
| 2 | Left-omission pattern | `demo-left-omission` | Omissions concentrate on the left. Practice suggestion cues the left side. |
| 3 | Right-omission pattern | `demo-right-omission` | Omissions concentrate on the right. Practice suggestion cues the right side. |

On session review, show hits, omissions by side, response order, spatial-pattern kind, and the underlying events. Mention that domain `scoreSession` is the only interpreter of recorded events.

## 2. History comparability

1. With only demonstration records saved, `comparableHistory()` / `summarizeAssessmentTrend` has an empty points list; every demonstration id is excluded with reason `demonstration`.
2. After one or more **live** assessments that share protocol `spatial-v1`, scorer `events-v1`, contracts `1.0.0`, and the fixed assessment layout family, those live sessions appear on the trend.
3. Practice rounds stored on a live session do not add trend points.

## 3. Gaze lab

`loadGazeLabData()` returns the shared click sequence from the balanced demonstration trial, two streams, and `EXAMPLE_CALIBRATION_REPORT` (9 points).

| Stream | Id | What to say |
| --- | --- | --- |
| Left-biased scan | `demo-gaze-left-biased` | Samples stay on the left half except during tracking gaps. |
| Both-halves scan | `demo-gaze-wide` | Alternating segments cover both halves. |

Tracking-gap marks: 6.8–9.0 s and 15.5–16.9 s. No sample falls inside those intervals. Replay both streams against the same click sequence. Label simulated lab traces as simulated; do not present them as webcam observation.

The boot shell’s gaze-lab toggle switches the package’s simulated traces (`lab-left` / `lab-wide`) for a short live check of `@neurovision/gaze`.

## 4. Practice round and reflection (live-like)

Using a live session scored like `demo-left-omission`:

1. `configurePractice` / `startPracticeTrial` with the scored cue (`left`) and density.
2. Record the practice board (practice never joins the assessment trend).
3. `reflectPractice` against the assessment `targetSelection` score: hits and omissions per side, response order, and change versus assessment.

## 5. Close

1. Reload a saved live session by id and show that `score` is unchanged.
2. If `packages/storage` is absent, say that history is the in-memory store for this build. When that package is present, `createAppServices()` defaults to its envelope HistoryStore; pass `{ store }` to override. The standalone file always uses in-memory history and makes no API calls.
3. Leave the audience with the standalone file path from `docs/RELEASE_EVIDENCE.md`.
