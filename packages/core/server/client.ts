import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { StagehandPingService } from "../gen/stagehand/v1/ping_pb";
import {
  pingRequestSchema,
  pingResponseSchema,
  timestampFromSecondsAndNanos,
} from "./schema/ping";

async function main() {
  const transport = createConnectTransport({
    baseUrl: "http://localhost:8080",
    httpVersion: "1.1",
  });

  const client = createClient(StagehandPingService, transport);

  const t0 = Date.now();
  const parsedRequest = pingRequestSchema.parse({
    clientSendTime: timestampFromDate(new Date(t0)),
  });
  // Convert Zod-validated plain object back to Timestamp Message for gRPC client
  const pingRequest = {
    clientSendTime: timestampFromSecondsAndNanos(parsedRequest.clientSendTime),
  };
  const rawResponse = await client.ping(pingRequest);
  const pingResponse = pingResponseSchema.parse(rawResponse);

  const t3 = Date.now();
  const rtt = t3 - t0;
  const latency = rtt / 2;
  const clientSendTimeMs = timestampDate(pingResponse.clientSendTime).getTime();
  const serverSendTimeMs = timestampDate(pingResponse.serverSendTime).getTime();
  const offset = serverSendTimeMs - (t0 + latency);

  console.log(
    JSON.stringify(
      {
        clientSendTime: clientSendTimeMs,
        serverSendTime: serverSendTimeMs,
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
