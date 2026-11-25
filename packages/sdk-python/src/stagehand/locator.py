from __future__ import annotations

from collections.abc import Sequence
from typing import Literal, Self

from ._generated.input_types import AriaRole, LocatorQueryStep, RgbaColor
from ._generated.input_types import LocatorStep as LocatorStepInput
from ._generated.models import (
    ChainLocatorDescriptor,
    LocatorCentroidResult,
    LocatorChain,
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
    LocatorParams,
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
from ._locator_selectors import locator_steps, role_query_step, text_query_step
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
        self._chain: LocatorChain | None = None
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
    def descriptor(self) -> LocatorDescriptor | ChainLocatorDescriptor:
        if self._chain is not None:
            return ChainLocatorDescriptor(
                page_id=self.page_id, chain=self._chain.model_copy(deep=True)
            )
        return self._descriptor

    async def click(
        self,
        *,
        button: MouseButton | Literal["left", "right", "middle"] | None = None,
        click_count: int | None = None,
        timeout: float | None = None,
    ) -> None:
        values = self._params(timeout)
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

    async def hover(self, *, timeout: float | None = None) -> None:
        await self._rpc_client.send(
            "locator.hover",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorHoverResult,
        )

    async def fill(self, value: str, *, timeout: float | None = None) -> None:
        await self._rpc_client.send(
            "locator.fill",
            LocatorFillParams.model_validate({
                **self._params(timeout),
                "value": value,
            }),
            LocatorFillResult,
        )

    async def count(self, *, timeout: float | None = None) -> int:
        return await self._rpc_client.send(
            "locator.count",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorCountResult,
        )

    async def is_checked(self, *, timeout: float | None = None) -> bool:
        return await self._rpc_client.send(
            "locator.is_checked",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorIsCheckedResult,
        )

    async def input_value(self, *, timeout: float | None = None) -> str:
        return await self._rpc_client.send(
            "locator.input_value",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorInputValueResult,
        )

    async def is_visible(self, *, timeout: float | None = None) -> bool:
        return await self._rpc_client.send(
            "locator.is_visible",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorIsVisibleResult,
        )

    async def inner_text(self, *, timeout: float | None = None) -> str:
        return await self._rpc_client.send(
            "locator.inner_text",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorInnerTextResult,
        )

    async def inner_html(self, *, timeout: float | None = None) -> str:
        return await self._rpc_client.send(
            "locator.inner_html",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorInnerHtmlResult,
        )

    async def text_content(self, *, timeout: float | None = None) -> str:
        return await self._rpc_client.send(
            "locator.text_content",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorTextContentResult,
        )

    async def scroll_to(self, percent: float | str, *, timeout: float | None = None) -> None:
        await self._rpc_client.send(
            "locator.scroll_to",
            LocatorScrollToParams.model_validate({
                **self._params(timeout),
                "percent": percent,
            }),
            LocatorScrollToResult,
        )

    async def centroid(self, *, timeout: float | None = None) -> LocatorCentroidResult:
        return await self._rpc_client.send(
            "locator.centroid",
            LocatorParams.model_validate(self._params(timeout)),
            LocatorCentroidResult,
        )

    async def highlight(
        self,
        *,
        duration_ms: int | None = None,
        border_color: RgbaColor | None = None,
        content_color: RgbaColor | None = None,
        timeout: float | None = None,
    ) -> None:
        values = self._params(timeout)
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
        timeout: float | None = None,
    ) -> None:
        values = self._params(timeout)
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
        self, text: str, *, delay: float | None = None, timeout: float | None = None
    ) -> None:
        values = {**self._params(timeout), "text": text}
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
        self, values: str | Sequence[str], *, timeout: float | None = None
    ) -> list[str]:
        return await self._rpc_client.send(
            "locator.select_option",
            LocatorSelectOptionParams.model_validate({
                **self._params(timeout),
                "values": list(values) if not isinstance(values, str) else values,
            }),
            LocatorSelectOptionResult,
        )

    async def set_input_files(
        self,
        files: FileInput | Sequence[FileInput],
        *,
        timeout: float | None = None,
    ) -> None:
        await self._rpc_client.send(
            "locator.set_input_files",
            LocatorSetInputFilesParams.model_validate({
                **self._params(timeout),
                "files": normalize_file_input(files),
            }),
            LocatorSetInputFilesResult,
        )

    def _params(self, timeout: float | None) -> dict[str, object]:
        values: dict[str, object] = self.descriptor.model_dump(
            exclude_none=True, exclude_unset=True
        )
        if timeout is not None:
            values["options"] = {"timeout": timeout}
        return values

    def first(self) -> Self:
        return self.nth(0)

    def nth(self, index: int) -> Self:
        child = type(self)(
            self._rpc_client,
            page_id=self.page_id,
            selector=self.selector,
            nth=index,
        )
        if self._chain is not None:
            child._chain = LocatorChain.model_validate({
                "steps": [
                    *self._chain.model_dump(exclude_unset=True)["steps"],
                    {"type": "nth", "index": index},
                ]
            })
        return child

    def locator(self, selector: str) -> Self:
        return self._append_steps(locator_steps(selector), selector)

    def get_by_text(self, text: str, *, exact: bool = False) -> Self:
        return self._append_steps([text_query_step(text, exact)], self.selector)

    def get_by_role(
        self,
        role: AriaRole,
        *,
        name: str | None = None,
        exact: bool = False,
        checked: bool | Literal["mixed"] | None = None,
        pressed: bool | Literal["mixed"] | None = None,
        selected: bool | None = None,
        expanded: bool | None = None,
        disabled: bool | None = None,
        level: int | None = None,
    ) -> Self:
        return self._append_steps(
            [
                role_query_step(
                    role,
                    name=name,
                    exact=exact,
                    checked=checked,
                    pressed=pressed,
                    selected=selected,
                    expanded=expanded,
                    disabled=disabled,
                    level=level,
                )
            ],
            self.selector,
        )

    @classmethod
    def _from_query(cls, rpc_client: RPCClient, page_id: str, step: LocatorQueryStep) -> Self:
        child = cls(rpc_client, page_id=page_id, selector="*")
        child._chain = LocatorChain.model_validate({"steps": [step]})
        return child

    @classmethod
    def _from_text(cls, rpc_client: RPCClient, page_id: str, text: str, exact: bool) -> Self:
        return cls._from_query(rpc_client, page_id, text_query_step(text, exact))

    def _append_steps(self, next_steps: Sequence[LocatorStepInput], selector: str) -> Self:
        child = type(self)(self._rpc_client, page_id=self.page_id, selector=selector)
        if self._chain is not None:
            steps = self._chain.model_dump(exclude_unset=True)["steps"]
        else:
            steps = list(locator_steps(self.selector))
            if self.nth_index is not None:
                steps.append({"type": "nth", "index": self.nth_index})
        child._chain = LocatorChain.model_validate({"steps": [*steps, *next_steps]})
        return child
