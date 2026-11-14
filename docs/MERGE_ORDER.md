# Merge order (workstreams A–E)

Workstreams land on `main` in this order. A row merges only after its gate is green. Agent F’s service layer and `npm run verify` are the integration wiring those workstreams consume; they are not a substitute for the gates below.

| Order | Workstream | May merge after | Must pass before merge |
| --- | --- | --- | --- |
| 1 | **A** — domain contracts, scoring, workspace, `docs/ARCHITECTURE.md` | empty `main` | `npm test -w @neurovision/domain` (session validation, `scoreSession`, golden fixtures, history comparability, demonstration records, practice round + reflection). Stored-session fields keep `CONTRACTS_VERSION` honest. `packages/domain` and the `apps/web` boot shell build. |
| 2 | **B** — `packages/storage`, identity | A | Storage adapter tests. Every write runs `parseSessionRecord`. History list/load round-trips a validated `SessionRecord`. Identity/profile used by session `profileId` / `alias`. Package exports a store that `createAppServices({ store })` can wrap. |
| 3 | **C** — `packages/gaze` | A | `npm test -w @neurovision/gaze`. Domain bridges emit `GazeStream` and `CalibrationQualityReport`. Gaze lab consumes demonstration streams (`GAZE_LAB_STREAMS`) without changing scoring. |
| 4 | **D+E** — task runner and product UI | A; C for gaze-lab UI; B for persisted history (memory store is allowed until B merges) | Screens listed in `docs/ARCHITECTURE.md` match the UI reference design (look, screens, board layout). The runner records `ResponseEvent` values in board coordinates and calls the app service layer (`startSession`, `score`, `save`/`load`, comparable history, demonstration + gaze-lab loaders, practice + reflection). Do not copy the UI reference file into the repo. Do not replace the existing brand header. |

B and C are independent of each other once A is on `main`; either may merge second. D+E must not merge before A. D+E may merge before B only if history uses the in-memory store from `apps/web/src/services/`. D+E may merge before C only if the gaze lab stays behind a non-blocking empty state.

Integration delivery (static Vite build, standalone HTML, service-layer tests, `npm run verify`) is Agent F and can merge after A (and C when gaze fixtures are required). F does not add product screens.
