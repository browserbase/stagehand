from __future__ import annotations

from collections.abc import Sequence
from typing import Literal, Self, cast

from ._generated.input_types import RgbaColor
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
    LocatorOperationParams,
    LocatorScrollToParams,
    LocatorScrollToResult,
    LocatorSelectOptionParams,
    LocatorSelectOptionResult,
    LocatorSendClickEventOptions,
    LocatorSendClickEventParams,
    LocatorSendClickEventResult,
    LocatorSetInputFilesParams,
    LocatorSetInputFilesResult,
    LocatorTextContentResult,
    LocatorTypeOptions,
    LocatorTypeParams,
    LocatorTypeResult,
    MouseButton,
)
from .file_upload import FileInput, normalize_file_input
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
        timeout: int | None = None,
    ) -> None:
        values = self._descriptor.model_dump(exclude_unset=True)
        options = LocatorClickOptions.model_validate({
            name: value
            for name, value in (
                ("button", button),
                ("click_count", click_count),
                ("timeout", timeout),
            )
            if value is not None
        })
        if options.model_fields_set:
            values["options"] = options
        await self._rpc_client.send(
            "locator.click",
            LocatorClickParams.model_validate(values),
            LocatorClickResult,
        )

    async def hover(self, *, timeout: int | None = None) -> None:
        await self._rpc_client.send(
            "locator.hover",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorHoverResult,
        )

    async def fill(self, value: str, *, timeout: int | None = None) -> None:
        await self._rpc_client.send(
            "locator.fill",
            LocatorFillParams.model_validate({
                **self._operation_values(timeout),
                "value": value,
            }),
            LocatorFillResult,
        )

    async def count(self, *, timeout: int | None = None) -> int:
        return await self._rpc_client.send(
            "locator.count",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorCountResult,
        )

    async def is_checked(self, *, timeout: int | None = None) -> bool:
        return await self._rpc_client.send(
            "locator.is_checked",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorIsCheckedResult,
        )

    async def input_value(self, *, timeout: int | None = None) -> str:
        return await self._rpc_client.send(
            "locator.input_value",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorInputValueResult,
        )

    async def is_visible(self, *, timeout: int | None = None) -> bool:
        return await self._rpc_client.send(
            "locator.is_visible",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorIsVisibleResult,
        )

    async def inner_text(self, *, timeout: int | None = None) -> str:
        return await self._rpc_client.send(
            "locator.inner_text",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorInnerTextResult,
        )

    async def inner_html(self, *, timeout: int | None = None) -> str:
        return await self._rpc_client.send(
            "locator.inner_html",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorInnerHtmlResult,
        )

    async def text_content(self, *, timeout: int | None = None) -> str:
        return await self._rpc_client.send(
            "locator.text_content",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorTextContentResult,
        )

    async def scroll_to(self, percent: float | str, *, timeout: int | None = None) -> None:
        await self._rpc_client.send(
            "locator.scroll_to",
            LocatorScrollToParams.model_validate({
                **self._operation_values(timeout),
                "percent": percent,
            }),
            LocatorScrollToResult,
        )

    async def centroid(self, *, timeout: int | None = None) -> LocatorCentroidResult:
        return await self._rpc_client.send(
            "locator.centroid",
            LocatorOperationParams.model_validate(self._operation_values(timeout)),
            LocatorCentroidResult,
        )

    async def highlight(
        self,
        *,
        duration_ms: int | None = None,
        border_color: RgbaColor | None = None,
        content_color: RgbaColor | None = None,
        timeout: int | None = None,
    ) -> None:
        values = self._descriptor.model_dump(exclude_unset=True)
        options = LocatorHighlightOptions.model_validate({
            name: value
            for name, value in (
                ("duration_ms", duration_ms),
                ("border_color", border_color),
                ("content_color", content_color),
                ("timeout", timeout),
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
        timeout: int | None = None,
    ) -> None:
        values = self._descriptor.model_dump(exclude_unset=True)
        options = LocatorSendClickEventOptions.model_validate({
            name: value
            for name, value in (
                ("bubbles", bubbles),
                ("cancelable", cancelable),
                ("composed", composed),
                ("detail", detail),
                ("timeout", timeout),
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

    async def type(
        self, text: str, *, delay: float | None = None, timeout: int | None = None
    ) -> None:
        values = {**self._operation_values(timeout), "text": text}
        options = LocatorTypeOptions.model_validate({
            name: value
            for name, value in (("delay", delay), ("timeout", timeout))
            if value is not None
        })
        if options.model_fields_set:
            values["options"] = options
        await self._rpc_client.send(
            "locator.type",
            LocatorTypeParams.model_validate(values),
            LocatorTypeResult,
        )

    async def select_option(
        self, values: str | Sequence[str], *, timeout: int | None = None
    ) -> list[str]:
        return await self._rpc_client.send(
            "locator.select_option",
            LocatorSelectOptionParams.model_validate({
                **self._operation_values(timeout),
                "values": list(values) if not isinstance(values, str) else values,
            }),
            LocatorSelectOptionResult,
        )

    async def set_input_files(
        self,
        files: FileInput | Sequence[FileInput],
        *,
        timeout: int | None = None,
    ) -> None:
        await self._rpc_client.send(
            "locator.set_input_files",
            LocatorSetInputFilesParams.model_validate({
                **self._operation_values(timeout),
                "files": normalize_file_input(files),
            }),
            LocatorSetInputFilesResult,
        )

    def _operation_values(self, timeout: int | None) -> dict[str, object]:
        values = self._descriptor.model_dump(exclude_unset=True)
        if timeout is not None:
            values["options"] = {"timeout": timeout}
        return cast(dict[str, object], values)

    def first(self) -> Self:
        return self.nth(0)

    def nth(self, index: int) -> Self:
        return type(self)(
            self._rpc_client,
            page_id=self.page_id,
            selector=self.selector,
            nth=index,
        )
