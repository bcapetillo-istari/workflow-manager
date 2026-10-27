"""Binding expressions, the only dynamic construct in a manifest.

    $inputs.<key>[.<field>...]
    $stages.<stage>.inputs.<key>[.<field>...]
    $stages.<stage>.outputs[.<key>[.<field>...]]   (no key = the whole outputs section)

Any other string is a literal. This module is the only place binding strings are parsed; it mirrors
ui/src/manifest/bindings.ts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

INPUTS_ROOT = "$inputs"
STAGES_ROOT = "$stages"
BINDING_FORMS = "$inputs.<key> or $stages.<stage>.inputs|outputs.<key>"

Section = Literal["inputs", "outputs"]


@dataclass(frozen=True)
class ParsedBinding:
    """A parsed binding. ``stage`` is None for the ``$inputs`` form; ``key`` is "" for a whole section."""

    kind: Literal["inputs", "stages"]
    key: str
    path: tuple[str, ...] = field(default_factory=tuple)
    stage: str | None = None
    section: Section = "inputs"


def is_binding(value: object) -> bool:
    """True for strings starting with ``$inputs.`` or ``$stages.``; such strings are never literals."""
    return isinstance(value, str) and (
        value.startswith(f"{INPUTS_ROOT}.") or value.startswith(f"{STAGES_ROOT}.")
    )


def parse_binding(expr: str) -> ParsedBinding | None:
    """Parses a binding expression; None when the string is not a binding or is malformed."""
    if not is_binding(expr):
        return None
    segments = expr.split(".")
    if any(segment == "" for segment in segments):
        return None
    root, *rest = segments
    if root == INPUTS_ROOT:
        if not rest:
            return None
        key, *path = rest
        return ParsedBinding(kind="inputs", key=key, path=tuple(path))
    if len(rest) < 2:
        return None
    stage, section, *key_and_path = rest
    if section not in ("inputs", "outputs"):
        return None
    key = key_and_path[0] if key_and_path else ""
    path = tuple(key_and_path[1:])
    return ParsedBinding(kind="stages", key=key, path=path, stage=stage, section=section)
