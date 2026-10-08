import type {
  WebMCPAnnotation,
  WebMCPInvocationDescriptor,
  WebMCPToolDescriptor,
  WebMCPToolResponse,
} from "@browserbasehq/stagehand-protocol/types";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type { WebMCPInvokeOptions, WebMCPResultOptions } from "./clientSchemas.js";
import type { StagehandCommandClient } from "./commandClient.js";

export class WebMCPTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: WebMCPToolDescriptor["inputSchema"];
  readonly annotations?: WebMCPAnnotation;
  readonly frameId: string;
  readonly backendNodeId?: number;

  readonly #rpcClient: StagehandCommandClient;
  readonly #pageId: string;

  constructor(rpcClient: StagehandCommandClient, pageId: string, descriptor: WebMCPToolDescriptor) {
    this.#rpcClient = rpcClient;
    this.#pageId = pageId;
    this.name = descriptor.name;
    this.description = descriptor.description;
    this.inputSchema = descriptor.inputSchema;
    this.annotations = descriptor.annotations;
    this.frameId = descriptor.frameId;
    this.backendNodeId = descriptor.backendNodeId;
  }

  async invoke(options?: WebMCPInvokeOptions): Promise<WebMCPInvocation> {
    const descriptor = await this.#rpcClient.send(StagehandMethods.pageWebMCPInvokeTool, {
      pageId: this.#pageId,
      frameId: this.frameId,
      toolName: this.name,
      input: options?.input ?? {},
    });
    return new WebMCPInvocation(this.#rpcClient, this.#pageId, descriptor);
  }
}

export class WebMCPInvocation {
  readonly invocationId: string;
  readonly toolName: string;
  readonly frameId: string;
  readonly input: WebMCPInvocationDescriptor["input"];

  readonly #rpcClient: StagehandCommandClient;
  readonly #pageId: string;
  #terminalResult?: WebMCPToolResponse;

  constructor(
    rpcClient: StagehandCommandClient,
    pageId: string,
    descriptor: WebMCPInvocationDescriptor,
  ) {
    this.#rpcClient = rpcClient;
    this.#pageId = pageId;
    this.invocationId = descriptor.invocationId;
    this.toolName = descriptor.toolName;
    this.frameId = descriptor.frameId;
    this.input = descriptor.input;
  }

  async result(options?: WebMCPResultOptions): Promise<WebMCPToolResponse> {
    if (this.#terminalResult !== undefined) return this.#terminalResult;

    const result = await this.#rpcClient.send(StagehandMethods.pageWebMCPInvocationResult, {
      pageId: this.#pageId,
      invocationId: this.invocationId,
      ...(options ? { options } : {}),
    });
    this.#terminalResult ??= result;
    return this.#terminalResult;
  }

  async cancel(): Promise<void> {
    await this.#rpcClient.send(StagehandMethods.pageWebMCPCancelInvocation, {
      pageId: this.#pageId,
      invocationId: this.invocationId,
    });
  }
}
