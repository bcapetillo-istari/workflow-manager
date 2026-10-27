from __future__ import annotations

import pytest

from wfm_manifest.bindings import ParsedBinding, is_binding, parse_binding


@pytest.mark.parametrize("value", ["$inputs.x", "$stages.a.outputs", "$inputs.", "$stages."])
def test_is_binding_true(value: str) -> None:
    assert is_binding(value)


@pytest.mark.parametrize("value", ["literal", "$inputs", "$stages", "inputs.x", 1, None, True])
def test_is_binding_false(value: object) -> None:
    assert not is_binding(value)


def test_parse_inputs_forms() -> None:
    assert parse_binding("$inputs.file1") == ParsedBinding(kind="inputs", key="file1")
    assert parse_binding("$inputs.file1.revision_id") == ParsedBinding(
        kind="inputs", key="file1", path=("revision_id",)
    )


def test_parse_stages_forms() -> None:
    assert parse_binding("$stages.diff.outputs") == ParsedBinding(
        kind="stages", key="", stage="diff", section="outputs"
    )
    assert parse_binding("$stages.diff.outputs.report") == ParsedBinding(
        kind="stages", key="report", stage="diff", section="outputs"
    )
    assert parse_binding("$stages.review.inputs.llm.secret_id") == ParsedBinding(
        kind="stages", key="llm", path=("secret_id",), stage="review", section="inputs"
    )


@pytest.mark.parametrize(
    "expr",
    ["$inputs.", "$inputs..x", "$stages.diff", "$stages.diff.params.x", "$stages..outputs", "literal", "$inputs"],
)
def test_parse_malformed(expr: str) -> None:
    assert parse_binding(expr) is None
