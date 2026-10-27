# Workflow Manager

A static single-page application that runs beside the Istari platform and turns Module Functions into guided, multi-stage workflows for non-technical users. No backend, no database: Istari is the data store and the access control layer.

- Design: `docs/PRD.md`
- Manifest format: `docs/manifest-schema.md` (schema at `schema/workflow-manifest.v1.json`)
- Plan and status: `docs/execution-plan.md`
- Standards: `docs/coding-standards.md`
- Deployment and infrastructure: `docs/deployment.md` (artifacts in `deploy/`)
- Brand: `docs/brand.md`

## Layout

```
ui/        Vite + React + TypeScript SPA
  src/gateway/rest   fetch-based Istari client (IstariGateway implementation)
  src/gateway/mock   in-memory gateway for development and tests
  src/manifest       JSON Schema validation, semantic checks, binding resolver
  src/renderer       stage renderer and the input type -> component map
  src/components     Istari-aware pickers and plain inputs
  src/run            run document reducer, effects, polling, hooks
  src/pages          Catalog, StartRun, RunDetail, RunHistory, SignIn
  scripts/           live smoke scripts (see below)
schema/    Workflow manifest JSON Schema (shared by the SPA and the CLI)
deploy/    Dockerfile, nginx.conf, Helm chart (see deploy/README.md)
cli/       wfm-manifest: validate, publish, and list manifests (Python)
scripts/   publish_manifest.py (dev helper, superseded by the CLI)
docs/      Design documents and example manifests
```

## Development

```
cd ui
npm install
npm run dev          # http://localhost:5173/apps/workflows/
npx vitest run       # unit and flow tests
npx tsc --noEmit -p tsconfig.app.json
npx vite build
```

Runtime configuration is `ui/public/config.json`: registry URL, Istari web URL, and the IDs of the two Istari systems (`workflow-manager` for manifests, `workflow-manager-runs` for run documents). It is served as a static file so one build runs in any environment.

Authentication is currently a development credential box: paste an Istari bearer token. Append `?mock=1` to the URL to use the in-memory mock gateway with seeded workflows and no token at all.

**Object store access in development.** The registry API accepts any browser origin, but the object-store bucket's CORS allowlist covers only the Istari web origin. Presigned downloads and uploads from `http://localhost` therefore fail in the browser with `net::ERR_FAILED` even though the bucket returns 200. In `npm run dev` the gateway rewrites presigned URLs to `/apps/workflows/__objstore/<host>/<path>` and a Vite middleware (`vite.config.ts`) performs the request server-side. Production builds never do this; they rely on being served from the Istari host so the origin is already allowlisted.

### Live smoke scripts (run from `ui/`, they read the dev token from a local .env, never commit tokens)

```
npx tsx scripts/probe-gateway.mjs      # exercises every gateway method against demo
npx tsx scripts/smoke-run.mts          # catalog -> create run -> submit stage -> poll, through the real engine
npx tsx scripts/smoke-cancel.mts <runResourceId|-> [jobId...]
```

### Publishing a workflow

Upload a manifest JSON to the `workflow-manager` system and share it with the users who should see it. Share the whole system to grant every workflow. During development:

```
ISTARI_TOKEN=... python scripts/publish_manifest.py docs/examples/smart_diff_workflow_manifest.json
```

The `cli/` package provides `wfm-manifest check|publish|list` with schema validation and live function checks.
