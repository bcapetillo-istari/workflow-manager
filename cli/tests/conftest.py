from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from wfm_manifest.validate import validator_for

REPO = Path(__file__).resolve().parents[2]
EXAMPLES = REPO / "docs" / "examples"

Json = dict[str, Any]


def load_example(name: str) -> Any:
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def base_manifest() -> Json:
    """A minimal valid two-stage manifest: a job stage followed by a result view (as in validate.test.ts)."""
    return {
        "schema_version": "1",
        "key": "base-flow",
        "name": "Base flow",
        "version": "1.0.0",
        "stages": [
            {
                "key": "configure",
                "name": "Configure",
                "inputs": [
                    {"key": "doc", "label": "Document", "type": "resource", "required": True},
                    {"key": "sys", "label": "System", "type": "system"},
                    {"key": "note", "label": "Note", "type": "text"},
                ],
                "function": {"name": "@istari_utils:do_thing", "target": "doc", "parameters": {"note": "$inputs.note"}},
                "outputs": [{"key": "report", "label": "Report", "type": "artifact"}],
            },
            {"key": "results", "name": "Results", "view": {"type": "artifact_list", "source": "$stages.configure.outputs"}},
        ],
    }


def with_input(input_: Json, stage_index: int = 0) -> Json:
    manifest = base_manifest()
    stage = manifest["stages"][stage_index]
    stage.setdefault("inputs", []).append({"key": "extra", "label": "Extra", "type": "text", **input_})
    return manifest


def mutate(manifest: Json, **changes: Any) -> Json:
    out = copy.deepcopy(manifest)
    out.update(changes)
    return out


@pytest.fixture(scope="session")
def validator() -> Draft202012Validator:
    return validator_for()


@pytest.fixture
def env_file(tmp_path: Path) -> Path:
    path = tmp_path / "env.json"
    path.write_text(json.dumps({"registry_url": "https://registry.example", "system_id": "sys-1"}))
    return path
