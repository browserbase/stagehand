import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeWireValue,
  wireSchema,
} from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import {
  LLMGenerateParamsSchema,
  StagehandInitParamsSchema,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/schemas";
import type {
  BrowserbaseRequestParams,
  ModelConfig,
} from "@browserbasehq/stagehand-protocol/types";
import { executeBrowserbaseRequest } from "../../sdk-ts/src/browserbaseTransport.js";
import { requestBrowserbase } from "../clients/browserbaseClient.js";
import { ChromeRuntimeClient } from "../clients/chromeRuntimeClient.js";
import { RPCClient } from "../clients/rpcClient.js";
import { buildGatewayContext, createGatewayLanguageModel } from "../llm/gatewayClient.js";
import { boundFetch } from "../llm/boundFetch.js";
import { RPCRouter } from "../rpcRouter.js";
import { createStagehandRuntime } from "../runtime.js";
import * as llmService from "../services/llmService.js";

vi.mock("../llm/boundFetch.js", () => ({ boundFetch: vi.fn() }));

const fixtures = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/browserbase-transport.json", import.meta.url),
    "utf8",
  ),
) as {
  connection: { apiKey: string; sessionId: string };
  gateway: {
    input: unknown;
    requestInput: unknown;
    response: unknown;
    result: unknown;
    headers: {
      name: string;
      configured: Record<string, string>;
      expected: Record<string, string>;
    }[];
  };
  httpFailures: {
    name: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    gatewayAttempts: number;
  }[];
};
const input = LLMGenerateParamsSchema.parse(fixtures.gateway.input);
const initParams = StagehandInitParamsSchema.parse({
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "test", version: "1" },
  browserbase: "client",
  browser: { sessionId: fixtures.connection.sessionId },
});
type Reply = { status: number; headers: Record<string, string>; body: string };
const success = (): Reply => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(fixtures.gateway.response),
});
let server: Server;
let apiUrl: string;
let respond: (attempt: number) => Reply | undefined;
const requests: { path: string; headers: IncomingHttpHeaders; body: string }[] = [];
const rpcRequests: BrowserbaseRequestParams[] = [];
let client: RPCClient;
let runtime: ReturnType<typeof createStagehandRuntime>;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      path: request.url ?? "",
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    const reply = respond(requests.length);
    if (!reply) {
      request.socket.destroy();
      return;
    }
    response.writeHead(reply.status, reply.headers);
    response.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/services/v1`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});
beforeEach(() => {
  requests.length = 0;
  rpcRequests.length = 0;
  respond = success;
  vi.mocked(boundFetch).mockRejectedValue(new Error("Unexpected worker HTTP request"));
  const transport = new ChromeRuntimeClient(
    {
      send(payload: string) {
        const message = JSON.parse(payload) as { id: number; method: string; params: unknown };
        if (message.method !== "browserbase.request")
          throw new Error("Unexpected reverse RPC method");
        const params = wireSchema(StagehandMethods.browserbaseRequest.params).parse(message.params);
        rpcRequests.push(params);
        void executeBrowserbaseRequest({ ...fixtures.connection, apiUrl }, params).then((result) =>
          transport.receive(
            JSON.stringify({ jsonrpc: "2.0", id: message.id, result: encodeWireValue(result) }),
          ),
        );
      },
    },
    "send",
  );
  runtime = createStagehandRuntime({
    clientBrowserbaseRequest: (params, signal) => requestBrowserbase(client, params, signal),
  });
  runtime.state.setState({ status: "initialized", initParams });
  client = new RPCClient(transport, new RPCRouter(runtime));
});
afterEach(() => {
  client.close();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function generate(config?: ModelConfig) {
  return llmService.generate(
    config,
    input,
    vi.fn(),
    buildGatewayContext(initParams, runtime.adapters.clientBrowserbaseRequest),
  );
}

describe("Model Gateway through client HTTP", () => {
  it.each(fixtures.gateway.headers)("preserves $name", async ({ configured, expected }) => {
    await expect(generate({ modelName: "openai/gpt-5", headers: configured })).resolves.toEqual(
      fixtures.gateway.result,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: "/services/v1/llm/responses",
      headers: { ...expected, "content-type": "application/json" },
    });
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      model: "openai/gpt-5",
      input: fixtures.gateway.requestInput,
    });
    expect(rpcRequests[0]).toMatchObject({ operation: "gateway.responses" });
    expect(boundFetch).not.toHaveBeenCalled();
  });

  it.each(["Authorization", "authorization", "AUTHORIZATION"])(
    "preserves explicit empty %s",
    async (name) => {
      await generate({ modelName: "openai/gpt-5", headers: { [name]: "" } });
      expect(rpcRequests[0]!.headers.authorization).toBe("");
      expect(requests[0]!.headers.authorization).toBe("");
    },
  );

  it("omits only the generated authorization default", async () => {
    await generate();
    expect(rpcRequests[0]!.headers).not.toHaveProperty("authorization");
    expect(rpcRequests[0]!.headers).not.toHaveProperty("x-bb-api-key");
    expect(requests[0]!.headers.authorization).toBe(`Bearer ${fixtures.connection.apiKey}`);
    const literal = "Bearer stagehand-client-gateway";
    await generate({
      modelName: "openai/gpt-5",
      headers: { Authorization: literal, "x-custom": literal },
    });
    expect(rpcRequests[1]!.headers).toMatchObject({ authorization: literal, "x-custom": literal });
    expect(requests[1]!.headers.authorization).toBe(literal);
  });

  it("omits the automatic model through both service and runtime entry points", async () => {
    await generate({ modelName: "groq/openai/future-model" });
    await generate();
    await expect(runtime.generateLlm(input)).resolves.toEqual(fixtures.gateway.result);
    const { model, ...rest } = JSON.parse(requests[0]!.body) as Record<string, unknown>;
    expect(model).toBe("groq/openai/future-model");
    expect(JSON.parse(requests[1]!.body)).toEqual(rest);
    expect(JSON.parse(requests[2]!.body)).toEqual(rest);
    expect(boundFetch).not.toHaveBeenCalled();
  });

  it("keeps structured output and tools under AI SDK formatting", async () => {
    const response = JSON.parse(JSON.stringify(fixtures.gateway.response));
    response.output[0].content[0].text = '{"greeting":"hi"}';
    respond = () => ({ ...success(), body: JSON.stringify(response) });
    const result = await llmService.generate(
      { modelName: "openai/gpt-5" },
      {
        ...input,
        responseFormat: {
          type: "json_schema",
          name: "greeting",
          schema: {
            type: "object",
            properties: { greeting: { type: "string" } },
            required: ["greeting"],
            additionalProperties: false,
          },
        },
      },
      vi.fn(),
      buildGatewayContext(initParams, runtime.adapters.clientBrowserbaseRequest),
    );
    expect(result).toMatchObject({
      outputFormat: "json_schema",
      structuredContent: { greeting: "hi" },
    });
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      text: { format: { type: "json_schema", name: "greeting" } },
    });
    await llmService.generate(
      { modelName: "openai/gpt-5" },
      {
        ...input,
        tools: [
          {
            name: "get_weather",
            description: "Weather",
            inputSchema: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        ],
        toolChoice: { mode: "required" },
      },
      vi.fn(),
      buildGatewayContext(initParams, runtime.adapters.clientBrowserbaseRequest),
    );
    expect(JSON.parse(requests[1]!.body)).toMatchObject({
      tools: [{ type: "function", name: "get_weather" }],
      tool_choice: "required",
    });
  });

  it.each(fixtures.httpFailures)(
    "preserves $name retries through the client",
    async ({ status, headers, body, gatewayAttempts }) => {
      respond = () => ({ status, headers, body });
      const error: unknown = await generate().catch((error: unknown) => error);
      expect(requests).toHaveLength(gatewayAttempts);
      expect(rpcRequests).toHaveLength(gatewayAttempts);
      expect(new Set(requests.map(({ body }) => body)).size).toBe(1);
      const last =
        error && typeof error === "object" && "lastError" in error ? error.lastError : error;
      expect(last).toMatchObject({
        statusCode: status,
        responseBody: body,
        isRetryable: gatewayAttempts > 1,
      });
      expect(boundFetch).not.toHaveBeenCalled();
    },
  );

  it("lets AI SDK retry an upstream connection failure", async () => {
    respond = (attempt) => (attempt === 1 ? undefined : success());
    await expect(generate()).resolves.toEqual(fixtures.gateway.result);
    expect(requests).toHaveLength(2);
    expect(rpcRequests).toHaveLength(2);
    expect(requests[1]!.body).toBe(requests[0]!.body);
  });

  it("leaves direct provider inference in the worker", async () => {
    vi.mocked(boundFetch).mockResolvedValue(
      new Response(success().body, { headers: success().headers }),
    );
    await expect(generate({ modelName: "openai/gpt-5", apiKey: "provider-key" })).resolves.toEqual(
      fixtures.gateway.result,
    );
    expect(boundFetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer provider-key" }),
      }),
    );
    expect(rpcRequests).toEqual([]);
  });

  it("preserves custom LLM generation and stop-sequence rejection", async () => {
    const custom = vi.fn().mockResolvedValue(fixtures.gateway.result);
    await llmService.generate(
      { source: "client" },
      input,
      custom,
      buildGatewayContext(initParams, runtime.adapters.clientBrowserbaseRequest),
    );
    expect(custom).toHaveBeenCalledOnce();
    await expect(
      llmService.generate(
        undefined,
        { ...input, stopSequences: ["STOP"] },
        custom,
        buildGatewayContext(initParams, runtime.adapters.clientBrowserbaseRequest),
      ),
    ).rejects.toThrow("does not support stop sequences");
    expect(rpcRequests).toEqual([]);
    expect(boundFetch).not.toHaveBeenCalled();
  });

  it("never falls back when the client adapter is missing or disconnected", async () => {
    const context = buildGatewayContext({ ...initParams, apiKey: "legacy-key", apiUrl }, undefined);
    await expect(llmService.generate(undefined, input, vi.fn(), context)).rejects.toThrow(
      "transport is unavailable",
    );
    client.close();
    await expect(generate()).rejects.toThrow("connection is disconnected");
    expect(rpcRequests).toEqual([]);
    expect(boundFetch).not.toHaveBeenCalled();
  });

  it("passes AI SDK cancellation to the client request", async () => {
    const controller = new AbortController();
    let forwardedSignal: AbortSignal | undefined;
    const request = vi.fn((_params: BrowserbaseRequestParams, signal?: AbortSignal) => {
      forwardedSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const model = createGatewayLanguageModel(undefined, {
      source: "client",
      sessionId: "session",
      request,
    });
    const pending = generateText({ model, prompt: "Hi", abortSignal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(forwardedSignal?.aborted).toBe(true);
    expect(boundFetch).not.toHaveBeenCalled();
  });

  it("does not infer client availability from an installed adapter alone", () => {
    const request = runtime.adapters.clientBrowserbaseRequest;
    expect(buildGatewayContext({ ...initParams, browserbase: undefined }, request)).toBeUndefined();
    expect(buildGatewayContext({ ...initParams, browser: undefined }, request)).toBeUndefined();
    expect(
      buildGatewayContext({ ...initParams, browserbase: undefined, apiKey: "legacy" }, request),
    ).toMatchObject({ apiKey: "legacy", apiUrl: "https://api.stagehand.browserbase.com/v1" });
    expect(buildGatewayContext(initParams, request)).toEqual({
      source: "client",
      sessionId: fixtures.connection.sessionId,
      request,
    });
  });
});
