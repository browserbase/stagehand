from __future__ import annotations

from collections.abc import Sequence
from typing import Literal, Self

from ._generated.models import (
    LocatorCentroidResult,
    LocatorClickOptions,
    LocatorClickParams,
    LocatorClickResult,
    LocatorCountResult,
    LocatorDescriptor,
    LocatorFillParams,
    LocatorFillResult,
    LocatorHighlightOptions,
    LocatorHighlightParams,
    LocatorHighlightResult,
    LocatorHoverResult,
    LocatorInnerHtmlResult,
    LocatorInnerTextResult,
    LocatorInputValueResult,
    LocatorIsCheckedResult,
    LocatorIsVisibleResult,
    LocatorScrollToParams,
    LocatorScrollToResult,
    LocatorSelectOptionParams,
    LocatorSelectOptionResult,
    LocatorSendClickEventOptions,
    LocatorSendClickEventParams,
    LocatorSendClickEventResult,
    LocatorTextContentResult,
    LocatorTypeOptions,
    LocatorTypeParams,
    LocatorTypeResult,
    MouseButton,
    RgbaColor,
)
from .rpc_client import RPCClient


class Locator:
    def __init__(
        self,
        rpc_client: RPCClient,
        *,
        page_id: str,
        selector: str,
        nth: int | None = None,
    ) -> None:
        self._rpc_client = rpc_client
        self._descriptor = LocatorDescriptor(page_id=page_id, selector=selector)
        if nth is not None:
            self._descriptor.nth = nth

    @property
    def page_id(self) -> str:
        return self._descriptor.page_id

    @property
    def selector(self) -> str:
        return self._descriptor.selector

    @property
    def nth_index(self) -> int | None:
        return self._descriptor.nth

    @property
    def descriptor(self) -> LocatorDescriptor:
        return self._descriptor

    async def click(
        self,
        *,
        button: MouseButton | Literal["left", "right", "middle"] | None = None,
        click_count: int | None = None,
    ) -> None:
        values = self._descriptor.model_dump(exclude_unset=True)
        options = LocatorClickOptions.model_validate({
            name: value
            for name, value in (("button", button), ("click_count", click_count))
            if value is not None
        })
        if options.model_fields_set:
            values["options"] = options
        await self._rpc_client.send(
            "locator.click",
            LocatorClickParams.model_validate(values),
            LocatorClickResult,
        )

    async def hover(self) -> None:
        await self._rpc_client.send(
            "locator.hover",
            self._descriptor,
            LocatorHoverResult,
        )

    async def fill(self, value: str) -> None:
        await self._rpc_client.send(
            "locator.fill",
            LocatorFillParams.model_validate({
                **self._descriptor.model_dump(exclude_unset=True),
                "value": value,
            }),
            LocatorFillResult,
        )

    async def count(self) -> int:
        result = await self._rpc_client.send(
            "locator.count",
            self._descriptor,
            LocatorCountResult,
        )
        return result.count

    async def is_checked(self) -> bool:
        result = await self._rpc_client.send(
            "locator.is_checked",
            self._descriptor,
            LocatorIsCheckedResult,
        )
        return result.checked

    async def input_value(self) -> str:
        result = await self._rpc_client.send(
            "locator.input_value",
            self._descriptor,
            LocatorInputValueResult,
        )
        return result.value

    async def is_visible(self) -> bool:
        result = await self._rpc_client.send(
            "locator.is_visible",
            self._descriptor,
            LocatorIsVisibleResult,
        )
        return result.visible

    async def inner_text(self) -> str:
        result = await self._rpc_client.send(
            "locator.inner_text",
            self._descriptor,
            LocatorInnerTextResult,
        )
        return result.text

    async def inner_html(self) -> str:
        result = await self._rpc_client.send(
            "locator.inner_html",
            self._descriptor,
            LocatorInnerHtmlResult,
        )
        return result.html

    async def text_content(self) -> str:
        result = await self._rpc_client.send(
            "locator.text_content",
            self._descriptor,
            LocatorTextContentResult,
        )
        return result.text_content

    async def scroll_to(self, percent: float | str) -> None:
        await self._rpc_client.send(
            "locator.scroll_to",
            LocatorScrollToParams.model_validate({
                **self._descriptor.model_dump(exclude_unset=True),
                "percent": percent,
            }),
            LocatorScrollToResult,
        )

    async def centroid(self) -> LocatorCentroidResult:
        return await self._rpc_client.send(
            "locator.centroid",
            self._descriptor,
            LocatorCentroidResult,
        )

    async def highlight(
        self,
        *,
        duration_ms: int | None = None,
        border_color: RgbaColor | None = None,
        content_color: RgbaColor | None = None,
    ) -> None:
        values = self._descriptor.model_dump(exclude_unset=True)
        options = LocatorHighlightOptions.model_validate({
            name: value
            for name, value in (
                ("duration_ms", duration_ms),
                ("border_color", border_color),
                ("content_color", content_color),
            )
            if value is not None
        })
        if options.model_fields_set:
            values["options"] = options
        await self._rpc_client.send(
            "locator.highlight",
            LocatorHighlightParams.model_validate(values),
            LocatorHighlightResult,
        )

    async def send_click_event(
        self,
        *,
        bubbles: bool | None = None,
        cancelable: bool | None = None,
        composed: bool | None = None,
        detail: float | None = None,
    ) -> None:
        values = self._descriptor.model_dump(exclude_unset=True)
        options = LocatorSendClickEventOptions.model_validate({
            name: value
            for name, value in (
                ("bubbles", bubbles),
                ("cancelable", cancelable),
                ("composed", composed),
                ("detail", detail),
            )
            if value is not None
        })
        if options.model_fields_set:
            values["options"] = options
        await self._rpc_client.send(
            "locator.send_click_event",
            LocatorSendClickEventParams.model_validate(values),
            LocatorSendClickEventResult,
        )

    async def type(self, text: str, *, delay: float | None = None) -> None:
        values = {**self._descriptor.model_dump(exclude_unset=True), "text": text}
        if delay is not None:
            values["options"] = LocatorTypeOptions(delay=delay)
        await self._rpc_client.send(
            "locator.type",
            LocatorTypeParams.model_validate(values),
            LocatorTypeResult,
        )

    async def select_option(self, values: str | Sequence[str]) -> list[str]:
        result = await self._rpc_client.send(
            "locator.select_option",
            LocatorSelectOptionParams.model_validate({
                **self._descriptor.model_dump(exclude_unset=True),
                "values": list(values) if not isinstance(values, str) else values,
            }),
            LocatorSelectOptionResult,
        )
        return result.values

    def first(self) -> Self:
        return self.nth(0)

    def nth(self, index: int) -> Self:
        return type(self)(
            self._rpc_client,
            page_id=self.page_id,
            selector=self.selector,
            nth=index,
        )
