import { randomUUID } from "crypto";
import { appendFile, mkdir } from "fs/promises";
import path from "path";

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

import { logTree } from "./lib/bubus.js";
import { logging } from "./lib/logging/index.js";
import {
  destroySessionStore,
  initializeSessionStore,
} from "./lib/sessionStoreManager.js";
import healthcheckRoute from "./routes/healthcheck.js";
import readinessRoute, { setReady, setUnready } from "./routes/readiness.js";
import v4Routes from "./routes/v4/index.js";
import { initializeV4Runtime } from "./v4/runtime.js";

// Constants for graceful shutdown
const READY_WAIT_PERIOD = 10_000; // 10 seconds
const GRACEFUL_SHUTDOWN_PERIOD = 30_000; // 30 seconds
const V4_EVENT_TREE_LOG_PATH =
  process.env.V4_EVENT_TREE_LOG_PATH ??
  path.join(process.cwd(), ".stagehand", "v4-event-tree.log");

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

async function appendV4RequestTreeSnapshot(params: {
  method: string;
  url: string;
  statusCode: number;
  requestId: string;
  bus: unknown;
}): Promise<void> {
  const sections: string[] = [];
  sections.push(
    `\n===== ${new Date().toISOString()} ${params.method} ${params.url} status=${params.statusCode} reqId=${params.requestId} =====`,
  );

  const label = (() => {
    if (params.bus && typeof params.bus === "object") {
      const maybeBus = params.bus as {
        toString?: () => string;
        name?: string;
        id?: string;
      };
      if (typeof maybeBus.toString === "function") {
        return maybeBus.toString();
      }
      return maybeBus.name ?? maybeBus.id ?? "unknown";
    }
    return "unknown";
  })();

  sections.push(`\n--- BUS ${label} ---`);
  try {
    sections.push(logTree(params.bus as any));
  } catch (error) {
    sections.push(
      `unable to build tree: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  sections.push("\n");
  await mkdir(path.dirname(V4_EVENT_TREE_LOG_PATH), { recursive: true });
  await appendFile(V4_EVENT_TREE_LOG_PATH, sections.join("\n"), "utf8");
}

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

app.addHook("onResponse", async (request, reply) => {
  if (!request.url.startsWith("/v4/")) {
    return;
  }

  const requestBus = (
    request as {
      __v4RequestRuntime?: {
        bus?: unknown;
      };
    }
  ).__v4RequestRuntime?.bus;

  if (!requestBus) {
    return;
  }

  try {
    await appendV4RequestTreeSnapshot({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      requestId: request.id,
      bus: requestBus,
    });
  } catch (error) {
    app.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "unable to append v4 request event log tree snapshot",
    );
  }
});

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
        return reply.status(StatusCodes.BAD_REQUEST).send({
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
    initializeV4Runtime();

    const appWithTypes = app.withTypeProvider<FastifyZodOpenApiTypeProvider>();

    await appWithTypes.register(v4Routes, { prefix: "/v4" });

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
