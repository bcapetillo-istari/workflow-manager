# wfm-manifest

Command line tool for Workflow Manager manifests: validate them offline against
`schema/workflow-manifest.v1.json`, verify their functions against an Istari environment, publish
them to the `workflow-manager` system, and list what is already there.

The JSON Schema is loaded at runtime from the repository (`../schema/workflow-manifest.v1.json`
relative to this package, or found by walking up from the current directory). Override with
`--schema <path>` or `WFM_SCHEMA=<path>`. There is no copy of the schema in this package.

## Install

```
cd cli
poetry install
poetry run wfm-manifest --help
```

Or, without installing, from the repository root with any interpreter that has `jsonschema`,
`pydantic`, and `istari-digital-client` available:

```
PYTHONPATH=cli python -m wfm_manifest.cli --help
```

## Environment file and token

Online commands take `--env env.json`:

```json
{ "registry_url": "https://fileservice-v2.demo.istari.app", "system_id": "df2e9e2e-e2a1-4a3b-aa58-01dc6f43321f" }
```

The bearer token is read from `ISTARI_TOKEN`. It is never logged or printed.

## Commands

### `check <manifest.json> [--env env.json]`

Offline: JSON Schema conformance (Draft 2020-12), then the cross-reference rules the SPA applies
(unique stage/input/output keys, `function.target` names a `resource` input of the same stage, every
binding parses and resolves to a declared input or an earlier stage's output, `$stages` references
only earlier stages, `stage_output.filter.source` points at an earlier output, `options_by.source`
points at another input of the same stage). Errors print one per line as `ERROR <json path>: <message>`
with the same wording as the SPA. Exit 1 on failure; exit 0 with an `OK: <name> (key=..., version=...,
N stages)` summary on success.

With `--env`, every job stage's function is looked up in the target environment: the function must
exist and, if `version` is pinned, that version must exist. When the function's input schema is
available the required inputs are checked too: the first required `user_model` input is covered by
`target`; every other required input must appear in `function.parameters`. If the schema cannot be
read, a `WARN` line says the required-input check was skipped.

```
wfm-manifest check docs/examples/smart_diff_workflow_manifest.json
wfm-manifest check docs/examples/pdf_extract_test_manifest.json --env env.json
```

### `publish <manifest.json> --env env.json [--name <file>] [--dry-run]`

Runs the offline check first and refuses to publish an invalid manifest. Then, exactly like
`scripts/publish_manifest.py`: if a tracked file with the same name (default `<key>.json`) exists on
the system's baseline branch, a new revision of that resource is created; otherwise a new artifact
resource is created and committed to the branch. Prints one JSON object:

```
{"action": "created", "name": "smart-diff.json", "resource_id": "...", "revision_id": "...", "branch_snapshot": "..."}
{"action": "revised", "name": "smart-diff.json", "resource_id": "...", "revision_id": "..."}
```

`--dry-run` performs only the read side and prints `{"action": "dry-run", "would": "create"|"revise", ...}`.

### `list --env env.json [--json]`

Lists the tracked `.json` files on the baseline branch of the system with their resource id and the
`key`, `name`, and `version` read from the content. Each file is validated; invalid ones are marked
`INVALID` with their errors (exit 1 if any are invalid).

## Exit codes

`0` success, `1` the manifest is invalid or an online check failed, `2` usage or environment error
(missing file, bad env file, `ISTARI_TOKEN` unset, schema not found).

## Development

```
cd cli
poetry install
poetry run pytest
poetry run mypy
poetry run ruff check .
```

Tests use fakes at the SDK boundary; no network access is needed.
