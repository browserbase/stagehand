import type { RPCMethod } from "../protocol/json-rpc/schemas.js";
import { encodeWireValue } from "../protocol/json-rpc/wire-casing.js";
import { StagehandMethods, StagehandRpcRequestSchema } from "../protocol/schema-registry.js";
import type { Action, StagehandMetrics } from "../protocol/types.js";
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
import type { StagehandCommandClient } from "../sdk-ts/src/commandClient.js";
import { Page } from "../sdk-ts/src/page.js";
import type { RPCRouter } from "./rpcRouter.js";

export type CallbackBatchOptions = {
  pageId?: string;
  timeout: number;
};

export type CallbackBatchEnvelope =
  | { ok: true; value: unknown; valueIsUndefined?: false }
  | { ok: true; valueIsUndefined: true }
  | { ok: false; error: { name: string; message: string; stack?: string } };

export type CallbackBatchFunction = (stagehand: CallbackStagehand, input: unknown) => unknown;

class InProcessCommandClient implements StagehandCommandClient {
  #nextRequestId = 1;

  constructor(
    private readonly router: RPCRouter,
    private readonly signal: AbortSignal,
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
    });
    const result = await this.router.handle(request);
    this.throwIfAborted();
    return method.result.parse(result) as z.output<Method["result"]>;
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

export function installCallbackBatchRunner(
  scope: {
    __stagehandRunCallbackBatch?: (
      callback: CallbackBatchFunction,
      input: unknown,
      options: CallbackBatchOptions,
    ) => Promise<CallbackBatchEnvelope>;
  },
  router: RPCRouter,
): void {
  let active = false;

  scope.__stagehandRunCallbackBatch = async (callback, input, options) => {
    if (active) return failure(new Error("Another Stagehand callback batch is already running"));
    if (typeof callback !== "function") {
      return failure(new TypeError("Stagehand callback batch requires a function"));
    }
    if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
      return failure(new RangeError("Stagehand callback batch timeout must be greater than zero"));
    }

    active = true;
    let callbackPromise: Promise<unknown> | undefined;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Stagehand callback batch timed out after ${options.timeout}ms`));
    }, options.timeout);

    try {
      const client = new InProcessCommandClient(router, controller.signal);
      const context = new BrowserContext(client);
      const pages = await context.pages();
      const page = options.pageId
        ? pages.find((candidate) => candidate.pageId === options.pageId)
        : await context.activePage();
      if (!page) {
        throw new Error(
          options.pageId
            ? `Stagehand callback batch page was not found: ${options.pageId}`
            : "Stagehand has no active page.",
        );
      }

      const stagehand: CallbackStagehand = {
        page,
        context: createCallbackContextFacade(context),
        act: async (instruction, operationOptions) => {
          const { page: operationPage, ...protocolOptions } = StagehandClientActOptionsSchema.parse(
            operationOptions ?? {},
          );
          return await client.send(StagehandMethods.stagehandAct, {
            pageId: (operationPage ?? page).pageId,
            instruction,
            ...(operationOptions === undefined ? {} : { options: protocolOptions }),
          });
        },
        observe: async (instruction, operationOptions) => {
          const { page: operationPage, ...protocolOptions } =
            StagehandClientObserveOptionsSchema.parse(operationOptions ?? {});
          return await client.send(StagehandMethods.stagehandObserve, {
            pageId: (operationPage ?? page).pageId,
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
          const { page: operationPage, ...protocolOptions } = clientOptions ?? {};
          return await client.send(StagehandMethods.stagehandExtract, {
            pageId: (operationPage ?? page).pageId,
            instruction,
            ...(schema === undefined ? {} : { schema: z.json().parse(schema) }),
            ...(clientOptions === undefined ? {} : { options: protocolOptions }),
          });
        },
        metrics: async () => await client.send(StagehandMethods.stagehandMetrics, {}),
      };

      callbackPromise = Promise.resolve().then(() => callback(stagehand, input));
      void callbackPromise
        .finally(() => {
          active = false;
        })
        .catch(() => {});
      const result = await Promise.race([
        callbackPromise,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
            once: true,
          });
        }),
      ]);
      if (result === undefined) return { ok: true, valueIsUndefined: true };
      return { ok: true, value: jsonRoundTrip(result) };
    } catch (error) {
      return failure(error);
    } finally {
      clearTimeout(timeoutId);
      if (!callbackPromise) active = false;
    }
  };
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

function jsonRoundTrip(value: unknown): unknown {
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
  return JSON.parse(serialized) as unknown;
}

function failure(error: unknown): CallbackBatchEnvelope {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    ok: false,
    error: {
      name: normalized.name,
      message: normalized.message,
      ...(normalized.stack ? { stack: normalized.stack } : {}),
    },
  };
}
