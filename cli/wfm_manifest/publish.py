"""Publish a manifest to the workflow-manager system.

Same approach as scripts/publish_manifest.py: if a tracked file with the same name exists on the
baseline branch, create a new revision of that resource; otherwise create an artifact resource and
commit it to the branch. ``dry_run`` performs only the read side and reports what would happen.
"""

from __future__ import annotations

import json
import logging
import tempfile
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from wfm_manifest.istari import _attr, baseline_branch

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PublishResult:
    action: str  # "created" | "revised" | "dry-run"
    name: str
    resource_id: str | None
    revision_id: str | None
    would: str | None = None  # dry-run only: "create" | "revise"
    branch_snapshot: str | None = None

    def to_json(self) -> str:
        return json.dumps({k: v for k, v in asdict(self).items() if v is not None})


def default_file_name(manifest: Mapping[str, Any]) -> str:
    return f"{manifest['key']}.json"


def description_for(manifest: Mapping[str, Any]) -> str:
    return f"Workflow manifest: {manifest.get('name', manifest.get('key'))} v{manifest.get('version', '?')}"


def find_existing(branch: Any, file_name: str) -> Any | None:
    return next((tf for tf in branch.files() if _attr(tf, "name") == file_name), None)


def publish(
    registry: Any,
    system_id: str,
    manifest: Mapping[str, Any],
    file_name: str | None = None,
    *,
    dry_run: bool = False,
) -> PublishResult:
    name = file_name or default_file_name(manifest)
    branch = baseline_branch(registry, system_id)
    existing = find_existing(branch, name)
    existing_id = (_attr(existing, "resource_id") or _attr(existing, "file_id")) if existing else None
    if dry_run:
        return PublishResult(
            action="dry-run",
            name=name,
            resource_id=str(existing_id) if existing_id else None,
            revision_id=None,
            would="revise" if existing is not None else "create",
        )
    desc = description_for(manifest)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / name
        path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        if existing_id:
            log.info("creating new revision of %s (%s)", name, existing_id)
            rev = registry.resources.revisions.create(existing_id, path, description=desc)
            return PublishResult(
                action="revised", name=name, resource_id=str(existing_id), revision_id=str(_attr(rev, "id"))
            )
        log.info("creating resource %s and committing to branch %s", name, _attr(branch, "tag"))
        res = registry.resources.create(path, "artifact", description=desc)
        rev = registry.resources.revisions.get(res.resource_id, res.file_revision_id)
        branch = branch.commit(add=[rev])
        return PublishResult(
            action="created",
            name=name,
            resource_id=str(res.resource_id),
            revision_id=str(_attr(rev, "id")),
            branch_snapshot=str(_attr(branch, "snapshot_id")),
        )
