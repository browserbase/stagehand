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

import { browserSessionOpenApiComponents } from "./schemas/v4/browserSession.js";
import { pageOpenApiComponents } from "./schemas/v4/page.js";
import healthcheckRoute from "./routes/healthcheck.js";
import readinessRoute, { setReady, setUnready } from "./routes/readiness.js";
import { browserSessionRoutesPlugin } from "./routes/v4/browsersession/routes.js";
import { pageRoutesPlugin } from "./routes/v4/page/routes.js";

const app = fastify({
  logger: false,
  return503OnClosing: false,
});

// Allow requests with `Content-Type: application/json` and an empty body (0 bytes).
// Some clients always send the header even when there is no request body (e.g. /end).
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

const start = async () => {
  try {
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    await app.register(fastifyZodOpenApiPlugin, {
      components: {
        schemas: {
          ...browserSessionOpenApiComponents.schemas,
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
            name: "page",
            description: "Page-scoped actions and action history endpoints",
          },
        ],
      },
      ...fastifyZodOpenApiTransformers,
    });

    // Only register Swagger UI in development - SEA binaries can't load static files
    if (process.env.NODE_ENV === "development") {
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
    await appWithTypes.register(pageRoutesPlugin, { prefix: "/v4" });

    // Register health and readiness routes at the root level
    appWithTypes.route(healthcheckRoute);
    appWithTypes.route(readinessRoute);
    await app.ready();

    await app.listen({
      host: "0.0.0.0",
      port: parseInt(process.env.PORT ?? "3000", 10),
    });
    setReady();
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

const shutdown = async () => {
  setUnready();
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => {
  shutdown().catch((err: unknown) => {
    console.error("Failed to shut down cleanly:", err);
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown().catch((err: unknown) => {
    console.error("Failed to shut down cleanly:", err);
    process.exit(1);
  });
});

start().catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
