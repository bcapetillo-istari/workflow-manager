# Coding Standards for Building the Workflow Manager Application

## General
- Enforce small, focused files, classes, and functions.
- Aim for 80% LOC coverage for all application logic.
- Record significant design decisions as ADRs in `docs/adr/` (auth flow, Istari as the data store, Workflow packaging). One decision per file, with context, decision, and consequences.
- Never log tokens, secrets, or secret-flagged Workflow inputs. Secret inputs are referenced by auth secret ID only.
- Pin dependency versions. Pin the Istari TypeScript client and Python SDK versions per release and note them in the release notes.

## TypeScript/React (the SPA)
- Separate display from application logic and data fetching. Components render; hooks fetch; the gateway talks to Istari.
- Favor small, reusable components, and use templates as needed.
- Style with inline Tailwind.
- Vite, TypeScript in strict mode, React Router, TanStack Query for server state, ESLint and Prettier.
- All Istari access goes through one `IstariGateway` interface. The v1 implementation wraps the Istari TypeScript client. No component or hook imports the Istari client directly.
- The access token lives in memory only. Never in localStorage, sessionStorage, or cookies. Use the same OIDC library and refresh approach as the Istari frontend.
- Shared Istari-aware controls (resource picker, revision picker, system picker, auth-secret picker) live in `src/components/istari/` and are reused by every Workflow.
- The stage renderer lives in `src/renderer/` and renders any valid manifest. Each manifest input `type` maps to exactly one component in `src/components/istari/` or `src/components/inputs/`; the map is a single table in `src/renderer/componentMap.ts` and is the only place a new type is registered. Custom components live in `src/workflows/<workflow-key>/` and are referenced from a manifest by `component` name.
- Manifests are validated against `schema/workflow-manifest.v1.json` with a JSON Schema validator before rendering. An invalid manifest renders as an error card, never a crash. The same schema file is used by the `wfm-manifest` CLI; it is the single source of truth and is versioned with the SPA.
- Binding resolution (`$inputs`, `$stages.<key>.inputs`, `$stages.<key>.outputs`, literals) is one pure function with exhaustive tests. No other code parses binding strings.
- Runtime configuration is read from `config.json` at startup. No environment-specific values are compiled into the bundle.
- Poll with backoff. Stop polling when the job reaches a terminal status or the tab is hidden.
- Run orchestration is a pure reducer: `(runDocument, event) -> runDocument`. No side effects inside the reducer. Effects (submit job, write revision) are performed by a thin effect layer that reacts to the reducer's output.
- Every run document write is optimistic: read the current revision ID, write only if it still matches, otherwise reload and re-render. Never write blind.
- The SPA is the only writer of step transitions. Modules write only within their own job step's section of the run document.
- Tests use Vitest with the gateway mocked. One Playwright smoke test runs against a mocked registry.

## Python (Module Functions)
- Follow the existing Istari python module scaffold. One function per Workflow unless there is a reason to split.
- Favor pure functions for application logic. Use classes when state management is required.
- Enforce type hinting across all function contracts and classes. Run mypy in strict mode and ruff in CI.
- Use poetry for environment management.
- Read inputs from the job parameters file, validate them with pydantic, and fail fast with a clear message written to the run document.
- Update the run document through the SDK at meaningful progress points (started, each major stage, finished, failed). Each update is a new revision. Keep messages user-readable.
- Write only to the step section the job belongs to (`/steps/<step-key>`). Never change the run's current step or any other step; the SPA owns transitions.
- If two automated stages would otherwise be two jobs with no human decision between them, implement them as one function with two stages.
- Write outputs as job artifacts and reference them in the run document.
- Use the logging library and log generously at the appropriate level. Never log credential values.
- Tests use pytest. Istari SDK calls are mocked at the client boundary. Each Workflow ships with one end-to-end test of its function.

## Istari as the data store
- All Workflow Manager data lives in two Istari systems. Manifests live in `workflow-manager`; run documents live in `workflow-manager-runs`. Users are viewers of the first and editors of the second. FDEs are editors of both. No other sharing model is used. Nothing is stored anywhere else except browser localStorage for non-sensitive drafts and preferences.
- Manifests and run documents carry a `schema_version` field. Readers tolerate unknown fields and reject unknown major versions.
- Run documents reference Istari resources by ID only. Never copy file content into a run document.
- Every write is a new revision. Never overwrite by deleting and recreating.
- There is no bundled catalog. If the `workflow-manager` system is unreadable, the catalog page says so and offers retry; it never shows a stale or default list.

## Containers and deployment
- One image: Chainguard FIPS nginx base serving the built SPA. Non-root user, read-only root filesystem, all capabilities dropped. Match the Istari platform's security context.
- Pinned tags, no `latest`. Publish an SBOM with every image.
- `config.json` is mounted from a ConfigMap. The image contains no environment-specific values and no secrets.
- Health endpoint served by nginx. Access logs to stdout as structured JSON.
- Ingress path rule on the Istari host. Document the subdomain fallback and its CORS changes alongside it.
