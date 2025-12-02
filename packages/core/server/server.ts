import { type ConnectRouter } from "@connectrpc/connect";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { createValidateInterceptor } from "@connectrpc/validate";
import { fastify } from "fastify";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { StagehandPingService } from "../gen/stagehand/v1/ping_pb";

export const routes = (router: ConnectRouter) =>
  router.service(StagehandPingService, {
    async ping(req) {
      return {
        clientSendTime: req.clientSendTime,
        serverSendTime: timestampNow(),
      };
    },
  });

async function main() {
  const server = fastify();
  await server.register(fastifyConnectPlugin, {
    interceptors: [createValidateInterceptor()],
    routes,
  });
  await server.listen({ host: "localhost", port: 8080 });
  console.log("server is listening at", server.addresses());
}

void main();
