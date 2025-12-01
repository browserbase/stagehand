import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { fastify } from "fastify";
import { createValidateInterceptor } from "@connectrpc/validate";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import routes from "../../server/connect";
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
      clientSendTime: timestampFromDate(new Date(clientSendTime)),
    });
    expect(timestampDate(response.clientSendTime).getTime()).toBe(
      clientSendTime,
    );
    expect(
      timestampDate(response.serverSendTime).getTime(),
    ).toBeGreaterThanOrEqual(clientSendTime);
  });

  it("rejects invalid payloads", async () => {
    const client = createClient(
      StagehandPingService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" }),
    );
    await expect(
      client.ping({
        clientSendTime: {
          seconds: BigInt(0),
          nanos: 0,
        },
      }),
    ).rejects.toMatchObject({
      code: Code.InvalidArgument,
    });
  });
});
