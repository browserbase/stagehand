import fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import {
  fastifyZodOpenApiPlugin,
  fastifyZodOpenApiTransformers,
  serializerCompiler,
  validatorCompiler,
  type FastifyZodOpenApiTypeProvider,
} from "fastify-zod-openapi";
import { StatusCodes } from "http-status-codes";
import { env } from "./env.js";
import healthcheckRoute from "./routes/healthcheck.js";
import readinessRoute from "./routes/readiness.js";
import { browserSessionRoutesPlugin } from "./routes/v4/browsersession/routes.js";
import { llmRoutesPlugin } from "./routes/v4/llms/routes.js";
import { pageRoutesPlugin } from "./routes/v4/page/routes.js";
import { browserSessionOpenApiComponents } from "./schemas/v4/browserSession.js";
import { llmOpenApiComponents } from "./schemas/v4/llm.js";
import { pageOpenApiComponents } from "./schemas/v4/page.js";

export const buildApp = async () => {
  const app = fastify({
    logger: true,
    return503OnClosing: false,
  });

  const defaultJsonParser = app.getDefaultJsonParser("error", "error");
  app.addContentTypeParser<string>(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      if (body === "" || (Buffer.isBuffer(body) && body.length === 0)) {
        done(null, {});
        return;
      }

      void defaultJsonParser(request, body, done);
    },
  );

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyZodOpenApiPlugin, {
    components: {
      schemas: {
        ...browserSessionOpenApiComponents.schemas,
        ...llmOpenApiComponents.schemas,
        ...pageOpenApiComponents.schemas,
      },
    },
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Stagehand API",
        version: "3.0.5",
      },
      openapi: "3.1.0",
      tags: [
        {
          name: "browserSession",
          description: "Browser session lifecycle and browser-scoped actions",
        },
        {
          name: "llm",
          description: "Reusable llm configuration resources",
        },
        {
          name: "page",
          description: "Page-scoped actions and action history endpoints",
        },
      ],
    },
    ...fastifyZodOpenApiTransformers,
  });

  if (env.NODE_ENV === "development") {
    await app.register(fastifySwaggerUI, {
      routePrefix: "/documentation",
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { validation?: unknown[] }).validation
      ? StatusCodes.BAD_REQUEST
      : ((error as { statusCode?: number }).statusCode ??
        StatusCodes.INTERNAL_SERVER_ERROR);
    const errorMessage = (error as { validation?: unknown[] }).validation
      ? "Request validation failed"
      : error instanceof Error
        ? error.message
        : String(error);

    reply.status(statusCode).send({
      error:
        statusCode === Number(StatusCodes.INTERNAL_SERVER_ERROR)
          ? "Internal Server Error"
          : errorMessage,
      statusCode,
    });
  });

  const appWithTypes = app.withTypeProvider<FastifyZodOpenApiTypeProvider>();

  await appWithTypes.register(browserSessionRoutesPlugin, { prefix: "/v4" });
  await appWithTypes.register(llmRoutesPlugin, { prefix: "/v4" });
  await appWithTypes.register(pageRoutesPlugin, { prefix: "/v4" });

  appWithTypes.route(healthcheckRoute);
  appWithTypes.route(readinessRoute);

  return app;
};
