"""JSON Schema conformance against schema/workflow-manifest.v1.json (Draft 2020-12).

The schema file is the single source of truth shared with the SPA; it is loaded at runtime, never
copied. Errors are rendered as one-line ``<path>: <message>`` strings with the same wording as
ui/src/manifest/schema.ts, honouring the schema's non-standard ``errorMessage`` annotation.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

log = logging.getLogger(__name__)

SCHEMA_RELATIVE_PATH = Path("schema") / "workflow-manifest.v1.json"
SCHEMA_ENV_VAR = "WFM_SCHEMA"

_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
_COMPARISONS = {"minimum": ">=", "exclusiveMinimum": ">", "maximum": "<=", "exclusiveMaximum": "<"}


class SchemaNotFoundError(FileNotFoundError):
    """Raised when the manifest JSON Schema cannot be located."""


def candidate_schema_paths(start: Path | None = None) -> list[Path]:
    """Locations searched for the schema, in order: the repo containing this package, then cwd upwards."""
    package_repo = Path(__file__).resolve().parents[2]
    candidates = [package_repo / SCHEMA_RELATIVE_PATH]
    here = (start or Path.cwd()).resolve()
    candidates.extend(parent / SCHEMA_RELATIVE_PATH for parent in [here, *here.parents])
    return candidates


def resolve_schema_path(explicit: Path | None = None) -> Path:
    """Returns the schema path: ``--schema``, then ``$WFM_SCHEMA``, then the repo's schema/ directory."""
    if explicit is not None:
        if not explicit.is_file():
            raise SchemaNotFoundError(f"schema file not found: {explicit}")
        return explicit
    from_env = os.environ.get(SCHEMA_ENV_VAR)
    if from_env:
        return resolve_schema_path(Path(from_env))
    for candidate in candidate_schema_paths():
        if candidate.is_file():
            return candidate
    raise SchemaNotFoundError(
        f"cannot find {SCHEMA_RELATIVE_PATH}; run from the repository or pass --schema <path>"
    )


def load_schema(path: Path | None = None) -> dict[str, Any]:
    """Loads and syntax-checks the JSON Schema document."""
    resolved = resolve_schema_path(path)
    log.debug("loading schema from %s", resolved)
    schema: dict[str, Any] = json.loads(resolved.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return schema


def make_validator(schema: dict[str, Any]) -> Draft202012Validator:
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def schema_errors(data: object, validator: Draft202012Validator) -> list[str]:
    """Validates against the JSON Schema only. Empty list means conformant."""
    lines: list[str] = []
    for error in validator.iter_errors(data):
        for message in _describe(error):
            line = f"{format_path(error.absolute_path)}: {message}"
            if line not in lines:
                lines.append(line)
    return lines


def format_path(path: Iterable[str | int]) -> str:
    """``["stages", 0, "inputs", 2]`` -> ``stages[0].inputs[2]``; the root is reported as ``manifest``."""
    out = ""
    for segment in path:
        if isinstance(segment, int):
            out += f"[{segment}]"
        elif _IDENTIFIER.match(segment):
            out = segment if out == "" else f"{out}.{segment}"
        else:
            out += f"[{json.dumps(segment)}]"
    return out or "manifest"


def _custom_message(error: ValidationError) -> str | None:
    parent = error.schema
    if isinstance(parent, dict):
        message = parent.get("errorMessage")
        if isinstance(message, str):
            return message
    return None


def _describe(error: ValidationError) -> Sequence[str]:
    custom = _custom_message(error)
    if custom is not None:
        return [custom]
    keyword = error.validator
    value = error.validator_value
    if keyword == "required":
        instance = error.instance if isinstance(error.instance, dict) else {}
        missing = [prop for prop in _as_list(value) if prop not in instance]
        return [f"missing required property {json.dumps(prop)}" for prop in missing]
    if keyword == "type":
        return [f"must be of type {' or '.join(str(t) for t in _as_list(value))}"]
    if keyword == "enum":
        return [f"must be one of {', '.join(json.dumps(v) for v in _as_list(value))}"]
    if keyword == "const":
        return [f"must be {json.dumps(value)}"]
    if keyword == "pattern":
        return [f"must match pattern {value}"]
    if keyword == "format":
        return [f"must be a valid {value}"]
    if keyword == "minItems":
        return [f"must have at least {value} item(s)"]
    if keyword == "minLength":
        return [f"must have at least {value} character(s)"]
    if keyword in _COMPARISONS:
        return [f"must be {_COMPARISONS[str(keyword)]} {value}"]
    if keyword == "oneOf":
        return ["must match exactly one of the allowed shapes"]
    if keyword == "contains":
        return ["must contain at least one matching item"]
    return [error.message or f'fails the "{keyword}" rule']


def _as_list(value: object) -> list[Any]:
    if isinstance(value, list):
        return value
    return [value]
