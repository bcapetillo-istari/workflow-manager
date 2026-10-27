from __future__ import annotations

import os
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from tests.conftest import EXAMPLES, REPO, base_manifest, load_example, mutate, with_input
from wfm_manifest.schema import (
    SchemaNotFoundError,
    format_path,
    load_schema,
    resolve_schema_path,
    schema_errors,
)


def errors(data: object, validator: Draft202012Validator) -> list[str]:
    return schema_errors(data, validator)


def test_schema_is_loaded_from_the_repository() -> None:
    assert resolve_schema_path() == REPO / "schema" / "workflow-manifest.v1.json"
    assert load_schema()["$id"].endswith("workflow-manifest.v1.json")


def test_schema_override_by_env_and_flag(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    copy = tmp_path / "s.json"
    copy.write_text((REPO / "schema" / "workflow-manifest.v1.json").read_text())
    assert resolve_schema_path(copy) == copy
    monkeypatch.setenv("WFM_SCHEMA", str(copy))
    assert resolve_schema_path() == copy
    with pytest.raises(SchemaNotFoundError):
        resolve_schema_path(tmp_path / "missing.json")


@pytest.mark.parametrize("name", [p.stem for p in EXAMPLES.glob("*.json") if not p.name.startswith("invalid_")])
def test_valid_examples_conform(name: str, validator: Draft202012Validator) -> None:
    assert errors(load_example(name), validator) == []


def test_missing_target_example(validator: Draft202012Validator) -> None:
    assert errors(load_example("invalid_missing_target_manifest"), validator) == [
        'stages[0].function: missing required property "target"'
    ]


def test_bad_binding_example_is_schema_conformant(validator: Draft202012Validator) -> None:
    assert errors(load_example("invalid_bad_binding_manifest"), validator) == []


def test_root_must_be_object(validator: Draft202012Validator) -> None:
    assert errors(None, validator) == ["manifest: must be of type object"]
    assert errors([], validator) == ["manifest: must be of type object"]


def test_top_level_rules(validator: Draft202012Validator) -> None:
    base = base_manifest()
    assert errors(mutate(base, schema_version="2"), validator) == ['schema_version: schema_version must be "1"']
    assert errors(mutate(base, key="Not Kebab"), validator) == [
        "key: key must be kebab-case (lowercase letters, digits, single hyphens)"
    ]
    assert errors(mutate(base, version="v1"), validator) == ['version: version must be semver, for example "1.0.0"']
    assert errors(mutate(base, version="1.2.3-beta.1+build.7"), validator) == []
    assert errors(mutate(base, stages=[]), validator) == ["stages: must have at least 1 item(s)"]
    assert errors(mutate(base, tags=["a", 2]), validator) == ["tags[1]: must be of type string"]
    assert errors(mutate(base, name=""), validator) == ["name: must have at least 1 character(s)"]


def test_unknown_fields_are_tolerated(validator: Draft202012Validator) -> None:
    data = base_manifest()
    data["extra"] = True
    data["stages"][0]["extra"] = "x"
    data["stages"][0]["inputs"][0]["filter"] = {"unknown_filter_field": 1}
    assert errors(data, validator) == []


def test_enum_options_rules(validator: Draft202012Validator) -> None:
    msg = 'enum and multi_enum require exactly one of "options" or "options_by"'
    assert errors(with_input({"type": "enum", "filter": {}}), validator) == [f"stages[0].inputs[3].filter: {msg}"]
    assert errors(with_input({"type": "multi_enum"}), validator) == [
        'stages[0].inputs[3]: enum and multi_enum require a filter with exactly one of "options" or "options_by"'
    ]
    both = {
        "options": [{"value": "a", "label": "A"}],
        "options_by": {"source": "$inputs.note", "groups": {"x": [{"value": "a", "label": "A"}]}},
    }
    assert errors(with_input({"type": "multi_enum", "filter": both}), validator) == [
        f"stages[0].inputs[3].filter: {msg}"
    ]
    assert errors(with_input({"type": "enum", "filter": {"options": []}}), validator) == [
        "stages[0].inputs[3].filter.options: must have at least 1 item(s)"
    ]
    assert errors(
        with_input({"type": "enum", "filter": {"options_by": {"source": "openai", "groups": {}}}}), validator
    ) == [
        "stages[0].inputs[3].filter.options_by.source: must be a binding "
        "($inputs.<key> or $stages.<stage>.inputs|outputs.<key>)"
    ]


def test_stage_output_branch_and_secret_rules(validator: Draft202012Validator) -> None:
    assert errors(with_input({"type": "stage_output"}, 1), validator) == [
        "stages[1].inputs[0]: stage_output requires a filter with source ($stages.<stage>.outputs.<key>)"
    ]
    assert errors(with_input({"type": "stage_output", "filter": {"source": "$stages.configure.inputs.doc"}}, 1), validator) == [
        "stages[1].inputs[0].filter.source: must reference an earlier stage's output ($stages.<stage>.outputs.<key>)"
    ]
    assert errors(with_input({"type": "branch", "filter": {}}), validator) == [
        "stages[0].inputs[3].filter: branch requires filter.system ($inputs.<key> of a system input)"
    ]
    assert errors(with_input({"type": "number", "secret": True}), validator) == [
        "stages[0].inputs[3].type: secret may only be set on auth_secret and text inputs"
    ]


def test_filter_field_types(validator: Draft202012Validator) -> None:
    assert errors(with_input({"type": "text", "filter": {"pattern": "("}}), validator) == [
        "stages[0].inputs[3].filter.pattern: must be a valid regex"
    ]
    assert errors(with_input({"type": "number", "filter": {"min": "1", "step": 0}}), validator) == [
        "stages[0].inputs[3].filter.min: must be of type number",
        "stages[0].inputs[3].filter.step: must be > 0",
    ]


def test_function_shape(validator: Draft202012Validator) -> None:
    data = base_manifest()
    data["stages"][0]["function"]["name"] = "smart_diff"
    assert errors(data, validator) == [
        'stages[0].function.name: function name must be fully qualified (for example "@istari_utils:smart_diff") '
        'or a binding such as "$inputs.model"'
    ]
    data = base_manifest()
    data["stages"][0]["function"]["parameters"] = {"x": {"a": 1}}
    assert errors(data, validator) == ["stages[0].function.parameters.x: must be of type string or number or boolean"]
    data = base_manifest()
    data["stages"][0]["inputs"] = [{"key": "note", "label": "Note", "type": "text"}]
    assert errors(data, validator) == [
        'stages[0].inputs: a stage with a function must have at least one "resource" input to use as function.target'
    ]
    data = base_manifest()
    del data["stages"][0]["inputs"]
    assert errors(data, validator) == [
        'stages[0]: a stage with a function must declare inputs including at least one "resource" input'
    ]


def test_outputs_and_views(validator: Draft202012Validator) -> None:
    data = base_manifest()
    data["stages"][0]["outputs"] = [{"key": "r", "type": "json", "path": 1}]
    assert errors(data, validator) == [
        'stages[0].outputs[0]: missing required property "label"',
        "stages[0].outputs[0].path: must be of type string",
    ]
    data = base_manifest()
    data["stages"][1]["view"] = {"type": "markdown", "source": "Hello"}
    assert errors(data, validator) == [
        "stages[1].view.source: must be a binding ($inputs.<key> or $stages.<stage>.inputs|outputs.<key>)"
    ]


def test_format_path() -> None:
    assert format_path([]) == "manifest"
    assert format_path(["stages", 0, "inputs", 2, "filter"]) == "stages[0].inputs[2].filter"
    assert format_path(["stages", 0, "function", "parameters", "a b"]) == 'stages[0].function.parameters["a b"]'


def test_env_var_is_not_leaked_into_schema_lookup() -> None:
    assert "WFM_SCHEMA" not in os.environ or Path(os.environ["WFM_SCHEMA"]).exists()
