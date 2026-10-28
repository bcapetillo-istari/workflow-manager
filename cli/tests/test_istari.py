from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.conftest import base_manifest, load_example
from tests.fakes import FakeFunctionVersion, FakeIntegrations, FakeSchema, FakeSchemaInput
from wfm_manifest.istari import EnvError, candidate_function_names, check_functions, load_env, read_token


def test_load_env(env_file: Path, tmp_path: Path) -> None:
    env = load_env(env_file)
    assert (env.registry_url, env.system_id) == ("https://registry.example", "sys-1")
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"registry_url": "x"}))
    with pytest.raises(EnvError):
        load_env(bad)
    with pytest.raises(EnvError):
        load_env(tmp_path / "missing.json")


def test_read_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ISTARI_TOKEN", raising=False)
    with pytest.raises(EnvError):
        read_token()
    monkeypatch.setenv("ISTARI_TOKEN", "t")
    assert read_token() == "t"


def test_missing_function_and_version() -> None:
    integrations = FakeIntegrations([FakeFunctionVersion("@istari_utils:do_thing", "1.0.0")])
    manifest = base_manifest()
    assert check_functions(integrations, manifest).errors == []
    manifest["stages"][0]["function"]["version"] = "2.0.0"
    assert check_functions(integrations, manifest).errors == [
        'stages[0].function.version: function "@istari_utils:do_thing" has no version "2.0.0" (known: 1.0.0)'
    ]
    manifest["stages"][0]["function"] = {"name": "@x:missing", "target": "doc"}
    assert check_functions(integrations, manifest).errors == [
        'stages[0].function.name: function "@x:missing" does not exist in this environment'
    ]


def test_required_inputs_are_checked_when_schema_available() -> None:
    schema = FakeSchema(
        [
            FakeSchemaInput("input_model", "user_model", False),
            FakeSchemaInput("file2", "user_model", False),
            FakeSchemaInput("prompt", "parameter", False),
            FakeSchemaInput("auth_token", "auth_info", False),
            FakeSchemaInput("extra", "parameter", True),
        ]
    )
    integrations = FakeIntegrations([FakeFunctionVersion("@istari_utils:do_thing", "1.0.0", function_schema=schema)])
    manifest = base_manifest()
    fn = manifest["stages"][0]["function"]
    result = check_functions(integrations, manifest)
    assert result.warnings == []
    assert result.errors == [
        'stages[0].function.parameters: function "@istari_utils:do_thing" requires input "file2" (user_model), '
        "which is not covered by target, parameters, sources or auth_bindings",
        'stages[0].function.parameters: function "@istari_utils:do_thing" requires input "prompt" (parameter), '
        "which is not covered by target, parameters, sources or auth_bindings",
        'stages[0].function.parameters: function "@istari_utils:do_thing" requires input "auth_token" (auth_info), '
        "which is not covered by target, parameters, sources or auth_bindings",
    ]
    fn["parameters"] = {"prompt": "$inputs.note"}
    fn["sources"] = {"file2": "$inputs.doc"}
    fn["auth_bindings"] = {"auth_token": "$inputs.doc"}
    assert check_functions(integrations, manifest).errors == []


def test_latest_version_is_used_when_unpinned() -> None:
    old = FakeFunctionVersion("@istari_utils:do_thing", "1.0.0", created=1, function_schema=FakeSchema([]))
    new = FakeFunctionVersion(
        "@istari_utils:do_thing", "1.1.0", created=2,
        function_schema=FakeSchema([FakeSchemaInput("needed", "parameter", False)]),
    )
    result = check_functions(FakeIntegrations([old, new]), base_manifest())
    assert len(result.errors) == 1 and '"needed"' in result.errors[0]


def test_warns_when_schema_unavailable() -> None:
    integrations = FakeIntegrations([FakeFunctionVersion("@istari_utils:do_thing", "1.0.0", function_schema=None)])
    result = check_functions(integrations, base_manifest())
    assert result.errors == []
    assert result.warnings == [
        'stages[0].function: skipped required-input check for "@istari_utils:do_thing" (function schema not available)'
    ]


def test_bound_function_name_checks_every_enum_option() -> None:
    manifest = load_example("smart_diff_workflow_manifest")
    stage = manifest["stages"][0]
    names = candidate_function_names(stage, stage["function"])
    assert names == [
        "@bcapetillo:execute_claude_opus-4.8",
        "@bcapetillo:execute_gemini_1.5-pro",
        "@bcapetillo:execute_openai_gpt-4o",
    ]
    integrations = FakeIntegrations([FakeFunctionVersion(n, "1.0.0") for n in names[:2]])
    result = check_functions(integrations, manifest)
    assert result.errors == [
        'stages[0].function.name: function "@bcapetillo:execute_openai_gpt-4o" does not exist in this environment'
    ]
    assert len(result.warnings) == 2  # schema unavailable for the two that exist


def test_bound_function_name_to_text_input_is_skipped() -> None:
    manifest = base_manifest()
    manifest["stages"][0]["function"]["name"] = "$inputs.note"
    result = check_functions(FakeIntegrations([]), manifest)
    assert result.errors == []
    assert result.warnings == [
        'stages[0].function.name: skipped function check ("$inputs.note" is only known at runtime)'
    ]
