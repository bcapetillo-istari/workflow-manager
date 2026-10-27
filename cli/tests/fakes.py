"""Fakes at the SDK boundary, shaped like the istari_digital_client objects the CLI touches."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class FakeRevision:
    id: str


@dataclass
class FakeResource:
    resource_id: str
    file_revision_id: str


@dataclass
class FakeTrackedFile:
    name: str
    resource_id: str
    extension: str = "json"
    content: Any = None

    def read_json(self) -> Any:
        if isinstance(self.content, Exception):
            raise self.content
        return self.content


@dataclass
class FakeBranch:
    tag: str = "baseline"
    is_baseline: bool = True
    snapshot_id: str = "snap-0"
    tracked: list[FakeTrackedFile] = field(default_factory=list)
    commits: list[list[Any]] = field(default_factory=list)

    def files(self, *, name: str | None = None) -> list[FakeTrackedFile]:
        return [t for t in self.tracked if name is None or name.lower() in t.name.lower()]

    def commit(self, *, add: list[Any] | None = None, remove: list[Any] | None = None) -> FakeBranch:
        self.commits.append(list(add or []))
        self.snapshot_id = f"snap-{len(self.commits)}"
        return self


@dataclass
class FakeSystem:
    branch_list: list[FakeBranch]

    def branches(self) -> list[FakeBranch]:
        return self.branch_list


class FakeSystems:
    def __init__(self, system: FakeSystem) -> None:
        self.system = system

    def get(self, system_id: str) -> FakeSystem:
        return self.system


class FakeRevisions:
    def __init__(self) -> None:
        self.created: list[tuple[str, Path, str | None]] = []

    def create(self, resource_id: str, path: str | Path, *, description: str | None = None) -> FakeRevision:
        self.created.append((resource_id, Path(path), description))
        return FakeRevision(id=f"rev-of-{resource_id}")

    def get(self, resource_id: str, revision_id: str) -> FakeRevision:
        return FakeRevision(id=revision_id)


class FakeResources:
    def __init__(self) -> None:
        self.revisions = FakeRevisions()
        self.created: list[tuple[Path, str, str | None, str]] = []

    def create(self, path: str | Path, resource_type: str, *, description: str | None = None) -> FakeResource:
        content = Path(path).read_text()
        self.created.append((Path(path), resource_type, description, content))
        return FakeResource(resource_id="res-new", file_revision_id="rev-new")


class FakeRegistry:
    def __init__(self, branch: FakeBranch) -> None:
        self.systems = FakeSystems(FakeSystem([FakeBranch(tag="feature", is_baseline=False), branch]))
        self.resources = FakeResources()


@dataclass
class FakeFunctionVersion:
    name: str
    version: str
    created: int = 0
    function_schema: Any = None


@dataclass
class FakeSchemaInput:
    key: str
    type: str
    optional: bool


@dataclass
class FakeSchema:
    inputs: list[FakeSchemaInput]


class FakeFunctions:
    def __init__(self, versions: list[FakeFunctionVersion]) -> None:
        self.versions = versions
        self.queries: list[str | None] = []

    def list(self, *, name: str | None = None) -> list[FakeFunctionVersion]:
        self.queries.append(name)
        return [v for v in self.versions if name is None or v.name == name]


class FakeIntegrations:
    def __init__(self, versions: list[FakeFunctionVersion]) -> None:
        self.functions = FakeFunctions(versions)
