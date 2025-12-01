import { createValidateInterceptor } from "@connectrpc/validate";
import { fastify } from "fastify";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import routes from "./connect";

async function main() {
  const server = fastify();
  await server.register(fastifyConnectPlugin, {
    interceptors: [createValidateInterceptor()],
    routes,
  });
  server.get("/", (_, reply) => {
    reply.type("text/plain");
    reply.send("Hello World!");
  });
  await server.listen({ host: "localhost", port: 8080 });
  console.log("server is listening at", server.addresses());
}

void main();
