import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import { encodeWireValue } from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";
import {
  StagehandMethods,
  StagehandRpcRequestSchema,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  Action,
  CallbackBatchParams,
  CallbackBatchResult,
  StagehandMetrics,
  StagehandRpcNotification,
} from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import type { ExperimentalBatchBrowserContext } from "../sdk-ts/src/batch.js";
import { BrowserContext } from "../sdk-ts/src/browserContext.js";
import {
  StagehandClientActOptionsSchema,
  StagehandClientExtractOptionsSchema,
  StagehandClientObserveOptionsSchema,
  type StagehandClientActOptions,
  type StagehandClientExtractOptions,
  type StagehandClientObserveOptions,
} from "../sdk-ts/src/clientSchemas.js";
import { serializeClientLocatorOptions } from "../sdk-ts/src/clientLocatorOptions.js";
import type { StagehandCommandClient } from "../sdk-ts/src/commandClient.js";
import { Page } from "../sdk-ts/src/page.js";
import type { HandlerContext, RPCRouter } from "./rpcRouter.js";

export type CallbackBatchFunction = (batch: CallbackStagehand, input: unknown) => unknown;

export type CallbackBatchRuntimeAttachments = {
  callback?: unknown;
};

class InProcessCommandClient implements StagehandCommandClient {
  #nextRequestId = 1;

  constructor(
    private readonly router: RPCRouter,
    private readonly signal: AbortSignal,
    private readonly traceContext: NonNullable<HandlerContext["traceContext"]>,
  ) {}

  async send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    this.throwIfAborted();
    const parsedParams = method.params.parse(params);
    const request = StagehandRpcRequestSchema.parse({
      jsonrpc: "2.0",
      id: this.#nextRequestId++,
      method: method.name,
      params: encodeWireValue(parsedParams, method.paramsWire),
      ...this.traceContext,
    });
    const result = await this.router.handle(request);
    this.throwIfAborted();
    return method.result.parse(result) as z.output<Method["result"]>;
  }

  onNotification(_listener: (notification: StagehandRpcNotification) => void): () => void {
    throw new Error("Stagehand callback batches do not support page event subscriptions");
  }

  private throwIfAborted(): void {
    if (!this.signal.aborted) return;
    throw this.signal.reason instanceof Error
      ? this.signal.reason
      : new Error("Stagehand callback batch was canceled");
  }
}

export type CallbackStagehand = {
  page: Page;
  context: ExperimentalBatchBrowserContext;
  act(instruction: string | Action, options?: StagehandClientActOptions): Promise<unknown>;
  observe(instruction?: string, options?: StagehandClientObserveOptions): Promise<unknown>;
  extract(
    instruction: string,
    schemaOrOptions?: unknown,
    options?: StagehandClientExtractOptions,
  ): Promise<unknown>;
  metrics(): Promise<StagehandMetrics>;
};

export function createCallbackBatchController(router: RPCRouter) {
  async function run(
    params: CallbackBatchParams,
    { runtimeAttachments, traceContext = {} }: HandlerContext,
  ): Promise<CallbackBatchResult> {
    const callback = runtimeAttachments?.callback;
    const { input, options } = params;
    if (typeof callback !== "function") {
      throw new TypeError(
        "Stagehand callback batch request is missing its runtime callback attachment",
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Stagehand callback batch timed out after ${options.timeout}ms`));
    }, options.timeout);

    try {
      const client = new InProcessCommandClient(router, controller.signal, traceContext);
      const context = new BrowserContext(client);
      const page = options.pageId
        ? (await context.pages()).find((candidate) => candidate.pageId === options.pageId)
        : await context.activePage();
      if (!page) {
        throw new Error(
          options.pageId
            ? `Stagehand callback batch page was not found: ${options.pageId}`
            : "Stagehand has no active page.",
        );
      }

      const resolveOperationPage = async (operationPage?: Page): Promise<Page> => {
        if (operationPage) return operationPage;
        const activePage = await context.activePage();
        if (!activePage) throw new Error("Stagehand has no active page.");
        return activePage;
      };

      const stagehand: CallbackStagehand = {
        page,
        context: createCallbackContextFacade(context),
        act: async (instruction, operationOptions) => {
          const { page: operationPage, ...clientOptions } = StagehandClientActOptionsSchema.parse(
            operationOptions ?? {},
          );
          const targetPage = await resolveOperationPage(operationPage);
          const protocolOptions = serializeClientLocatorOptions(
            "act",
            targetPage.pageId,
            clientOptions,
          );
          return await client.send(StagehandMethods.stagehandAct, {
            pageId: targetPage.pageId,
            instruction,
            ...(operationOptions === undefined ? {} : { options: protocolOptions }),
          });
        },
        observe: async (instruction, operationOptions) => {
          const { page: operationPage, ...clientOptions } =
            StagehandClientObserveOptionsSchema.parse(operationOptions ?? {});
          const targetPage = await resolveOperationPage(operationPage);
          const protocolOptions = serializeClientLocatorOptions(
            "observe",
            targetPage.pageId,
            clientOptions,
          );
          return await client.send(StagehandMethods.stagehandObserve, {
            pageId: targetPage.pageId,
            ...(instruction === undefined ? {} : { instruction }),
            ...(operationOptions === undefined ? {} : { options: protocolOptions }),
          });
        },
        extract: async (...args) => {
          const [instruction, schemaOrOptions, explicitOptions] = args;
          const optionsOnly =
            args.length < 3 &&
            schemaOrOptions !== undefined &&
            StagehandClientExtractOptionsSchema.safeParse(schemaOrOptions).success;
          const schema = optionsOnly ? undefined : schemaOrOptions;
          const clientOptions = optionsOnly
            ? StagehandClientExtractOptionsSchema.parse(schemaOrOptions)
            : explicitOptions === undefined
              ? undefined
              : StagehandClientExtractOptionsSchema.parse(explicitOptions);
          const { page: operationPage, ...optionsWithoutPage } = clientOptions ?? {};
          const targetPage = await resolveOperationPage(operationPage);
          const protocolOptions =
            clientOptions === undefined
              ? undefined
              : serializeClientLocatorOptions("extract", targetPage.pageId, optionsWithoutPage);
          return await client.send(StagehandMethods.stagehandExtract, {
            pageId: targetPage.pageId,
            instruction,
            ...(schema === undefined ? {} : { schema: z.json().parse(schema) }),
            ...(protocolOptions === undefined ? {} : { options: protocolOptions }),
          });
        },
        metrics: async () => await client.send(StagehandMethods.stagehandMetrics, {}),
      };

      const callbackPromise = Promise.resolve().then(() =>
        (callback as CallbackBatchFunction)(stagehand, input),
      );
      const result = await Promise.race([
        callbackPromise,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
            once: true,
          });
        }),
      ]);
      if (result === undefined) return {};
      return { value: jsonRoundTrip(result) };
    } finally {
      clearTimeout(timeoutId);
      if (!controller.signal.aborted) {
        controller.abort(new Error("Stagehand callback batch has completed"));
      }
    }
  }

  return { run };
}

function createCallbackContextFacade(context: BrowserContext): ExperimentalBatchBrowserContext {
  const facade = Object.create(null) as Record<PropertyKey, unknown>;
  const descriptors = Object.getOwnPropertyDescriptors(BrowserContext.prototype);

  for (const [property, descriptor] of Object.entries(descriptors)) {
    if (property === "constructor" || property === "close") continue;

    if (typeof descriptor.value === "function") {
      const method = descriptor.value as (...args: unknown[]) => unknown;
      Object.defineProperty(facade, property, {
        configurable: false,
        enumerable: descriptor.enumerable,
        value: (...args: unknown[]) => Reflect.apply(method, context, args),
        writable: false,
      });
      continue;
    }

    if (descriptor.get) {
      // The facade intentionally invokes the prototype getter with the real context as `this`.
      // oxlint-disable-next-line typescript/unbound-method
      const getter = descriptor.get;
      Object.defineProperty(facade, property, {
        configurable: false,
        enumerable: descriptor.enumerable,
        get: () => Reflect.apply(getter, context, []),
      });
    }
  }

  return Object.freeze(facade) as ExperimentalBatchBrowserContext;
}

function jsonRoundTrip(value: unknown): z.output<ReturnType<typeof z.json>> {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError("Stagehand callback batch result must be JSON-serializable", {
      cause: error,
    });
  }
  if (serialized === undefined) {
    throw new TypeError("Stagehand callback batch result must be JSON-serializable");
  }
  return z.json().parse(JSON.parse(serialized));
}
