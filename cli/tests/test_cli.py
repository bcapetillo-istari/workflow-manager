from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tests.conftest import EXAMPLES, base_manifest
from tests.fakes import FakeBranch, FakeFunctionVersion, FakeIntegrations, FakeRegistry, FakeTrackedFile
from wfm_manifest import cli
from wfm_manifest.istari import Clients


def run(*argv: str) -> tuple[int, str]:
    import io
    from contextlib import redirect_stdout

    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = cli.main(list(argv))
    return code, buffer.getvalue()


def test_check_valid_example() -> None:
    code, out = run("check", str(EXAMPLES / "smart_diff_workflow_manifest.json"))
    assert code == 0
    assert out.strip() == "OK: Smart Diff (key=smart-diff, version=1.2.0, 2 stages)"


def test_check_invalid_examples() -> None:
    code, out = run("check", str(EXAMPLES / "invalid_bad_binding_manifest.json"))
    assert code == 1
    lines = out.strip().splitlines()
    assert len(lines) == 3 and lines[0].startswith("ERROR stages[0].function.parameters.file2_resource_id:")
    assert lines[-1] == "2 error(s)"
    code, out = run("check", str(EXAMPLES / "invalid_missing_target_manifest.json"))
    assert code == 1
    assert out.splitlines()[0] == 'ERROR stages[0].function: missing required property "target"'


def test_check_bad_json_and_missing_file(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text("{nope")
    assert run("check", str(bad))[0] == 1
    assert run("check", str(tmp_path / "missing.json"))[0] == 2


def test_check_with_explicit_schema(tmp_path: Path) -> None:
    schema = cli.validator_for().schema
    copy = tmp_path / "schema.json"
    copy.write_text(json.dumps(schema))
    manifest = tmp_path / "m.json"
    manifest.write_text(json.dumps(base_manifest()))
    assert run("--schema", str(copy), "check", str(manifest))[0] == 0
    assert run("--schema", str(tmp_path / "nope.json"), "check", str(manifest))[0] == 2


@pytest.fixture
def fake_clients(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    branch = FakeBranch(
        tracked=[
            FakeTrackedFile("base-flow.json", "res-1", content=base_manifest()),
            FakeTrackedFile("broken.json", "res-2", content={"schema_version": "2"}),
            FakeTrackedFile("notes.txt", "res-3", extension="txt"),
            FakeTrackedFile("unreadable.json", "res-4", content=RuntimeError("boom")),
        ]
    )
    registry = FakeRegistry(branch)
    integrations = FakeIntegrations([FakeFunctionVersion("@istari_utils:do_thing", "1.0.0")])
    monkeypatch.setenv("ISTARI_TOKEN", "secret-token")
    monkeypatch.setattr(cli, "make_clients", lambda env, token: Clients(registry=registry, integrations=integrations))
    return {"branch": branch, "registry": registry, "integrations": integrations}


def test_check_env_online(fake_clients: dict[str, Any], env_file: Path, tmp_path: Path) -> None:
    manifest = tmp_path / "m.json"
    manifest.write_text(json.dumps(base_manifest()))
    code, out = run("check", str(manifest), "--env", str(env_file))
    assert code == 0
    assert "functions verified against https://registry.example" in out
    assert "WARN" in out  # schema not available from the fake -> required-input check skipped
    assert fake_clients["integrations"].functions.queries == ["@istari_utils:do_thing"]
    data = base_manifest()
    data["stages"][0]["function"]["name"] = "@x:missing"
    manifest.write_text(json.dumps(data))
    code, out = run("check", str(manifest), "--env", str(env_file))
    assert code == 1
    assert 'ERROR stages[0].function.name: function "@x:missing" does not exist' in out


def test_publish_refuses_invalid(fake_clients: dict[str, Any], env_file: Path) -> None:
    code, out = run("publish", str(EXAMPLES / "invalid_bad_binding_manifest.json"), "--env", str(env_file))
    assert code == 1
    assert "refusing to publish" in out
    assert fake_clients["registry"].resources.created == []


def test_publish_dry_run_and_real(fake_clients: dict[str, Any], env_file: Path, tmp_path: Path) -> None:
    manifest = tmp_path / "m.json"
    manifest.write_text(json.dumps(base_manifest()))
    code, out = run("publish", str(manifest), "--env", str(env_file), "--dry-run")
    assert code == 0
    assert json.loads(out) == {"action": "dry-run", "name": "base-flow.json", "resource_id": "res-1", "would": "revise"}
    code, out = run("publish", str(manifest), "--env", str(env_file), "--name", "fresh.json")
    assert code == 0
    assert json.loads(out) == {
        "action": "created",
        "name": "fresh.json",
        "resource_id": "res-new",
        "revision_id": "rev-new",
        "branch_snapshot": "snap-1",
    }


def test_publish_requires_token(fake_clients: dict[str, Any], env_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ISTARI_TOKEN")
    code, _ = run("publish", str(EXAMPLES / "smart_diff_workflow_manifest.json"), "--env", str(env_file))
    assert code == 2


def test_list(fake_clients: dict[str, Any], env_file: Path) -> None:
    code, out = run("list", "--env", str(env_file), "--json")
    assert code == 1  # one invalid, one unreadable
    entries = json.loads(out)
    assert [e["file_name"] for e in entries] == ["base-flow.json", "broken.json", "unreadable.json"]
    assert entries[0]["valid"] and entries[0]["key"] == "base-flow" and entries[0]["version"] == "1.0.0"
    assert not entries[1]["valid"] and 'schema_version: schema_version must be "1"' in entries[1]["errors"]
    assert entries[2]["errors"] == ["unreadable: boom"]
    code, out = run("list", "--env", str(env_file))
    assert "ok      base-flow.json  res-1" in out
    assert "INVALID broken.json" in out
    assert out.strip().endswith("3 manifest(s), 2 invalid")
