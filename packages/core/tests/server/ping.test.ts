import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { fastify } from "fastify";
import { createValidateInterceptor } from "@connectrpc/validate";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { timestampFromMs, timestampMs } from "@bufbuild/protobuf/wkt";
import { routes } from "../../server/server";
import { StagehandPingService } from "../../gen/stagehand/v1/ping_pb";

const TEST_HOST = "127.0.0.1";
const TEST_PORT = 0; // use ephemeral port

describe("Stagehand Ping RPC", () => {
  const server = fastify();
  let baseUrl: string;

  beforeAll(async () => {
    await server.register(fastifyConnectPlugin, {
      interceptors: [createValidateInterceptor()],
      routes,
    });
    baseUrl = await server.listen({ host: TEST_HOST, port: TEST_PORT });
  });

  afterAll(async () => {
    await server.close();
  });

  it("responds with server timestamp echoing client timestamp", async () => {
    const client = createClient(
      StagehandPingService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" }),
    );
    const clientSendTime = Date.now();
    const response = await client.ping({
      clientSendTime: timestampFromMs(clientSendTime),
    });
    expect(timestampMs(response.clientSendTime)).toBe(clientSendTime);
    expect(timestampMs(response.serverSendTime)).toBeGreaterThanOrEqual(
      clientSendTime,
    );
  });

  it("rejects invalid timestamp structure", async () => {
    const client = createClient(
      StagehandPingService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" }),
    );
    await expect(
      client.ping({
        clientSendTime: {
          seconds: "not a bigint" as never, // Wrong type
          nanos: "not a number" as never, // Wrong type
        } as never,
      }),
    ).rejects.toMatchObject({
      code: Code.Internal,
    });
  });

  it("calculates RTT, latency, and clock offset correctly", async () => {
    const client = createClient(
      StagehandPingService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" }),
    );

    const t0 = Date.now();
    const pingResponse = await client.ping({
      clientSendTime: timestampFromMs(t0),
    });

    const t3 = Date.now();
    const rtt = t3 - t0;
    const latency = rtt / 2;
    const clientSendTimeMs = timestampMs(pingResponse.clientSendTime);
    const serverSendTimeMs = timestampMs(pingResponse.serverSendTime);
    const offset = serverSendTimeMs - (t0 + latency);

    // RTT should be positive and reasonable (less than 1 second for local test)
    expect(rtt).toBeGreaterThan(0);
    expect(rtt).toBeLessThan(1000);

    // Latency should be half of RTT
    expect(latency).toBe(rtt / 2);

    // Client send time should match what we sent
    expect(clientSendTimeMs).toBe(t0);

    // Server send time should be after client send time
    expect(serverSendTimeMs).toBeGreaterThanOrEqual(t0);

    // Clock offset should be reasonable (within a few seconds for local test)
    expect(Math.abs(offset)).toBeLessThan(5000);
  });
});
