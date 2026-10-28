# Workflow Manifest Schema

A Workflow is one JSON resource in the `workflow-manager` Istari system. The SPA lists that system, reads every manifest the user can see, validates each against this schema, and renders the valid ones. Sharing the manifest resource is how a user is granted the Workflow. Sharing the system grants all of them.

This document is the human-readable specification. The machine-readable JSON Schema lives at `schema/workflow-manifest.v1.json` and is the one the SPA and the CLI enforce.

## Design rules
- The manifest describes **what to collect and what to run**. It is not a programming language. The only dynamic constructs are the two binding forms below.
- Each input `type` maps to exactly one React component. Adding a type means adding a component to the library and an entry in this document.
- When the standard library cannot express a stage, use a `component` override, not a new manifest feature.
- Unknown fields are ignored by readers. Unknown `schema_version` major versions are rejected.

## Top level

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | string | yes | `"1"` for this document. |
| `key` | string | yes | Stable identifier, kebab-case, unique within the system. Used in routes and run documents. |
| `name` | string | yes | Display name. |
| `description` | string | no | One or two sentences shown on the catalog card. |
| `version` | string | yes | Semver. Recorded on every run so history survives manifest changes. |
| `tags` | string[] | no | Catalog filtering. |
| `icon` | string | no | Name from the SPA's icon set. |
| `stages` | Stage[] | yes | Ordered. At least one. |

## Stage

| Field | Type | Required | Notes |
|---|---|---|---|
| `key` | string | yes | Unique within the manifest. Referenced by later stages as `$stages.<key>`. |
| `name` | string | yes | Shown as the step title. |
| `description` | string | no | Help text above the form. |
| `inputs` | Input[] | no | Fields collected from the user at this stage. |
| `function` | Function | no | Module Function to run after inputs are submitted. Present: job stage. Absent with inputs: review gate. Absent without inputs: display stage. |
| `outputs` | Output[] | no | Declares what the function produces so later stages and views can bind to it. |
| `view` | View | no | How to present this stage's content (review gate or result display). |

A stage with a `function` must have at least one `resource` input designated as `target` (see Function), because an Istari job runs against exactly one resource.

## Input

Common fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `key` | string | yes | Unique within the stage. Referenced as `$inputs.<key>`. |
| `label` | string | yes | |
| `type` | string | yes | One of the types below. |
| `required` | boolean | no | Default false. |
| `help` | string | no | Inline help text. |
| `default` | any | no | Type-appropriate default. |
| `secret` | boolean | no | If true the value is never written to the run document. Only `auth_secret` and `text` may set it. |
| `component` | string | no | Name of a custom component compiled into the SPA. Overrides the default for `type`. |
| `filter` | object | no | Type-specific constraints, below. |

Types and the component each maps to:

| `type` | Component | Value bound | `filter` fields |
|---|---|---|---|
| `resource` | ResourcePicker (search, select, choose revision) | `{ resource_id, revision_id, name }` | `extensions: string[]`, `system: "$inputs.<key>"` to scope to a chosen system |
| `system` | SystemPicker | `{ system_id, name }` | |
| `branch` | BranchPicker | `{ branch_id, tag }` | `system: "$inputs.<key>"` (required) |
| `auth_secret` | LinkedAccountCredentialPicker (the user's linked account credentials) | `{ secret_id, name }` | `secret_type: string`, optional. Omit to list every linked credential (the default). When given, an Istari validation type such as `"@token:llm"` matches credentials of auth type `token`; `basic` and `oauth` are also accepted. |
| `text` | TextInput | string | `multiline: boolean`, `pattern: regex`, `max_length: number` |
| `number` | NumberInput | number | `min`, `max`, `step` |
| `boolean` | Toggle | boolean | |
| `enum` | Select | string | `options: [{ value, label }]`, or `options_by` (one of the two is required) |
| `multi_enum` | MultiSelect | string[] | `options` or `options_by` (one required), `min`, `max` |
| `stage_output` | OutputPicker (choose from a prior stage's outputs) | the chosen output's value | `source: "$stages.<key>.outputs.<key>"` (required), `multiple: boolean` |

### Dependent options (`options_by`)

`enum` and `multi_enum` may take `options_by` instead of `options` when the choices depend on another input in the same stage:

```json
"options_by": {
  "source": "$inputs.llm_credential.name",
  "match": "contains",
  "groups": { "openai": [ { "value": "...", "label": "OpenAI / GPT-4o" } ], "anthropic": [ ... ] }
}
```

`match` selects how group keys are compared with the resolved source value: `"exact"` (default) requires the value to equal a key; `"contains"` picks the first key that appears, case-insensitively, inside the value, which lets a manifest key on a free-text field such as a credential's name. The component is disabled until the source input has a value, and shows an empty list with a message when no group matches. Workflow Manager has no knowledge of what the groups mean; the manifest owns that mapping entirely. This is the only form of dependency between inputs. There is no general `visible_if`.

## Function

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Fully qualified function name, for example `@istari_utils:smart_diff`, **or** a binding such as `$inputs.model` to an `enum` or `text` input whose value is the function name at runtime (lets one stage pick among several functions, for example one per LLM model). |
| `version` | string | no | Function version. Omit for latest. Pin in production. |
| `target` | string | yes | Key of a `resource` input in this stage. Its `resource_id` becomes the job's `resource_id`. |
| `parameters` | object | no | Map of function parameter name to a binding or literal. Written to the job's parameters file. |
| `sources` | object | no | Additional `user_model` inputs: map of function input key to a binding whose value is a resource, either a `resource` input in this stage or an earlier stage's input/output (`$stages.<key>.outputs.<key>`). The bound value's `revision_id` is sent as a job source with that relationship identifier. |
| `auth_bindings` | object | no | `auth_info` inputs: map of function auth input key to a binding to an `auth_secret` input (this stage or an earlier one). Its `secret_id` is bound to the job. |
| `tool_name`, `tool_version`, `operating_system`, `agent_pool_id` | string | no | Passed through to job creation when the function needs them. |

## Output

| Field | Type | Required | Notes |
|---|---|---|---|
| `key` | string | yes | Referenced as `$stages.<stage>.outputs.<key>`. |
| `label` | string | yes | |
| `type` | string | yes | `artifact`, `resource`, `revision`, `json`, `text`. |
| `path` | string | no | For `json`: pointer into the run document section the module wrote, when the output is nested. |

The module is responsible for writing outputs into its stage section of the run document (`/stages/<key>/outputs`). The SPA treats declared outputs as the contract for what later stages may bind to.

## View

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | yes | `artifact_list`, `json_table`, `markdown`, `summary`. |
| `source` | string | yes | Binding to the content to show, usually `$stages.<key>.outputs` or one output within it. |
| `component` | string | no | Custom component override. |

## Bindings

Exactly three forms, usable in `function.name`, `function.parameters`, `function.sources`, `function.auth_bindings`, `filter.system`, `filter.source`, and `view.source`:

- `$inputs.<key>` and `$inputs.<key>.<field>`: a value collected in the current stage. Fields are those listed in the Input table's "Value bound" column.
- `$stages.<stage-key>.inputs.<input-key>`: a value the user entered at a completed earlier stage (needed for review gates).
- `$stages.<stage-key>.outputs.<output-key>`: an output a module wrote at a completed earlier stage.

Any other string is a literal. There are no expressions, conditionals, or functions.

## Validation performed

By the SPA on load, and by the `wfm-manifest check <file>` CLI before upload:
- Schema conformance, unique keys, every binding resolves to a declared input or earlier output, every job stage has a valid `target`.

By the CLI only, using the SDK against the target environment:
- The function and version exist.
- Every required function input is covered by `target` or `parameters`.
- Referenced `secret_type` values exist.

## Example: Smart Diff

```json
{
  "schema_version": "1",
  "key": "smart-diff",
  "name": "Smart Diff",
  "description": "LLM-assisted comparison of two documents. Surfaces matches, conflicts, and missing items with a traceable HTML report attached to the first document.",
  "version": "1.3.2",
  "tags": [
    "documents",
    "llm",
    "icd"
  ],
  "icon": "git-compare",
  "stages": [
    {
      "key": "configure",
      "name": "Select documents and model",
      "description": "Pick the two documents to compare, the credential to use, and the model. The report is attached to the first document.",
      "inputs": [
        {
          "key": "file1",
          "label": "First document",
          "type": "resource",
          "required": true,
          "help": "The report will be attached to this document as an artifact.",
          "filter": {
            "extensions": [
              "pdf",
              "docx",
              "xlsx",
              "txt"
            ]
          }
        },
        {
          "key": "file2",
          "label": "Second document",
          "type": "resource",
          "required": true,
          "filter": {
            "extensions": [
              "pdf",
              "docx",
              "xlsx",
              "txt"
            ]
          }
        },
        {
          "key": "llm_credential",
          "label": "Linked account credential",
          "type": "auth_secret",
          "required": true,
          "help": "Any of your linked accounts. The model list below follows the credential you choose (matched on its name)."
        },
        {
          "key": "model",
          "label": "Model",
          "type": "enum",
          "required": true,
          "help": "Each choice is a Smart Diff function of the @bcapetillo:smart_diff module registered for that provider and model.",
          "filter": {
            "options_by": {
              "source": "$inputs.llm_credential.name",
              "match": "contains",
              "groups": {
                "openai": [
                  {
                    "value": "@bcapetillo:execute_openai_gpt-4o",
                    "label": "OpenAI / GPT-4o"
                  }
                ],
                "anthropic": [
                  {
                    "value": "@bcapetillo:execute_claude_opus-4.8",
                    "label": "Anthropic / Claude Opus 4.8"
                  }
                ],
                "claude": [
                  {
                    "value": "@bcapetillo:execute_claude_opus-4.8",
                    "label": "Anthropic / Claude Opus 4.8"
                  }
                ],
                "gemini": [
                  {
                    "value": "@bcapetillo:execute_gemini_1.5-pro",
                    "label": "Google / Gemini 1.5 Pro"
                  }
                ],
                "google": [
                  {
                    "value": "@bcapetillo:execute_gemini_1.5-pro",
                    "label": "Google / Gemini 1.5 Pro"
                  }
                ]
              }
            }
          }
        },
        {
          "key": "prompt",
          "label": "Focus",
          "type": "text",
          "required": true,
          "default": "Diff these two files",
          "help": "What matters most in this comparison, for example signal timing or voltage tolerances. Passed to the module as the focus prompt.",
          "filter": {
            "multiline": true,
            "max_length": 2000
          }
        }
      ],
      "function": {
        "name": "$inputs.model",
        "version": "1.0.0",
        "target": "file1",
        "tool_name": "LLM",
        "operating_system": "Ubuntu 24.04",
        "parameters": {
          "prompt": "$inputs.prompt"
        },
        "sources": {
          "file2": "$inputs.file2"
        },
        "auth_bindings": {
          "auth_token": "$inputs.llm_credential"
        },
        "tool_version": "1.0"
      },
      "outputs": [
        {
          "key": "artifacts",
          "label": "Diff report (diff_output.html), prompt audit, and job logs",
          "type": "artifact"
        }
      ]
    },
    {
      "key": "results",
      "name": "Results",
      "view": {
        "type": "artifact_list",
        "source": "$stages.configure.outputs.artifacts"
      }
    }
  ]
}
```

## Example: a review gate (diff, review, resolve)

```json
{
  "key": "review",
  "name": "Choose conflicts to resolve",
  "inputs": [
    { "key": "conflicts", "label": "Conflicts", "type": "stage_output", "required": true,
      "filter": { "source": "$stages.diff.outputs.conflicts", "multiple": true } },
    { "key": "strategy", "label": "Resolution strategy", "type": "enum", "required": true,
      "filter": { "options": [
        { "value": "prefer_a", "label": "Prefer first document" },
        { "value": "prefer_b", "label": "Prefer second document" },
        { "value": "llm", "label": "Let the LLM propose" } ] } }
  ]
},
{
  "key": "resolve",
  "name": "Resolve",
  "inputs": [
    { "key": "target_doc", "label": "Document to update", "type": "resource", "required": true }
  ],
  "function": {
    "name": "@istari_utils:resolve_conflicts",
    "target": "target_doc",
    "parameters": {
      "report_artifact_id": "$stages.diff.outputs.report",
      "conflicts": "$stages.review.inputs.conflicts",
      "strategy": "$stages.review.inputs.strategy"
    }
  },
  "outputs": [ { "key": "resolved", "label": "Resolved document", "type": "revision" } ]
}
```

The `resolve` stage binds to the review gate's inputs with `$stages.review.inputs.<key>`, which is why that binding form exists.
