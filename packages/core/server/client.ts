import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { StagehandPingService } from "../gen/stagehand/v1/ping_pb";
import { pingRequestSchema, pingResponseSchema } from "./schema/ping";

async function main() {
  const transport = createConnectTransport({
    baseUrl: "http://localhost:8080",
    httpVersion: "1.1",
  });

  const client = createClient(StagehandPingService, transport);

  const t0 = Date.now();
  const pingRequest = pingRequestSchema.parse({ clientSendTime: BigInt(t0) });
  const rawResponse = await client.ping(pingRequest);
  const pingResponse = pingResponseSchema.parse(rawResponse);

  const t3 = Date.now();
  const rtt = t3 - t0;
  const latency = rtt / 2;
  const offset = Number(pingResponse.serverSendTime) - (t0 + latency);

  console.log(
    JSON.stringify(
      {
        clientSendTime: Number(pingResponse.clientSendTime),
        serverSendTime: Number(pingResponse.serverSendTime),
        rtt,
        latency,
        offset,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
