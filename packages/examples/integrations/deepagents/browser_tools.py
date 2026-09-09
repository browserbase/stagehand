from __future__ import annotations

import asyncio
import json
import os
import re
from typing import Any

from browserbase import Browserbase
from bs4 import BeautifulSoup
from langchain.tools import tool
from stagehand import AsyncStagehand

# Using the Browserbase Model Gateway, you only need to pass your Browserbase API key to use frontier models
# Docs: https://docs.browserbase.com/platform/model-gateway/overview

DEFAULT_STAGEHAND_MODEL = os.getenv(
    "STAGEHAND_MODEL",
    "google/gemini-3-flash-preview",
)
DEFAULT_STAGEHAND_AGENT_MODEL = os.getenv(
    "STAGEHAND_AGENT_MODEL",
    "anthropic/claude-sonnet-4-6",
)


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def _browserbase_client() -> Browserbase:
    return Browserbase(api_key=_require_env("BROWSERBASE_API_KEY"))


def _normalize(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _normalize(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_normalize(item) for item in value]
    if hasattr(value, "model_dump"):
        return _normalize(value.model_dump())
    if hasattr(value, "dict"):
        return _normalize(value.dict())
    if hasattr(value, "__dict__"):
        public = {
            key: val
            for key, val in vars(value).items()
            if not key.startswith("_") and not callable(val)
        }
        if public:
            return _normalize(public)
    return str(value)


def _json(value: Any) -> str:
    return json.dumps(_normalize(value), indent=2, default=str)


def _html_to_text(html: str, max_chars: int) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    body = soup.body or soup
    text = body.get_text("\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return title, text[:max_chars]


def _stagehand_client() -> AsyncStagehand:
    return AsyncStagehand(
        browserbase_api_key=_require_env("BROWSERBASE_API_KEY"),
    )


def _run_async(coro: Any) -> Any:
    return asyncio.run(coro)


@tool
def browserbase_search(query: str, num_results: int = 5) -> str:
    """Search the web with Browserbase. Use this first for discovery before opening pages."""
    bb = _browserbase_client()
    response = bb.search.web(query=query, num_results=max(1, min(num_results, 10)))
    results = []
    for result in getattr(response, "results", []):
        results.append(
            {
                "title": getattr(result, "title", ""),
                "url": getattr(result, "url", ""),
                "author": getattr(result, "author", None),
                "published_date": (
                    getattr(result, "published_date", None)
                    or getattr(result, "publishedDate", None)
                ),
            }
        )
    return _json(
        {
            "query": query,
            "request_id": getattr(response, "request_id", None)
            or getattr(response, "requestId", None),
            "results": results,
        }
    )


@tool
def browserbase_fetch(
    url: str,
    format: str = "markdown",
    schema: str = "",
    use_proxy: bool = False,
    allow_redirects: bool = False,
    allow_insecure_ssl: bool = False,
    max_chars: int = 12000,
) -> str:
    """Fetch page content without a browser session. Best for static pages and quick reads."""
    bb = _browserbase_client()
    normalized_format = format.strip().lower() or "markdown"
    if normalized_format not in {"raw", "markdown", "json"}:
        raise ValueError("format must be one of: raw, markdown, json")

    parsed_schema: dict[str, Any] | None = None
    if schema.strip():
        try:
            loaded_schema = json.loads(schema)
        except json.JSONDecodeError as exc:
            raise ValueError("schema must be valid JSON") from exc
        if not isinstance(loaded_schema, dict):
            raise ValueError("schema must decode to a JSON object")
        parsed_schema = loaded_schema

    if normalized_format == "json" and parsed_schema is None:
        raise ValueError("schema is required when format='json'")
    if normalized_format != "json" and parsed_schema is not None:
        raise ValueError("schema can only be used when format='json'")

    request: dict[str, Any] = {
        "url": url,
        "format": normalized_format,
        "proxies": use_proxy,
        "allow_redirects": allow_redirects,
        "allow_insecure_ssl": allow_insecure_ssl,
    }
    if parsed_schema is not None:
        request["schema"] = parsed_schema

    response = bb.fetch_api.create(**request)
    content = getattr(response, "content", "")
    content_type = (
        getattr(response, "content_type", None)
        or getattr(response, "contentType", "")
        or ""
    ).lower()

    title = ""
    text = ""
    structured_content: Any = None

    if normalized_format == "json":
        structured_content = _normalize(content)
    else:
        text = str(content)[:max_chars]
        if normalized_format == "raw" and "html" in content_type:
            title, text = _html_to_text(str(content), max_chars=max_chars)

    return _json(
        {
            "url": url,
            "format": normalized_format,
            "schema": parsed_schema,
            "used_proxy": use_proxy,
            "allow_redirects": allow_redirects,
            "allow_insecure_ssl": allow_insecure_ssl,
            "status_code": getattr(response, "status_code", None)
            or getattr(response, "statusCode", None),
            "headers": getattr(response, "headers", None),
            "content_type": getattr(response, "content_type", None)
            or getattr(response, "contentType", None),
            "encoding": getattr(response, "encoding", None),
            "title": title,
            "text": text,
            "content": structured_content,
        }
    )


@tool
def browserbase_rendered_extract(start_url: str, instruction: str) -> str:
    """Open a full Browserbase browser session and extract rendered content from a page with Stagehand."""
    return _run_async(_browserbase_rendered_extract_async(start_url=start_url, instruction=instruction))


async def _browserbase_rendered_extract_async(start_url: str, instruction: str) -> str:
    client = _stagehand_client()
    start_resp = await client.sessions.start(
        model_name=DEFAULT_STAGEHAND_MODEL,
    )
    session_id = start_resp.data.session_id

    try:
        await client.sessions.navigate(
            id=session_id,
            url=start_url,
            frame_id="",
        )
        result = await client.sessions.extract(
            id=session_id,
            instruction=instruction,
        )
        extracted = getattr(getattr(result, "data", None), "result", None)
        return _json(
            {
                "start_url": start_url,
                "session_id": session_id,
                "session_url": f"https://browserbase.com/sessions/{session_id}",
                "instruction": instruction,
                "result": _normalize(extracted),
            }
        )
    finally:
        await client.sessions.end(id=session_id)


@tool
def browserbase_interactive_task(start_url: str, task: str) -> str:
    """Open a Browserbase-hosted Stagehand session and let a Stagehand agent execute a multi-step browser task."""
    return _run_async(_browserbase_interactive_task_async(start_url=start_url, task=task))


async def _browserbase_interactive_task_async(start_url: str, task: str) -> str:
    client = _stagehand_client()
    start_resp = await client.sessions.start(
        model_name=DEFAULT_STAGEHAND_AGENT_MODEL,
    )
    session_id = start_resp.data.session_id

    try:
        await client.sessions.navigate(
            id=session_id,
            url=start_url,
            frame_id="",
        )
        result = await client.sessions.execute(
            id=session_id,
            execute_options={
                "instruction": task,
                "max_steps": 20,
            },
            agent_config={
                "model": DEFAULT_STAGEHAND_AGENT_MODEL,
                "instructions": (
                    "You are executing a browser task on behalf of a LangChain tool. "
                    "Be precise, avoid unnecessary actions, and stop once the requested task is complete."
                ),
            },
            timeout=300.0,
        )
        return _json(_normalize(result))
    finally:
        await client.sessions.end(id=session_id)
