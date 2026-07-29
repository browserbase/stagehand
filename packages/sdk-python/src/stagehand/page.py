from __future__ import annotations

import base64
import builtins
from collections.abc import Mapping
from pathlib import Path
from typing import Self, TypeVar, cast, overload

from pydantic import JsonValue, TypeAdapter

from ._generated.input_types import (
    LoadState,
    PageClickOptions,
    PageDragAndDropOptions,
    PageHoverOptions,
    PageKeyPressOptions,
    PageNavigationOptions,
    PageReloadOptions,
    PageScrollOptions,
    PageSetViewportSizeOptions,
    PageSnapshotOptions,
    PageTypeOptions,
    PageWaitForSelectorOptions,
)
from ._generated.models import (
    PageAddInitScriptParams,
    PageClickParams,
    PageCloseResult,
    PageCoordinateResult,
    PageDragAndDropParams,
    PageDragAndDropResult,
    PageEvaluateParams,
    PageEvaluateResult,
    PageGoBackParams,
    PageGoForwardParams,
    PageGotoParams,
    PageHoverParams,
    PageIdParams,
    PageKeyPressParams,
    PageRef,
    PageReloadParams,
    PageScreenshotParams,
    PageScreenshotResult,
    PageScrollParams,
    PageSetExtraHTTPHeadersParams,
    PageSetViewportSizeParams,
    PageSnapshotParams,
    PageTitleResult,
    PageTypeParams,
    PageUrlResult,
    PageVoidResult,
    PageWaitForLoadStateParams,
    PageWaitForSelectorParams,
    PageWaitForSelectorResult,
    PageWaitForTimeoutParams,
    SnapshotResult,
)
from .client_types import ScreenshotOptions
from .locator import Locator
from .rpc_client import RPCClient

EvaluateResult = TypeVar("EvaluateResult")


class Page:
    def __init__(self, rpc_client: RPCClient, ref: PageRef) -> None:
        self._rpc_client = rpc_client
        self._ref = ref

    @property
    def page_id(self) -> str:
        return self._ref.page_id

    @property
    def ref(self) -> PageRef:
        return self._ref

    async def goto(
        self,
        url: str,
        options: PageNavigationOptions | None = None,
    ) -> Self:
        params = PageGotoParams.model_validate({
            "page_id": self.page_id,
            "url": url,
            **({"options": options} if options is not None else {}),
        })
        self._ref = await self._rpc_client.send("page.goto", params, PageRef)
        return self

    async def reload(
        self,
        options: PageReloadOptions | None = None,
    ) -> Self:
        params = PageReloadParams.model_validate({
            "page_id": self.page_id,
            **({"options": options} if options is not None else {}),
        })
        self._ref = await self._rpc_client.send("page.reload", params, PageRef)
        return self

    async def go_back(
        self,
        options: PageNavigationOptions | None = None,
    ) -> Self:
        params = PageGoBackParams.model_validate({
            "page_id": self.page_id,
            **({"options": options} if options is not None else {}),
        })
        self._ref = await self._rpc_client.send("page.go_back", params, PageRef)
        return self

    async def go_forward(
        self,
        options: PageNavigationOptions | None = None,
    ) -> Self:
        params = PageGoForwardParams.model_validate({
            "page_id": self.page_id,
            **({"options": options} if options is not None else {}),
        })
        self._ref = await self._rpc_client.send("page.go_forward", params, PageRef)
        return self

    async def click(
        self,
        x: float,
        y: float,
        options: PageClickOptions | None = None,
    ) -> str:
        params = PageClickParams.model_validate({
            "page_id": self.page_id,
            "x": x,
            "y": y,
            **({"options": options} if options is not None else {}),
        })
        result = await self._rpc_client.send("page.click", params, PageCoordinateResult)
        return result.xpath

    async def hover(
        self,
        x: float,
        y: float,
        options: PageHoverOptions | None = None,
    ) -> str:
        params = PageHoverParams.model_validate({
            "page_id": self.page_id,
            "x": x,
            "y": y,
            **({"options": options} if options is not None else {}),
        })
        result = await self._rpc_client.send("page.hover", params, PageCoordinateResult)
        return result.xpath

    async def scroll(
        self,
        x: float,
        y: float,
        delta_x: float,
        delta_y: float,
        options: PageScrollOptions | None = None,
    ) -> str:
        params = PageScrollParams.model_validate({
            "page_id": self.page_id,
            "x": x,
            "y": y,
            "delta_x": delta_x,
            "delta_y": delta_y,
            **({"options": options} if options is not None else {}),
        })
        result = await self._rpc_client.send("page.scroll", params, PageCoordinateResult)
        return result.xpath

    async def drag_and_drop(
        self,
        from_x: float,
        from_y: float,
        to_x: float,
        to_y: float,
        options: PageDragAndDropOptions | None = None,
    ) -> tuple[str, str]:
        params = PageDragAndDropParams.model_validate({
            "page_id": self.page_id,
            "from_x": from_x,
            "from_y": from_y,
            "to_x": to_x,
            "to_y": to_y,
            **({"options": options} if options is not None else {}),
        })
        result = await self._rpc_client.send(
            "page.drag_and_drop",
            params,
            PageDragAndDropResult,
        )
        return result.from_xpath, result.to_xpath

    async def type(
        self,
        text: str,
        options: PageTypeOptions | None = None,
    ) -> None:
        params = PageTypeParams.model_validate({
            "page_id": self.page_id,
            "text": text,
            **({"options": options} if options is not None else {}),
        })
        await self._rpc_client.send("page.type", params, PageVoidResult)

    async def key_press(
        self,
        key: str,
        options: PageKeyPressOptions | None = None,
    ) -> None:
        params = PageKeyPressParams.model_validate({
            "page_id": self.page_id,
            "key": key,
            **({"options": options} if options is not None else {}),
        })
        await self._rpc_client.send("page.key_press", params, PageVoidResult)

    @overload
    async def evaluate(self, expression: str) -> JsonValue: ...

    @overload
    async def evaluate(
        self,
        expression: str,
        *,
        result_type: builtins.type[EvaluateResult],
    ) -> EvaluateResult: ...

    async def evaluate(
        self,
        expression: str,
        *,
        result_type: builtins.type[EvaluateResult] | None = None,
    ) -> JsonValue | EvaluateResult:
        result = await self._rpc_client.send(
            "page.evaluate",
            PageEvaluateParams(page_id=self.page_id, expression=expression),
            PageEvaluateResult,
        )
        value = None if result.value is None else result.value.model_dump()
        if result_type is None:
            return cast(JsonValue, value)
        return TypeAdapter(result_type).validate_python(value, strict=True)

    async def add_init_script(self, source: str | Path) -> None:
        if isinstance(source, Path):
            source_url = str(source).replace("\n", "")
            script = f"{source.read_text()}\n//# sourceURL={source_url}"
        else:
            script = source
        await self._rpc_client.send(
            "page.add_init_script",
            PageAddInitScriptParams(page_id=self.page_id, source=script),
            PageVoidResult,
        )

    async def set_extra_http_headers(self, headers: Mapping[str, str]) -> None:
        await self._rpc_client.send(
            "page.set_extra_http_headers",
            PageSetExtraHTTPHeadersParams(page_id=self.page_id, headers=dict(headers)),
            PageVoidResult,
        )

    async def set_viewport_size(
        self,
        width: int,
        height: int,
        options: PageSetViewportSizeOptions | None = None,
    ) -> None:
        params = PageSetViewportSizeParams.model_validate({
            "page_id": self.page_id,
            "width": width,
            "height": height,
            **({"options": options} if options is not None else {}),
        })
        await self._rpc_client.send("page.set_viewport_size", params, PageVoidResult)

    async def wait_for_load_state(
        self,
        state: LoadState,
        timeout: int | None = None,
    ) -> None:
        params = PageWaitForLoadStateParams.model_validate({
            "page_id": self.page_id,
            "state": state,
        })
        if timeout is not None:
            params.timeout = timeout
        await self._rpc_client.send("page.wait_for_load_state", params, PageVoidResult)

    async def wait_for_timeout(self, ms: int) -> None:
        await self._rpc_client.send(
            "page.wait_for_timeout",
            PageWaitForTimeoutParams(page_id=self.page_id, ms=ms),
            PageVoidResult,
        )

    async def wait_for_selector(
        self,
        selector: str,
        options: PageWaitForSelectorOptions | None = None,
    ) -> bool:
        params = PageWaitForSelectorParams.model_validate({
            "page_id": self.page_id,
            "selector": selector,
            **({"options": options} if options is not None else {}),
        })
        result = await self._rpc_client.send(
            "page.wait_for_selector",
            params,
            PageWaitForSelectorResult,
        )
        return result.matched

    async def screenshot(
        self,
        options: ScreenshotOptions | None = None,
    ) -> bytes:
        protocol_options = dict(options or {})
        path = cast(str | Path | None, protocol_options.pop("path", None))
        mask = cast(list[Locator] | None, protocol_options.pop("mask", None))
        if mask is not None:
            protocol_options["mask"] = [locator.descriptor for locator in mask]
        params = PageScreenshotParams.model_validate({
            "page_id": self.page_id,
            **({"options": protocol_options} if protocol_options else {}),
        })
        result = await self._rpc_client.send(
            "page.screenshot",
            params,
            PageScreenshotResult,
        )
        data = base64.b64decode(result.data, validate=True)
        if path is not None:
            Path(path).write_bytes(data)
        return data

    async def snapshot(
        self,
        options: PageSnapshotOptions | None = None,
    ) -> SnapshotResult:
        params = PageSnapshotParams.model_validate({
            "page_id": self.page_id,
            **({"options": options} if options is not None else {}),
        })
        return await self._rpc_client.send("page.snapshot", params, SnapshotResult)

    async def url(self) -> str:
        return await self._rpc_client.send(
            "page.url",
            PageIdParams(page_id=self.page_id),
            PageUrlResult,
        )

    async def title(self) -> str:
        return await self._rpc_client.send(
            "page.title",
            PageIdParams(page_id=self.page_id),
            PageTitleResult,
        )

    async def close(self) -> None:
        await self._rpc_client.send(
            "page.close",
            PageIdParams(page_id=self.page_id),
            PageCloseResult,
        )

    def locator(self, selector: str) -> Locator:
        return Locator(self._rpc_client, page_id=self.page_id, selector=selector)
