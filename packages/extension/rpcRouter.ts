import {
  ROOT_CONTEXT,
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import { wireSchema } from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  StagehandInitParams,
  StagehandInitResult,
  StagehandRpcRequest,
} from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import { createContextController } from "./controllers/contextController.js";
import {
  createCallbackBatchController,
  type CallbackBatchRuntimeAttachments,
} from "./callbackBatch.js";
import { createLocatorController } from "./controllers/locatorController.js";
import { createPageController } from "./controllers/pageController.js";
import { createResponseController } from "./controllers/responseController.js";
import { createStagehandController } from "./controllers/stagehandController.js";
import type { StagehandLogger } from "./logger.js";
import type { StagehandRuntime } from "./runtime.js";

const W3C_TRACE_CONTEXT_PROPAGATOR = new W3CTraceContextPropagator();

export type HandlerContext = {
  logger: StagehandLogger;
  telemetryScope: symbol;
  traceContext?: {
    traceparent?: string;
    tracestate?: string;
  };
  runtimeAttachments?: CallbackBatchRuntimeAttachments;
};

export type RPCRouterOptions = {
  initializeStagehand?: (params: StagehandInitParams) => Promise<StagehandInitResult>;
  closeStagehand?: () => Promise<void>;
};

export class RPCRouter {
  readonly stagehandController;
  readonly contextController;
  readonly pageController;
  readonly locatorController;
  readonly responseController;
  readonly callbackBatchController;

  constructor(
    readonly runtime: StagehandRuntime,
    options: RPCRouterOptions = {},
  ) {
    this.stagehandController = createStagehandController(runtime, {
      ...(options.initializeStagehand ? { initialize: options.initializeStagehand } : {}),
      ...(options.closeStagehand ? { close: options.closeStagehand } : {}),
    });
    this.contextController = createContextController(runtime);
    this.pageController = createPageController(runtime);
    this.locatorController = createLocatorController(runtime);
    this.responseController = createResponseController(runtime);
    this.callbackBatchController = createCallbackBatchController(this);
  }

  async handle(
    request: StagehandRpcRequest,
    runtimeAttachments?: CallbackBatchRuntimeAttachments,
  ): Promise<unknown> {
    // The RPC client validates the complete request before routing; the generated
    // request union does not currently narrow params from the method name.
    const initParams: StagehandInitParams | undefined =
      request.method === StagehandMethods.stagehandInit.name
        ? (request.params as StagehandInitParams)
        : undefined;
    if (initParams) {
      await this.runtime.tracing.configure(initParams.telemetry, initParams.clientInfo);
    }
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
    const traceContextFields: { traceparent?: string; tracestate?: string } = {};
    W3C_TRACE_CONTEXT_PROPAGATOR.inject(requestContext, traceContextFields, {
      set(carrier, key, value) {
        if (key === "traceparent" || key === "tracestate") carrier[key] = value;
      },
    });
    const handlerContext: HandlerContext = {
      logger: this.runtime.logger.withContext(requestContext),
      telemetryScope: Symbol(`rpc:${String(request.id)}`),
      traceContext: traceContextFields,
      ...(runtimeAttachments ? { runtimeAttachments } : {}),
    };

    try {
      return await context.with(requestContext, () =>
        this.runtime.runWithTelemetryContext(
          handlerContext.telemetryScope,
          handlerContext.logger,
          () => this.route(request, handlerContext, initParams),
        ),
      );
    } catch (error) {
      setRPCErrorOnSpan(span, error);
      throw error;
    } finally {
      span.end();
    }
  }

  async beforeResponse(request: StagehandRpcRequest): Promise<void> {
    if (request.method !== StagehandMethods.stagehandClose.name) return;
    await this.runtime.tracing.forceFlush().catch(() => undefined);
  }

  async route(
    request: StagehandRpcRequest,
    context: HandlerContext,
    parsedInitParams?: StagehandInitParams,
  ): Promise<unknown> {
    switch (request.method) {
      case "stagehand.init":
        return this.stagehandController.init(
          parsedInitParams ?? parseParams(StagehandMethods.stagehandInit, request.params),
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
      case "stagehand.callback_batch":
        return this.callbackBatchController.run(
          parseParams(StagehandMethods.stagehandCallbackBatch, request.params),
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
      case "context.active_page":
        return this.contextController.activePage(
          parseParams(StagehandMethods.contextActivePage, request.params),
          context,
        );
      case "context.set_active_page":
        return this.contextController.setActivePage(
          parseParams(StagehandMethods.contextSetActivePage, request.params),
          context,
        );
      case "context.add_init_script":
        return this.contextController.addInitScript(
          parseParams(StagehandMethods.contextAddInitScript, request.params),
          context,
        );
      case "context.set_extra_http_headers":
        return this.contextController.setExtraHTTPHeaders(
          parseParams(StagehandMethods.contextSetExtraHTTPHeaders, request.params),
          context,
        );
      case "context.get_domain_policy":
        return this.contextController.getDomainPolicy(
          parseParams(StagehandMethods.contextGetDomainPolicy, request.params),
          context,
        );
      case "context.set_domain_policy":
        return this.contextController.setDomainPolicy(
          parseParams(StagehandMethods.contextSetDomainPolicy, request.params),
          context,
        );
      case "context.cookies":
        return this.contextController.cookies(
          parseParams(StagehandMethods.contextCookies, request.params),
          context,
        );
      case "context.add_cookies":
        return this.contextController.addCookies(
          parseParams(StagehandMethods.contextAddCookies, request.params),
          context,
        );
      case "context.clear_cookies":
        return this.contextController.clearCookies(
          parseParams(StagehandMethods.contextClearCookies, request.params),
          context,
        );
      case "context.clipboard_read_text":
        return this.contextController.clipboardReadText(
          parseParams(StagehandMethods.contextClipboardReadText, request.params),
          context,
        );
      case "context.clipboard_write_text":
        return this.contextController.clipboardWriteText(
          parseParams(StagehandMethods.contextClipboardWriteText, request.params),
          context,
        );
      case "context.clipboard_clear":
        return this.contextController.clipboardClear(
          parseParams(StagehandMethods.contextClipboardClear, request.params),
          context,
        );
      case "context.clipboard_paste":
        return this.contextController.clipboardPaste(
          parseParams(StagehandMethods.contextClipboardPaste, request.params),
          context,
        );
      case "context.clipboard_copy":
        return this.contextController.clipboardCopy(
          parseParams(StagehandMethods.contextClipboardCopy, request.params),
          context,
        );
      case "context.clipboard_cut":
        return this.contextController.clipboardCut(
          parseParams(StagehandMethods.contextClipboardCut, request.params),
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
      case "page.on":
        return this.pageController.on(
          parseParams(StagehandMethods.pageOn, request.params),
          context,
        );
      case "page.off":
        return this.pageController.off(
          parseParams(StagehandMethods.pageOff, request.params),
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
      case "page.webmcp_tools":
        return this.pageController.webMCPTools(
          parseParams(StagehandMethods.pageWebMCPTools, request.params),
          context,
        );
      case "page.webmcp_invoke_tool":
        return this.pageController.webMCPInvokeTool(
          parseParams(StagehandMethods.pageWebMCPInvokeTool, request.params),
          context,
        );
      case "page.webmcp_invocation_result":
        return this.pageController.webMCPInvocationResult(
          parseParams(StagehandMethods.pageWebMCPInvocationResult, request.params),
          context,
        );
      case "page.webmcp_cancel_invocation":
        return this.pageController.webMCPCancelInvocation(
          parseParams(StagehandMethods.pageWebMCPCancelInvocation, request.params),
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
      case "response.body":
        return this.responseController.body(
          parseParams(StagehandMethods.responseBody, request.params),
          context,
        );
      case "response.all_headers":
        return this.responseController.allHeaders(
          parseParams(StagehandMethods.responseAllHeaders, request.params),
          context,
        );
      case "response.headers_array":
        return this.responseController.headersArray(
          parseParams(StagehandMethods.responseHeadersArray, request.params),
          context,
        );
      case "response.security_details":
        return this.responseController.securityDetails(
          parseParams(StagehandMethods.responseSecurityDetails, request.params),
          context,
        );
      case "response.server_addr":
        return this.responseController.serverAddr(
          parseParams(StagehandMethods.responseServerAddr, request.params),
          context,
        );
      case "response.finished":
        return this.responseController.finished(
          parseParams(StagehandMethods.responseFinished, request.params),
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
      case "locator.set_input_files":
        return this.locatorController.setInputFiles(
          parseParams(StagehandMethods.locatorSetInputFiles, request.params),
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
