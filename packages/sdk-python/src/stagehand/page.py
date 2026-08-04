from __future__ import annotations

import asyncio
import base64
import builtins
import inspect
from collections.abc import Awaitable, Callable, Mapping, Sequence
from pathlib import Path
from typing import Literal, TypeVar, cast, overload
from uuid import uuid4

from pydantic import JsonValue, TypeAdapter

from ._generated.input_types import PageEventName, PageScreenshotClip
from ._generated.models import (
    Animations,
    Caret,
    LoadState,
    MouseButton,
    PageAddInitScriptParams,
    PageCDPEvent,
    PageCDPEventNotification,
    PageClickOptions,
    PageClickParams,
    PageCloseResult,
    PageDragAndDropOptions,
    PageDragAndDropParams,
    PageEvaluateParams,
    PageEvaluateResult,
    PageGoBackParams,
    PageGoForwardParams,
    PageGotoParams,
    PageHoverParams,
    PageIdParams,
    PageKeyPressOptions,
    PageKeyPressParams,
    PageNavigationOptions,
    PageNavigationResult,
    PageOffParams,
    PageOnParams,
    PageRef,
    PageReloadOptions,
    PageReloadParams,
    PageScreenshotOptions,
    PageScreenshotParams,
    PageScreenshotResult,
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
    PageWebMCPToolsParams,
    PageWebMCPToolsResult,
    Scale,
    SnapshotResult,
    State,
    WebMCPToolsOptions,
)
from ._generated.models import (
    Type as ScreenshotType,
)
from .locator import Locator
from .response import Response
from .rpc_client import RPCClient
from .webmcp import WebMCPTool

EvaluateResult = TypeVar("EvaluateResult")
PageEventListener = Callable[[PageCDPEvent], object | Awaitable[object]]


class CDPSubscription:
    def __init__(
        self,
        rpc_client: RPCClient,
        subscription_id: str,
        remove_local_listener: Callable[[], None],
        on_disposed: Callable[[], None],
    ) -> None:
        self._rpc_client = rpc_client
        self._subscription_id = subscription_id
        self._remove_local_listener = remove_local_listener
        self._on_disposed = on_disposed
        self._unsubscribe_task: asyncio.Task[None] | None = None

    async def unsubscribe(self) -> None:
        if self._unsubscribe_task is None:

            async def run() -> None:
                await self._unsubscribe_once()

            self._unsubscribe_task = asyncio.create_task(run())
        await self._unsubscribe_task

    async def _unsubscribe_once(self) -> None:
        self._remove_local_listener()
        self._on_disposed()
        await self._rpc_client.send(
            "page.off",
            PageOffParams(subscription_id=self._subscription_id),
            PageVoidResult,
        )


class Page:
    def __init__(self, rpc_client: RPCClient, ref: PageRef) -> None:
        self._rpc_client = rpc_client
        self._ref = ref
        self._event_subscriptions: set[CDPSubscription] = set()

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
        timeout: int | None = None,
    ) -> Response | None:
        options = {
            name: value
            for name, value in (("wait_until", wait_until), ("timeout", timeout))
            if value is not None
        }
        params = PageGotoParams.model_validate({
            "page_id": self.page_id,
            "url": url,
            **({"options": options} if options else {}),
        })
        result = await self._rpc_client.send("page.goto", params, PageNavigationResult)
        self._ref = result.page
        return Response(self._rpc_client, result.response) if result.response is not None else None

    async def reload(
        self,
        *,
        wait_until: LoadState | Literal["load", "domcontentloaded", "networkidle"] | None = None,
        timeout: int | None = None,
        ignore_cache: bool | None = None,
    ) -> Response | None:
        params = PageReloadParams(page_id=self.page_id)
        options = PageReloadOptions.model_validate({
            name: value
            for name, value in (
                ("wait_until", wait_until),
                ("timeout", timeout),
                ("ignore_cache", ignore_cache),
            )
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send("page.reload", params, PageNavigationResult)
        self._ref = result.page
        return Response(self._rpc_client, result.response) if result.response is not None else None

    async def go_back(
        self,
        *,
        wait_until: LoadState | Literal["load", "domcontentloaded", "networkidle"] | None = None,
        timeout: int | None = None,
    ) -> Response | None:
        params = PageGoBackParams(page_id=self.page_id)
        options = PageNavigationOptions.model_validate({
            name: value
            for name, value in (("wait_until", wait_until), ("timeout", timeout))
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send("page.go_back", params, PageNavigationResult)
        self._ref = result.page
        return Response(self._rpc_client, result.response) if result.response is not None else None

    async def go_forward(
        self,
        *,
        wait_until: LoadState | Literal["load", "domcontentloaded", "networkidle"] | None = None,
        timeout: int | None = None,
    ) -> Response | None:
        params = PageGoForwardParams(page_id=self.page_id)
        options = PageNavigationOptions.model_validate({
            name: value
            for name, value in (("wait_until", wait_until), ("timeout", timeout))
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client.send("page.go_forward", params, PageNavigationResult)
        self._ref = result.page
        return Response(self._rpc_client, result.response) if result.response is not None else None

    async def click(
        self,
        x: float,
        y: float,
        *,
        button: MouseButton | Literal["left", "right", "middle"] | None = None,
        click_count: int | None = None,
    ) -> None:
        params = PageClickParams(page_id=self.page_id, x=x, y=y)
        options = PageClickOptions.model_validate({
            name: value
            for name, value in (
                ("button", button),
                ("click_count", click_count),
            )
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        await self._rpc_client.send("page.click", params, PageVoidResult)

    async def hover(
        self,
        x: float,
        y: float,
    ) -> None:
        params = PageHoverParams(page_id=self.page_id, x=x, y=y)
        await self._rpc_client.send("page.hover", params, PageVoidResult)

    async def scroll(
        self,
        x: float,
        y: float,
        delta_x: float,
        delta_y: float,
    ) -> None:
        params = PageScrollParams(
            page_id=self.page_id,
            x=x,
            y=y,
            delta_x=delta_x,
            delta_y=delta_y,
        )
        await self._rpc_client.send("page.scroll", params, PageVoidResult)

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
    ) -> None:
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
            )
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        await self._rpc_client.send(
            "page.drag_and_drop",
            params,
            PageVoidResult,
        )

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

    async def on(
        self,
        event: PageEventName,
        listener: PageEventListener,
    ) -> CDPSubscription:
        subscription_id = uuid4().hex

        async def notify(notification: PageCDPEventNotification) -> None:
            if notification.subscription_id != subscription_id:
                return
            try:
                result = listener(notification.event)
                if inspect.isawaitable(result):
                    await result
            except Exception as error:
                asyncio.get_running_loop().call_exception_handler({
                    "message": "Stagehand page event listener failed",
                    "exception": error,
                })

        remove_notification_listener = self._rpc_client.on_notification(
            "page.cdp_event",
            PageCDPEventNotification,
            notify,
        )

        subscription: CDPSubscription
        subscription = CDPSubscription(
            self._rpc_client,
            subscription_id,
            remove_notification_listener,
            lambda: self._event_subscriptions.discard(subscription),
        )
        self._event_subscriptions.add(subscription)
        try:
            await self._rpc_client.send(
                "page.on",
                PageOnParams.model_validate({
                    "page_id": self.page_id,
                    "subscription_id": subscription_id,
                    "event": event,
                }),
                PageVoidResult,
            )
        except Exception:
            remove_notification_listener()
            self._event_subscriptions.discard(subscription)
            raise
        return subscription

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
        *,
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

    async def tools(self, *, timeout: float | None = None) -> list[WebMCPTool]:
        params = PageWebMCPToolsParams(page_id=self.page_id)
        if timeout is not None:
            params.options = WebMCPToolsOptions(timeout=timeout)
        result = await self._rpc_client.send(
            "page.webmcp_tools",
            params,
            PageWebMCPToolsResult,
        )
        return [WebMCPTool(self._rpc_client, self.page_id, tool) for tool in result.tools]

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
        if self._event_subscriptions:
            await asyncio.gather(
                *(subscription.unsubscribe() for subscription in self._event_subscriptions),
                return_exceptions=True,
            )
        await self._rpc_client.send(
            "page.close",
            PageIdParams(page_id=self.page_id),
            PageCloseResult,
        )

    def locator(self, selector: str) -> Locator:
        return Locator(self._rpc_client, page_id=self.page_id, selector=selector)
