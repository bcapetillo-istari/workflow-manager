from __future__ import annotations

import json

from tests.conftest import base_manifest
from tests.fakes import FakeBranch, FakeRegistry, FakeTrackedFile
from wfm_manifest.publish import default_file_name, description_for, publish


def test_default_name_and_description() -> None:
    manifest = base_manifest()
    assert default_file_name(manifest) == "base-flow.json"
    assert description_for(manifest) == "Workflow manifest: Base flow v1.0.0"


def test_publish_creates_and_commits_when_name_is_new() -> None:
    registry = FakeRegistry(FakeBranch(tracked=[FakeTrackedFile("other.json", "res-other")]))
    manifest = base_manifest()
    result = publish(registry, "sys-1", manifest)
    assert result.action == "created"
    assert result.resource_id == "res-new"
    assert result.revision_id == "rev-new"
    assert result.branch_snapshot == "snap-1"
    path, resource_type, description, content = registry.resources.created[0]
    assert path.name == "base-flow.json"
    assert resource_type == "artifact"
    assert description == "Workflow manifest: Base flow v1.0.0"
    assert json.loads(content) == manifest
    branch = registry.systems.system.branch_list[1]
    assert [rev.id for rev in branch.commits[0]] == ["rev-new"]


def test_publish_revises_when_name_exists_on_baseline() -> None:
    branch = FakeBranch(tracked=[FakeTrackedFile("base-flow.json", "res-existing")])
    registry = FakeRegistry(branch)
    result = publish(registry, "sys-1", base_manifest())
    assert result.action == "revised"
    assert result.resource_id == "res-existing"
    assert result.revision_id == "rev-of-res-existing"
    assert registry.resources.created == []
    assert branch.commits == []
    assert registry.resources.revisions.created[0][0] == "res-existing"


def test_publish_honours_name_override() -> None:
    branch = FakeBranch(tracked=[FakeTrackedFile("custom.json", "res-custom")])
    result = publish(FakeRegistry(branch), "sys-1", base_manifest(), "custom.json")
    assert (result.action, result.resource_id) == ("revised", "res-custom")


def test_dry_run_only_reads() -> None:
    branch = FakeBranch(tracked=[FakeTrackedFile("base-flow.json", "res-existing")])
    registry = FakeRegistry(branch)
    result = publish(registry, "sys-1", base_manifest(), dry_run=True)
    assert json.loads(result.to_json()) == {
        "action": "dry-run",
        "name": "base-flow.json",
        "resource_id": "res-existing",
        "would": "revise",
    }
    result = publish(registry, "sys-1", base_manifest(), "new.json", dry_run=True)
    assert json.loads(result.to_json()) == {"action": "dry-run", "name": "new.json", "would": "create"}
    assert registry.resources.created == [] and registry.resources.revisions.created == []
    assert branch.commits == []
