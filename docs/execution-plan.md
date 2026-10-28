# Execution Plan

> **Status (2026-10-23):** Phases 0 through 3 were built in one pass against the live demo environment, behind the development credential box. The gateway is a minimal fetch-based client (the official TypeScript client needs private registry access). Verified live: catalog from manifests, run creation, job creation as the user, polling, run document revisions, cancellation. Jobs now carry extra files as `sources` and credentials as `auth_bindings`; the Smart Diff manifest targets the real per-model functions in demo. Smart Diff completed end to end in demo through the real engine (Pending to Completed in about 35 seconds, artifacts attached and shown via the artifact fallback). On 2026-10-28 the user confirmed the full flow from the browser against the `@bcapetillo:smart_diff` module on a containerized agent: Cameo extraction and Smart Diff both run from the catalog to a visible report. The `wfm-manifest` CLI (check, publish, list) is built with live function checks. Remaining: browser walkthrough by the user, packaging (Phase 5), real auth (Phase 6). Concurrency control and container hardening are deliberately deferred.

Companion to `PRD.md`, `manifest-schema.md`, and `coding-standards.md`. Phases are sequential; each ends with a demo that exercises the acceptance criteria against a live Istari environment. Estimates assume one engineer and are rough.

## Decisions fixed for v1
- Authentication is a development stub for now: a credential box where the user pastes an Istari bearer token. The real Zitadel PKCE flow is Phase 6. The stub lives behind the same `AuthProvider` interface the real flow will implement, so nothing else changes when it is swapped.
- The token is held in memory. A development-only "keep for this tab" toggle may store it in `sessionStorage`; that code path is behind a build flag and is excluded from production builds.
- Istari access goes through the `IstariGateway` interface wrapping the Istari TypeScript client. One implementation for v1.
- Manifest validation uses the JSON Schema file at `schema/workflow-manifest.v1.json`, enforced by Ajv in the SPA and by `jsonschema` in the Python CLI. One file, two consumers.
- The Smart Diff module stays in its own repository (`smart-diff-module`). This repository holds the SPA, the schema, the CLI, deployment files, and example manifests.

## Repository layout

```
workflow_manager/
  docs/                         PRD, schema spec, standards, this plan, ADRs, examples
  schema/workflow-manifest.v1.json
  ui/                           Vite + React + TypeScript SPA
    src/auth/                   AuthProvider interface, DevTokenAuth (stub), later PkceAuth
    src/gateway/                IstariGateway interface and TS-client implementation
    src/manifest/               loader, Ajv validation, binding resolver
    src/renderer/               stage renderer, componentMap.ts
    src/components/istari/      ResourcePicker, SystemPicker, BranchPicker, LinkedAccountCredentialPicker
    src/components/inputs/      TextInput, NumberInput, Toggle, Select, MultiSelect, OutputPicker
    src/run/                    run document types, reducer, effects, polling
    src/pages/                  Catalog, StartRun, RunDetail, RunHistory
    src/workflows/              custom components, by workflow key (empty in v1)
    public/config.json          runtime config (dev values)
  cli/                          Python: wfm-manifest check, publish
  deploy/                       Dockerfile (Chainguard nginx), nginx.conf, Kustomize or Helm, ingress patch
```

## Phase 0: Foundations (about 1 week)

Deliverables
- Repository scaffolded per the layout above. Vite, React, TypeScript strict, Tailwind, React Router, TanStack Query, ESLint, Prettier, Vitest, Playwright.
- Istari TypeScript client installed from the private registry (`.npmrc` documented). Confirm the WASM bindings load under Vite in dev and production builds.
- `IstariGateway` interface with the TS-client implementation covering: current user, list resources in a system, read resource content, create resource revision, create resource, list and get jobs, create job, list function auth secrets.
- `AuthProvider` interface and `DevTokenAuth`: credential box, in-memory token, optional dev-only tab persistence, clear-token action, visible "development authentication" banner.
- Runtime `config.json` loader (registry URL, workflow-manager system ID, workflow-manager-runs system ID).
- Development environment decision: which Istari environment the SPA develops against, and how a `localhost` origin reaches the object store. Options in order of preference: the dev bucket and registry already allow a localhost origin for Istari frontend development (verify); a Vite dev proxy for registry calls plus a small local Node proxy for presigned URL reads and writes used only by the dev gateway; a dev deployment on the Istari host path from the start.
- CI: lint, type-check, unit tests, build.

Acceptance
- `npm run dev` shows the credential box; pasting a valid token shows the current user's name and lists the `workflow-manager` system contents in a plain table.
- The same build runs as a static bundle under nginx locally.

Open questions resolved here: dev-environment CORS (new), TS client WASM under Vite (new).

## Phase 1: Catalog from manifests (about 1 week)

Deliverables
- `schema/workflow-manifest.v1.json` covering everything in `manifest-schema.md`, including `options_by` and the three binding forms.
- Manifest loader: list the `workflow-manager` system, read each JSON resource, validate with Ajv, produce typed `Manifest` or `InvalidManifest { errors }`.
- Binding resolver as one pure function with exhaustive tests.
- Catalog page: cards for valid manifests (name, description, tags, version), error cards for invalid ones, empty and unreadable states.
- Example manifests under `docs/examples/`, including Smart Diff and a deliberately invalid one.

Acceptance
- Uploading a manifest to the system makes it appear on refresh. Sharing and unsharing it with a second test user changes what that user sees.
- An invalid manifest shows its errors on a card and does not affect the others.

## Phase 2: Single-stage runs (about 2 weeks)

Deliverables
- Stage renderer and `componentMap.ts`.
- Components: ResourcePicker (search, select, revision), LinkedAccountCredentialPicker (lists the user's function auth secrets filtered by `secret_type`, derives `provider`), TextInput, NumberInput, Toggle, Select with `options` and `options_by`, MultiSelect.
- Run document types and writer: create `<run-id>.json` in `workflow-manager-runs` on submit; optimistic write on revision ID.
- Job submission from a manifest: resolve `target` and `parameters`, call create job as the user, record the job ID in the run document.
- Polling with backoff for job status and run document revisions; stops on terminal status or hidden tab.
- Result stage views: `summary`, `artifact_list` with links into Istari.
- Run detail page at `/runs/<run-id>` and run history at `/runs` listing the user's run documents.

Acceptance
- A test workflow with one job stage (any existing function) runs end to end from the catalog: form, submit, status, results, links that open in Istari.
- Closing the tab during the job and reopening the run shows the completed state.

Open questions resolved here: how job output artifacts are attached and listed (PRD question 3); whether the revision API supports optimistic concurrency (PRD question 6); how LLM credentials expose a provider (schema doc note).

## Phase 3: Multi-stage runs (about 1.5 weeks)

Deliverables
- Run reducer: `(runDocument, event) -> runDocument` covering job stages, review gates, display stages, cancel, and failure. Exhaustive unit tests.
- Effect layer reacting to reducer output (submit job, write revision, cancel job).
- OutputPicker for `stage_output` inputs. Bindings to `$stages.<key>.inputs` and `$stages.<key>.outputs`.
- Resume from any device: opening `/runs/<run-id>` renders the current stage.
- Cancel from any stage; abandoned runs visible in history.
- Second example manifest with a review gate (diff, review, resolve) using stub functions.

Acceptance
- The review-gate example runs end to end across two browser sessions, with the second session resuming mid-run.
- Two tabs on one run: the stale tab reloads instead of overwriting.

## Phase 4: Smart Diff and the manifest CLI (about 1 week, module work in its own repo)

Deliverables
- Smart Diff module updated: accept `file1_revision_id`, `provider`, `model`; write progress and outputs (`report`, `prompt_audit`, `summary`) into its stage section of the run document; attach artifacts.
- `wfm-manifest check <file> [--env <config>]`: schema validation, key uniqueness, binding resolution, `target` validity; with `--env`, verifies via the SDK that the function and version exist and required inputs are covered.
- `wfm-manifest publish <file> --env <config>`: uploads or revises the manifest resource in the `workflow-manager` system.

Acceptance
- Smart Diff runs from the catalog on two real documents in the dev environment and produces the report, visible both in Workflow Manager and in the Istari UI.
- The CLI rejects a manifest whose parameters omit a required function input.

## Phase 5: Packaging and dev-cluster deployment (about 1 week)

Design: `docs/deployment.md`. Artifacts: `deploy/` (Dockerfile, nginx.conf, Helm chart with ALB, nginx, and Istio ingress modes).

Deliverables
- Dockerfile on a Chainguard FIPS nginx base, non-root, read-only root filesystem, pinned tag, SBOM.
- `nginx.conf`: SPA fallback routing under `/apps/workflows/`, `config.json` served from a mounted ConfigMap, health endpoint, JSON access logs.
- Kustomize overlay or Helm chart: Deployment, Service, ConfigMap, ingress path patch on the existing Istari ingress.
- Deployed to a dev cluster on the Istari host path.

Acceptance
- The SPA loads at `https://<dev-istari-host>/apps/workflows/`, shares the Istari origin, and completes a Smart Diff run with no CORS configuration changes.

Open questions resolved here: ingress sibling path and service worker behavior (PRD question 2).

## Phase 6: Real authentication and delivery (about 1.5 weeks)

Deliverables
- `PkceAuth` implementing `AuthProvider`: Zitadel public client, Authorization Code with PKCE, same refresh approach as the Istari frontend. `DevTokenAuth` excluded from production builds.
- Security documentation: one-page architecture and data flow, authentication flow, statement of stored data (none), image inventory, sharing model.
- Runbook for the install team: Zitadel client creation, system creation and sharing, ConfigMap values, ingress patch, manifest publishing.
- Handoff to the install subcontractor.

Acceptance
- Silent sign-in from an existing Istari session in the dev cluster. Production build contains no development authentication code.

Open questions resolved here: token acceptance from a second Zitadel client and refresh mechanism (PRD question 1).

## Sequencing notes
- Phases 0 through 3 need only a dev Istari environment and a pasted token. Nothing waits on the platform team.
- Ask the platform team the Phase 5 and Phase 6 questions during Phase 0 so answers arrive before they block.
- The LLM endpoint question (PRD question 4) gates only the Model One rollout, not development. Smart Diff can be exercised against any reachable provider in dev.

## Total
Roughly 9 weeks of focused engineering to a deployable, authenticated v1 with Smart Diff, plus module work in its own repository. Phases 0 through 4 (about 6 weeks) produce a working system behind the development credential box.
