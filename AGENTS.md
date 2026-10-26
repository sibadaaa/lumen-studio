# AGENTS.md

LUMEN 流明 — Vue 3 frontend + local Hono BFF for AI image/video generation. Single user, no auth. `README.md` (Chinese) is detailed and current; `docs/03-api-contract.yaml` is the API contract.

## Commands

```bash
npm run dev:all        # Vite (127.0.0.1:5173) + BFF (127.0.0.1:8787) via concurrently
npm run dev            # web only
npm run dev:server     # BFF only (tsx watch)
npm run typecheck      # vue-tsc -b (src) AND tsc -p tsconfig.server.json
npm run test:server    # node --import tsx --test server/tests/*.test.ts (vault, estimate, ffmpeg, db, agent)
npm run build          # vue-tsc -b && vite build
```

- Single test file: `node --import tsx --test server/tests/vault.test.ts` (same pattern for others).
- No lint or formatter config exists; don't invent one. Verification = `typecheck` + `test:server`.
- `npm run test:server` needs `ffmpeg`/`ffprobe` on PATH (`FFMPEG_PATH`/`FFPROBE_PATH` override). The vault and estimate tests don't.
- Frontend has no test runner; only server code is tested.

## Two TypeScript worlds

- `tsconfig.json` (project references) covers `src/` + `vite.config.ts` via `tsconfig.app.json` — bundler resolution, no `.js` import extensions, `.vue` files included.
- `tsconfig.server.json` covers `server/` + `shared/` — **NodeNext**: relative imports must end in `.js` (e.g. `import ... from "../shared/contracts.js"`). Match the existing style or typecheck fails.
- `npm run typecheck` runs both; a change in one world can break the other.

## Frontend

- Vue 3 + TypeScript + Vue Router + Pinia. Entry: `src/main.ts`; shell: `src/App.vue`; routes: `src/router.ts`.
- `StudioPage` and `AgentPage` are kept alive via `<KeepAlive :include="['StudioPage','AgentPage']">`; their `defineOptions({ name })` must match those strings.
- `src/stores/studio.ts` owns generation/queue state; `src/stores/app.ts` owns project/runtime/theme/toast/API modal state.
- `src/agent/useAgent.ts` wraps session CRUD + SSE; `src/agent/AgentPage.vue` renders the workbench. `src/chat.css` layers chat layout over `.workspace-page` / `.ws-*`.
- i18n uses the existing JSON locales through `src/i18n/index.ts` (`useT(ns)`), not vue-i18n.

## Architecture invariants

- `shared/contracts.ts` is the single source of truth for API types used by both frontend and BFF. Change contracts there, not in `src/` or `server/`.
- `server/config.ts` loads `.env` with a hand-rolled parser (cwd-relative, existing env vars win) — no dotenv package. BFF must be started from the repo root for `.env`/`data/` to resolve.
- Provider logic lives in `server/providers/` as adapters (ark / openai / mock) behind `providers/types.ts`. The mock provider needs no API key and exercises the full queue/poll/FFmpeg path — use it for local verification.
- `data/` is runtime state (gitignored): `master.key`, `lumen.db` (SQLite, WAL), assets/outputs. Deleting it resets provider config, projects, sessions and history. Legacy `providers.json` / `jobs.json` / `assets.json` are imported once into SQLite on boot and renamed to `*.migrated`; never write to them.
- SQLite uses the built-in `node:sqlite` (`server/db.ts`) — no ORM and no native dependency. Schema migrations live in `server/db.ts` (`SCHEMA_VERSION`); bump it when adding tables rather than editing old migrations.
- Agent runtime (`server/agent/runtime.ts`) is a local, deterministic orchestrator (no LLM API call). It parses intent, plans, then calls the same generation queue via `media.generate`, streaming `AgentEvent`s over SSE. Sessions/messages live in SQLite via `server/storage/sessions.ts`.
- Agent runs are in-memory: after a BFF restart, sessions stuck in `running` are reset to `idle` at startup.
- Changing `APP_SECRET` makes already-stored keys undecryptable.
- Vite proxies `/api` and `/media` to the BFF; the browser never talks to :8787 directly.

## Don't touch

- `design/` is a static design prototype (`design/index.html`), not production frontend. Production code is `src/`.
- `docs/01-*`, `docs/02-*`, `docs/03-api-contract.yaml` are specs; update the API contract when changing endpoints.

## Working conventions

- **Do not take screenshots** (no Playwright `page.screenshot()`, no new PNGs, do not update `design/screenshots/`). Verify UI changes with DOM measurements/computed styles, `npm run typecheck`, `npm run build`, and Playwright assertions; report the evidence in text instead. Existing screenshots are historical references only.
- UI font-size increases should be applied consistently across all comparable panels (studio inspector, workspace/project right column, agent context, API & models modal). Keep the scoped override blocks at the end of `src/styles.css` so they are easy to tune.
- Prefer human-readable Chinese copy in the UI and user-facing messages; code/comments stay in English.
