import { SwaggerOptions } from "@fastify/swagger";

declare module "fastify" {
  interface FastifyInstance {
    swagger: (opts?: { yaml?: boolean }) => Promise<string>;
    swaggerCSP?: unknown;
  }
}

// Create a custom declaration for the fastifySwagger module
declare module "@fastify/swagger" {
  export default function fastifySwagger(options: SwaggerOptions): unknown;
}
