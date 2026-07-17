# Notification Templates Admin UI

Admin SPA for the Notification Templates service: create a `DRAFT` template, preview it
against sample JSON bindings, and publish it. Built with Vite + React + TypeScript,
TanStack Query, React Router, and Mantine.

This repository currently ships a walking skeleton delivered as chained PRs:

- **PR 1 (this slice)** — scaffold + data layer (config, types, typed client, error mapper,
  query hooks, providers, routing shell). Feature pages are placeholders.
- **PR 2** — Create flow (`/create`).
- **PR 3** — Preview flow (`/:templateKey/:version/preview`).
- **PR 4** — Publish flow (`/:templateKey/:version/publish`) + polish.

## Prerequisites

- Node.js 22+, npm 10+
- The `api-template` backend running locally (see below)

## Run the backend

From the `api-template` repo root:

```bash
docker compose up -d      # starts MongoDB (27017) + LocalStack S3 (4566)
mvn spring-boot:run       # starts the API on http://localhost:8080
```

Health check: `curl http://localhost:8080/actuator/health` → `{"status":"UP"}`.

The backend's default `CORS_ALLOWED_ORIGINS` already includes `http://localhost:5173`
(Vite's default dev-server origin), so no extra CORS configuration is needed for local
development. If you run the dev server on a different port, add that origin to
`CORS_ALLOWED_ORIGINS` when starting the backend.

See `api-template/docs/INTEGRATION.md` for the full integration contract this UI
consumes.

## Run this UI

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` and reads `VITE_API_BASE_URL` from
`.env.development` (already pointed at `http://localhost:8080/api/v1/templates`). Copy
`.env.example` to `.env.development` if you need to point at a different backend.

## Build

```bash
npm run build
```

## Project structure

```
src/
  app/            main.tsx, App.tsx, providers (QueryClient, Router, Mantine)
  api/            config.ts, types.ts (contract types), templatesClient.ts (typed client)
  lib/            errors.ts (ApiError -> UI mapper), variables.ts (HTML placeholder
                  extractor), idempotency.ts (per-attempt Idempotency-Key helper)
  queries/        TanStack Query hooks wrapping the typed client
  features/       route-level feature pages (container/presentational)
  routes.tsx      route table
```

`features/` and `components/` never call `fetch` directly — only `queries/` does. `api/`
never imports React.
