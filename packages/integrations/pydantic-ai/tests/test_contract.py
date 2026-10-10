import re
from pathlib import Path

import pytest
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

from agent import FACADE_AGENT_INSTRUCTIONS, PageReport, build_agent


def test_instructions_match_canonical_constant() -> None:
    """Pin the hand-copied prompt to the TS source of truth when in-repo."""
    contract = Path(__file__).parent / ".." / ".." / "core" / "src" / "facade" / "contract.ts"
    if not contract.is_file():
        pytest.skip("core contract.ts not present (example lifted out of the repo)")
    source = contract.read_text()
    match = re.search(r"FACADE_AGENT_INSTRUCTIONS = `([^`]+)`", source)
    assert match, "FACADE_AGENT_INSTRUCTIONS not found in contract.ts"
    normalize = lambda text: re.sub(r"\n{2,}", "\n", text.strip())  # noqa: E731
    assert normalize(FACADE_AGENT_INSTRUCTIONS) == normalize(match.group(1))


def test_agent_uses_test_model_without_live_provider() -> None:
    agent = build_agent(structured=False, model="test")
    with agent.override(model=TestModel()):
        result = agent.run_sync("Report the page title.")
    assert isinstance(result.output, str)
    assert result.output


def test_structured_output_uses_page_report_model() -> None:
    agent: Agent[None, PageReport] = build_agent(structured=True, model="test")  # type: ignore[assignment]
    with agent.override(model=TestModel()):
        result = agent.run_sync("Open https://example.com and report the title.")
    assert isinstance(result.output, PageReport)
    assert result.output.title
    assert result.output.url
    assert result.output.notes
