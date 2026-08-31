# Notification Templates Admin UI

Admin SPA for the Notification Templates service. Author an HTML email template, see it
rendered before anyone receives it, and publish it when it looks right. Built with Vite +
React + TypeScript, TanStack Query, React Router and Mantine.

The preview does not ask the API to render. It runs the notification sender's own Jinja2
code in the browser, so what the author sees is produced by the same engine that will send
the mail — see [How the preview works](#how-the-preview-works).

## Quick start

```bash
npm install     # postinstall also stages the Pyodide runtime (~14 MB, needs network)
npm run dev
```

Open <http://localhost:5173>. You should get the template list; an empty table means the UI
reached the API and there is nothing stored yet, while an error banner means it did not.

The API has to be running. From the `api-template` repo root:

```bash
docker compose up -d      # MongoDB (27017) + LocalStack S3 (4566)
mvn spring-boot:run       # API on http://localhost:8080
```

Verify with `curl http://localhost:8080/actuator/health` → `{"status":"UP"}`.

The backend's default `CORS_ALLOWED_ORIGINS` already lists `http://localhost:5173`, so a
local pair needs no extra configuration.

## Routes

| Path | Page | What it does |
| --- | --- | --- |
| `/` | List | Browse versions, filter, preview a stored one, publish or archive |
| `/create` | Create | Author a new version — it is born `DRAFT` |
| `/templates/:templateKey/versions/:version/edit` | Edit draft | Rewrite a `DRAFT` in place, without burning a version |

Only drafts are editable. The edit page enforces that itself rather than trusting that the
only way in was the list's Edit button.

## How the preview works

A preview that renders with its own logic is a preview that can disagree with what ships.
That already happened once: the previous SendNotif preview drifted from the sender and went
on rendering happily. So this UI does not reimplement rendering, and does not ask the API to
do it either — the API stores templates and decides which version is live; it does not parse
or render them.

Instead:

1. `scripts/sync-render-core.mjs` copies the sender's render core into `public/py/render_core`
   and records a SHA-256 of every file in `public/py/render-core.manifest.json`.
2. `scripts/setup-pyodide.mjs` stages the Pyodide runtime and the jinja2 wheels under
   `public/pyodide/`, so nothing is fetched from a CDN at render time.
3. `src/preview/` boots that core inside a Web Worker and renders the draft there. One worker
   per session, created lazily and never torn down: Pyodide costs ~14 MB and a couple of
   seconds to start, so every panel shares it.

Two things fall out of this that are worth knowing:

- **The variable catalogue comes from the renderer's own context**, not from scraping the
  template text, so it cannot disagree with what sending will actually supply.
- **Failures are typed by what you can do about them.** `SYNTAX` carries a line number,
  `TEMPLATE_NOT_FOUND` means an `extends`/`include` names something absent, `RENDER` parsed
  but blew up with the sample context, and `ENGINE` is Pyodide itself failing to boot — it
  says so rather than blaming your draft.

### Keeping the copy honest

A vendored copy is only safe while something proves it is still the same copy.

```bash
npm run check:render-core    # exits 1 on drift
npm run sync:render-core     # re-copy and rewrite the manifest
```

`check:render-core` runs in CI on every push and PR. It always verifies the vendored copy
against the manifest, which catches a hand-edit to generated code. Catching **upstream**
drift additionally needs the sender checked out next to this repo:

```
../notifications-sender-service        # or set SENDER_REPO=/path/to/it
```

Without it the check says so and passes, rather than passing quietly. The source of truth is
`lambda/sender`, **not** `terraform/build/stage/render_core` — that one is a build artifact
carrying an older copy.

`public/py/render_core` is generated. Do not edit it by hand; the check will catch you.

## Pointing at a different backend

`VITE_API_BASE_URL` in `.env.development` selects the API. Two shapes:

| Target | `VITE_API_BASE_URL` | Also set |
| --- | --- | --- |
| Local backend | `http://localhost:8080/api/v1/templates` | — |
| Remote backend | `/api/v1/templates` (relative!) | `API_PROXY_TARGET`, `API_PROXY_AUTH` |

A hosted `api-template` cannot be reached straight from a browser: CORS is enforced against
the server's response headers, and the ingress in front of it answers the preflight with a
404 and challenges with Basic auth. So `API_PROXY_TARGET` routes `/api` through the dev
server instead — the browser stays same-origin and Node attaches the credentials on the way
out.

Leave `API_PROXY_TARGET` unset and there is no proxy at all.

> **The base URL must be relative when proxying.** Left absolute, the browser goes
> cross-origin again and the proxy is bypassed entirely.
>
> `API_PROXY_AUTH` holds real credentials. It is deliberately not `VITE_`-prefixed, because
> anything named `VITE_*` is inlined into the client bundle. It belongs only in
> `.env.development`, which is gitignored. This is a dev-only path; a deployed UI has a real
> origin and must be added to the API's `CORS_ALLOWED_ORIGINS`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :5173 |
| `npm test` | Vitest, including the render-core manifest checks |
| `npm run lint` | oxlint |
| `npm run build` | `tsc -b` then `vite build` |
| `npm run check:render-core` | Verify the vendored core; exits 1 on drift |
| `npm run sync:render-core` | Re-copy the core from the sender repo |
| `npm run setup:pyodide` | Re-stage the runtime (`--force` to start clean) |

## Project structure

```
src/
  app/        main.tsx, App.tsx, providers (QueryClient, Router, Mantine)
  api/        config.ts, types.ts, templatesClient.ts — the API contract, nothing else
  preview/    client.ts, protocol.ts, preview.worker.ts — the local render engine
  lib/        errors.ts (ApiError -> UI), idempotency.ts
  queries/    TanStack Query hooks over the client and the preview engine
  features/   route-level pages (container/presentational)
  routes.tsx  route table
public/
  py/         preview_api.py, shape_extractor.py + the VENDORED render_core/
  pyodide/    staged runtime (gitignored, regenerate with setup:pyodide)
scripts/      sync-render-core.mjs, setup-pyodide.mjs
```

Two boundaries hold this together: `features/` never calls `fetch` or the worker directly —
only `queries/` does — and `api/` never imports React.

## Prerequisites

- Node.js 22+, npm 10+
- The `api-template` backend (locally, or reachable through the proxy above)
- `notifications-sender-service` checked out as a sibling, to sync or fully verify the
  render core

For the endpoint contract, see `api-template/docs/API.md`.
