from __future__ import annotations

import copy
from typing import Any

from jsonschema import Draft202012Validator

from tests.conftest import base_manifest, load_example, with_input
from wfm_manifest.semantic import member, semantic_errors
from wfm_manifest.validate import validate_manifest

Json = dict[str, Any]


def errors_of(data: object, validator: Draft202012Validator) -> list[str]:
    return validate_manifest(data, validator).errors


def with_params(params: dict[str, Any], stage_index: int = 1) -> Json:
    manifest = base_manifest()
    stage = manifest["stages"][stage_index]
    stage.setdefault("inputs", []).append({"key": "doc2", "label": "Doc", "type": "resource"})
    stage["function"] = {"name": "@istari_utils:f", "target": "doc2", "parameters": params}
    return manifest


LOC = "stages[1].function.parameters.p"


def test_examples(validator: Draft202012Validator) -> None:
    assert errors_of(load_example("smart_diff_workflow_manifest"), validator) == []
    assert errors_of(load_example("review_gate_workflow_manifest"), validator) == []
    assert errors_of(load_example("pdf_extract_test_manifest"), validator) == []
    assert errors_of(load_example("invalid_bad_binding_manifest"), validator) == [
        'stages[0].function.parameters.file2_resource_id: "$inputs.file3.resource_id" does not resolve: '
        'stage "configure" has no input "file3"',
        'stages[0].function.parameters.previous_report: "$stages.results.outputs.report" references '
        'stage "results" (stages[1]), which comes after this stage',
    ]
    assert errors_of(base_manifest(), validator) == []


def test_duplicate_keys() -> None:
    data = base_manifest()
    data["stages"][1]["key"] = "configure"
    assert semantic_errors(data) == ['stages[1].key: duplicate stage key "configure" (already used by stages[0])']
    assert semantic_errors(with_input({"key": "doc"})) == [
        'stages[0].inputs[3].key: duplicate input key "doc" (already used by stages[0].inputs[0])'
    ]
    assert semantic_errors(with_input({"key": "note"}, 1)) == []
    data = base_manifest()
    data["stages"][0]["outputs"].append({"key": "report", "label": "Again", "type": "json"})
    assert semantic_errors(data) == [
        'stages[0].outputs[1].key: duplicate output key "report" (already used by stages[0].outputs[0])'
    ]


def test_function_target() -> None:
    data = base_manifest()
    data["stages"][0]["function"]["target"] = "nope"
    assert semantic_errors(data) == ['stages[0].function.target: "nope" is not an input of stage "configure"']
    data["stages"][0]["function"]["target"] = "note"
    assert semantic_errors(data) == ['stages[0].function.target: "note" must be a "resource" input (it is "text")']


def test_binding_valid_forms_and_literals() -> None:
    params = {
        "a": "$inputs.doc2",
        "b": "$inputs.doc2.revision_id",
        "c": "$stages.configure.inputs.doc.resource_id",
        "d": "$stages.configure.inputs.note",
        "e": "$stages.configure.outputs.report",
        "f": "$stages.configure.outputs",
        "g": "$stages.configure.inputs",
        "literal": "just text",
        "n": 1,
        "flag": True,
    }
    assert semantic_errors(with_params(params)) == []


def test_binding_unresolved() -> None:
    assert semantic_errors(with_params({"p": "$inputs.ghost"})) == [
        f'{LOC}: "$inputs.ghost" does not resolve: stage "results" has no input "ghost"'
    ]
    assert semantic_errors(with_params({"p": "$stages.ghost.outputs.report"})) == [
        f'{LOC}: "$stages.ghost.outputs.report" does not resolve: no stage "ghost"'
    ]
    assert semantic_errors(with_params({"p": "$stages.configure.outputs.ghost"})) == [
        f'{LOC}: "$stages.configure.outputs.ghost" does not resolve: stage "configure" declares no output "ghost"'
    ]
    assert semantic_errors(with_params({"p": "$stages.configure.inputs.ghost"})) == [
        f'{LOC}: "$stages.configure.inputs.ghost" does not resolve: stage "configure" has no input "ghost"'
    ]


def test_binding_malformed() -> None:
    assert semantic_errors(with_params({"p": "$stages.configure.params.x"})) == [
        f'{LOC}: "$stages.configure.params.x" is not a valid binding (expected $inputs.<key> or '
        "$stages.<stage>.inputs|outputs.<key>)"
    ]
    assert semantic_errors(with_params({"p": "$inputs."})) == [
        f'{LOC}: "$inputs." is not a valid binding (expected $inputs.<key> or $stages.<stage>.inputs|outputs.<key>)'
    ]


def test_binding_stage_order() -> None:
    assert semantic_errors(with_params({"p": "$stages.results.outputs.report"}, 0)) == [
        'stages[0].function.parameters.p: "$stages.results.outputs.report" references stage "results" (stages[1]), '
        "which comes after this stage"
    ]
    assert semantic_errors(with_params({"p": "$stages.configure.outputs.report"}, 0)) == [
        'stages[0].function.parameters.p: "$stages.configure.outputs.report" references its own stage; '
        "use $inputs.<key> for the current stage"
    ]


def test_binding_fields() -> None:
    assert semantic_errors(with_params({"p": "$inputs.doc2.nope"})) == [
        f'{LOC}: "$inputs.doc2.nope": "nope" is not a field of a resource input '
        '(expected one of "resource_id", "revision_id", "name")'
    ]
    assert semantic_errors(with_params({"p": "$stages.configure.inputs.note.x"})) == [
        f'{LOC}: "$stages.configure.inputs.note.x": input "note" is a text and has no fields'
    ]


def test_filter_bindings() -> None:
    assert semantic_errors(with_input({"type": "resource", "filter": {"system": "$inputs.sys"}})) == []
    assert semantic_errors(with_input({"type": "branch", "filter": {"system": "$inputs.note"}})) == [
        'stages[0].inputs[3].filter.system: "$inputs.note" must reference a "system" input'
    ]
    assert semantic_errors(
        with_input({"type": "stage_output", "filter": {"source": "$stages.configure.outputs.report"}}, 1)
    ) == []
    options_by = {"source": "$inputs.extra", "groups": {}}
    assert semantic_errors(with_input({"type": "enum", "filter": {"options_by": options_by}})) == [
        'stages[0].inputs[3].filter.options_by.source: "$inputs.extra" may not reference its own input'
    ]
    options_by = {"source": "$stages.configure.outputs", "groups": {}}
    assert semantic_errors(with_input({"type": "enum", "filter": {"options_by": options_by}}, 1)) == [
        'stages[1].inputs[0].filter.options_by.source: "$stages.configure.outputs" must reference an input in '
        "the same stage ($inputs.<key>)"
    ]


def smart_diff_with(**fn_changes: Any) -> Json:
    data: Json = copy.deepcopy(load_example("smart_diff_workflow_manifest"))
    data["stages"][0]["function"].update(fn_changes)
    return data


def test_function_name_binding() -> None:
    fn_loc = "stages[0].function.name"
    assert semantic_errors(smart_diff_with(name="$inputs.model")) == []
    assert semantic_errors(smart_diff_with(name="$inputs.prompt")) == []
    assert semantic_errors(smart_diff_with(name="$inputs.file1")) == [
        f'{fn_loc}: "$inputs.file1" must reference an "enum" or "text" input'
    ]
    assert semantic_errors(smart_diff_with(name="$inputs.ghost")) == [
        f'{fn_loc}: "$inputs.ghost" does not resolve: stage "configure" has no input "ghost"'
    ]


def test_function_sources_and_auth_bindings() -> None:
    assert semantic_errors(smart_diff_with(sources={"file2": "$inputs.prompt"})) == [
        'stages[0].function.sources.file2: "$inputs.prompt" must reference a "resource" input or a stage output'
    ]
    assert semantic_errors(smart_diff_with(sources={"file2": "abc"})) == [
        'stages[0].function.sources.file2: "abc" must be a binding ($inputs.<key> or $stages.<stage>.inputs|outputs.<key>)'
    ]
    assert semantic_errors(smart_diff_with(sources={"odd key": "$inputs.nope"})) == [
        'stages[0].function.sources["odd key"]: "$inputs.nope" does not resolve: stage "configure" has no input "nope"'
    ]
    assert semantic_errors(smart_diff_with(auth_bindings={"auth_token": "$inputs.file1"})) == [
        'stages[0].function.auth_bindings.auth_token: "$inputs.file1" must reference an "auth_secret" input'
    ]
    later = with_params({}, 1)
    later["stages"][1]["function"]["sources"] = {"prev": "$stages.configure.outputs.report"}
    assert semantic_errors(later) == []


def test_member() -> None:
    assert member("x", "ok_name") == "x.ok_name"
    assert member("x", "a b") == 'x["a b"]'
