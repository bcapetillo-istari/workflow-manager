"""``wfm-manifest`` command line: check, publish, list.

Exit codes: 0 success, 1 the manifest (or a listed manifest) is invalid or an online check failed,
2 usage or environment error (bad arguments, missing env file, missing token, schema not found).
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from wfm_manifest import __version__
from wfm_manifest.istari import (
    Clients,
    EnvConfig,
    EnvError,
    _attr,
    baseline_branch,
    check_functions,
    load_env,
    make_clients,
    read_token,
    tracked_json_files,
)
from wfm_manifest.publish import publish
from wfm_manifest.schema import SchemaNotFoundError
from wfm_manifest.validate import ValidationResult, summary, validate_manifest, validator_for

log = logging.getLogger("wfm_manifest")

EXIT_OK = 0
EXIT_INVALID = 1
EXIT_USAGE = 2


class CliError(Exception):
    """A user-facing failure; the message is printed and the exit code returned."""

    def __init__(self, message: str, code: int = EXIT_USAGE) -> None:
        super().__init__(message)
        self.code = code


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="wfm-manifest", description="Validate and publish Workflow manifests.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging to stderr")
    parser.add_argument("--schema", type=Path, help="path to workflow-manifest.v1.json (default: repo schema/)")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="validate a manifest offline, optionally against an environment")
    check.add_argument("manifest", type=Path)
    check.add_argument("--env", type=Path, help="env.json with registry_url and system_id (token: $ISTARI_TOKEN)")
    check.set_defaults(func=cmd_check)

    pub = sub.add_parser("publish", help="validate, then publish to the workflow-manager system")
    pub.add_argument("manifest", type=Path)
    pub.add_argument("--env", type=Path, required=True)
    pub.add_argument("--name", help="resource file name (default <key>.json)")
    pub.add_argument("--dry-run", action="store_true", help="only report what would be created or revised")
    pub.set_defaults(func=cmd_publish)

    lst = sub.add_parser("list", help="list manifests in the system")
    lst.add_argument("--env", type=Path, required=True)
    lst.add_argument("--json", action="store_true", help="machine-readable output")
    lst.set_defaults(func=cmd_list)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    try:
        code: int = args.func(args)
        return code
    except (CliError, EnvError, SchemaNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return getattr(exc, "code", EXIT_USAGE)


# --- helpers ---------------------------------------------------------------------------------------


def load_manifest(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CliError(f"manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CliError(f"{path}: not valid JSON ({exc})", EXIT_INVALID) from exc


def check_offline(path: Path, schema_path: Path | None) -> tuple[ValidationResult, dict[str, Any]]:
    data = load_manifest(path)
    result = validate_manifest(data, validator_for(schema_path))
    return result, data if isinstance(data, dict) else {}


def print_errors(errors: Sequence[str]) -> None:
    for error in errors:
        print(f"ERROR {error}")


@dataclass(frozen=True)
class Environment:
    config: EnvConfig
    clients: Clients


def connect(env_path: Path) -> Environment:
    config = load_env(env_path)
    clients = make_clients(config, read_token())
    log.debug("connected to %s (system %s)", config.registry_url, config.system_id)
    return Environment(config=config, clients=clients)


# --- commands --------------------------------------------------------------------------------------


def cmd_check(args: argparse.Namespace) -> int:
    result, manifest = check_offline(args.manifest, args.schema)
    if not result.ok:
        print_errors(result.errors)
        print(f"{len(result.errors)} error(s)")
        return EXIT_INVALID
    if args.env is None:
        print(summary(manifest))
        return EXIT_OK
    env = connect(args.env)
    online = check_functions(env.clients.integrations, manifest)
    for warning in online.warnings:
        print(f"WARN {warning}")
    if online.errors:
        print_errors(online.errors)
        print(f"{len(online.errors)} error(s) against {env.config.registry_url}")
        return EXIT_INVALID
    print(f"{summary(manifest)}; functions verified against {env.config.registry_url}")
    return EXIT_OK


def cmd_publish(args: argparse.Namespace) -> int:
    result, manifest = check_offline(args.manifest, args.schema)
    if not result.ok:
        print_errors(result.errors)
        print(f"refusing to publish: {len(result.errors)} error(s)")
        return EXIT_INVALID
    env = connect(args.env)
    outcome = publish(env.clients.registry, env.config.system_id, manifest, args.name, dry_run=args.dry_run)
    print(outcome.to_json())
    return EXIT_OK


@dataclass(frozen=True)
class ManifestEntry:
    file_name: str
    resource_id: str
    key: str | None
    name: str | None
    version: str | None
    errors: list[str]

    @property
    def valid(self) -> bool:
        return not self.errors


def list_manifests(registry: Any, system_id: str, schema_path: Path | None) -> list[ManifestEntry]:
    validator = validator_for(schema_path)
    entries: list[ManifestEntry] = []
    for tracked in tracked_json_files(baseline_branch(registry, system_id)):
        file_name = str(_attr(tracked, "name"))
        resource_id = str(_attr(tracked, "resource_id"))
        try:
            data = tracked.read_json()
        except Exception as exc:  # noqa: BLE001 - one unreadable file must not hide the rest
            entries.append(ManifestEntry(file_name, resource_id, None, None, None, [f"unreadable: {exc}"]))
            continue
        result = validate_manifest(data, validator)
        fields: Mapping[str, Any] = data if isinstance(data, Mapping) else {}
        entries.append(
            ManifestEntry(
                file_name,
                resource_id,
                _as_str(fields.get("key")),
                _as_str(fields.get("name")),
                _as_str(fields.get("version")),
                result.errors,
            )
        )
    return entries


def _as_str(value: object) -> str | None:
    return None if value is None else str(value)


def cmd_list(args: argparse.Namespace) -> int:
    env = connect(args.env)
    entries = list_manifests(env.clients.registry, env.config.system_id, args.schema)
    if args.json:
        print(json.dumps([{**entry.__dict__, "valid": entry.valid} for entry in entries], indent=2))
    else:
        for entry in entries:
            status = "ok     " if entry.valid else "INVALID"
            print(f"{status} {entry.file_name}  {entry.resource_id}  key={entry.key} name={entry.name!r} version={entry.version}")
            for error in entry.errors:
                print(f"        {error}")
        print(f"{len(entries)} manifest(s), {sum(1 for e in entries if not e.valid)} invalid")
    return EXIT_INVALID if any(not e.valid for e in entries) else EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
