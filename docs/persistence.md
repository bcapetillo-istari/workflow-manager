# Persistence: where every byte lives and when it moves

Workflow Manager stores nothing of its own. Everything is an Istari resource. This document is the complete account of which files exist, who creates them, when they are read and written, and what that implies.

## 1. The two systems

| Istari system | Holds | Created by | Shared as |
|---|---|---|---|
| `workflow-manager` | One manifest per workflow: `<workflow-key>.json` | Engineers, via `wfm-manifest publish` | Users: viewer (per manifest or whole system). Engineers: editor |
| `workflow-manager-runs` | One run document per run: `<run-id>.json` | The SPA, when a user starts a run | Workflow Manager users: editor |

Both are ordinary systems: browsable in the Istari UI, with revision history per file and Istari's sharing and audit. Their ids are the only configuration the SPA needs besides URLs (`config.json`).

Files are tracked on each system's baseline branch with the `Latest` specifier, so the branch always resolves a file to its newest revision. (The platform SDK's default pins a fixed revision; the gateway deliberately does not.)

## 2. Manifests

- **Written** when an engineer publishes. First publish creates the resource and commits it to the branch; later publishes add a revision to the same resource. Nothing else ever writes a manifest.
- **Read** by the SPA on the catalog page: list the branch's tracked `.json` files the user's token can see, download each one's current revision, validate, render cards. Also read once per run page load, pinned to the revision the run started from (see below).
- **Access** is Istari sharing. The catalog is literally "the manifests this token can read." Unsharing hides a workflow immediately on the next load.

## 3. Run documents

### Identity and naming
- A run id is a UUID minted in the browser when the user clicks Start. The file is `<run-id>.json`. The resource id Istari assigns is what appears in the URL (`/runs/<resourceId>`), so the URL is a durable handle.
- The document records `initiator_user_id`, `workflow_key`, `workflow_version`, and `manifest_resource_id` plus `manifest_revision_id`. Runs are pinned to the exact manifest revision they began with, so publishing a new manifest never changes how an in-flight or historical run renders.

### Contents
Stage order, current stage, status, timestamps, and a record per stage: status, submitted inputs (secret-flagged inputs redacted to a placeholder), job id, outputs, progress entries, error. Plus `finished`, `error`, and `result_summary` at run level once terminal.

### Who writes, and when
Two writers, strictly partitioned:

| Writer | Writes | When |
|---|---|---|
| The SPA (as the user) | Everything except module-owned fields | Run created; stage inputs submitted and job created; job observed terminal; run advanced; run cancelled |
| The Module Function (as the agent) | Only `stages[<its stage>].outputs` and `.progress` | During its job, if the module knows about run documents |

The SPA is the only writer of transitions. Every SPA write is a whole-document new revision: it serializes its in-memory copy and uploads it. Writes happen only at transitions, not on every poll, so a typical single-stage run produces three or four revisions: created, submitted, completed, plus one if cancelled.

For modules that do not write run documents (Smart Diff today), the SPA fills declared `artifact` outputs itself when the job completes, from the artifacts attached to the target resource since the stage started.

### Who reads, and when
- **Opening a run page:** one read of the run document's current revision, then one read of the pinned manifest revision. The SPA builds its in-memory copy from these.
- **While a job stage is running:** the SPA polls on a backoff (2s, 4s, 8s, capped at 15s), paused while the tab is hidden. Each cycle reads the job status from the registry and re-reads the run document to pick up module-written progress and outputs. Module-owned fields from the fresh read are merged into the in-memory copy; transitions still come only from the SPA's state.
- **Resolving bindings:** no read. Bindings resolve against the in-memory copy.
- **Run history page:** list the runs system's tracked `.json` files, take the newest 50 by `updated`, read each, keep those whose `initiator_user_id` is the current user.

### What is in memory only
Form values before Submit. Close the tab mid-form and that stage starts over. Once submitted, the values are in the document and survive anything. Everything else in the browser is a cache of the document.

## 4. Jobs and artifacts (Istari's own records)
Each job stage creates one Istari job, as the user, with the stage's inputs as the job's target, parameters, sources, and auth bindings. The job's status history, parameters file, and attached artifacts are Istari's records and are never duplicated into the run document; the document stores the job id and references to outputs by resource and revision id.

## 5. Per-user boundaries, stated plainly
- **Manifests:** per-user visibility is real and enforced by Istari.
- **Run documents:** in v1 the runs system is shared with all Workflow Manager users as editor. Any user can therefore read any run document; the history page filters to the current user client-side. Documents contain input values and output references, not file contents. If per-user isolation of run records is required, create each run document with per-resource access instead of relying on the system share. This is a one-line change in the gateway call plus the sharing step.
- **Files the user picks:** Istari enforces access at job creation. A user who can see a workflow but not a document cannot run it on that document.

## 6. Known limits of the v1 design
- **Last writer wins.** Two tabs on the same run can overwrite each other's transition. Optimistic concurrency on revision ids is designed (one write seam) but deferred.
- **Each new run is a branch commit.** Creating a run document commits a new configuration snapshot that lists every tracked file. Cost grows with the number of runs in the system. Fine for hundreds; revisit before tens of thousands (options: periodic archiving of old run documents, or a runs system per month or per workflow).
- **History is a scan.** The history page lists the branch and reads up to 50 documents. Adequate for a team; a registry-side filter by creator would be better at scale.
- **Secrets never persist.** Inputs flagged `secret` are written as a placeholder. Credentials are referenced by id only; their values never reach the browser.

## 7. Lifecycle summary

```
Engineer publishes manifest ──► workflow-manager/<key>.json (rev 1, 2, 3 ...)
User opens catalog          ──► read manifests the token can see
User clicks Start           ──► create workflow-manager-runs/<run-id>.json (rev 1: in_progress)
User submits stage          ──► create job (as user) ─► write rev 2 (running_job)
Agent runs module           ──► (optional) module writes outputs/progress into its stage section
SPA polls                   ──► read job status + run doc; no writes
Job terminal                ──► fill outputs if needed ─► write rev 3 (succeeded / failed)
User reopens later          ──► read current rev, read pinned manifest rev, resume
```
