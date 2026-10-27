# Workflow Manager

**BLUF.** Workflow Manager is an **orchestration layer** that gives non-technical Istari users a guided, multi-step interface for the custom automations engineers build on the platform, without adding a backend, a database, or a new identity system. It is a static web application served from the Istari host, configured entirely by JSON manifests stored in Istari, authenticated by the user's existing Istari sign-in, and executed entirely by Istari agents. Its deployment footprint is one hardened container and one routing rule. Remove it and the platform is unchanged.

## What it is

- **A custom UI layer for Istari Module Functions.** It turns a function or a chain of functions into a form a user can fill in: pick files from Istari, choose a stored credential, set parameters, review intermediate results, and see outputs with links back into the platform. Multi-stage workflows pause for human decisions between automated steps and can be resumed from any device.
- **Driven by configuration stored in Istari.** Each workflow is a JSON manifest in a dedicated Istari system. The manifest declares the stages, the inputs and their types, the Module Function to run, and how outputs flow into later stages. Publishing a workflow is uploading a file. Changing it is uploading a new revision. No build or deployment is involved.
- **Governed by Istari's own access control.** A user sees exactly the workflows whose manifests are shared with them. Share one manifest to grant one workflow, share the system to grant them all, remove the share to revoke. Workflow Manager has no permission model of its own.
- **Signed in with the existing Istari identity.** The same identity provider, the same session, the same per-user token. Every call to the registry and every job it creates is made as the user, so Istari's audit records name the person, not a service account.
- **Served from the Istari origin.** It is a folder of static files served by a minimal nginx container, reached at a path on the Istari hostname. Because the browser treats it as the same origin as the Istari UI, it reads and writes files through the registry and the object store exactly as the platform's own frontend does.
- **Stateful through Istari.** Run history and in-progress state live as JSON resources in Istari, next to the jobs they describe. Nothing is stored anywhere else.

## What it is not

- **Not an execution environment.** Workflow Manager runs no customer code and performs no computation on files. Every workflow step executes as an Istari job on an Istari agent, the platform's authorized and accredited computing surface, under the agent's existing controls. The browser only submits the job and watches it.
- **Not an API or a backend service.** It has no server-side code, exposes no endpoints, accepts no inbound requests other than serving its own files, and makes no outbound connections. There is nothing for another system to integrate with and nothing that holds data at rest.
- **Not a credential store.** It holds no API keys, service accounts, or client secrets. Tool and LLM credentials stay as Istari stored credentials and are bound to jobs by reference. User tokens live in browser memory for the session.
- **Not a replacement for the Istari UI.** It covers the gap between what the platform's single-input job form can express and what real engineering workflows need. Files, jobs, and results remain ordinary Istari objects visible in the Istari UI.
- **Not a platform modification.** No change to the registry, the frontend, the agents, or their configuration. It installs beside the platform and uninstalls cleanly.
- **Not a no-code builder for end users.** Manifests are authored by engineers who also write the Module Functions. End users run workflows; they do not define them.

## Essential benefits

- **For users:** complex automations become guided forms inside the environment they already work in. No second login, no second desktop, no copying IDs between systems.
- **For engineers:** a new capability is a Module Function plus a manifest. It ships in days, not release cycles, and updates without redeploying anything.
- **For security and accreditation:** one static-file container with no data, no secrets, no egress, and no new accounts, riding the platform's existing load balancer, identity provider, and image delivery path. Authorization and audit are Istari's. The security impact analysis is short because there is little to analyze.
- **For the platform:** it is additive. If the platform later gains these capabilities natively, Workflow Manager can be retired with no migration, because everything it produced is already an Istari resource or job.

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

## Workflow configuration: how it is stored, managed, and updated

**There is no database.** Workflow Manager keeps no state of its own anywhere. Every piece of configuration and every record of a run is an ordinary Istari resource, stored and versioned by the platform, in two Istari systems created at install time:

| System | Contents | Who can read | Who can write |
|---|---|---|---|
| `workflow-manager` | One JSON manifest per workflow (`<workflow-key>.json`) | Users the manifest or system is shared with | Engineers who publish workflows |
| `workflow-manager-runs` | One JSON run document per run (`<run-id>.json`) | Workflow Manager users | Workflow Manager users (the SPA writes transitions; modules write their own outputs) |

Both are regular systems in the Istari UI. You can open them, browse the files, read a manifest, see its revision history, and share or unshare them like any other content.

### What a manifest is

A manifest is a JSON file describing one workflow: its name and version, its ordered stages, each stage's typed inputs (file pickers, credential pickers, text, numbers, choices), the Module Function each stage runs and how inputs bind to its parameters, and how outputs feed later stages and the results view. The format is specified in `docs/manifest-schema.md` and enforced by the JSON Schema at `schema/workflow-manifest.v1.json`, which both the application and the publishing CLI load. Examples live in `docs/examples/`.

### Lifecycle

1. **Author.** An engineer writes the manifest alongside the Module Function it drives. The manifest lives in source control with the module.
2. **Validate.** `wfm-manifest check <file>` validates against the schema and the semantic rules (unique keys, bindings resolve, target is a file input). With `--env`, it also confirms against the live registry that every referenced function and version exists and that the function's required inputs are covered.
3. **Publish.** `wfm-manifest publish <file> --env <env.json>` uploads the manifest as a resource in the `workflow-manager` system. If a file with that name already exists there, it becomes a new revision of the same resource; otherwise a new resource is created and committed to the system's baseline branch. Either way the catalog picks it up on the next page load. No application build, image, or deployment is involved.
4. **Grant.** Share the manifest resource with the users or groups who should see the workflow, or share the whole system to grant every workflow. This is Istari's standard sharing; Workflow Manager has no permission model of its own and simply lists the manifests the user's token can read.
5. **Update.** Publish again. The resource gains a revision. Runs record the manifest revision they were started from, so in-flight runs keep rendering against the version they began with, and history remains accurate after a change.
6. **Retire.** Unshare the manifest to hide it, or archive the resource to remove it. Existing run documents still reference it by id and revision.
7. **Roll back.** Re-publish an earlier manifest file, or restore the earlier revision in Istari. Nothing else needs to change.

### What this means in practice

- **Versioning, history, and audit come from Istari.** Every change is a revision with an author and a timestamp. Who was granted a workflow and when is in Istari's access history.
- **Access control is Istari's.** Seeing a manifest lets a user open the form. Istari still checks their access to each file they pick and to the function when the job is created.
- **Backup and recovery are the platform's.** There is nothing separate to back up.
- **Environments are just systems.** Development, staging, and production differ only in which registry and which two system ids the application's `config.json` points at.
- **Invalid manifests fail safely.** A manifest that does not validate is shown to engineers as an error card with the reasons and is never rendered as a form.
