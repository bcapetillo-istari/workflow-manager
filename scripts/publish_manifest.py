#!/usr/bin/env python
"""Publish a workflow manifest to the workflow-manager system (dev helper; the wfm-manifest CLI supersedes this).

Usage:
  ISTARI_TOKEN=... python scripts/publish_manifest.py docs/examples/smart_diff_workflow_manifest.json
Options:
  --registry-url  default https://fileservice-v2.demo.istari.app
  --system-id     default df2e9e2e-e2a1-4a3b-aa58-01dc6f43321f (workflow-manager in demo)
Behavior: if a tracked resource with the same file name exists on the baseline branch, a new revision is
created on it; otherwise a new artifact resource is created and committed to the branch.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from istari_digital_client import Configuration, Istari

DEFAULT_REGISTRY = "https://fileservice-v2.demo.istari.app"
DEFAULT_SYSTEM = "df2e9e2e-e2a1-4a3b-aa58-01dc6f43321f"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", type=Path)
    ap.add_argument("--registry-url", default=os.environ.get("ISTARI_BASE_URL", DEFAULT_REGISTRY))
    ap.add_argument("--system-id", default=DEFAULT_SYSTEM)
    ap.add_argument("--name", help="Override the resource file name (default <key>.json)")
    args = ap.parse_args()

    token = os.environ.get("ISTARI_TOKEN")
    if not token:
        print("ISTARI_TOKEN is not set", file=sys.stderr)
        return 2

    data = json.loads(args.manifest.read_text())
    key = data.get("key")
    if not key:
        print("manifest has no key", file=sys.stderr)
        return 2
    file_name = args.name or f"{key}.json"

    client = Istari(Configuration(registry_url=args.registry_url, registry_auth_token=token))
    system = client.systems.get(args.system_id)
    branch = next((b for b in system.branches() if b.is_baseline), None)
    if branch is None:
        print("system has no baseline branch", file=sys.stderr)
        return 2

    existing = None
    for tf in branch.files():
        if getattr(tf, "name", None) == file_name:
            existing = tf
            break

    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / file_name
        path.write_text(json.dumps(data, indent=2))
        desc = f"Workflow manifest: {data.get('name', key)} v{data.get('version', '?')}"
        if existing is not None:
            rid = getattr(existing, "resource_id", None) or getattr(existing, "file_id", None)
            rev = client.resources.revisions.create(rid, path, description=desc)
            print(json.dumps({"action": "revised", "resource_id": rid, "revision_id": rev.id, "name": file_name}))
            return 0
        res = client.resources.create(path, "artifact", description=desc)
        rev = client.resources.revisions.get(res.resource_id, res.file_revision_id)
        branch = branch.commit(add=[rev])
        print(json.dumps({"action": "created", "resource_id": res.resource_id, "revision_id": rev.id,
                          "name": file_name, "branch_snapshot": branch.snapshot_id}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
