from __future__ import annotations

import base64
import builtins
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Literal, Self, TypeVar, cast, overload

from pydantic import BaseModel, JsonValue, TypeAdapter

from ._generated.models import (
    Action,
    ActOptions,
    ActResult,
    ActResultData,
    Animations,
    Caret,
    ExtractOptions,
    ExtractResult,
    LoadState,
    MouseButton,
    ObserveOptions,
    ObserveResult,
    PageAddInitScriptParams,
    PageClickOptions,
    PageClickParams,
    PageCloseResult,
    PageCoordinateResult,
    PageDragAndDropOptions,
    PageDragAndDropParams,
    PageDragAndDropResult,
    PageEvaluateParams,
    PageEvaluateResult,
    PageGoBackParams,
    PageGoForwardParams,
    PageGotoParams,
    PageHoverOptions,
    PageHoverParams,
    PageIdParams,
    PageKeyPressOptions,
    PageKeyPressParams,
    PageNavigationOptions,
    PageRef,
    PageReloadOptions,
    PageReloadParams,
    PageScreenshotClip,
    PageScreenshotOptions,
    PageScreenshotParams,
    PageScreenshotResult,
    PageScrollOptions,
    PageScrollParams,
    PageSetExtraHTTPHeadersParams,
    PageSetViewportSizeOptions,
    PageSetViewportSizeParams,
    PageSnapshotOptions,
    PageSnapshotParams,
    PageTitleResult,
    PageTypeOptions,
    PageTypeParams,
    PageUrlResult,
    PageVoidResult,
    PageWaitForLoadStateParams,
    PageWaitForSelectorOptions,
    PageWaitForSelectorParams,
    PageWaitForSelectorResult,
    PageWaitForTimeoutParams,
    Scale,
    SnapshotResult,
    StagehandActParams,
    StagehandExtractParams,
    StagehandObserveParams,
    State,
    Variables,
)
from ._generated.models import (
    Type as ScreenshotType,
)
from .client_models import Cache, _cache_config, _model_config
from .locator import Locator
from .rpc_client import RPCClient

ResultModel = TypeVar("ResultModel", bound=BaseModel)
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
        *,
        wait_until: LoadState | Literal["load", "domcontentloaded", "networkidle"] | None = None,
        timeout_ms: int | None = None,
    ) -> Self:
        params = PageGotoParams(page_id=self.page_id, url=url)
        options = PageNavigationOptions.model_validate({
            name: value
            for name, value in (("wait_until", wait_until), ("timeout_ms", timeout_ms))
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        self._ref = await self._rpc_client.send("page.goto", params, PageRef)
        return self

    async def reload(
        self,
        *,
        wait_until: LoadState | Literal["load", "domcontentloaded", "networkidle"] | None = None,
        timeout_ms: int | None = None,
        ignore_cache: bool | None = None,
    ) -> Self:
        params = PageReloadParams(page_id=self.page_id)
        options = PageReloadOptions.model_validate({
            name: value
            for name, value in (
                ("wait_until", wait_until),
                ("timeout_ms", timeout_ms),
                ("ignore_cache", ignore_cache),
            )
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        self._ref = await self._rpc_client.send("page.reload", params, PageRef)
        return self

    async def go_back(
        self,
        *,
        wait_until: LoadState | Literal["load", "domcontentloaded", "networkidle"] | None = None,
        timeout_ms: int | None = None,
    ) -> Self:
        params = PageGoBackParams(page_id=self.page_id)
        options = PageNavigationOptions.model_validate({
            name: value
            for name, value in (("wait_until", wait_until), ("timeout_ms", timeout_ms))
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        self._ref = await self._rpc_client.send("page.go_back", params, PageRef)
        return self

    async def go_forward(
        self,
        *,
        wait_until: LoadState | Literal["load", "domcontentloaded", "networkidle"] | None = None,
        timeout_ms: int | None = None,
    ) -> Self:
        params = PageGoForwardParams(page_id=self.page_id)
        options = PageNavigationOptions.model_validate({
            name: value
            for name, value in (("wait_until", wait_until), ("timeout_ms", timeout_ms))
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        self._ref = await self._rpc_client.send("page.go_forward", params, PageRef)
        return self

    async def click(
        self,
        x: float,
        y: float,
        *,
        button: MouseButton | Literal["left", "right", "middle"] | None = None,
        click_count: int | None = None,
        return_xpath: bool | None = None,
    ) -> str:
        params = PageClickParams(page_id=self.page_id, x=x, y=y)
        options = PageClickOptions.model_validate({
            name: value
            for name, value in (
                ("button", button),
                ("click_count", click_count),
                ("return_xpath", return_xpath),
            )
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send("page.click", params, PageCoordinateResult)
        return result.xpath

    async def hover(
        self,
        x: float,
        y: float,
        *,
        return_xpath: bool | None = None,
    ) -> str:
        params = PageHoverParams(page_id=self.page_id, x=x, y=y)
        if return_xpath is not None:
            params.options = PageHoverOptions(return_xpath=return_xpath)
        result = await self._rpc_client.send("page.hover", params, PageCoordinateResult)
        return result.xpath

    async def scroll(
        self,
        x: float,
        y: float,
        delta_x: float,
        delta_y: float,
        *,
        return_xpath: bool | None = None,
    ) -> str:
        params = PageScrollParams(
            page_id=self.page_id,
            x=x,
            y=y,
            delta_x=delta_x,
            delta_y=delta_y,
        )
        if return_xpath is not None:
            params.options = PageScrollOptions(return_xpath=return_xpath)
        result = await self._rpc_client.send("page.scroll", params, PageCoordinateResult)
        return result.xpath

    async def drag_and_drop(
        self,
        from_x: float,
        from_y: float,
        to_x: float,
        to_y: float,
        *,
        button: MouseButton | Literal["left", "right", "middle"] | None = None,
        steps: int | None = None,
        delay: float | None = None,
        return_xpath: bool | None = None,
    ) -> tuple[str, str]:
        params = PageDragAndDropParams(
            page_id=self.page_id,
            from_x=from_x,
            from_y=from_y,
            to_x=to_x,
            to_y=to_y,
        )
        options = PageDragAndDropOptions.model_validate({
            name: value
            for name, value in (
                ("button", button),
                ("steps", steps),
                ("delay", delay),
                ("return_xpath", return_xpath),
            )
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send(
            "page.drag_and_drop",
            params,
            PageDragAndDropResult,
        )
        return result.from_xpath, result.to_xpath

    async def type(
        self,
        text: str,
        *,
        delay: float | None = None,
        with_mistakes: bool | None = None,
    ) -> None:
        params = PageTypeParams(page_id=self.page_id, text=text)
        options = PageTypeOptions.model_validate({
            name: value
            for name, value in (("delay", delay), ("with_mistakes", with_mistakes))
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        await self._rpc_client.send("page.type", params, PageVoidResult)

    async def key_press(self, key: str, *, delay: float | None = None) -> None:
        params = PageKeyPressParams(page_id=self.page_id, key=key)
        if delay is not None:
            params.options = PageKeyPressOptions(delay=delay)
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
        *,
        device_scale_factor: float | None = None,
    ) -> None:
        params = PageSetViewportSizeParams(page_id=self.page_id, width=width, height=height)
        if device_scale_factor is not None:
            params.options = PageSetViewportSizeOptions(
                device_scale_factor=device_scale_factor,
            )
        await self._rpc_client.send("page.set_viewport_size", params, PageVoidResult)

    async def wait_for_load_state(
        self,
        state: LoadState | Literal["load", "domcontentloaded", "networkidle"],
        timeout_ms: int | None = None,
    ) -> None:
        params = PageWaitForLoadStateParams.model_validate({
            "page_id": self.page_id,
            "state": state,
        })
        if timeout_ms is not None:
            params.timeout_ms = timeout_ms
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
        *,
        state: State | Literal["attached", "detached", "visible", "hidden"] | None = None,
        timeout: int | None = None,
        pierce_shadow: bool | None = None,
    ) -> bool:
        params = PageWaitForSelectorParams(page_id=self.page_id, selector=selector)
        options = PageWaitForSelectorOptions.model_validate({
            name: value
            for name, value in (
                ("state", state),
                ("timeout", timeout),
                ("pierce_shadow", pierce_shadow),
            )
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send(
            "page.wait_for_selector",
            params,
            PageWaitForSelectorResult,
        )
        return result.matched

    async def screenshot(
        self,
        *,
        animations: Animations | Literal["disabled", "allow"] | None = None,
        caret: Caret | Literal["hide", "initial"] | None = None,
        clip: PageScreenshotClip | None = None,
        full_page: bool | None = None,
        path: str | Path | None = None,
        mask: Sequence[Locator] | None = None,
        mask_color: str | None = None,
        omit_background: bool | None = None,
        quality: int | None = None,
        scale: Scale | Literal["css", "device"] | None = None,
        style: str | None = None,
        timeout: float | None = None,
        type: ScreenshotType | Literal["png", "jpeg"] | None = None,
    ) -> bytes:
        params = PageScreenshotParams(page_id=self.page_id)
        options = PageScreenshotOptions.model_validate({
            name: value
            for name, value in (
                ("animations", animations),
                ("caret", caret),
                ("clip", clip),
                ("full_page", full_page),
                (
                    "mask",
                    [locator.descriptor for locator in mask] if mask is not None else None,
                ),
                ("mask_color", mask_color),
                ("omit_background", omit_background),
                ("quality", quality),
                ("scale", scale),
                ("style", style),
                ("timeout", timeout),
                ("type", type),
            )
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send(
            "page.screenshot",
            params,
            PageScreenshotResult,
        )
        data = base64.b64decode(result.data, validate=True)
        if path is not None:
            Path(path).write_bytes(data)
        return data

    async def snapshot(self, *, include_iframes: bool | None = None) -> SnapshotResult:
        params = PageSnapshotParams(page_id=self.page_id)
        if include_iframes is not None:
            params.options = PageSnapshotOptions(include_iframes=include_iframes)
        return await self._rpc_client.send("page.snapshot", params, SnapshotResult)

    async def url(self) -> str:
        result = await self._rpc_client.send(
            "page.url",
            PageIdParams(page_id=self.page_id),
            PageUrlResult,
        )
        return result.url

    async def title(self) -> str:
        result = await self._rpc_client.send(
            "page.title",
            PageIdParams(page_id=self.page_id),
            PageTitleResult,
        )
        return result.title

    async def close(self) -> None:
        await self._rpc_client.send(
            "page.close",
            PageIdParams(page_id=self.page_id),
            PageCloseResult,
        )

    async def act(
        self,
        input: str,
        *,
        model: str | None = None,
        model_api_key: str | None = None,
        model_base_url: str | None = None,
        model_headers: Mapping[str, str] | None = None,
        variables: Variables | None = None,
        timeout: float | None = None,
        cache: Cache | None = None,
    ) -> ActResultData:
        if model is None and any(
            value is not None for value in (model_api_key, model_base_url, model_headers)
        ):
            raise TypeError("model connection options require a model name")
        options = ActOptions.model_validate({
            name: value
            for name, value in (
                (
                    "model",
                    _model_config(
                        model,
                        api_key=model_api_key,
                        base_url=model_base_url,
                        headers=dict(model_headers) if model_headers is not None else None,
                    )
                    if model is not None
                    else None,
                ),
                ("variables", variables),
                ("timeout", timeout),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
        params = StagehandActParams(page_id=self.page_id, input=input)
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send("stagehand.act", params, ActResult)
        return result.result

    async def observe(
        self,
        *,
        instruction: str | None = None,
        model: str | None = None,
        model_api_key: str | None = None,
        model_base_url: str | None = None,
        model_headers: Mapping[str, str] | None = None,
        variables: Variables | None = None,
        timeout: float | None = None,
        selector: str | None = None,
        ignore_selectors: list[str] | None = None,
        cache: Cache | None = None,
    ) -> list[Action]:
        if model is None and any(
            value is not None for value in (model_api_key, model_base_url, model_headers)
        ):
            raise TypeError("model connection options require a model name")
        options = ObserveOptions.model_validate({
            name: value
            for name, value in (
                (
                    "model",
                    _model_config(
                        model,
                        api_key=model_api_key,
                        base_url=model_base_url,
                        headers=dict(model_headers) if model_headers is not None else None,
                    )
                    if model is not None
                    else None,
                ),
                ("variables", variables),
                ("timeout", timeout),
                ("selector", selector),
                ("ignore_selectors", ignore_selectors),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
        params = StagehandObserveParams(page_id=self.page_id, instruction=instruction)
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send("stagehand.observe", params, ObserveResult)
        return result.result

    async def extract(
        self,
        *,
        instruction: str,
        schema: builtins.type[ResultModel],
        model: str | None = None,
        model_api_key: str | None = None,
        model_base_url: str | None = None,
        model_headers: Mapping[str, str] | None = None,
        timeout: float | None = None,
        selector: str | None = None,
        ignore_selectors: list[str] | None = None,
        screenshot: bool | None = None,
        cache: Cache | None = None,
    ) -> ResultModel:
        if model is None and any(
            value is not None for value in (model_api_key, model_base_url, model_headers)
        ):
            raise TypeError("model connection options require a model name")
        options = ExtractOptions.model_validate({
            name: value
            for name, value in (
                (
                    "model",
                    _model_config(
                        model,
                        api_key=model_api_key,
                        base_url=model_base_url,
                        headers=dict(model_headers) if model_headers is not None else None,
                    )
                    if model is not None
                    else None,
                ),
                ("timeout", timeout),
                ("selector", selector),
                ("ignore_selectors", ignore_selectors),
                ("screenshot", screenshot),
                ("cache", _cache_config(cache) if cache is not None else None),
            )
            if value is not None
        })
        params = StagehandExtractParams(
            page_id=self.page_id,
            instruction=instruction,
            schema_=schema.model_json_schema(),
        )
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send("stagehand.extract", params, ExtractResult)
        value = (
            result.result.model_dump() if isinstance(result.result, BaseModel) else result.result
        )
        return schema.model_validate(value)

    def locator(self, selector: str) -> Locator:
        return Locator(self._rpc_client, page_id=self.page_id, selector=selector)
