import { randomUUID } from "crypto";

import cors from "@fastify/cors";
import fastify from "fastify";
import metricsPlugin from "fastify-metrics";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import {
  fastifyZodOpenApiPlugin,
  fastifyZodOpenApiTransformers,
  serializerCompiler,
  validatorCompiler,
  type FastifyZodOpenApiTypeProvider,
  RequestValidationError,
  ResponseSerializationError,
} from "fastify-zod-openapi";
import { StatusCodes } from "http-status-codes";

import { logging } from "./lib/logging/index.js";
import {
  destroySessionStore,
  initializeSessionStore,
} from "./lib/sessionStoreManager.js";
import healthcheckRoute from "./routes/healthcheck.js";
import readinessRoute, { setReady, setUnready } from "./routes/readiness.js";
import actRoute from "./routes/v1/sessions/_id/act.js";
import agentExecuteRoute from "./routes/v1/sessions/_id/agentExecute.js";
import endRoute from "./routes/v1/sessions/_id/end.js";
import extractRoute from "./routes/v1/sessions/_id/extract.js";
import navigateRoute from "./routes/v1/sessions/_id/navigate.js";
import observeRoute from "./routes/v1/sessions/_id/observe.js";
import startRoute from "./routes/v1/sessions/start.js";

// Constants for graceful shutdown
const READY_WAIT_PERIOD = 10_000; // 10 seconds
const GRACEFUL_SHUTDOWN_PERIOD = 30_000; // 30 seconds

const app = fastify({
  disableRequestLogging: true,

  genReqId: () => {
    return randomUUID();
  },

  logger: {
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },

    level: process.env.NODE_ENV === "production" ? "info" : "trace",

    ...(process.env.NODE_ENV === "development" && {
      transport: {
        options: {
          colorize: true,
          ignore: "pid,hostname",
        },
        target: "pino-pretty",
      },
    }),
  },

  return503OnClosing: false,
});

export const logger = app.log;

process.on("uncaughtException", (error) => {
  app.log.error(error, "Uncaught Exception:");
});

process.on("unhandledRejection", (reason, promise) => {
  app.log.error(
    reason instanceof Error ? reason : new Error(String(reason)),
    "Unhandled Rejection at:",
    promise,
    "reason:",
    reason,
  );
});

// Graceful shutdown handler
const gracefulShutdown = async () => {
  app.log.info("gracefulShutdown");

  setUnready();

  await new Promise((resolve) => setTimeout(resolve, READY_WAIT_PERIOD));

  const timeout = setTimeout(() => {
    app.log.warn("forcefully shutting down after 30 seconds");
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_PERIOD);

  timeout.unref();

  await app.close();
  await destroySessionStore();
  clearTimeout(timeout);

  app.log.info("gracefulShutdown complete");
  process.exit(0);
};

// Handle termination signals
process.on("SIGTERM", () => {
  gracefulShutdown().catch((err: unknown) => {
    app.log.error(err, "error gracefully shutting down");
  });
});

process.on("SIGINT", () => {
  gracefulShutdown().catch((err: unknown) => {
    app.log.error(err, "error gracefully shutting down");
  });
});

const start = async () => {
  try {
    if (process.env.NODE_ENV === "development") {
      await app.register(cors, {
        origin: ["http://localhost:3000"],
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["*"],
        credentials: true,
      });
    }

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    await app.register(fastifyZodOpenApiPlugin);

    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: "Stagehand API",
          version: "3.0.5",
        },
        openapi: "3.1.0",
      },
      ...fastifyZodOpenApiTransformers,
    });

    // Only register Swagger UI in development - SEA binaries can't load static files
    if (process.env.NODE_ENV === "development") {
      await app.register(fastifySwaggerUI, {
        routePrefix: "/documentation",
      });
    }

    app.setSchemaErrorFormatter(function (errors, dataVar) {
      const zodIssues = errors
        .filter((err) => err instanceof RequestValidationError)
        .map((err) => err.params.issue);
      this.log.warn({ dataVar, zodIssues }, "request validation failed");
      return new Error(`${dataVar} validation failed`);
    });

    app.setErrorHandler((error, request, reply) => {
      if ((error as { validation?: unknown }).validation) {
        const zodIssues = (error as { validation: unknown[] }).validation
          .filter((err) => err instanceof RequestValidationError)
          .map((err) => (err as RequestValidationError).params.issue);

        request.log.warn({ zodIssues }, "request validation failed");
        return reply.status(StatusCodes.UNPROCESSABLE_ENTITY).send({
          error: "Request validation failed",
          issues: zodIssues,
        });
      }

      if (error instanceof ResponseSerializationError) {
        request.log.error({ err: error }, "response serialization failed");
        return reply
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send({ error: "Response validation failed" });
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      request.log.error(`Server error: ${errorMessage}`);

      const statusCode =
        (error as { statusCode?: number }).statusCode ??
        StatusCodes.INTERNAL_SERVER_ERROR;

      reply.status(statusCode).send({
        error:
          statusCode === Number(StatusCodes.INTERNAL_SERVER_ERROR)
            ? "Internal Server Error"
            : errorMessage,
        statusCode,
      });
    });

    await app.register(metricsPlugin, {
      defaultMetrics: {
        enabled: true,
        prefix: "stagehand_api_",
      },
      routeMetrics: {
        overrides: {
          histogram: {
            name: "stagehand_api_http_request_duration_seconds",
          },
          summary: {
            name: "stagehand_api_http_request_summary_seconds",
          },
        },
      },
    });

    initializeSessionStore();

    const appWithTypes = app.withTypeProvider<FastifyZodOpenApiTypeProvider>();

    await appWithTypes.register(
      (instance, _opts, done) => {
        instance.route(actRoute);
        instance.route(endRoute);
        instance.route(extractRoute);
        instance.route(navigateRoute);
        instance.route(observeRoute);
        instance.route(startRoute);
        instance.route(agentExecuteRoute);
        done();
      },
      { prefix: "/v1" },
    );

    logging(app);

    // Register health and readiness routes at the root level
    appWithTypes.route(healthcheckRoute);
    appWithTypes.route(readinessRoute);
    await app.ready();

    await app.listen({
      host: "0.0.0.0",
      port: parseInt(process.env.PORT ?? "3000", 10),
    });
    console.log("Routes registered:", app.printRoutes());

    // Mark the server as ready after it's started
    setReady();
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

start().catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
