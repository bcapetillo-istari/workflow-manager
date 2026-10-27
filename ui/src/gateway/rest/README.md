# RestGateway (src/gateway/rest)

`RestGateway` implements `IstariGateway` (`../types.ts`) with plain `fetch` against the Istari
registry REST API. Construct with `{ registryUrl, istariWebUrl, getToken }`; every request goes to
`${registryUrl}/registry/api/...` with `Authorization: Bearer <token>`. Non-2xx responses throw
`GatewayError` with `status` and the parsed JSON (or text) body.

Files: `http.ts` (fetch wrapper + v2 offset / v3 cursor paging), `storage.ts` (hashing, presigned
upload/download), `branches.ts` (system branch plumbing + commit), `dto.ts` (raw payload types),
`mappers.ts` (DTO -> gateway types), `RestGateway.ts`, `index.ts`.

Sources of truth: `istari-ts-client/openapi/fileservice_v{2,3}*_openapi.json`, the Python SDK
(`istari_digital_client/sdk/_common/*.py`, `_storage/*`) and `iframe-capabilities-sandbox/SDK-to-URL.md`.
Live-verified 2026-10-23 against `https://api.demo.istari.app` (registry v11.6.9) with
`ui/scripts/probe-gateway.mjs` (`npx tsx scripts/probe-gateway.mjs` from `ui/`).

## Endpoint map

| Method                  | Endpoint(s)                                                                                                                                                                                                                                                     | Notes                                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currentUser`           | `GET /v2/users/me`                                                                                                                                                                                                                                              | `display_name`, else `first_name last_name`, else `user_name`.                                                                                                                                                                                                                                          |
| `listSystems`           | `GET /v2/systems?name=&size=&sort=-created&include_total=false`                                                                                                                                                                                                 | `name` is a case-insensitive substring filter.                                                                                                                                                                                                                                                          |
| `getSystem`             | `GET /v2/systems/{id}`                                                                                                                                                                                                                                          |                                                                                                                                                                                                                                                                                                         |
| `listBranches`          | `GET /v2/systems/configurations/snapshots/tags?system_id=` (all pages)                                                                                                                                                                                          | Branches are v2 "snapshot tags".                                                                                                                                                                                                                                                                        |
| `listTrackedResources`  | baseline: `GET /v2/systems/{id}/baseline`; branch: tags list -> `GET /v2/systems/configurations/snapshots/{snapshot_id}` -> `GET /v2/systems/configurations/{configuration_id}/tracked-files` (all pages) -> `GET /v3/resources?resource_id=...` (chunks of 50) | Same as the SDK's `Branches.list_files`. `revisionId` is the **resource's current revision** (`file_revision_id` from v3), not the branch's `pinned_file_revision_id`. Tracked files without a `resource_id` are skipped.                                                                               |
| `searchResources`       | `GET /v3/resources?size=&include_total=false&own_files_first=true&type_name=...&name__contains=...`                                                                                                                                                             | `name__contains` needs >= 3 chars (server 400 otherwise); shorter names use exact `name=`. v3 has **no extension or system filter**: extensions are filtered client-side (page of 100, then sliced to `size`, default 25); `systemId` scopes via `listTrackedResources(systemId)` + client-side filter. |
| `getResource`           | `GET /v3/resources/{id}`                                                                                                                                                                                                                                        |                                                                                                                                                                                                                                                                                                         |
| `listRevisions`         | `GET /v3/resources/{id}/revisions` (cursor pages)                                                                                                                                                                                                               | Sorted newest first.                                                                                                                                                                                                                                                                                    |
| `readText` / `readJson` | `GET /v3/resources/{id}` (current) or `GET /v3/resources/{id}/revisions/{rev}` -> `content_token` -> download (below)                                                                                                                                           | `readJson` returns `{ data, revisionId }` where `revisionId` is the revision actually read.                                                                                                                                                                                                             |
| `createJsonResource`    | upload (below) -> `POST /v3/resources` -> branch commit (below)                                                                                                                                                                                                 | `resource_type` default `artifact`; name gets `.json` appended if missing; `mime: application/json`.                                                                                                                                                                                                    |
| `createJsonRevision`    | `GET /v3/resources/{id}` (for the name) -> upload -> `POST /v3/resources/{id}/revisions`                                                                                                                                                                        | Body: `ResourceRevisionCreateDto`.                                                                                                                                                                                                                                                                      |
| `listAuthSecrets`       | `GET /v2/credentials` (plain array of `StoredCredential`)                                                                                                                                                                                                       | Filter `secretType` matches `auth_type` (`token`, `basic`, `oauth2`, ...). `expiration` is not exposed by this endpoint. See "provider" below.                                                                                                                                                          |
| `listFunctions`         | `GET /v2/modules/versions/functions?name=&input_extension=&status=supported` (<= 10 pages of 100)                                                                                                                                                               | One row per function x tool-version x OS set; grouped by `(module_name, name)`, unions of `versions`, `toolVersions`, `operatingSystems`; `displayName` = `tool_display_name`.                                                                                                                          |
| `createJob`             | upload `parameters.json` -> `POST /v2/models/{resourceId}/jobs?function_name=&function_version=&tool_name=&tool_version=&operating_system=&assigned_agent_pool_id=`                                                                                             | Body `{ revision: FileRevision, auth_bindings: [] }`; see "Job body".                                                                                                                                                                                                                                   |
| `getJob`                | `GET /v2/jobs/{id}`                                                                                                                                                                                                                                             | Status = latest `status_history` entry by `created`.                                                                                                                                                                                                                                                    |
| `listJobs`              | `GET /v2/jobs?model_id=&size=&sort=-created`                                                                                                                                                                                                                    | `model_id` is the resource id (deprecated name). `createdById` filtered client-side (API returns the caller's jobs only).                                                                                                                                                                               |
| `cancelJob`             | `PUT /v2/jobs/{id}/status?status_name=Canceled` body `{ message }`                                                                                                                                                                                              | Same endpoint the SDK's `Job.update_status` uses.                                                                                                                                                                                                                                                       |
| `listArtifacts`         | `GET /v2/models/{resourceId}/artifacts?sort=-created` (all pages)                                                                                                                                                                                               | Each `Artifact` has `id` (= resource id) and `file.revisions`; the newest revision gives name/extension/mime/size.                                                                                                                                                                                      |
| `resourceUrl`           | `${istariWebUrl}/resources/{resourceId}`                                                                                                                                                                                                                        | Route taken from the demo web bundle (`/resources/${resourceId}`; artifacts also match `/resources/artifact/:id/:rev?`).                                                                                                                                                                                |
| `jobUrl`                | `${istariWebUrl}/jobs/{jobId}`                                                                                                                                                                                                                                  | Route `/jobs/:jobId` in the web bundle.                                                                                                                                                                                                                                                                 |

## Content hashing and upload recipe (storage.ts)

Replicates `istari_digital_core.Token` exactly (verified by comparing against the native module):

- `salt` = 32 lowercase hex chars (`uuid4().hex`), a fresh salt per token.
- `sha` = `SHA-384( bytes || ascii(saltHex) )` as 96 lowercase hex chars (`crypto.subtle.digest`).

For each blob (content and properties):

1. `GET /v2/tokens/{sha}/upload-url` -> `{ url, expires }` (a presigned S3 PUT). HTTP 409 means the
   blob already exists and the upload is skipped (SDK behaviour).
2. `PUT <url>` with the raw bytes, `Content-Type: application/octet-stream`, no Authorization.

The properties blob is `Properties.to_bytes()` from the SDK: compact JSON with every key present,
in this order: `file_name, size, extension, mime, description, version_name, external_identifier,
display_name` (missing values are `null`). Properties are uploaded first, then content.

Register with `POST /v3/resources` (`ResourceCreateDto`) or `POST /v3/resources/{id}/revisions`
(`ResourceRevisionCreateDto`): `{ content_token: {sha, salt}, properties_token: {sha, salt}, name,
extension, size, mime, description, [resource_type] }`. JSON content is `JSON.stringify(data, null, 2)`.

## Download recipe

`GET /v2/tokens/{sha}/download-url` -> `{ url }` -> `GET <url>` (no Authorization). The bytes are
re-hashed with the token's salt and must equal `sha`, otherwise `GatewayError` (SDK `compare_hash`).
Browser note: the presigned S3 URL is cross-origin; the bucket's CORS must allow the SPA origin.

## Branch commit recipe (branches.ts)

Follows the SDK's `Branches.commit`, with one deliberate change (new files are `Latest`, not `Locked`):

1. Resolve the branch: baseline via `GET /v2/systems/{id}/baseline` (`tag_id`, `snapshot_id`), or the
   tag with `id == branchId` from the tags list.
2. `GET /v2/systems/configurations/snapshots/{snapshot_id}` -> `configuration_id`.
3. `GET /v2/systems/configurations/{configuration_id}/tracked-files` (all pages). Each existing file
   is carried forward unchanged: `{ specifier_type, file_id, pinned_file_revision_id, folder_path }`,
   where `folder_path` is the tracked `path` minus its trailing file label (paths are system-rooted
   ltree labels `<system_hex>.<Folder>.<file_hex>`; root files get no `folder_path`). The SDK omits
   `folder_path`; passing it preserves folders. Not live-verified on a system that has folders.
4. Append `{ specifier_type: 'Latest', file_id }` for the new resource (`file_id` from the v3
   `ResourceDto`). No `pinned_file_revision_id`, so the branch follows every new revision. If the
   file is already tracked the commit is a no-op.
5. `POST /v2/systems/{system_id}/configurations { name: '<tag>-commit', tracked_files }`.
6. `GET /v2/systems/configurations/snapshots?configuration_id=&size=1&sort=-created` -> new snapshot.
7. `PUT /v2/systems/configurations/snapshots/tags/{tag_id} { snapshot_id, commit_message }`.
   On failure after step 5 the orphan configuration is archived (`DELETE .../configurations/{id}`),
   best effort, like the SDK.

Live-verified: after `createJsonResource` the tracked file shows `specifier_type: Latest`,
`pinned_file_revision_id: null`; after `createJsonRevision`, `readJson(resourceId)` returns the new
content and `listTrackedResources` reports the new revision id.

## Job body (createJob) — `jobBody.ts`

Built by the pure `buildJobBody(req, uploadedParams)` (unit-tested in `jobBody.test.ts`; no live job is
created for it). Parameters are uploaded as `parameters.json` with the recipe above and the POST body
is schema `NewJob`:

```json
{
  "revision": {
    "id": "<uuid>",
    "created": "<iso>",
    "file_id": null,
    "content_token": { "id": "<uuid>", "created": "<iso>", "sha": "<96 hex>", "salt": "<32 hex>" },
    "properties_token": { "id": "<uuid>", "created": "<iso>", "sha": "<96 hex>", "salt": "<32 hex>" },
    "archive_status_history": [
      {
        "id": "<uuid>",
        "created": "<iso>",
        "name": "Active",
        "reason": "Initial",
        "created_by_id": null,
        "file_revision_id": "<revision id above>"
      }
    ],
    "name": "parameters.json",
    "extension": "json",
    "size": 123,
    "mime": "application/json",
    "sources": [
      {
        "revision_id": "<uuid>",
        "file_id": null,
        "resource_type": null,
        "resource_id": null,
        "relationship_identifier": "file2"
      }
    ]
  },
  "auth_bindings": [{ "input_name": "auth_token", "credential_id": "<id from listAuthSecrets>" }]
}
```

- `req.sources` (`JobSource { revisionId, relationshipIdentifier? }`) become `revision.sources` rows
  (schema `Source`): the extra `user_model` inputs of a function; `relationship_identifier` is the
  function input key. The primary input remains the URL's `model_id`. Same placement as the legacy
  SDK's `StorageApi.create_revision(sources=[NewSource(...)])` used by `client.add_job`.
- `req.authBindings` (`JobAuthBinding { inputName, credentialId }`) become top-level `auth_bindings`
  (schema `NewCredentialBinding`); `credential_id` is a `secretId` from `listAuthSecrets`.
- `created_by_id` must be present (nullable) or the API answers 422. Query string:
  `function_name, function_version, tool_name, tool_version, operating_system, assigned_agent_pool_id`.
  The request body passed server validation live (without sources/bindings); see "Not live-verified".

## Provider derivation (listAuthSecrets)

`GET /v2/app_integrations/authsecrets` (the SDK's `function_auth_secrets.list`) returned an empty
list for this user, while `GET /v2/credentials` holds the LLM keys (`anthropic_api_key`,
`gemini_api_key`, type `token`, no auth integration). So credentials are the source. `provider` is a
best-effort mapping of the lowercase credential **name** (the API has no provider field):
contains `openai` -> `openai`; `anthropic` or `claude` -> `claude`; `gemini` or `google` -> `gemini`;
otherwise undefined. `authIntegrationId` is passed through; the auth integration type is not
consulted (the catalog types are enterprise systems such as `google_accounts` OAuth, not LLMs).

## Not live-verified

- `createJob`: the body is accepted by the server (passed validation and reached function matching)
  but no job was created. The one `.json`-input function the user may execute was denied with 403
  (`execute` permission on that function version); the user's own module only accepts `.mdzip`
  ("Function Not Found ... for model with extension: json"). Expect a 404 like that when the
  function/tool/OS combination does not accept the resource's extension.
- `cancelJob`: not exercised (no job to cancel). Endpoint and params taken from the OpenAPI spec
  and the SDK's `update_job_status`.
- `folder_path` carry-forward on systems with folders (the runs system has none).
- `listSystems`/`listJobs` return at most one page (`size`, max 100).
