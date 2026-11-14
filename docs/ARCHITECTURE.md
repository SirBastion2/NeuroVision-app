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

Screens talk to domain, gaze, storage, and the HTTP API through `apps/web/src/services/` (`createAppServices`). The layer does not draw UI.

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
| `health` / `uploadSession` / `uploadTrace` | Typed calls to the API health, session, and trace-upload routes |
| `pollProcessingState` | Dashboard polling of processing state with exponential backoff; stops on `ready` or `failed` |
| `exportParticipant` / `deleteParticipant` | Participant export bundle and confirmed delete |
| `beginOidcRedirect` / `completeOidcCallback` / `getAccessToken` | Browser OIDC authorization-code + PKCE; access token stays in memory |

### History store

The default store is `createPackageHistoryStore` from `@neurovision/storage` (the envelope HistoryStore, `kind: "package"`) when that package is in the workspace and a key-value backend such as `localStorage` is available. Pass a store into `createAppServices({ store })` to override. The standalone HTML build always uses `createMemoryStore()` (`kind: "memory"`). When `packages/storage` is not in the workspace, the Vite alias and tsconfig path resolve `@neurovision/storage` to `apps/web/src/services/storage-unavailable.ts`, and the default is in-memory.

### HTTP API client

`createApiClient` / `createAppServices` read `VITE_API_BASE_URL`. When that value is empty, or when the standalone build is active (`VITE_STANDALONE=true` or a `file:` page), the client is disabled and service methods throw `ApiOfflineError` without calling `fetch`.

The client matches the routes `apps/api` is expected to expose. **Today `apps/api/src` only registers `GET /health`.** The other paths below are typed in the web client so the dashboard can call them once the API adds them; they are missing from the current API process.

| Client method | Method and path | On `apps/api` today |
| --- | --- | --- |
| `health` | `GET /health` | Present |
| `putSession` | `PUT /api/v1/sessions/:sessionId` | Missing |
| `createTraceUpload` | `POST /api/v1/sessions/:sessionId/trace-uploads` | Missing |
| `putTraceContent` | `PUT /api/v1/sessions/:sessionId/trace-uploads/:traceId/content` | Missing |
| `getSession` / `getProcessingState` / `pollProcessingState` | `GET /api/v1/sessions/:sessionId` (processing field + `processingDetail`) | Missing (no dedicated processing-state route either) |
| `exportParticipant` | `POST /api/v1/participants/:participantId/exports` | Missing |
| `deleteParticipant` | `DELETE /api/v1/participants/:participantId` (`{ confirm: true }`) | Missing |

`pollProcessingState` fetches immediately, then waits `initialDelayMs` (default 250ms) doubling each time up to `maxDelayMs` (default 4s) until `processing` is `ready` or `failed`.

When an in-memory OIDC access token is present, requests send `Authorization: Bearer <token>`.

### Browser OIDC (authorization code + PKCE)

`apps/api` currently exposes no auth or OIDC routes. The helper is therefore configured entirely from Vite env:

| Variable | Role |
| --- | --- |
| `VITE_OIDC_AUTHORIZE_URL` | Authorization endpoint (`response_type=code`, S256 PKCE) |
| `VITE_OIDC_TOKEN_URL` | Token endpoint (`grant_type=authorization_code` + `code_verifier`) |
| `VITE_OIDC_CLIENT_ID` | Public client id |
| `VITE_OIDC_REDIRECT_URI` | Browser callback URL |
| `VITE_OIDC_SCOPE` | Optional; default `openid` |

The in-flight PKCE verifier and `state` are stored in `sessionStorage` (or an injected transaction store) so the redirect can complete. The access token is not written to storage. If those env values are unset, `beginOidcRedirect` / `buildAuthorizationUrl` throw `OidcConfigError`.

If `apps/api` later adds cookie-based login (`/api/v1/auth/login` and `/api/v1/auth/callback`), keep this browser PKCE helper behind the Vite config above; do not mix the two token models in the service layer without an explicit choice.

## Standalone HTML build

`npm run build` runs the static Vite build and the single-file build. `npm run build:standalone` only emits the disk-openable file:

- Config: `apps/web/vite.standalone.config.ts` (`vite-plugin-singlefile`)
- Output: `apps/web/dist/standalone/index.html`
- All JavaScript and CSS are inlined; there are no external `script src` or `link href` URLs
- The file opens from disk (`file:`) with no network requests
- `VITE_STANDALONE` is `true` and `VITE_API_BASE_URL` is empty, so the service layer never calls the API

`npm run verify` runs the production build, all package tests, and the service-layer e2e suite, then writes `docs/RELEASE_EVIDENCE.md`. Merge order for workstreams A–F is in `docs/MERGE_ORDER.md`. The demonstration walkthrough is in `docs/DEMO_REHEARSAL.md`.
