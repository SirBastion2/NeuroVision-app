# Folder ownership

Later agents should read `docs/ARCHITECTURE.md` as the repository map, then use this table for who may change which tree.

| Folder | Owner | Notes |
| --- | --- | --- |
| `packages/domain` | Agent A | Versioned contracts, session validation, scoring, practice rules, history comparability, demonstration records. Gaze types only. |
| `docs/` | Agent A | Architecture map and this ownership file. Other agents update their own rows when they add folders. |
| `apps/web` | Agents D+E | Task runner, screens, board, review, practice, history. Must match the UI reference design. |
| `apps/web` boot shell | Agent A (initial) | Minimal React + Vite app that boots. D+E replace the shell with the product UI. Keep the existing brand header. |
| `apps/web/src/services/` | Agent F | Thin service layer: session start, scoring, history I/O, demonstration and gaze-lab loaders. Screens import this; F does not add product screens. |
| `apps/web` standalone build | Agent F | `vite.standalone.config.ts`, `npm run build:standalone`, single-file HTML check. |
| `packages/storage` | Agent B | Browser storage, validated session I/O, identity / profile. |
| `packages/gaze` | Agent C | Gaze streams, replay, heatmaps, calibration, quality gates, analysis. |
| `apps/web` gaze lab shell | Agent C | Minimal gaze-lab wiring only; D+E own full product UI. |
| Root workspace (`package.json`, `tsconfig.base.json`, `scripts/`) | Agent A (initial), then Agent F | Shared scripts (`npm test`, `npm run build`, `npm run build:standalone`, `npm run verify`) and TypeScript baseline. |
| `docs/MERGE_ORDER.md`, `docs/DEMO_REHEARSAL.md`, `docs/RELEASE_EVIDENCE.md` | Agent F | Integration merge gates, demonstration script, verify evidence. |

Cross-cutting integration (static build, standalone HTML, wiring domain + storage + gaze + UI) is Agent F.

Do not add product UI, storage, or gaze runtime inside `packages/domain`.
