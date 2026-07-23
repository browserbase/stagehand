from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from ._generated.models import (
    ContextClipboardPasteParams,
    ContextClipboardReadTextResult,
    ContextClipboardTarget,
    ContextClipboardWriteTextParams,
    ContextVoidResult,
    Shortcut,
)
from .rpc_client import RPCClient

if TYPE_CHECKING:
    from .page import Page


class BrowserClipboard:
    def __init__(self, rpc_client: RPCClient) -> None:
        self._rpc_client = rpc_client

    async def read_text(self, *, page: Page | None = None) -> str:
        result = await self._rpc_client.send(
            "context.clipboard_read_text",
            _clipboard_target(page),
            ContextClipboardReadTextResult,
        )
        return result.text

    async def write_text(self, text: str, *, page: Page | None = None) -> None:
        params = ContextClipboardWriteTextParams(text=text)
        if page is not None:
            params.page_id = page.page_id
        await self._rpc_client.send(
            "context.clipboard_write_text",
            params,
            ContextVoidResult,
        )

    async def clear(self, *, page: Page | None = None) -> None:
        await self._rpc_client.send(
            "context.clipboard_clear",
            _clipboard_target(page),
            ContextVoidResult,
        )

    async def paste(
        self,
        *,
        page: Page | None = None,
        shortcut: Shortcut | Literal["ControlOrMeta+V", "Meta+V", "Control+V"] | None = None,
    ) -> None:
        params = ContextClipboardPasteParams()
        if page is not None:
            params.page_id = page.page_id
        if shortcut is not None:
            params = ContextClipboardPasteParams.model_validate({
                **params.model_dump(exclude_unset=True),
                "shortcut": shortcut,
            })
        await self._rpc_client.send(
            "context.clipboard_paste",
            params,
            ContextVoidResult,
        )

    async def copy(self, *, page: Page | None = None) -> None:
        await self._rpc_client.send(
            "context.clipboard_copy",
            _clipboard_target(page),
            ContextVoidResult,
        )

    async def cut(self, *, page: Page | None = None) -> None:
        await self._rpc_client.send(
            "context.clipboard_cut",
            _clipboard_target(page),
            ContextVoidResult,
        )


def _clipboard_target(page: Page | None) -> ContextClipboardTarget:
    return (
        ContextClipboardTarget() if page is None else ContextClipboardTarget(page_id=page.page_id)
    )
