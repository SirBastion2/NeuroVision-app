# Spatial Patterns architecture

Later agents should treat this file as their only repository map.

Spatial Patterns is a browser application that runs two board tasks, scores the recorded responses, reviews the session, suggests a practice setup, and can show a gaze comparison on the same geometry. Delivery is a static Vite build or a standalone HTML file. Session records are validated before they are written to browser storage.

## Logical board

The task runner draws every trial on a fixed 960×540 board. Pointers are converted into those coordinates before they are stored. Target selection places hollow-ring targets and solid-disk distractors on a mirrored 4×6 slot grid (left copied to the right). Line bisection presents five horizontal segments, one per trial. Assessment layouts stay fixed; practice may use a lower-density board.

## Shared scoring

Domain scoring is the only interpreter of recorded events. It walks events in elapsed-time order (sequence number as a tie-break), counts first target hits, omissions by side and vertical region, distractors, repeats, click-path length, and line midpoint error (percent of line length; right of center is positive). From the target-selection result it also emits a spatial-pattern summary and a practice suggestion (cue left / right / none, board density standard / low).

## Product surfaces

The UI work must match the supplied UI reference design (look, screens, and board layout). Do not copy that file into the repo.

| Surface | Role |
| --- | --- |
| Home | Start an assessment, open history, open the gaze lab, choose input |
| Target-selection intro and board | Instructions, then ring selection on the 960×540 board |
| Line-bisection intro and board | Five midpoint marks, no trial-by-trial feedback |
| Session review | Hits, omissions, response order, spatial pattern, underlying events |
| Practice setup | Suggested cue and density, left / right / unguided preview, optional row guide |
| Practice round and reflection | Same board family; practice never joins the assessment trend |
| History | Validated records, comparable-session charts, source labels (live vs demonstration) |
| Gaze lab | Shared click sequence, two gaze streams, common replay, heatmap, tracking-gap marks, calibration preview |

## Repository map

```
apps/web              React + Vite application (static / standalone HTML)
apps/web/src/services Thin app service layer (session, scoring, history, fixtures)
packages/domain       Versioned contracts, validation, scoring
packages/storage      Browser storage, history, identity (Agent B)
packages/gaze         Gaze streams, replay, calibration (Agent C)
docs/                 This map, ownership, merge order, demo rehearsal, release evidence
scripts/              `npm run verify` and the standalone-file check
```

`packages/storage` is owned by Agent B and is not created in the Agent A scaffold. `packages/gaze` is owned by Agent C (provider, calibration, quality gates, analysis, domain bridges).

## Workstreams

| Agent | Owns | Folders |
| --- | --- | --- |
| A | Contracts, scoring, workspace scaffold | `packages/domain`, `docs/`, root workspace config, `apps/web` boot shell only |
| B | Backend, browser storage, identity | `packages/storage`, storage adapters used by `apps/web` |
| C | Gaze comparison, replay, calibration types consumption | `packages/gaze`, gaze lab wiring in `apps/web` |
| D+E | Task runner and UI (must match the UI reference design) | `apps/web` screens, board, instructions, review, practice, history chrome |
| F | Integration across tasks, scoring, storage, gaze, and delivery | `apps/web/src/services/`, static / standalone HTML packaging, `npm run verify` |

Agent A exports `CONTRACTS_VERSION` from `@neurovision/domain`. Stored session records must pass `parseSessionRecord` before they are written. Scoring and practice rules are pure functions with no DOM access.

## Contracts consumers

- Task runner records `ResponseEvent` values in board coordinates with elapsed time, sequence, and task context.
- Review and history render `ScoringResult` (hits, omissions, midpoint errors, response order, spatial pattern).
- Practice setup starts from `suggestPractice`.
- Gaze lab consumes `GazeStream` (samples + tracking-gap intervals) and `CalibrationQualityReport` shapes; Agent C implements behavior.
- Storage persists `SessionRecord` with `source: "live" | "demonstration"`.
- History charts call `areSessionsComparable` / `summarizeAssessmentTrend` (live assessment sessions only; practice and demonstration records are excluded from the trend).
- Practice setup also calls `configurePracticeRound` (chosen cue, density, optional self-paced row marker) and `reflectPracticeRound` after a recorded round.
- Gaze lab and history consume exported demonstration `SessionRecord`s (`DEMONSTRATION_SESSIONS`), `GAZE_LAB_CLICK_SEQUENCE`, `GAZE_LAB_STREAMS`, and `EXAMPLE_CALIBRATION_REPORT`.

## App service layer

Screens talk to domain, gaze, and storage through `apps/web/src/services/` (`createAppServices`). The layer does not draw UI.

| Method | Role |
| --- | --- |
| `startSession` | Create a live assessment `SessionRecord` with the fixed target-selection layout and five line-bisection trials |
| `recordClick` / `finishTrial` | Append a classified `ResponseEvent` and close a trial |
| `completeSession` / `score` | Mark the record complete and run `scoreSession` |
| `save` / `load` / `listHistory` | Persist through a `HistoryStore` (`parseSessionRecord` runs before every write) |
| `comparableHistory` | `summarizeAssessmentTrend` / `areSessionsComparable` over saved records |
| `loadDemonstrationSessions` / `seedDemonstrationHistory` | Exported demonstration sessions |
| `loadGazeLabData` | Demonstration click sequence, two gaze streams, calibration report, plus simulated lab traces from `@neurovision/gaze` |
| `configurePractice` / `startPracticeTrial` / `appendPracticeRound` / `reflectPractice` | Practice setup and `reflectPracticeRound` |

`packages/storage` is optional. When it is present, pass its store into `createAppServices({ store })`. When it is absent, the layer uses `createMemoryStore()`.

## Standalone HTML build

`npm run build` runs the static Vite build and the single-file build. `npm run build:standalone` only emits the disk-openable file:

- Config: `apps/web/vite.standalone.config.ts` (`vite-plugin-singlefile`)
- Output: `apps/web/dist/standalone/index.html`
- All JavaScript and CSS are inlined; there are no external `script src` or `link href` URLs
- The file opens from disk (`file:`) with no network requests

`npm run verify` runs the production build, all package tests, and the service-layer e2e suite, then writes `docs/RELEASE_EVIDENCE.md`. Merge order for workstreams A–E is in `docs/MERGE_ORDER.md`. The demonstration walkthrough is in `docs/DEMO_REHEARSAL.md`.
