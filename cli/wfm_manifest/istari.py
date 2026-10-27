"""Istari SDK boundary: environment config, client construction, and the online checks.

Everything that talks to the registry goes through here so tests can substitute fakes. The token is
read from ``ISTARI_TOKEN`` and is never logged or printed.
"""

from __future__ import annotations

import json
import logging
import os
import warnings
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from wfm_manifest.bindings import is_binding, parse_binding

log = logging.getLogger(__name__)

TOKEN_ENV_VAR = "ISTARI_TOKEN"


class EnvConfig(BaseModel):
    """Contents of an ``--env`` file: where the workflow-manager system lives."""

    model_config = ConfigDict(extra="ignore")

    registry_url: str = Field(min_length=1)
    system_id: str = Field(min_length=1)


class EnvError(RuntimeError):
    """Bad env file or missing token."""


def load_env(path: Path) -> EnvConfig:
    try:
        return EnvConfig.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError as exc:
        raise EnvError(f"env file not found: {path}") from exc
    except (json.JSONDecodeError, ValidationError) as exc:
        raise EnvError(f"invalid env file {path}: {exc}") from exc


def read_token() -> str:
    token = os.environ.get(TOKEN_ENV_VAR)
    if not token:
        raise EnvError(f"{TOKEN_ENV_VAR} is not set")
    return token


def suppress_sdk_warnings() -> None:
    """The SDK warns once per session about registry/SDK version skew; that is noise for this tool."""
    warnings.filterwarnings("ignore", message=r".*Istari Registry.*")
    logging.getLogger("istari.compatibility").setLevel(logging.ERROR)


@dataclass(frozen=True)
class Clients:
    registry: Any
    integrations: Any


def make_clients(env: EnvConfig, token: str) -> Clients:
    """Builds the registry and integrations clients lazily, so offline commands never import the SDK."""
    from istari_digital_client import Configuration  # noqa: PLC0415
    from istari_digital_client.sdk import Istari, IstariIntegrations  # noqa: PLC0415

    suppress_sdk_warnings()
    config = Configuration(registry_url=env.registry_url, registry_auth_token=token)
    return Clients(registry=Istari(config), integrations=IstariIntegrations(config))


# --- function checks -------------------------------------------------------------------------------


class FunctionsApi(Protocol):
    def list(self, *, name: str | None = None) -> Iterable[Any]: ...


@dataclass(frozen=True)
class FunctionCheck:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class FunctionInput:
    key: str
    type: str
    optional: bool


def check_functions(integrations: Any, manifest: Mapping[str, Any]) -> FunctionCheck:
    """For every job stage: the function exists, the pinned version exists, required inputs are covered.

    When ``function.name`` is a binding, every literal option value of the referenced enum input is
    checked; other bindings (text inputs, stage outputs) cannot be verified ahead of time.
    """
    errors: list[str] = []
    warns: list[str] = []
    for index, stage in enumerate(manifest.get("stages") or []):
        fn = stage.get("function")
        if not isinstance(fn, Mapping):
            continue
        loc = f"stages[{index}].function"
        names = candidate_function_names(stage, fn)
        if names is None:
            warns.append(f'{loc}.name: skipped function check ("{fn.get("name")}" is only known at runtime)')
            continue
        for name in names:
            _check_one_function(integrations, loc, name, fn, errors, warns)
    return FunctionCheck(errors=errors, warnings=warns)


def candidate_function_names(stage: Mapping[str, Any], fn: Mapping[str, Any]) -> list[str] | None:
    """Literal name, or the literal option values of the bound enum input; None when unknowable."""
    raw = fn.get("name")
    if not is_binding(raw):
        return [str(raw)]
    parsed = parse_binding(str(raw))
    if parsed is None or parsed.kind != "inputs" or parsed.path:
        return None
    inputs = [i for i in stage.get("inputs") or [] if isinstance(i, Mapping)]
    input_ = next((i for i in inputs if i.get("key") == parsed.key), None)
    if input_ is None or input_.get("type") != "enum":
        return None
    filter_ = input_.get("filter") or {}
    options = list(filter_.get("options") or [])
    options_by = filter_.get("options_by") or {}
    for group in (options_by.get("groups") or {}).values():
        options.extend(group or [])
    values = [str(o.get("value")) for o in options if isinstance(o, Mapping) and o.get("value") is not None]
    return sorted(set(values)) if values else None


def _check_one_function(
    integrations: Any, loc: str, name: str, fn: Mapping[str, Any], errors: list[str], warns: list[str]
) -> None:
    version = fn.get("version")
    log.debug("looking up function %s version %s", name, version)
    versions = _list_versions(integrations.functions, name)
    if not versions:
        errors.append(f'{loc}.name: function "{name}" does not exist in this environment')
        return
    if version is not None:
        matching = [v for v in versions if _attr(v, "version") == version]
        if not matching:
            known = ", ".join(sorted({str(_attr(v, "version")) for v in versions}))
            errors.append(f'{loc}.version: function "{name}" has no version "{version}" (known: {known})')
            return
    else:
        matching = [_latest(versions)]
    inputs = _function_inputs(integrations, matching[0])
    if inputs is None:
        warns.append(f'{loc}: skipped required-input check for "{name}" (function schema not available)')
        return
    errors.extend(_uncovered_inputs(loc, name, fn, inputs))


def _list_versions(functions: FunctionsApi, name: str) -> list[Any]:
    # The list endpoint matches the exact qualified name and returns one entry per function version.
    return [item for item in functions.list(name=name) if _attr(item, "name") == name]


def _attr(obj: Any, name: str) -> Any:
    """Reads a field from an SDK object or dict; the DTOs may carry fields the model does not declare."""
    if obj is None:
        return None
    if isinstance(obj, Mapping):
        return obj.get(name)
    try:
        value = getattr(obj, name, None)
    except Exception:  # noqa: BLE001 - pydantic/SDK proxies may raise on unknown attributes
        value = None
    if value is None and hasattr(obj, "__dict__"):
        value = vars(obj).get(name)
    return value


def _latest(versions: Sequence[Any]) -> Any:
    return max(versions, key=lambda v: (_attr(v, "created") is not None, _attr(v, "created") or 0))


def _function_inputs(integrations: Any, version: Any) -> list[FunctionInput] | None:
    """Reads the function's input schema; None when the SDK cannot provide it."""
    schema = _attr(version, "function_schema")
    if isinstance(schema, str):
        schema = _fetch_schema(integrations, schema)
    raw_inputs = _attr(schema, "inputs") if schema is not None else None
    if not isinstance(raw_inputs, list):
        return None
    return [
        FunctionInput(
            key=str(_attr(item, "key")),
            type=str(getattr(_attr(item, "type"), "value", _attr(item, "type"))),
            optional=bool(_attr(item, "optional")),
        )
        for item in raw_inputs
    ]


def _fetch_schema(integrations: Any, schema_id: str) -> Any:
    """The public SDK surface exposes only the schema id; the generated v2 API can expand it."""
    engine = getattr(getattr(integrations, "functions", None), "_engine", None)
    getter = getattr(getattr(engine, "v2_api", None), "get_function_schema", None)
    if getter is None:
        return None
    try:
        return getter(schema_id)
    except Exception as exc:  # noqa: BLE001 - any SDK failure degrades to a warning
        log.debug("function schema %s not fetched: %s", schema_id, exc)
        return None


def _uncovered_inputs(
    loc: str, name: str, fn: Mapping[str, Any], inputs: Sequence[FunctionInput]
) -> list[str]:
    """``target`` covers the first required user_model input; parameters, sources and auth_bindings
    cover everything else by function input key."""
    provided: set[str] = set()
    for section in ("parameters", "sources", "auth_bindings"):
        value = fn.get(section)
        if isinstance(value, Mapping):
            provided.update(str(k) for k in value)
    required = [i for i in inputs if not i.optional]
    models = [i for i in required if i.type == "user_model"]
    covered_by_target = {models[0].key} if models else set()
    errors: list[str] = []
    for item in required:
        if item.key in covered_by_target or item.key in provided:
            continue
        errors.append(
            f'{loc}.parameters: function "{name}" requires input "{item.key}" ({item.type}), '
            f"which is not covered by target, parameters, sources or auth_bindings"
        )
    return errors


# --- listing ---------------------------------------------------------------------------------------


class ManifestListingError(RuntimeError):
    pass


def baseline_branch(registry: Any, system_id: str) -> Any:
    system = registry.systems.get(system_id)
    branch = next((b for b in system.branches() if _attr(b, "is_baseline")), None)
    if branch is None:
        raise ManifestListingError(f"system {system_id} has no baseline branch")
    return branch


def tracked_json_files(branch: Any) -> list[Any]:
    files = []
    for tracked in branch.files():
        name = str(_attr(tracked, "name") or "")
        extension = str(_attr(tracked, "extension") or "").lower()
        if extension == "json" or name.lower().endswith(".json"):
            files.append(tracked)
    return files
