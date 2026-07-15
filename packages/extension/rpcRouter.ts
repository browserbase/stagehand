import {
  ROOT_CONTEXT,
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import type { RPCMethod } from "../protocol/json-rpc/schemas.js";
import { wireSchema } from "../protocol/json-rpc/wire-casing.js";
import { StagehandRPC } from "../protocol/schema-registry.js";
import type { StagehandRpcRequest } from "../protocol/types.js";
import { z } from "zod/v4";
import { createBrowserController } from "./controllers/browserController.js";
import { createContextController } from "./controllers/contextController.js";
import { createLocatorController } from "./controllers/locatorController.js";
import { createPageController } from "./controllers/pageController.js";
import { createRuntimeController } from "./controllers/runtimeController.js";
import { createStagehandController } from "./controllers/stagehandController.js";
import type { StagehandLogger } from "./logger.js";
import { StagehandRuntimeError, type StagehandRuntime } from "./runtime.js";

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
      return await otelContext.with(requestContext, () => this.route(request, handlerContext));
    } catch (error) {
      if (error instanceof StagehandRuntimeError) {
        setRPCErrorOnSpan(span, error.code, error.type, error.message);
      } else {
        setRPCErrorOnSpan(
          span,
          -32603,
          "stagehand.internal_error",
          error instanceof Error ? error.message : undefined,
        );
      }
      throw error;
    } finally {
      span.end();
      if (request.method === StagehandRPC.stagehandClose.name) {
        await this.runtime.tracing.shutdown();
      }
    }
  }

  async route(request: StagehandRpcRequest, context: HandlerContext): Promise<unknown> {
    switch (request.method) {
      case "ping":
        return this.runtimeController.ping(parseParams(StagehandRPC.ping, request.params), context);
      case "runtime.configure":
        return this.runtimeController.configure(
          parseParams(StagehandRPC.runtimeConfigure, request.params),
          context,
        );
      case "runtime.loopback_status":
        return this.runtimeController.loopbackStatus(
          parseParams(StagehandRPC.runtimeLoopbackStatus, request.params),
          context,
        );
      case "browser.get_version":
        return this.browserController.getVersion(
          parseParams(StagehandRPC.browserGetVersion, request.params),
          context,
        );
      case "stagehand.init":
        return this.stagehandController.init(
          parseParams(StagehandRPC.stagehandInit, request.params),
          context,
        );
      case "stagehand.close":
        return this.stagehandController.close(
          parseParams(StagehandRPC.stagehandClose, request.params),
          context,
        );
      case "stagehand.act":
        return this.stagehandController.act(
          parseParams(StagehandRPC.stagehandAct, request.params),
          context,
        );
      case "stagehand.observe":
        return this.stagehandController.observe(
          parseParams(StagehandRPC.stagehandObserve, request.params),
          context,
        );
      case "stagehand.extract":
        return this.stagehandController.extract(
          parseParams(StagehandRPC.stagehandExtract, request.params),
          context,
        );
      case "stagehand.metrics":
        return this.stagehandController.metrics(
          parseParams(StagehandRPC.stagehandMetrics, request.params),
          context,
        );
      case "context.pages":
        return this.contextController.pages(
          parseParams(StagehandRPC.contextPages, request.params),
          context,
        );
      case "context.new_page":
        return this.contextController.newPage(
          parseParams(StagehandRPC.contextNewPage, request.params),
          context,
        );
      case "page.goto":
        return this.pageController.goto(
          parseParams(StagehandRPC.pageGoto, request.params),
          context,
        );
      case "page.url":
        return this.pageController.url(parseParams(StagehandRPC.pageUrl, request.params), context);
      case "page.title":
        return this.pageController.title(
          parseParams(StagehandRPC.pageTitle, request.params),
          context,
        );
      case "page.close":
        return this.pageController.close(
          parseParams(StagehandRPC.pageClose, request.params),
          context,
        );
      case "locator.click":
        return this.locatorController.click(
          parseParams(StagehandRPC.locatorClick, request.params),
          context,
        );
      case "locator.fill":
        return this.locatorController.fill(
          parseParams(StagehandRPC.locatorFill, request.params),
          context,
        );
      case "locator.hover":
        return this.locatorController.hover(
          parseParams(StagehandRPC.locatorHover, request.params),
          context,
        );
      case "locator.count":
        return this.locatorController.count(
          parseParams(StagehandRPC.locatorCount, request.params),
          context,
        );
      case "locator.is_checked":
        return this.locatorController.isChecked(
          parseParams(StagehandRPC.locatorIsChecked, request.params),
          context,
        );
      case "locator.input_value":
        return this.locatorController.inputValue(
          parseParams(StagehandRPC.locatorInputValue, request.params),
          context,
        );
      case "locator.is_visible":
        return this.locatorController.isVisible(
          parseParams(StagehandRPC.locatorIsVisible, request.params),
          context,
        );
      case "locator.inner_text":
        return this.locatorController.innerText(
          parseParams(StagehandRPC.locatorInnerText, request.params),
          context,
        );
      case "locator.inner_html":
        return this.locatorController.innerHtml(
          parseParams(StagehandRPC.locatorInnerHtml, request.params),
          context,
        );
      case "locator.text_content":
        return this.locatorController.textContent(
          parseParams(StagehandRPC.locatorTextContent, request.params),
          context,
        );
      case "locator.scroll_to":
        return this.locatorController.scrollTo(
          parseParams(StagehandRPC.locatorScrollTo, request.params),
          context,
        );
      case "locator.centroid":
        return this.locatorController.centroid(
          parseParams(StagehandRPC.locatorCentroid, request.params),
          context,
        );
      case "locator.highlight":
        return this.locatorController.highlight(
          parseParams(StagehandRPC.locatorHighlight, request.params),
          context,
        );
      case "locator.send_click_event":
        return this.locatorController.sendClickEvent(
          parseParams(StagehandRPC.locatorSendClickEvent, request.params),
          context,
        );
      case "locator.type":
        return this.locatorController.type(
          parseParams(StagehandRPC.locatorType, request.params),
          context,
        );
      case "locator.select_option":
        return this.locatorController.selectOption(
          parseParams(StagehandRPC.locatorSelectOption, request.params),
          context,
        );
    }
  }
}

function parseParams<Method extends RPCMethod>(
  method: Method,
  params: unknown,
): z.output<Method["params"]> {
  return wireSchema(method.params, method.paramsWire?.decode).parse(params) as z.output<
    Method["params"]
  >;
}

function setRPCErrorOnSpan(span: Span, code: number, type: string, message?: string): void {
  span.setStatus({ code: SpanStatusCode.ERROR, ...(message ? { message } : {}) });
  span.setAttribute("rpc.response.status_code", String(code));
  span.setAttribute("error.type", type);
}
