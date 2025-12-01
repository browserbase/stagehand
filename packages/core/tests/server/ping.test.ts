import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { fastify } from "fastify";
import { createValidateInterceptor } from "@connectrpc/validate";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import routes from "../../server/connect";
import { StagehandPingService } from "../../gen/stagehand/v1/ping_pb";

const TEST_HOST = "127.0.0.1";
const TEST_PORT = 7357; // use ephemeral port

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

  it("responds with pong prefix", async () => {
    const client = createClient(
      StagehandPingService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" }),
    );
    const response = await client.ping({ message: "hello" });
    expect(response).toMatchObject({ message: "pong: hello" });
  });

  it("rejects invalid payloads", async () => {
    const client = createClient(
      StagehandPingService,
      createConnectTransport({ baseUrl, httpVersion: "1.1" }),
    );
    await expect(client.ping({ message: "" })).rejects.toMatchObject({
      code: Code.InvalidArgument,
    });
  });
});
