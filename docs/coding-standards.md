# Coding Standards for Building the Workflow Manager Application

## General
- Enforce small, focused files, classes, and functions.
- Aim for 80% LOC coverage for all application logic.
- Record significant design decisions as ADRs in `docs/adr/` (auth flow, execution model, Workflow packaging). One decision per file, with context, decision, and consequences.
- Never log tokens, secrets, or secret-flagged Workflow inputs. Redact at the model boundary, not in each log call.
- Pin dependency versions. Pin the Istari SDK version per release and note it in the release notes.

## Python
- Favor pure functions for application logic. Use classes when state management is required.
- Enforce type-hinting across all function contracts and classes. Run mypy in strict mode in CI.
- Use poetry for environment management. Use ruff for linting and formatting.
- Use FastAPI with small, focused routers. One router package per Workflow under `app/workflows/<workflow-id>/`.
- Use pydantic models for all request, response, and Workflow input/output contracts. Mark secret inputs with a `SecretStr` type so they are redacted automatically.
- Use pydantic-settings for configuration. All configuration comes from environment variables; no config files in the image.
- Use the logging library with structured JSON output. Log generously at the appropriate level. Propagate a request ID into run events.
- Implement API versioning (`/api/v1`) for backwards compatibility.
- Manage schema with Alembic. Every schema change ships as a migration; migrations run as a Kubernetes job before rollout.
- Workflow executors are plain Python callables taking a typed input model and a context object (Istari client, run event emitter). They must not import FastAPI.
- Tests use pytest. Istari SDK calls are mocked at the client boundary. Each Workflow ships with one end-to-end test of its executor.

## JS/TS/React
- Separate display from application logic and data fetching.
- Favor small, reusable components, and use templates as needed.
- Style with inline Tailwind.
- Use Vite, TypeScript in strict mode, React Router, and TanStack Query for server state.
- Generate the API client from the FastAPI OpenAPI spec. Do not hand-write request types.
- Shared Istari-aware controls (resource picker, revision picker, system picker) live in `src/components/istari/` and are reused by every Workflow page.
- One directory per Workflow under `src/workflows/<workflow-id>/` containing the page, form, and results view.
- The browser never holds tokens. All API calls use the session cookie.

## PostgreSQL
- Every table definition should include a unique ID (unless it is a join table or similar).
- When designing the database, do not use extraneous fields, but do not be afraid to track metadata important to the entities or debugging.
- Use JSONB for Workflow inputs and outputs; validate shape in the application, not in the database.
- Timestamps are `timestamptz`, set by the application, named for the event (`queued`, `started`, `finished`).
- The run queue uses `SELECT ... FOR UPDATE SKIP LOCKED`; no external broker.

## Containers and deployment
- Chainguard FIPS base images. Non-root user, read-only root filesystem, all capabilities dropped. Match the Istari platform's security context.
- One image for API and Worker, selected by entrypoint. One image for the UI.
- Pinned tags, no `latest`. Publish an SBOM with every image.
- Health and readiness endpoints on every service.
