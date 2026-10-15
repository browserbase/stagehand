import {
  encodeWireValue,
  wireSchema,
} from "@browserbasehq/stagehand-protocol/json-rpc/wire-casing";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  BrowserbaseRequestParams,
  LLMGenerateParams,
  LLMGenerateResult,
} from "@browserbasehq/stagehand-protocol/types";
import type { BrowserbaseConnection } from "../../../sdk-ts/src/browserbaseConnection.js";
import { executeBrowserbaseRequest } from "../../../sdk-ts/src/browserbaseTransport.js";
import { requestBrowserbase } from "../../clients/browserbaseClient.js";
import { ChromeRuntimeClient } from "../../clients/chromeRuntimeClient.js";
import { RPCClient } from "../../clients/rpcClient.js";
import { RPCRouter } from "../../rpcRouter.js";
import { createStagehandRuntime } from "../../runtime.js";

export type WireMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
};

export function createBrowserbaseTestBridge(
  connection: BrowserbaseConnection,
  generate?: (params: LLMGenerateParams) => LLMGenerateResult,
) {
  const messages: WireMessage[] = [];
  const requests: BrowserbaseRequestParams[] = [];
  const pendingReplies: Promise<void>[] = [];
  const reply = (id: number | undefined, result: unknown) =>
    transport.receive(JSON.stringify({ jsonrpc: "2.0", id, result: encodeWireValue(result) }));
  const transport = new ChromeRuntimeClient(
    {
      send(payload: string) {
        const message = JSON.parse(payload) as WireMessage;
        messages.push(message);
        if (message.method === "browserbase.request") {
          const params = wireSchema(StagehandMethods.browserbaseRequest.params).parse(
            message.params,
          );
          requests.push(params);
          pendingReplies.push(
            executeBrowserbaseRequest(connection, params).then((result) =>
              reply(message.id, result),
            ),
          );
        } else if (message.method === "llm.generate" && generate) {
          const params = wireSchema(StagehandMethods.llmGenerate.params).parse(message.params);
          pendingReplies.push(reply(message.id, generate(params)));
        }
      },
    },
    "send",
  );
  const runtime = createStagehandRuntime({
    clientBrowserbaseRequest: (params, signal) => requestBrowserbase(rpc, params, signal),
    clientLLMGenerate: (params) => rpc.send(StagehandMethods.llmGenerate, params),
  });
  const rpc = new RPCClient(transport, new RPCRouter(runtime));
  return { runtime, rpc, transport, messages, requests, pendingReplies };
}
