from __future__ import annotations

import builtins
from collections.abc import Awaitable, Callable
from typing import TypeVar, cast, overload

from pydantic import BaseModel

from ._ai_options import _act_options, _extract_options, _observe_options
from ._generated.input_types import Action as ActionInput
from ._generated.input_types import ModelConfig, Variables
from ._generated.models import (
    Action,
    ActResult,
    FieldSchema0,
    ObserveResult,
    StagehandActParams,
    StagehandExtractParams,
    StagehandObserveParams,
)
from .client_models import DefaultExtract, ExtractResult, _ExtractWireResult
from .client_types import Cache
from .locator import Locator
from .page import Page
from .rpc_client import RPCClient

ResultModel = TypeVar("ResultModel", bound=BaseModel)


class ExperimentalDecisions:
    """`stagehand.experimental_decisions`: act, observe and extract resolved by a
    decision model (typed questions answered with probabilities, a few hundred
    milliseconds each) instead of an LLM call, falling back to the LLM when the
    model is not confident. Same arguments and results as the methods on
    `Stagehand`; requires `experimental_decisions` in `Stagehand.create()`.

    Experimental: the surface and its behaviour may change between releases.
    """

    def __init__(
        self,
        *,
        rpc_client: Callable[[], RPCClient],
        active_page: Callable[[], Awaitable[Page | None]],
    ) -> None:
        self._rpc_client = rpc_client
        self._active_page = active_page

    async def act(
        self,
        instruction: str | ActionInput | Action,
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        variables: Variables | None = None,
        timeout: float | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ActResult:
        target_page = page or await self._active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        options = _act_options(
            target_page.page_id,
            model=model,
            variables=variables,
            timeout=timeout,
            locator=locator,
            ignore_locators=ignore_locators,
            cache=cache,
        )
        params = StagehandActParams.model_validate({
            "page_id": target_page.page_id,
            "instruction": instruction,
        })
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client().send(
            "stagehand.experimental_decisions_act", params, ActResult
        )
        return result

    async def observe(
        self,
        instruction: str | None = None,
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        variables: Variables | None = None,
        timeout: float | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ObserveResult:
        target_page = page or await self._active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        options = _observe_options(
            target_page.page_id,
            model=model,
            variables=variables,
            timeout=timeout,
            locator=locator,
            ignore_locators=ignore_locators,
            cache=cache,
        )
        params = StagehandObserveParams(page_id=target_page.page_id, instruction=instruction)
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client().send(
            "stagehand.experimental_decisions_observe", params, ObserveResult
        )
        return result

    @overload
    async def extract(
        self,
        instruction: str,
        schema: builtins.type[DefaultExtract] = DefaultExtract,
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        timeout: float | None = None,
        screenshot: bool | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ExtractResult[DefaultExtract]: ...

    @overload
    async def extract(
        self,
        instruction: str,
        schema: builtins.type[ResultModel],
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        timeout: float | None = None,
        screenshot: bool | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ExtractResult[ResultModel]: ...

    async def extract(
        self,
        instruction: str,
        schema: builtins.type[ResultModel] = cast(builtins.type[ResultModel], DefaultExtract),
        *,
        page: Page | None = None,
        model: ModelConfig | None = None,
        timeout: float | None = None,
        screenshot: bool | None = None,
        locator: Locator | None = None,
        ignore_locators: list[Locator] | None = None,
        cache: Cache | None = None,
    ) -> ExtractResult[ResultModel]:
        target_page = page or await self._active_page()
        if target_page is None:
            raise RuntimeError("Stagehand has no active page")
        options = _extract_options(
            target_page.page_id,
            model=model,
            timeout=timeout,
            screenshot=screenshot,
            locator=locator,
            ignore_locators=ignore_locators,
            cache=cache,
        )
        params = StagehandExtractParams(
            page_id=target_page.page_id,
            instruction=instruction,
        )
        if schema is not DefaultExtract:
            params.schema_ = FieldSchema0.model_validate(schema.model_json_schema())
        if options.model_fields_set:
            params.options = options
        result = await self._rpc_client().send(
            "stagehand.experimental_decisions_extract", params, _ExtractWireResult
        )
        return ExtractResult(
            data=schema.model_validate(result.data),
            metadata=result.metadata,
        )
