"""Cross-reference rules the JSON Schema cannot express; mirrors ui/src/manifest/validate.ts.

Unique keys, ``function.target`` naming a resource input, and every binding resolving to a declared
input or an earlier stage's output. These checks assume the document already conforms to the schema.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from wfm_manifest.bindings import BINDING_FORMS, ParsedBinding, is_binding, parse_binding

Json = Mapping[str, Any]

# Fields of the structured value each input type produces (the "Value bound" column of the spec).
VALUE_FIELDS: dict[str, tuple[str, ...]] = {
    "resource": ("resource_id", "revision_id", "name"),
    "system": ("system_id", "name"),
    "branch": ("branch_id", "tag"),
    "auth_secret": ("secret_id", "name", "provider"),
}
# Types whose value is a scalar or string list and therefore has no fields.
SCALAR_TYPES = frozenset({"text", "number", "boolean", "enum", "multi_enum"})
# Types whose value is a plain string and may therefore name a function at runtime.
FUNCTION_NAME_TYPES = frozenset({"enum", "text"})

_MEMBER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


@dataclass(frozen=True)
class Scope:
    manifest: Json
    index: int
    stage: Json


@dataclass(frozen=True)
class Target:
    """What a binding resolved to: an input, an output, or a whole inputs/outputs section."""

    kind: str  # "input" | "output" | "section"
    stage: Json
    input: Json | None = None
    output: Json | None = None
    section: str | None = None


Accept = Callable[[Target, ParsedBinding], str | None]


def semantic_errors(manifest: Json) -> list[str]:
    errors: list[str] = []
    stage_index_by_key: dict[str, int] = {}
    for index, stage in enumerate(_items(manifest, "stages")):
        loc = f"stages[{index}]"
        key = str(stage.get("key"))
        previous = stage_index_by_key.get(key)
        if previous is None:
            stage_index_by_key[key] = index
        else:
            errors.append(
                f'{loc}.key: duplicate stage key "{key}" (already used by stages[{previous}])'
            )
        _check_unique_keys(_items(stage, "inputs"), f"{loc}.inputs", "input", errors)
        _check_unique_keys(_items(stage, "outputs"), f"{loc}.outputs", "output", errors)
        scope = Scope(manifest=manifest, index=index, stage=stage)
        _check_target(scope, loc, errors)
        _check_input_filters(scope, loc, errors)
        _check_function_bindings(scope, loc, errors)
        view = stage.get("view")
        if isinstance(view, Mapping):
            _check_binding(f"{loc}.view.source", view.get("source"), scope, errors)
    return errors


def _items(container: Json, field: str) -> Sequence[Json]:
    value = container.get(field)
    if isinstance(value, list):
        return [item for item in value if isinstance(item, Mapping)]
    return []


def _find(items: Sequence[Json], key: str) -> Json | None:
    return next((item for item in items if item.get("key") == key), None)


def _check_unique_keys(items: Sequence[Json], loc: str, noun: str, errors: list[str]) -> None:
    seen: dict[str, int] = {}
    for index, item in enumerate(items):
        key = str(item.get("key"))
        previous = seen.get(key)
        if previous is None:
            seen[key] = index
        else:
            errors.append(
                f'{loc}[{index}].key: duplicate {noun} key "{key}" (already used by {loc}[{previous}])'
            )


def _check_target(scope: Scope, loc: str, errors: list[str]) -> None:
    fn = scope.stage.get("function")
    if not isinstance(fn, Mapping):
        return
    target = str(fn.get("target"))
    stage_key = scope.stage.get("key")
    input_ = _find(_items(scope.stage, "inputs"), target)
    if input_ is None:
        errors.append(f'{loc}.function.target: "{target}" is not an input of stage "{stage_key}"')
    elif input_.get("type") != "resource":
        errors.append(
            f'{loc}.function.target: "{target}" must be a "resource" input (it is "{input_.get("type")}")'
        )


def _check_input_filters(scope: Scope, loc: str, errors: list[str]) -> None:
    for index, input_ in enumerate(_items(scope.stage, "inputs")):
        filter_loc = f"{loc}.inputs[{index}].filter"
        filter_ = input_.get("filter")
        if not isinstance(filter_, Mapping):
            continue
        type_ = input_.get("type")
        if type_ in ("resource", "branch"):
            _check_binding(f"{filter_loc}.system", filter_.get("system"), scope, errors, _accept_system)
        if type_ == "stage_output":
            _check_binding(f"{filter_loc}.source", filter_.get("source"), scope, errors, _accept_output)
        options_by = filter_.get("options_by")
        if type_ in ("enum", "multi_enum") and isinstance(options_by, Mapping):
            own_key = input_.get("key")

            def accept_same_stage(_target: Target, parsed: ParsedBinding) -> str | None:
                if parsed.kind != "inputs":
                    return "must reference an input in the same stage ($inputs.<key>)"
                return "may not reference its own input" if parsed.key == own_key else None

            _check_binding(
                f"{filter_loc}.options_by.source", options_by.get("source"), scope, errors, accept_same_stage
            )


def _accept_system(target: Target, _parsed: ParsedBinding) -> str | None:
    if target.kind == "input" and target.input is not None and target.input.get("type") == "system":
        return None
    return 'must reference a "system" input'


def _accept_output(target: Target, _parsed: ParsedBinding) -> str | None:
    if target.kind == "output":
        return None
    return "must reference an earlier stage's output ($stages.<stage>.outputs.<key>)"


def _check_function_bindings(scope: Scope, loc: str, errors: list[str]) -> None:
    fn = scope.stage.get("function")
    if not isinstance(fn, Mapping):
        return
    fn_loc = f"{loc}.function"
    if is_binding(fn.get("name")):
        _check_binding(f"{fn_loc}.name", fn.get("name"), scope, errors, _accept_function_name)
    for name, value in _entries(fn.get("parameters")):
        if is_binding(value):
            _check_binding(member(f"{fn_loc}.parameters", name), value, scope, errors)
    for name, value in _entries(fn.get("sources")):
        _check_binding(member(f"{fn_loc}.sources", name), value, scope, errors, _accept_source)
    for name, value in _entries(fn.get("auth_bindings")):
        _check_binding(member(f"{fn_loc}.auth_bindings", name), value, scope, errors, _accept_auth)


def _entries(value: object) -> list[tuple[str, Any]]:
    return list(value.items()) if isinstance(value, Mapping) else []


def member(base: str, name: str) -> str:
    """``base.name`` for identifier-like names, ``base["weird name"]`` otherwise (as in bindings.ts)."""
    return f"{base}.{name}" if _MEMBER.match(name) else f"{base}[{json.dumps(name)}]"


def _accept_function_name(target: Target, _parsed: ParsedBinding) -> str | None:
    if target.kind == "input" and target.input is not None:
        if target.input.get("type") in FUNCTION_NAME_TYPES:
            return None
        return 'must reference an "enum" or "text" input'
    if target.kind == "output" and target.output is not None and target.output.get("type") == "text":
        return None
    return "must reference a text value"


def _accept_source(target: Target, _parsed: ParsedBinding) -> str | None:
    if target.kind == "output":
        return None
    if target.kind == "input" and target.input is not None and target.input.get("type") == "resource":
        return None
    return 'must reference a "resource" input or a stage output'


def _accept_auth(target: Target, _parsed: ParsedBinding) -> str | None:
    if target.kind == "input" and target.input is not None and target.input.get("type") == "auth_secret":
        return None
    return 'must reference an "auth_secret" input'


def _check_binding(
    loc: str, expr: object, scope: Scope, errors: list[str], accept: Accept | None = None
) -> None:
    """A field that must hold a binding: it parses, resolves in scope, and satisfies ``accept``."""
    if expr is None:
        return
    if not is_binding(expr):
        errors.append(f'{loc}: "{expr}" must be a binding ({BINDING_FORMS})')
        return
    assert isinstance(expr, str)
    resolved, problem = _resolve_reference(expr, scope)
    if resolved is None:
        errors.append(f"{loc}: {problem}")
        return
    target, parsed = resolved
    suffix = accept(target, parsed) if accept else None
    if suffix:
        errors.append(f'{loc}: "{expr}" {suffix}')


def _resolve_reference(expr: str, scope: Scope) -> tuple[tuple[Target, ParsedBinding] | None, str]:
    parsed = parse_binding(expr)
    if parsed is None:
        return None, f'"{expr}" is not a valid binding (expected {BINDING_FORMS})'
    if parsed.kind == "inputs":
        return _resolve_input(expr, parsed, scope.stage)
    stages = _items(scope.manifest, "stages")
    target_index = next((i for i, s in enumerate(stages) if s.get("key") == parsed.stage), -1)
    if target_index < 0:
        return None, f'"{expr}" does not resolve: no stage "{parsed.stage}"'
    if target_index == scope.index:
        return None, f'"{expr}" references its own stage; use $inputs.<key> for the current stage'
    if target_index > scope.index:
        later = f'stage "{parsed.stage}" (stages[{target_index}]), which comes after this stage'
        return None, f'"{expr}" references {later}'
    stage = stages[target_index]
    if parsed.key == "":
        return (Target(kind="section", stage=stage, section=parsed.section), parsed), ""
    if parsed.section == "inputs":
        return _resolve_input(expr, parsed, stage)
    output = _find(_items(stage, "outputs"), parsed.key)
    if output is None:
        return None, f'"{expr}" does not resolve: stage "{stage.get("key")}" declares no output "{parsed.key}"'
    return (Target(kind="output", stage=stage, output=output), parsed), ""


def _resolve_input(
    expr: str, parsed: ParsedBinding, stage: Json
) -> tuple[tuple[Target, ParsedBinding] | None, str]:
    input_ = _find(_items(stage, "inputs"), parsed.key)
    if input_ is None:
        return None, f'"{expr}" does not resolve: stage "{stage.get("key")}" has no input "{parsed.key}"'
    field_error = _check_fields(expr, input_, parsed.path)
    if field_error:
        return None, field_error
    return (Target(kind="input", stage=stage, input=input_), parsed), ""


def _check_fields(expr: str, input_: Json, path: tuple[str, ...]) -> str | None:
    if not path:
        return None
    type_ = str(input_.get("type"))
    if type_ in SCALAR_TYPES:
        return f'"{expr}": input "{input_.get("key")}" is a {type_} and has no fields'
    fields = VALUE_FIELDS.get(type_)
    if fields and path[0] not in fields:
        expected = ", ".join(f'"{f}"' for f in fields)
        return f'"{expr}": "{path[0]}" is not a field of a {type_} input (expected one of {expected})'
    return None
