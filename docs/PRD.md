# Workflow Manager

## 1. Problem

Forward Deployed Engineers (FDEs) need a fast way to deliver custom, multi-step capabilities to non-technical, UI-focused customers inside secure environments (Model One: air-gapped AWS GovCloud, CUI/ITAR, IL5 controls). Today they can automate the platform through the Python SDK and ship Module Functions to agents, but there is no supported surface for building a guided user experience on top of that automation and running it where the user already works.

The platform's Module Function UI accepts a single input resource per job. Anything more complex (two files, several parameters, chained operations) forces one of three workarounds, all of which have failed in practice:

- **Bundle the workflow into a Module Function.** Users copy and paste resource IDs into free-text parameters. Confusing for users, constraining for engineers.
- **Ship a standalone desktop app.** Smart Diff (LLM-assisted diff of two Istari files) was built this way and approved for Model One, but the only authorized host was an AWS Workspace. Users had to log in to a separate box, launch the tool, and navigate back to Istari. Updates were per-box. Adoption suffered because the friction outweighed the value.
- **Embed HTML apps in the File Preview iframe.** Buildable today, but the sandbox gives the app an opaque origin: no identity, no object-store reads or writes, no persisted state. Fixing that requires a platform release that FDEs do not control.

The lesson generalizes: whenever a customer needs a workflow the core platform does not yet support, FDEs should be able to build it quickly and have it run alongside Istari, in the browser, authenticated by the same identity provider, with nothing new to log in to and as little new infrastructure as possible to accredit.

## 2. Why not the alternatives

| Option | What it solves | Why it is not sufficient |
|---|---|---|
| Module Functions alone | Execution on accredited agents; auth secrets for tool credentials | Single-resource job UI; no guided multi-step input |
| Desktop app on AWS Workspace (Smart Diff) | Rich UI; was approvable | Second login and environment; uncentralized updates; users abandoned it |
| HTML app in File Preview iframe | Lives inside Istari | Blocked on a platform change; no identity, file I/O, or state |
| GitLab CI pipelines | Orchestration, logs, audit, git-versioned code | No guided UI (plain-text variables, users still paste IDs); runners act as a service account; separate developer-tool login; no GitLab known in the Model One boundary |
| Three-tier app (React, FastAPI, Postgres, worker) | Everything | Three images, a database, server-held tokens, a queue. Each is a line item in the security impact analysis. Nearly all of it duplicates what Istari agents and the registry already provide |

Two platform changes would shrink or remove the need for this project and should be pursued in parallel: a multi-input job form in the Istari frontend (the module manifest already permits multiple `user_model` inputs; only the UI restricts to one), and a host-page postMessage API for the File Preview iframe. Workflow Manager is designed so its Istari access layer can be swapped for the iframe API if that ships.

## 3. Solution

Workflow Manager is a static single-page application served under the same hostname as the Istari frontend, so the browser treats it as the same origin. It runs as its own Deployment and Service in the Istari namespace; "same host" throughout this document means the same URL hostname, not the same node or pod. It has no backend and no database of its own. It signs the user in through the same Zitadel the Istari frontend uses, calls the Istari registry with the user's own token using the Istari TypeScript client exactly as the Istari web UI does, and executes Workflows by submitting Istari jobs to Module Functions running on the customer's existing agents. Istari is the data store and the access control system: each Workflow is a JSON manifest resource in a dedicated Istari system, a user's catalog is simply the manifests their token can read, and run records and run state live as Istari jobs and resources.

Workflow Manager is additive by design. It introduces no changes to platform code, schema, or configuration beyond an ingress rule and an OIDC client. If it is removed, the platform is unchanged and every artifact it produced remains an ordinary Istari job, resource, or revision that users can still open in the Istari UI.

Benefits:

- **Users**: complex, multi-step engineering automations become guided forms with Istari-aware pickers. No second login, no second environment, no copying IDs.
- **Security**: same IdP, same token model, same access controls and audit trail as the Istari web UI. Who may run which Workflow is Istari sharing on the manifest resource. Nothing new stores data, secrets, or permissions. Jobs execute on already-accredited agents.
- **Engineers**: a Workflow is a Module Function (the pattern FDEs already use) plus a JSON manifest uploaded to Istari, and only when needed a custom component. Publishing or revising a Workflow is uploading a file. Granting access is sharing it.
- **Deployment**: one static container image, one ingress path rule, one Zitadel client. Workflow logic deploys through the module and agent process that already exists.

### Example user flow (Smart Diff, single phase)

1. User is working in Istari and needs to compare two documents.
2. User opens `https://<istari-host>/apps/workflows/` and is signed in silently through the shared Zitadel session.
3. User sees their assigned Workflows and selects Smart Diff.
4. The Smart Diff page lets the user search for and select two Istari resources and revisions, enter a focus prompt, and choose the stored LLM credential (an Istari function auth secret, never typed into the form). The user submits.
5. The SPA creates a run document, then creates an Istari job against the first resource with the second resource, prompt, and auth secret reference as parameters. The job runs on an agent. The user can stay or navigate away.
6. The SPA polls job status and the run document. On completion it shows the summary and links to the report artifact in Istari.

### Example user flow (multi-phase: diff, review, resolve)

1. Steps 1 through 5 as above. Phase one produces a conflict list.
2. The SPA advances the run to a review step and renders the conflicts. The user selects which conflicts to resolve and chooses a resolution strategy for each. The user may leave and return later; the run is resumable from history.
3. The user confirms. The SPA records the selections in the run document and submits the phase-two job (a resolution function) with the phase-one report artifact and the selections as parameters, again as the user.
4. On completion the SPA shows the resolved output with links to the new revision in Istari. The run document holds the full trail: inputs, both job IDs, selections, outputs.

## 4. Scope

**In scope (v1)**
- SSO login via Zitadel using Authorization Code with PKCE.
- Workflow catalog: the manifest resources in the `workflow-manager` system that the user can read. Access is managed entirely by Istari sharing.
- Config-driven renderer: each manifest's stages and typed inputs map to a library of Istari-aware React components (see `docs/manifest-schema.md`), plus a custom-component escape hatch.
- One reference Workflow (Smart Diff) end to end, plus a template for new Workflows.
- Multi-phase runs: a run is an ordered sequence of steps (form, job, review, result) with state held in the run document, resumable from any device.
- Job submission, status polling, run document display, result links into Istari.
- Run history per user from run documents, cross-referenced to the Istari jobs list.
- Deployment artifacts: static image, Helm chart or Kustomize overlay with ingress path and runtime config.

**Out of scope (v1)**
- Any server-side component owned by Workflow Manager.
- Any Workflow Manager admin UI. Publishing is uploading a manifest; access is Istari sharing.
- Multi-tenancy across customers. One deployment per customer.
- Scheduling, webhooks, or triggers other than user-initiated runs.
- Unattended chaining of separate jobs with no human step between them (see 5.4: collapse those into one Module Function).
- Parallel branches within a run. Steps are sequential in v1.

## 5. System Architecture

One deployable unit: a container serving static files. Everything else is the Istari platform.

```
Browser ── SPA (static, same host as Istari) ── Zitadel (PKCE)
   │
   └── Istari TS client, user bearer token ── Registry service ── Object store (presigned, same-origin CORS)
                                                   │
                                                   └── Jobs ── Agents ── Module Functions (Python, SDK) ── LLM endpoint
```

### 5.1 Static SPA
- React, TypeScript, Vite, Tailwind, TanStack Query, React Router. Istari TypeScript client for all platform calls.
- Served by a Chainguard nginx image from its own Deployment and Service in the `istari` namespace. One added path rule on the existing Istari ingress routes `https://<istari-hostname>/apps/workflows/*` to this Service; all other paths continue to the Istari frontend Service. Because origin is scheme plus hostname plus port, the SPA shares the Istari frontend's origin and inherits its CORS allowlist entries on the registry service and the object store bucket. Fallback if path routing is not possible: a subdomain, which is a new origin and needs one CORS allowlist entry on each of the registry service and the bucket. Confirmed empirically on 2026-10-23: the registry reflects any origin, but the bucket returns no CORS headers for a localhost origin, so content transfers from a non-allowlisted origin fail in the browser. Development uses a Vite-side forwarder for presigned URLs; production relies on the shared origin.
- Runtime configuration (`config.json`: registry URL, Zitadel issuer and client ID, catalog resource ID) is mounted from a ConfigMap, so one image serves every environment.
- Routes: `/` catalog, `/workflows/<workflow-key>` start a run, `/runs/<run-id>` run detail and resume, `/runs` history.
- On load the SPA lists the `workflow-manager` system, reads each manifest the user can see, validates it against the manifest JSON Schema, and renders valid ones as cards. An invalid manifest renders as a card showing its validation errors so FDEs can fix it; it never breaks the catalog.
- Istari access is isolated behind one adapter interface (`IstariGateway`): the direct TS-client implementation for v1, with room for an iframe postMessage implementation later.

### 5.2 Authentication
Full design, including how the Istari frontend authenticates today and the two ways to reuse the existing session, is in `docs/auth.md`.

**Development phase.** Until Phase 6 of the execution plan, authentication is a stub: a credential box where the user pastes an Istari bearer token. It implements the same `AuthProvider` interface the Zitadel flow will, is visibly labelled as development authentication, and is excluded from production builds. Everything below describes the production design.

- Workflow Manager is registered in Zitadel as a public OIDC client in the same Zitadel project as the Istari frontend, so tokens carry the audience the registry service accepts. Redirect URI on the Istari host.
- Authorization Code with PKCE. Access token held in memory; refresh via `offline_access` refresh token or silent renew, whichever the Istari frontend uses, so the posture matches the platform exactly.
- Every registry call is made as the user. Istari enforces access control, infosec levels, and control tags on every resource, job, and function involved.
- Workflow Manager has no authorization logic of its own. Catalog visibility is Istari sharing on manifest resources: share the system to grant every Workflow, share one manifest to grant one Workflow, remove the share to revoke. Users hold viewer on manifests; FDEs hold editor to publish. Seeing a manifest grants nothing else: Istari still checks the user's access to each input file and to the function when the job is created. Grant and revoke history is Istari's access audit.
- Jobs execute under the agent's credentials, as every Istari job does today. The job record names the submitting user.
- Assumption to verify with the platform team: the registry accepts tokens from a second client in the Zitadel project. The MCP Service is an existing second client, so this is expected to hold.

### 5.3 Execution within a phase
- A phase executes as one Istari job against a Module Function. The job carries the target resource, plain parameters, additional input files as revision `sources` keyed by the function's input names, and credentials as `auth_bindings` to stored credentials. The module's Python does all automated orchestration inside the phase: reading inputs, calling other functions, calling the LLM, writing outputs.
- Modules that do not know about run documents still produce visible results: when a job completes without writing declared artifact outputs, the SPA fills them from the artifacts attached to the target resource since the stage started.
- Tool and LLM credentials use Istari function auth secrets (`auth_info` inputs), which the Smart Diff manifest already declares. Users never type credentials into Workflow Manager.
- Outputs are job artifacts attached in Istari plus an updated run document (5.5). Results are therefore visible in the Istari UI as well as in Workflow Manager.
- Concurrency, retries, durability, and logs are the agent infrastructure's.

### 5.4 Multi-phase orchestration
Principle: **humans gate phases, agents chain within a phase.** The SPA orchestrates between human touchpoints. A Module Function chains the automated steps that need no human. Two jobs that would only ever run back to back with no decision between them are one Module Function with two stages, not two steps in the UI.

- **Run model.** A run has its own ID (UUID minted by the SPA) and follows the ordered `stages` array in the Workflow manifest. A stage with inputs and a function is a job stage; a stage with inputs and no function is a review gate; a stage with only a view is a result display. The run document records the current stage and, for every completed stage, its user inputs, job ID, outputs, and timestamps.
- **State machine.** The SPA is the only writer of step transitions. Modules write progress and outputs for their own job step. Transition logic is a pure reducer over (run document, event) so it is unit-testable and the same on every device.
- **Input binding.** Function parameters are bound from the stage's own inputs (`$inputs.<key>`), from a prior stage's user inputs (`$stages.<key>.inputs.<key>`), from a prior stage's outputs (`$stages.<key>.outputs.<key>`), or from literals in the manifest. That is the entire binding language. Anything it cannot express is a custom component or a small glue Module Function, not a new manifest feature.
- **Attribution.** Every job in a run is submitted by the SPA with the user's token, so Istari records the human on each job. This is a property a server-side orchestrator or a job-chaining module would not have.
- **Resumability.** Because all state is in the run document, closing the tab, switching machines, or a browser crash loses nothing. Opening `/runs/<run-id>` reconstructs the exact step. A job that is running when the user leaves finishes on the agent; the module writes its outputs; the SPA advances when the user returns.
- **Concurrency.** Two tabs on the same run could race. Writes use optimistic concurrency: read the latest revision, compare to the revision last seen, write only if unchanged, otherwise reload and re-render.
- **Cancel and abandon.** A run can be cancelled from any step; in-flight jobs are cancelled through the jobs API. Runs left in `awaiting_input` stay listed in history until cancelled.
- **Limitation.** Advancing from one step to the next requires the browser. A run never advances unattended. If a Workflow needs unattended multi-job chaining with no human in between, that is the signal to put the chain inside one Module Function, or, if the jobs truly cannot share a function, to take the escalation path in Appendix A.

### 5.5 Data: Istari as the store
Because the SPA shares the Istari origin, it can read and write resource content through presigned URLs exactly as the Istari web UI does. Workflow Manager data lives in two dedicated Istari systems with different sharing: `workflow-manager` holds manifests (users viewer, FDEs editor) and `workflow-manager-runs` holds run documents (users editor).

| Data | Where | Written by | Notes |
|---|---|---|---|
| Workflow manifest | `<workflow-key>.json` in `workflow-manager` | FDE (SDK or UI upload) | One per Workflow: key, name, description, version, ordered stages with typed inputs, function binding, outputs, and views. Schema in `docs/manifest-schema.md`. Sharing the resource is granting the Workflow. Uploading a new revision publishes a change with no redeploy. |
| Job record | Istari job (one per `job` step) | SPA when the step starts | Submitter, parameters file (inputs), status history, artifacts. Istari's own audit record of the work. |
| Run document | `<run-id>.json` in `workflow-manager-runs` | SPA at run creation and every step transition; module during its job step | Workflow key and version, step list with current step, per-step inputs, job IDs, outputs, progress messages, timestamps, and final result summary. New revision per update. The source of truth for run history and the state the SPA resumes from. |
| User drafts and preferences | Browser localStorage | SPA | Allowed now that the app has a real origin. Nothing sensitive. |

Secret-flagged inputs are never written to the run document or passed as plain parameters; they are referenced by auth secret ID only.

Access: `workflow-manager-runs` is shared with Workflow Manager users as editor so they can create and update run documents. Run documents are therefore visible to that group in v1. If per-user isolation is required, create run documents with per-resource access instead. Run documents reference CUI resources by ID only and inherit the system's classification.

### 5.5 Workflow packaging
A Workflow has up to three parts:

1. **Module Functions** (required, one per `job` step): Python packages following the existing module scaffold, deployed to agents through the existing module process. Each reads inputs from the job parameters, writes outputs as artifacts, and updates its step in the run document via the SDK.
2. **Manifest** (required): one JSON resource describing the Workflow's stages, each stage's typed inputs, function binding, outputs, and views. Validated against the published JSON Schema by the SPA on load and by a CLI before upload (the CLI also checks via the SDK that the referenced function and version exist and that the parameter bindings cover the function's required inputs).
3. **Custom components** (optional): an input or view may name a `component` compiled into the SPA under `src/workflows/<workflow-key>/` when the standard library is not enough. Requires a new SPA image.

Most Workflows need only parts 1 and 2 and ship with no change to the Workflow Manager image. Smart Diff is one job stage (two resource pickers, a text input, an auth-secret picker, the existing `@istari_utils:smart_diff` function) and one result stage.

## 6. Deployment, security, and accreditation

The full plan, including topology, ingress modes, image delivery through the cross-domain solution, the cyber-lift table, effort estimates, and open questions for the install team, is in `docs/deployment.md`. Artifacts (Dockerfile, nginx configuration, Helm chart) are in `deploy/`.

Workflow Manager is positioned as a thin companion to the Istari frontend, following the same pattern.

- One image built on a Chainguard FIPS nginx base, non-root, read-only root filesystem, all capabilities dropped, pinned tags, SBOM published. Delivered and mirrored through the customer's existing image approval process.
- No data at rest. No secrets. No egress. No database.
- Ingress path rule on the existing Istari host and TLS certificate.
- Zitadel public client, created by the Zitadel configurator or documented manual step.
- Structured access logs to stdout for the customer's log shipping.
- Security documentation deliverable: one-page architecture and data flow, authentication flow, statement of stored data (none), image inventory.

Approval risk assessment: additions to the boundary are one static image running as its own Deployment and Service in the existing namespace, one ingress path rule, and one OIDC client. The token model, access control, data store, and execution environment are all the platform's existing accredited ones. The security impact analysis should be short. Residual risk is the install subcontractor's and ISSO's change-process calendar, not the content of the review.

## 7. Non-functional requirements
- Availability: single replica acceptable for v1; the SPA is stateless, so restarts lose nothing.
- Performance: catalog and run pages respond in under one second; status polling every few seconds with backoff.
- Observability: structured nginx access logs; client-side errors surfaced to the user with a correlation ID that also appears in the run document.
- Testing: 80 percent line coverage on SPA logic with the Istari client mocked; the run state reducer tested exhaustively against every step kind and transition; one end-to-end test per Module Function; one Playwright smoke test against a mocked registry.
- Compatibility: pinned Istari TypeScript client and SDK versions per release; catalog schema versioned.

## 8. Success metrics
- Smart Diff used from inside the browser by Model One users without an AWS Workspace login.
- Time for an FDE to go from Workflow idea to deployable module plus manifest: under one week for a Workflow of Smart Diff complexity, with no Workflow Manager image change.
- Zero credentials typed by users.
- Every run attributable to a human user in Istari's job records.

## 9. Open questions
1. Confirm the registry accepts tokens from a second public client in the Zitadel project, and confirm the refresh mechanism the Istari frontend uses (refresh token versus silent renew).
2. Confirm the Istari frontend ingress and any service worker tolerate a sibling path on the same host. If not, use the subdomain fallback and scope the CORS change.
3. Confirm how job output artifacts are attached and listed, so the run detail page can link them.
4. Confirm the authorized LLM endpoint for Smart Diff in Model One and that it is reachable from the agents.
5. Decide whether `workflow-manager-runs` is shared with a group as editor (simple) or run documents use per-resource access (isolated).
6. Confirm the revision API returns the current revision ID on read and rejects or exposes conflicts on write, so optimistic concurrency on run documents is enforceable.

## 10. Execution phases

The detailed plan with deliverables, acceptance criteria, and estimates is in `docs/execution-plan.md`. Summary:

- **Phase 0, Foundations**: scaffold, TS client, gateway, development credential box, dev-environment CORS decision.
- **Phase 1, Catalog**: JSON Schema, manifest loader and validation, binding resolver, catalog with error cards.
- **Phase 2, Single-stage runs**: component library, stage renderer, run documents, job submission, polling, results, history.
- **Phase 3, Multi-stage runs**: run reducer and effects, review gates, resume, cancel, optimistic concurrency.
- **Phase 4, Smart Diff and CLI**: module updates, `wfm-manifest check` and `publish`.
- **Phase 5, Packaging**: FIPS nginx image, runtime config, ingress path, dev-cluster deployment.
- **Phase 6, Authentication and delivery**: Zitadel PKCE, security documentation, runbook, handoff.

## Appendix A: Escalation path
If a future Workflow needs data Istari cannot hold (relational queries across runs, secrets Workflow Manager must own, cross-user aggregates) or needs server-side calls made as the user, add a small backend-for-frontend API with its own database at that point. The `IstariGateway` adapter and the catalog-driven design mean the SPA does not change shape. The earlier three-tier design is preserved in version control as the reference for that step.
