# Folder ownership

Later agents should read `docs/ARCHITECTURE.md` as the repository map, then use this table for who may change which tree.

| Folder | Owner | Notes |
| --- | --- | --- |
| `packages/domain` | Agent A | Versioned contracts, session validation, scoring, practice rules, history comparability, demonstration records. Gaze types only. |
| `docs/` | Agent A | Architecture map and this ownership file. Other agents update their own rows when they add folders. |
| `apps/web` | Agents D+E | Task runner, screens, board, review, practice, history. Must match the UI reference design. |
| `apps/web` boot shell | Agent A (initial) | Minimal React + Vite app that boots. D+E replace the shell with the product UI. |
| `packages/storage` | Agent B | Browser storage, validated session I/O, identity / profile. |
| `packages/gaze` | Agent C | Gaze streams, replay, heatmaps, calibration. |
| Root workspace (`package.json`, `tsconfig.base.json`) | Agent A (initial), then Agent F | Shared scripts (`npm test`, `npm run build`) and TypeScript baseline. |

Cross-cutting integration (static build, standalone HTML, wiring domain + storage + gaze + UI) is Agent F.

Do not add product UI, storage, or gaze runtime inside `packages/domain`.
