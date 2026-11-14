# Spatial Patterns architecture

Later agents should treat this file as their only repository map.

Spatial Patterns is a browser application that runs two board tasks, scores the recorded responses, reviews the session, suggests a practice setup, and can show a gaze comparison on the same geometry. Delivery is a static Vite build or a standalone HTML file. Session records are validated before they are written to browser storage.

## Logical board

The task runner draws every trial on a fixed 960×540 board. Pointers are converted into those coordinates before they are stored. Target selection places hollow-ring targets and solid-disk distractors on a mirrored 4×6 slot grid (left copied to the right). Line bisection presents five horizontal segments, one per trial. Assessment layouts stay fixed; practice may use a lower-density board.

## Shared scoring

Domain scoring is the only interpreter of recorded events. It walks events in elapsed-time order (sequence number as a tie-break), counts first target hits, omissions by side and vertical region, distractors, repeats, click-path length, and line midpoint error (percent of line length; right of center is positive). From the target-selection result it also emits a spatial-pattern summary and a practice suggestion (cue left / right / none, board density standard / low).

## Battery scoring modules

`@neurovision/domain` also exports these battery scorers (pure functions; they do not replace `scoreSession`):

- evidence: `combineEvidence`, `standardize`, `verdictFor`, `seProportionDiff`, `fitNorms`, `DEFAULT_NORMS` (`TestId`, `Hypothesis`, `TestNorm`, `TestObservation`, `EvidenceOptions`, `TestEvidence`, `EvidenceResult`, `Verdict`)
- scene: `generateScene`, `scoreScene`, `hitTest`, `centerOfCancellation`, `SCENE_DEFAULTS` (`HideSide`, `SceneConfig`, `Scene`, `Lantern`, `Building`, `SceneWindow`, `SceneTap`, `SceneTapResult`, `SceneScore`)
- clock: `generateClockTrials`, `scoreClock`, `numeralAngle`, `CLOCK_DEFAULTS` (`ClockSide`, `ClockErrorType`, `StackPosition`, `ClockNumeral`, `ClockFace`, `ClockTrial`, `ClockResponse`, `ClockScore`)
- greyscales: `generateGreyscalesTrials`, `scoreGreyscales`, `chosenDarkSide`, `greyscalesNormFor`, `GREYSCALES_DEFAULTS` (`DarkSide`, `BarPosition`, `ReadingDirection`, `GreyscalesTrial`, `GreyscalesResponse`, `GreyscalesScore`)
- bisection: `generateBisectionLines`, `signedErrorPct`, `bisectionObservation` (`BisectionLine`, `BisectionResponse`)
- battery: `BATTERY_CONTRACT_VERSION`, `parseBatteryRecord`, `scoreBatteryRecord` (`BatteryRecord`, `BatteryScore`). Stored records hold raw taps, trials, and responses only; scores are always recomputed.

## Product surfaces

The UI work must match the supplied UI reference design (look, screens, and board layout). Do not copy that file into the repo.

| Surface | Role |
| --- | --- |
| Home | Start an assessment, open the spatial battery (always visible), open history, open the gaze lab, choose input |
| Spatial battery | Starry Night, clock, greyscales, line bisection. Hidden-scene demo is not saved. Full live runs save to the API when configured, with browser storage as fallback. |
| Target-selection intro and board | Instructions, then ring selection on the 960×540 board |
| Line-bisection intro and board | Five midpoint marks, no trial-by-trial feedback |
| Session review | Hits, omissions, response order, spatial pattern, underlying events |
| Practice setup | Suggested cue and density, left / right / unguided preview, optional row guide |
| Practice round and reflection | Same board family; practice never joins the assessment trend |
| History | Validated records, comparable-session charts, source labels (live vs demonstration). Reads the server when the API is configured. |
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

Agent A exports `CONTRACTS_VERSION` from `@neurovision/domain`. Stored session records must pass `parseSessionRecord` before they are written. Stored battery records must pass `parseBatteryRecord` before they are written. Scoring and practice rules are pure functions with no DOM access. `@neurovision/domain` is the contract: other packages must import these types and `parse*` validators from it. Local copies in other packages are not the contract.

## Contracts

`CONTRACTS_VERSION` is **1.2.0**. Increment it when a stored session field is added, removed, or changes meaning, or when the battery record is added. `PracticeRound.transfer` is a stored session field (optional boolean: `true` means transfer-cue isolation). Battery records carry `BATTERY_CONTRACT_VERSION` (`battery-1.0.0`) on `BatteryRecord.contract` and must pass `parseBatteryRecord` before they are written.

Runtime validators follow `parseSessionRecord`: each `parse*` function throws if the value is invalid and returns a typed, copied object.

### Battery record

Stored under its own envelope. Scores are not stored; `scoreBatteryRecord` regenerates the scene from `seed` and `hide`, scores each test from raw responses, and calls `combineEvidence`. Mode `"demo"` with source `"live"` is invalid.

| Export | Kind | Meaning |
| --- | --- | --- |
| `BATTERY_CONTRACT_VERSION` | `"battery-1.0.0"` | Battery record contract id stored on `BatteryRecord.contract`. |
| `BatteryRecord` | `{ contract, id, mode, hide, seed, readingDirection, consent, source, startedAt, completedAt, scene, clock, greyscales, bisection, normsUsed }` | One battery run. `mode` is `"demo" \| "full"`. `source` is `"live" \| "demonstration"`. `greyscales` and `bisection` may be `null`. `parseBatteryRecord`. |
| `parseBatteryRecord` | helper | Throws if any field is invalid; returns a typed copy. |
| `scoreBatteryRecord` | helper | Pure rescoring from raw data: scene, clock, greyscales, bisection, `combineEvidence`. |

### Organization and identity

| Export | Kind | Meaning |
| --- | --- | --- |
| `Role` | `"owner" \| "admin" \| "reviewer" \| "participant"` | Membership role. `ROLES` / `parseRole`. |
| `Organization` | `{ id, name }` | Tenant. `parseOrganization`. |
| `Membership` | `{ orgId, subject, role }` | Subject membership in an organization. `parseMembership`. |
| `Participant` | `{ orgId, participantId, label, subject }` | Org-scoped participant. Identity is `orgId` + `participantId`. `subject` is the bound identity or `null`. `parseParticipant`. |

### Assignments

| Export | Kind | Meaning |
| --- | --- | --- |
| `ExposureStatus` | `"unseen" \| "seen" \| "unknown"` | Whether the assigned form has been shown. `parseExposureStatus`. |
| `AssignmentManifest` | `{ protocol, scorer, taskIds, source, input, accessibilityId, configHash, requestedMode }` | Immutable snapshot of what a participant is asked to run. `parseAssignmentManifest`. |
| `TaskAssignment` | `{ id, orgId, participantId, revision, supersedes, createdAt, exposureStatus, manifest }` | One immutable revision. `revision` starts at 1. `supersedes` is the previous revision number, or `null` on the first. `parseTaskAssignment`. |
| `appendAssignmentRevision` | helper | Appends a revision and returns a **new** array. Does not mutate the input array or existing revision objects. Identity (`id`, `orgId`, `participantId`) cannot change across revisions. |

### Ingestion states

Three separate unions. Each has `parse*`, `canTransition*`, and `transition*` (throws on a disallowed edge). Same-state is not a transition.

| Union | Values | Allowed transitions |
| --- | --- | --- |
| `CompletionState` | `active`, `complete`, `interrupted` | `active → complete \| interrupted`. `complete` and `interrupted` are terminal. |
| `SyncState` | `local`, `queued`, `uploading`, `acknowledged`, `blocked` | `local → queued \| uploading`; `queued → uploading \| blocked`; `uploading → acknowledged \| blocked \| queued`; `blocked → queued \| uploading`. `acknowledged` is terminal. |
| `ProcessingState` | `pending`, `running`, `ready`, `failed` | `pending → running \| failed`; `running → ready \| failed`; `failed → pending \| running`. `ready` is terminal. |

Constants: `COMPLETION_STATES`, `SYNC_STATES`, `PROCESSING_STATES`, plus `*_TRANSITIONS`.

### Upload batch

| Export | Kind | Meaning |
| --- | --- | --- |
| `TraceUploadRequest` | `{ declaredByteCount, declaredExpandedBytes, declaredChecksum, contentType }` | Declared trace object for upload. Expanded size must be ≥ compressed size. `parseTraceUploadRequest`. |
| `BatchPayload` | `{ sequence, parentBatchId, records, traces }` | Ordered batch of `SessionRecord`s and `TraceUploadRequest`s. Sequence starts at 1 with `parentBatchId: null`; later sequences require a parent id. `parseBatchPayload`, `batchPayloadFromSession`. |

### Gaze sample provenance

`GazeSample` stays `{ elapsed, x, y }`. Do not put capture/inference timing on the sample.

| Export | Kind | Meaning |
| --- | --- | --- |
| `GazeSampleProvenanceRequest` | `{ captureMs, inferenceDoneMs, timestampBasis }` | Timing provenance. `timestampBasis` is `"frame" \| "estimated"`. `inferenceDoneMs >= captureMs`. `parseGazeSampleProvenanceRequest`. |
| `GazeSampleWithProvenance` | `{ sample, provenance }` | Pairing. `attachGazeSampleProvenance` copies the sample as `{ elapsed, x, y }` and the provenance alongside it. |
| `parseGazeSample` | helper | Returns only `{ elapsed, x, y }`, stripping any extra fields. |

### Requested mode

| Export | Kind | Meaning |
| --- | --- | --- |
| `RequestedMode` | `"assessment" \| "practice" \| "transfer"` | What the runner is asked to present. `parseRequestedMode`. |
| `mapRequestedMode` | helper | Mapping onto `SessionRecord`. |
| `practiceRoundForRequestedMode` | helper | Builds the practice record for `practice` and `transfer`. Throws for `assessment`. |

Mapping:

- **assessment** → `SessionRecord` trials (assessment layouts). Not stored in `SessionRecord.practice`.
- **practice** → `SessionRecord.practice` with `transfer` false.
- **transfer** → transfer-cue isolation. Same practice record array, with `transfer: true`.

`isTransferPracticeRound` is true only when `transfer === true`.

### Session source vocabulary

`SessionSource` remains `"live" \| "demonstration"`. Do not add `observed`. `parseSessionRecord` rejects any other source string, including `simulated` and `observed`.

Imported records keep their original string separately:

| Export | Kind | Meaning |
| --- | --- | --- |
| `ImportedSource` | `"live" \| "simulated"` | Original imported source string. |
| `ImportedSourceProvenance` | `{ original }` | Provenance wrapper. `parseImportedSourceProvenance`. |
| `mapImportedSource` | helper | `live → live`, `simulated → demonstration`. |
| `sessionSourceFromImport` | helper | Applies the mapping and refuses to store a simulated import as `live`. |

## Contracts consumers

- Task runner records `ResponseEvent` values in board coordinates with elapsed time, sequence, and task context.
- Review and history render `ScoringResult` (hits, omissions, midpoint errors, response order, spatial pattern).
- Practice setup starts from `suggestPractice`.
- Gaze lab consumes `GazeStream` (samples + tracking-gap intervals) and `CalibrationQualityReport` shapes; Agent C implements behavior.
- Storage persists `SessionRecord` with `source: "live" | "demonstration"`. Imported `simulated` records are stored as `demonstration` and keep `ImportedSourceProvenance.original`.
- Battery storage persists `BatteryRecord` under `neurovision:battery:v1` (`createBatteryStore`). `parseBatteryRecord` runs before every write. The standalone HTML build uses an in-memory key-value backend (`memoryStore()`).
- Organization APIs persist `Organization`, `Membership` (`Role`), and org-scoped `Participant`.
- Assignment APIs persist immutable `TaskAssignment` revisions (`appendAssignmentRevision`); the runner records `ExposureStatus` when a form is first shown.
- Upload uses `BatchPayload` and `TraceUploadRequest`. Ingestion tracks `CompletionState`, `SyncState`, and `ProcessingState` with the allowed transitions above.
- Gaze capture attaches `GazeSampleProvenanceRequest` alongside each `GazeSample`; it does not extend the sample.
- The task runner uses `RequestedMode`. Practice stays on `SessionRecord.practice`; transfer is a practice round with `transfer: true`.
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
| `save` / `load` / `remove` / `listHistory` | Persist through a `HistoryStore` (`parseSessionRecord` runs before every write). When the API client is on, `listHistory` merges server sessions and falls back to the browser store. |
| `listBatteries` / `uploadBattery` / `sessionActivity` | Battery records and a daily activity bucket from `GET /api/v1/sessions`. Full live batteries also save locally. The hidden-scene demo is never stored. |
| `comparableHistory` | `summarizeAssessmentTrend` / `areSessionsComparable` over saved records |
| `loadDemonstrationSessions` / `seedDemonstrationHistory` | Exported demonstration sessions |
| `loadGazeLabData` | Demonstration click sequence, two gaze streams, calibration report, plus simulated lab traces from `@neurovision/gaze` |
| `configurePractice` / `startPracticeTrial` / `appendPracticeRound` / `reflectPractice` | Practice setup and `reflectPracticeRound` |
| `health` / `uploadSession` / `uploadTrace` | Typed calls to the API health, session, and trace-upload routes |
| `enqueueUpload` / `queueState` / `drainQueue` | Offline upload queue: persist session/trace jobs, retry with backoff when online, idempotent by session and batch id |
| `pollProcessingState` | Dashboard polling of processing state with exponential backoff; stops on `ready` or `failed` |
| `exportParticipant` / `deleteParticipant` | Participant export bundle and confirmed delete |
| `beginSignIn` / `completeSignIn` / `signInLocal` / `getMe` / `signOut` | Browser sign-in through the API's `/api/v1/auth/login` and `/api/v1/auth/callback` (cookie + CSRF). `signInLocal` posts to `/api/v1/auth/local`. |

Screens use `apps/web/src/data/sessionStore.ts` as a thin adapter over this HistoryStore. Sign-in, export, delete, and upload-queue chrome are shown only when the API client is enabled.

### History store

The default store is `createPackageHistoryStore` from `@neurovision/storage` (the envelope HistoryStore, `kind: "package"`, key `spatial-patterns:envelope:v1`) when that package is in the workspace and a key-value backend such as `localStorage` is available. Battery records use `createBatteryStore` on the same key-value backend under `neurovision:battery:v1`; the standalone HTML build passes `memoryStore()`. `load` maps envelope `sessions` and, on `EnvelopeError`, returns `{ sessions: [], rejected: 0, error }` without replacing the stored value. `save` calls `saveSession`. `remove` filters by id and writes the envelope back. A one-time import copies malformed records from the screens' `neurovision.web.sessions` envelope aside before valid records are written into the package envelope.

Pass a store into `createAppServices({ store })` to override. The standalone HTML build always uses `createMemoryStore()` (`kind: "memory"`). When `packages/storage` is not in the workspace, the Vite alias and tsconfig path resolve `@neurovision/storage` to `apps/web/src/services/storage-unavailable.ts`, and the default is in-memory.

### HTTP API client

`createApiClient` / `createAppServices` read `VITE_API_BASE_URL`. When that value is empty, or when the standalone build is active (`VITE_STANDALONE=true` or a `file:` page), the client is disabled and service methods throw `ApiOfflineError` without calling `fetch`. Set `VITE_API_BASE_URL=/` to use same-origin routes (the Vite dev server proxies `/api` and `/health` to `http://127.0.0.1:3001`).

The client matches the routes `apps/api` registers. Requests use `credentials: "include"` and send `x-csrf-token` from the `nv_csrf` cookie (or `/api/v1/me`) on POST, PUT, and DELETE.

| Client method | Method and path |
| --- | --- |
| `health` | `GET /health` |
| `getMe` | `GET /api/v1/me` |
| `completeAuthCallback` | `GET /api/v1/auth/callback` |
| `signInLocal` | `POST /api/v1/auth/local` |
| `logout` | `POST /api/v1/auth/logout` |
| `listSessions` | `GET /api/v1/sessions` (sessions, batteries, daily activity) |
| `putSession` | `PUT /api/v1/sessions/:sessionId` |
| `putBattery` | `PUT /api/v1/sessions/:sessionId/battery` |
| `createAssignment` | `POST /api/v1/assignments` |
| `putBatch` | `PUT /api/v1/sessions/:sessionId/batches/:batchId` |
| `finalizeSession` | `POST /api/v1/sessions/:sessionId/finalize` |
| `createTraceUpload` | `POST /api/v1/sessions/:sessionId/trace-uploads` |
| `putTraceContent` | `PUT /api/v1/sessions/:sessionId/trace-uploads/:traceId/content` |
| `getSession` / `getProcessingState` / `pollProcessingState` | `GET /api/v1/sessions/:sessionId` (processing field + `processingDetail`) |
| `exportParticipant` | `POST /api/v1/participants/:participantId/exports` |
| `deleteParticipant` | `DELETE /api/v1/participants/:participantId` (`{ confirm: true }`) |

`pollProcessingState` fetches immediately, then waits `initialDelayMs` (default 250ms) doubling each time up to `maxDelayMs` (default 4s) until `processing` is `ready` or `failed`.

### Offline upload queue

`createUploadQueue` persists pending session and optional trace uploads on the same key-value backend (`spatial-patterns:upload-queue:v1`). Jobs are keyed by session id (batch id `"{sessionId}-batch-1"`). A 409 conflict is treated as already stored. While offline, jobs stay queued; an `online` event and `drainQueue()` retry with exponential backoff. Reloading reads the persisted envelope and resets in-flight `uploading` jobs back to `queued`. `queueState()` / `subscribeQueue` expose pending, uploading, acknowledged, and blocked counts.

After a live assessment ends, screens call `enqueueUpload`. The queued work is `PUT` session, `PUT` batch, optional trace bytes, then `POST` finalize.

### Browser sign-in (API routes)

The web app does not run OIDC PKCE in the browser. Sign-in navigates to the API:

| Route | Role |
| --- | --- |
| `GET /api/v1/auth/login` | API starts the provider redirect (PKCE lives on the server) |
| `GET /api/v1/auth/callback` | API exchanges the code, sets `nv_session` / `nv_csrf`, redirects to `/` |
| `POST /api/v1/auth/local` | Local identity for `IDENTITY_MODE=local` |
| `GET /api/v1/me` | Current subject, org, role, and CSRF token |
| `POST /api/v1/auth/logout` | Clears the API session cookies |

`beginSignIn` returns `{ url }` for `/api/v1/auth/login`. `completeSignIn` forwards `code` and `state` to `/api/v1/auth/callback`. These controls are hidden when the API client is disabled (standalone or empty `VITE_API_BASE_URL`).

## Standalone HTML build

`npm run build` runs the static Vite build and the single-file build. `npm run build:standalone` only emits the disk-openable file:

- Config: `apps/web/vite.standalone.config.ts` (`vite-plugin-singlefile`)
- Output: `apps/web/dist/standalone/index.html`
- All JavaScript and CSS are inlined; there are no external `script src` or `link href` URLs
- The file opens from disk (`file:`) with no network requests
- `VITE_STANDALONE` is `true` and `VITE_API_BASE_URL` is empty, so the service layer never calls the API

`npm run verify` runs the production build, all package tests, and the service-layer e2e suite, then writes `docs/RELEASE_EVIDENCE.md`. Merge order for workstreams A–F is in `docs/MERGE_ORDER.md`. The demonstration walkthrough is in `docs/DEMO_REHEARSAL.md`.
