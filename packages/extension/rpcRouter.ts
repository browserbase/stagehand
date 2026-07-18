import {
  ROOT_CONTEXT,
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import type { RPCMethod } from "../protocol/json-rpc/schemas.js";
import { wireSchema } from "../protocol/json-rpc/wire-casing.js";
import { StagehandMethods } from "../protocol/schema-registry.js";
import type { StagehandRpcRequest } from "../protocol/types.js";
import { z } from "zod/v4";
import { createBrowserController } from "./controllers/browserController.js";
import { createContextController } from "./controllers/contextController.js";
import { createLocatorController } from "./controllers/locatorController.js";
import { createPageController } from "./controllers/pageController.js";
import { createRuntimeController } from "./controllers/runtimeController.js";
import { createStagehandController } from "./controllers/stagehandController.js";
import type { StagehandLogger } from "./logger.js";
import type { StagehandRuntime } from "./runtime.js";

const W3C_TRACE_CONTEXT_PROPAGATOR = new W3CTraceContextPropagator();

export type HandlerContext = {
  logger: StagehandLogger;
};

export class RPCRouter {
  readonly runtimeController;
  readonly browserController;
  readonly stagehandController;
  readonly contextController;
  readonly pageController;
  readonly locatorController;

  constructor(readonly runtime: StagehandRuntime) {
    this.runtimeController = createRuntimeController(runtime);
    this.browserController = createBrowserController(runtime);
    this.stagehandController = createStagehandController(runtime);
    this.contextController = createContextController(runtime);
    this.pageController = createPageController(runtime);
    this.locatorController = createLocatorController(runtime);
  }

  async handle(request: StagehandRpcRequest): Promise<unknown> {
    const parentContext = W3C_TRACE_CONTEXT_PROPAGATOR.extract(ROOT_CONTEXT, request, {
      get(carrier, key) {
        if (key === "traceparent" || key === "tracestate") return carrier[key];
        return undefined;
      },
      keys(carrier) {
        return ["traceparent", "tracestate"].filter((key) => key in carrier);
      },
    });
    const span = this.runtime.tracing.tracer.startSpan(
      request.method,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "rpc.system.name": "jsonrpc",
          "rpc.method": request.method,
          "jsonrpc.request.id": String(request.id),
        },
      },
      parentContext,
    );
    const requestContext = trace.setSpan(parentContext, span);
    const handlerContext = { logger: this.runtime.logger.withContext(requestContext) };

    try {
      return await context.with(requestContext, () => this.route(request, handlerContext));
    } catch (error) {
      setRPCErrorOnSpan(span, error);
      throw error;
    } finally {
      span.end();
      if (request.method === StagehandMethods.stagehandClose.name) {
        await this.runtime.tracing.shutdown();
      }
    }
  }

  async route(request: StagehandRpcRequest, context: HandlerContext): Promise<unknown> {
    switch (request.method) {
      case "ping":
        return this.runtimeController.ping(
          parseParams(StagehandMethods.ping, request.params),
          context,
        );
      case "runtime.configure":
        return this.runtimeController.configure(
          parseParams(StagehandMethods.runtimeConfigure, request.params),
          context,
        );
      case "runtime.loopback_status":
        return this.runtimeController.loopbackStatus(
          parseParams(StagehandMethods.runtimeLoopbackStatus, request.params),
          context,
        );
      case "browser.get_version":
        return this.browserController.getVersion(
          parseParams(StagehandMethods.browserGetVersion, request.params),
          context,
        );
      case "stagehand.init":
        return this.stagehandController.init(
          parseParams(StagehandMethods.stagehandInit, request.params),
          context,
        );
      case "stagehand.close":
        return this.stagehandController.close(
          parseParams(StagehandMethods.stagehandClose, request.params),
          context,
        );
      case "stagehand.act":
        return this.stagehandController.act(
          parseParams(StagehandMethods.stagehandAct, request.params),
          context,
        );
      case "stagehand.observe":
        return this.stagehandController.observe(
          parseParams(StagehandMethods.stagehandObserve, request.params),
          context,
        );
      case "stagehand.extract":
        return this.stagehandController.extract(
          parseParams(StagehandMethods.stagehandExtract, request.params),
          context,
        );
      case "stagehand.metrics":
        return this.stagehandController.metrics(
          parseParams(StagehandMethods.stagehandMetrics, request.params),
          context,
        );
      case "context.pages":
        return this.contextController.pages(
          parseParams(StagehandMethods.contextPages, request.params),
          context,
        );
      case "context.new_page":
        return this.contextController.newPage(
          parseParams(StagehandMethods.contextNewPage, request.params),
          context,
        );
      case "page.goto":
        return this.pageController.goto(
          parseParams(StagehandMethods.pageGoto, request.params),
          context,
        );
      case "page.reload":
        return this.pageController.reload(
          parseParams(StagehandMethods.pageReload, request.params),
          context,
        );
      case "page.go_back":
        return this.pageController.goBack(
          parseParams(StagehandMethods.pageGoBack, request.params),
          context,
        );
      case "page.go_forward":
        return this.pageController.goForward(
          parseParams(StagehandMethods.pageGoForward, request.params),
          context,
        );
      case "page.click":
        return this.pageController.click(
          parseParams(StagehandMethods.pageClick, request.params),
          context,
        );
      case "page.hover":
        return this.pageController.hover(
          parseParams(StagehandMethods.pageHover, request.params),
          context,
        );
      case "page.scroll":
        return this.pageController.scroll(
          parseParams(StagehandMethods.pageScroll, request.params),
          context,
        );
      case "page.drag_and_drop":
        return this.pageController.dragAndDrop(
          parseParams(StagehandMethods.pageDragAndDrop, request.params),
          context,
        );
      case "page.type":
        return this.pageController.type(
          parseParams(StagehandMethods.pageType, request.params),
          context,
        );
      case "page.key_press":
        return this.pageController.keyPress(
          parseParams(StagehandMethods.pageKeyPress, request.params),
          context,
        );
      case "page.evaluate":
        return this.pageController.evaluate(
          parseParams(StagehandMethods.pageEvaluate, request.params),
          context,
        );
      case "page.add_init_script":
        return this.pageController.addInitScript(
          parseParams(StagehandMethods.pageAddInitScript, request.params),
          context,
        );
      case "page.set_extra_http_headers":
        return this.pageController.setExtraHTTPHeaders(
          parseParams(StagehandMethods.pageSetExtraHTTPHeaders, request.params),
          context,
        );
      case "page.set_viewport_size":
        return this.pageController.setViewportSize(
          parseParams(StagehandMethods.pageSetViewportSize, request.params),
          context,
        );
      case "page.wait_for_load_state":
        return this.pageController.waitForLoadState(
          parseParams(StagehandMethods.pageWaitForLoadState, request.params),
          context,
        );
      case "page.wait_for_timeout":
        return this.pageController.waitForTimeout(
          parseParams(StagehandMethods.pageWaitForTimeout, request.params),
          context,
        );
      case "page.wait_for_selector":
        return this.pageController.waitForSelector(
          parseParams(StagehandMethods.pageWaitForSelector, request.params),
          context,
        );
      case "page.screenshot":
        return this.pageController.screenshot(
          parseParams(StagehandMethods.pageScreenshot, request.params),
          context,
        );
      case "page.snapshot":
        return this.pageController.snapshot(
          parseParams(StagehandMethods.pageSnapshot, request.params),
          context,
        );
      case "page.url":
        return this.pageController.url(
          parseParams(StagehandMethods.pageUrl, request.params),
          context,
        );
      case "page.title":
        return this.pageController.title(
          parseParams(StagehandMethods.pageTitle, request.params),
          context,
        );
      case "page.close":
        return this.pageController.close(
          parseParams(StagehandMethods.pageClose, request.params),
          context,
        );
      case "locator.click":
        return this.locatorController.click(
          parseParams(StagehandMethods.locatorClick, request.params),
          context,
        );
      case "locator.fill":
        return this.locatorController.fill(
          parseParams(StagehandMethods.locatorFill, request.params),
          context,
        );
      case "locator.hover":
        return this.locatorController.hover(
          parseParams(StagehandMethods.locatorHover, request.params),
          context,
        );
      case "locator.count":
        return this.locatorController.count(
          parseParams(StagehandMethods.locatorCount, request.params),
          context,
        );
      case "locator.is_checked":
        return this.locatorController.isChecked(
          parseParams(StagehandMethods.locatorIsChecked, request.params),
          context,
        );
      case "locator.input_value":
        return this.locatorController.inputValue(
          parseParams(StagehandMethods.locatorInputValue, request.params),
          context,
        );
      case "locator.is_visible":
        return this.locatorController.isVisible(
          parseParams(StagehandMethods.locatorIsVisible, request.params),
          context,
        );
      case "locator.inner_text":
        return this.locatorController.innerText(
          parseParams(StagehandMethods.locatorInnerText, request.params),
          context,
        );
      case "locator.inner_html":
        return this.locatorController.innerHtml(
          parseParams(StagehandMethods.locatorInnerHtml, request.params),
          context,
        );
      case "locator.text_content":
        return this.locatorController.textContent(
          parseParams(StagehandMethods.locatorTextContent, request.params),
          context,
        );
      case "locator.scroll_to":
        return this.locatorController.scrollTo(
          parseParams(StagehandMethods.locatorScrollTo, request.params),
          context,
        );
      case "locator.centroid":
        return this.locatorController.centroid(
          parseParams(StagehandMethods.locatorCentroid, request.params),
          context,
        );
      case "locator.highlight":
        return this.locatorController.highlight(
          parseParams(StagehandMethods.locatorHighlight, request.params),
          context,
        );
      case "locator.send_click_event":
        return this.locatorController.sendClickEvent(
          parseParams(StagehandMethods.locatorSendClickEvent, request.params),
          context,
        );
      case "locator.type":
        return this.locatorController.type(
          parseParams(StagehandMethods.locatorType, request.params),
          context,
        );
      case "locator.select_option":
        return this.locatorController.selectOption(
          parseParams(StagehandMethods.locatorSelectOption, request.params),
          context,
        );
    }
  }
}

function parseParams<Method extends RPCMethod>(
  method: Method,
  params: unknown,
): z.output<Method["params"]> {
  return wireSchema(method.params, method.paramsWire).parse(params) as z.output<Method["params"]>;
}

function setRPCErrorOnSpan(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const type = error instanceof Error ? error.name : "Error";
  if (error instanceof Error) span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.setAttribute("rpc.response.status_code", "-32603");
  span.setAttribute("error.type", type);
}
