"""Full offline validation: schema conformance first, then semantic rules."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from wfm_manifest.schema import load_schema, make_validator, schema_errors
from wfm_manifest.semantic import semantic_errors


@dataclass(frozen=True)
class ValidationResult:
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_manifest(data: object, validator: Draft202012Validator) -> ValidationResult:
    """Semantic checks run only once the document conforms to the schema, so they can rely on its shape."""
    errors = schema_errors(data, validator)
    if errors:
        return ValidationResult(errors)
    assert isinstance(data, dict)
    return ValidationResult(semantic_errors(data))


def validator_for(schema_path: Path | None = None) -> Draft202012Validator:
    return make_validator(load_schema(schema_path))


def summary(manifest: dict[str, Any]) -> str:
    stages = manifest.get("stages") or []
    return (
        f"OK: {manifest.get('name')} (key={manifest.get('key')}, version={manifest.get('version')}, "
        f"{len(stages)} stage{'s' if len(stages) != 1 else ''})"
    )
