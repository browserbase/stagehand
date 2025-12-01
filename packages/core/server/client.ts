import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { StagehandPingService } from "../gen/stagehand/v1/ping_pb";
import { pingRequestSchema, pingResponseSchema } from "./schema/ping";

function ensureValidRequest(payload: unknown) {
  const result = pingRequestSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid PingRequest: ${result.error.message}`);
  }
  return result.data;
}

function ensureValidResponse(payload: unknown) {
  const result = pingResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid PingResponse: ${result.error.message}`);
  }
  return result.data;
}

async function main() {
  const transport = createConnectTransport({
    baseUrl: "http://localhost:8080",
    httpVersion: "1.1",
  });

  const client = createClient(StagehandPingService, transport);

  const pingResponse = ensureValidResponse(
    await client.ping(ensureValidRequest({ message: "hello" })),
  );
  console.log("ping ->", pingResponse.message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
