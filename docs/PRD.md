# Workflow Manager

## 1. Problem

Forward Deployed Engineers (FDEs) need a fast way to deliver custom, multi-step capabilities to non-technical, UI-focused customers inside secure environments (Model One: air-gapped AWS GovCloud, CUI/ITAR, IL5 controls). Today they can automate the platform through the Python SDK, but that covers only the backend. There is no supported surface for building a guided user experience on top of that automation and running it where the user already works.

The platform's Module Function UI accepts a single input resource per job. Anything more complex (two files, several parameters, chained operations, mid-flow decisions) forces one of three workarounds, all of which have failed in practice:

- **Bundle the workflow into a Module Function.** Users must copy and paste resource IDs into free-text parameters, and the function has to fetch the extra inputs itself. Confusing for users, constraining for engineers.
- **Ship a standalone desktop app.** Smart Diff (LLM-assisted diff of two Istari files) was built this way and approved for Model One, but the only authorized host was an AWS Workspace. Users had to log in to a separate box, launch the tool, and navigate back to Istari. Updates were per-box and uncentralized. Adoption suffered because the friction outweighed the value.
- **Embed HTML apps in the File Preview iframe.** Buildable today, but the sandbox gives the app an opaque origin: no identity, no object-store reads or writes, no persisted state. Fixing that requires a platform release (a host-page postMessage API) that FDEs do not control, and even then apps would have no server-side execution or secrets handling.

The lesson generalizes: whenever a customer needs a workflow the core platform does not yet support, FDEs should be able to build it quickly and have it run alongside Istari, in the browser, authenticated by the same identity provider, with no second environment to maintain.

## 2. Why not the alternatives

| Option | What it solves | Why it is not sufficient |
|---|---|---|
| Module Functions alone | Execution on accredited agents; auth secrets for tool credentials | Single-resource UI; no guided multi-step input; no cross-resource orchestration from the UI |
| Desktop app on AWS Workspace (Smart Diff) | Rich UI; was approvable | Second login and environment; uncentralized updates; users abandoned it |
| HTML app in File Preview iframe | Lives inside Istari | Blocked on a platform change; no identity, file I/O, state, server-side execution, or secrets |
| GitLab CI pipelines as the workflow engine | Orchestration, workers, logs, artifacts, audit, git-versioned workflow code, no image rebuild per change | No guided UI: pipeline variables are plain text or static dropdowns, so users still copy and paste IDs. Runners act as a service account, so Istari calls cannot be made as the human user and Istari access controls and audit are bypassed. No mid-flow user input. Separate login to a developer tool. No GitLab is known to exist in the Model One boundary; standing one up is a larger accreditation lift than this app. |

GitLab is a reasonable execution substrate and a poor user surface. The value of this project is the user surface. If a customer already operates GitLab inside the boundary and FDEs are given a project there, delegating execution to pipelines is a viable option for the worker tier (see Section 5.4). It is not a replacement for the application.

## 3. Solution

Workflow Manager is a small web application deployed alongside the Istari platform in the same Kubernetes cluster, using the same identity provider (Zitadel), following the same deployment and security pattern as the existing Istari MCP Service (a separate confidential OIDC client that calls the registry service). It gives users a list of the Workflows assigned to them, guides them through each Workflow's inputs with Istari-aware controls (resource search and select, no copying IDs), runs the Workflow in the background, and shows status and results with links back into Istari.

Benefits:

- **Users**: complex, multi-step engineering automations become guided forms. No second login, no second environment, no copying IDs between systems.
- **Security**: users authenticate through the existing IdP via SSO. Istari is called with the user's own token, so Istari's access controls, infosec levels, and audit trail apply unchanged.
- **Engineers**: a Workflow is a Python package plus a React page, written against the SDK the way FDEs already write scripts. Orchestration across many resources and functions is ordinary code.
- **Deployment**: new capabilities ship as a documented container image change through the customer's existing image approval and Helm upgrade process, the same path Istari releases already follow. One place to update, every user gets it.

### Example user flow (Smart Diff)

1. User is working in Istari and needs to compare two documents.
2. User opens `workflows.<domain>` and is signed in silently through the shared IdP session.
3. User sees their assigned Workflows and selects Smart Diff.
4. The Smart Diff page lets the user search for and select two Istari resources (and revisions), enter a focus prompt, and submit. LLM credentials are held by the platform (function auth secret or service configuration), not typed by the user.
5. The run starts in the background. The user can stay and watch status or navigate away.
6. On completion the page shows the summary and links to the report uploaded as a new Istari resource.

## 4. Scope

**In scope (v1)**
- SSO login via Zitadel; calls to Istari made as the logged-in user.
- Workflow catalog filtered by assignment.
- One reference Workflow (Smart Diff) end to end, plus a template Workflow for new ones.
- Background execution with durable run records, status polling, and result display.
- Admin assignment of users to Workflows (CLI or seed data; no admin UI).
- Deployment artifacts: container images, Helm chart or Kustomize overlay, migration job.

**Out of scope (v1)**
- Declarative or no-code Workflow authoring.
- Admin UI for assignments.
- Multi-tenancy across customers. One deployment per customer.
- Scheduling, webhooks, or triggers other than user-initiated runs.
- Mid-run human approval steps (design for it, do not build it).

## 5. System Architecture

Four deployable units, three container images (API and Worker share one image with different entrypoints). Deployed with Kubernetes into the Istari cluster alongside the platform.

### 5.1 React UI
- Displays assigned Workflows and run history.
- Guides users through each Workflow's inputs with reusable Istari-aware components (resource picker with search, revision picker, system and branch picker).
- Polls run status and renders results and links into Istari.
- Routes: `/workflows`, `/workflows/<workflow-id>`, `/runs/<run-id>`. One page module per Workflow under `ui/src/workflows/<workflow-id>/`.
- Holds no tokens. Talks only to the Workflow Manager API with a session cookie (see 5.5).
- Served so it can be embedded or linked from Istari later (do not block framing by the Istari origin).

### 5.2 FastAPI API (backend for frontend)
- OIDC confidential client. Handles login redirect, callback, session, logout.
- Exposes versioned routes (`/api/v1/...`) for catalog, run creation, run status, and Workflow-specific helper endpoints (for example, resource search proxied to Istari as the user).
- Validates inputs, writes the run record, enqueues the run. Never executes Workflow logic in the request path.
- One router package per Workflow under `api/app/workflows/<workflow-id>/` containing routes, input and output models, and the executor.

### 5.3 Worker
- Same image as the API, different entrypoint. Consumes runs from a Postgres-backed queue (`SELECT ... FOR UPDATE SKIP LOCKED`), so no additional broker is introduced into the boundary.
- Executes the Workflow's Python executor: custom logic, Istari SDK calls, Istari job submission and polling, result upload.
- Emits run events (status, progress message, percent) that the UI polls.
- Horizontally scalable; concurrency is bounded per replica. Target: tens of concurrent users, runs lasting minutes.

### 5.4 Execution substrate options for Workflow steps
- **In-worker Python** (default): custom orchestration and light compute.
- **Istari jobs**: heavy or tool-bound steps submitted to existing Module Functions on accredited agents, polled by the worker. Smart Diff already exists as a Module Function and can be invoked this way.
- **GitLab pipeline** (optional, only where GitLab exists in the boundary and FDEs own a project): trigger via pipeline API, poll, fetch artifacts. Identity is lost at this hop; record the human initiator in the run.

### 5.5 Authentication and authorization
- Workflow Manager is registered in Zitadel as a confidential OIDC client in the same Zitadel project as the Istari frontend, so its access tokens carry the audience the registry service accepts.
- Login uses Authorization Code with PKCE through the API (BFF pattern). Tokens are kept server-side in the session store; the browser holds only an httpOnly, secure session cookie. This keeps tokens out of the browser, which matters for IL5 review.
- Istari calls made during a request use the user's access token. Istari enforces its own access controls; Workflow Manager adds none of its own on Istari data.
- Background runs outlive the 15-minute access token. The worker refreshes using the `offline_access` refresh token stored encrypted at rest and scoped to the run. If the customer disallows refresh tokens, the fallback is a Workflow Manager service account for the execution phase with the human initiator recorded on the run; this is a documented degradation, not the default.
- Workflow Manager's own authorization is limited to catalog visibility: which users may see and launch which Workflows.
- Assumption to verify with the platform team: the registry service accepts any valid token from the Zitadel project regardless of client ID. The MCP Service pattern suggests yes.

### 5.6 PostgreSQL
Separate database on the same managed Postgres instance the platform uses, owned by Workflow Manager, migrated with Alembic. Initial entities:

- `workflow`: id, key, display name, description, version, enabled, created, updated.
- `workflow_assignment`: workflow_id, subject_id (Zitadel user or group id), subject_type, granted_by, created.
- `workflow_run`: id, workflow_id, workflow_version, initiator_user_id, status (queued, running, succeeded, failed, cancelled), inputs (JSONB, secrets redacted), outputs (JSONB), istari_refs (JSONB: resource, revision, job IDs touched), error, queued, started, finished, worker_id.
- `run_event`: id, run_id, timestamp, level, message, progress.
- `session`: id, user_id, encrypted tokens, expiry.

The run tables are the audit log for the application. Input fields flagged as secret are never persisted.

### 5.7 Workflow packaging
A Workflow is a directory in the API (`workflows/<id>/`: routes, models, executor, tests) and a directory in the UI (`workflows/<id>/`: page, form, results view) sharing a generated TypeScript client from the OpenAPI spec. Each Workflow declares a version; runs record the version that executed them. A cookiecutter or copier template produces a new Workflow skeleton.

## 6. Deployment, security, and accreditation

The application is positioned as an Istari platform add-on service following the established pattern of the MCP Service, not as a bespoke customer application. Requirements:

- Container images built on Chainguard FIPS base images, non-root, read-only root filesystem, all capabilities dropped, pinned tags, SBOM published, matching the platform's existing security context.
- Images delivered and mirrored through the customer's existing image approval process alongside platform releases.
- No egress. LLM access only through the endpoint already authorized for Smart Diff.
- Secrets (OIDC client secret, database credentials, token encryption key) in Kubernetes secrets sourced from the customer's secrets manager. No secrets in images or config maps.
- Structured JSON logs to stdout for the customer's log shipping and SIEM. No tokens or secret inputs in logs.
- TLS at the ingress using the platform's existing certificates. Service-to-service traffic within the namespace.
- Database backups inherit the platform's managed Postgres policy.
- Security documentation deliverable: architecture diagram, data flow, ports and protocols, authentication flow, list of stored data, image inventory. Prepared for the customer ISSO to perform a security impact analysis.

Approval risk assessment: the Smart Diff desktop app was approved as a user tool on a Workspace. A network-exposed web service with its own database is a higher bar and will be treated as a change to the authorized boundary. The factors most likely to make it approvable are: same cluster and namespace pattern as Istari, same IdP with no new credentials, same base images and hardening, no new egress, and a precedent (MCP Service) for an additional OIDC client calling the registry. Plan for the paperwork to run in parallel with development and to take one to three months.

## 7. Non-functional requirements
- Availability: single replica acceptable for v1; no data loss on restart (runs are durable in Postgres and resume or fail cleanly).
- Performance: catalog and run status pages respond in under one second; status polling interval of a few seconds.
- Observability: structured logs, request IDs propagated to run events, basic metrics endpoint.
- Testing: 80 percent line coverage on application logic; one end-to-end test per Workflow against a mocked Istari client.
- Compatibility: pinned Istari SDK version per release; API versioned under `/api/v1`.

## 8. Success metrics
- Smart Diff used from inside the browser by Model One users without an AWS Workspace login.
- Time for an FDE to go from Workflow idea to deployable image: under one week for a Workflow of Smart Diff complexity.
- Zero credentials typed by users.
- Every run attributable to a human user in both Workflow Manager and Istari audit records.

## 9. Open questions
1. Confirm with the platform team that registry token validation accepts tokens from a new client in the same Zitadel project, and whether `offline_access` refresh tokens are permitted in Model One's Zitadel configuration.
2. Confirm the LLM endpoint authorized for Smart Diff and how its credential is held (function auth secret versus service configuration).
3. Confirm with the install subcontractor and customer ISSO the change process for adding a service to the boundary and the expected timeline.
4. Decide whether Smart Diff v1 executes in the worker or by submitting the existing Module Function as an Istari job.
5. Decide whether assignments reference Zitadel groups (preferred, fewer manual steps) or individual users.

## 10. Execution phases

### Phase 1: Design and planning
- Finalize architecture, auth flow, and data model (this document plus ADRs for auth, execution model, and packaging).
- Resolve the open questions above with the platform team, the install subcontractor, and the customer ISSO.
- Produce the security documentation outline needed for the impact analysis.

### Phase 2: Walking skeleton
- Login via Zitadel, catalog page, one trivial Workflow that reads a resource as the user and writes a run record. Deployed to a dev cluster.

### Phase 3: Smart Diff
- Resource picker components, worker and queue, Smart Diff executor, results view, end-to-end tests.

### Phase 4: Hardening and delivery
- FIPS images, Helm chart, migrations job, logging, security documentation, handoff to the install team.
