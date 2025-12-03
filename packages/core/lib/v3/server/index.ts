import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { randomUUID } from "crypto";
import type {
  V3Options,
  ActOptions,
  ActResult,
  ExtractResult,
  ExtractOptions,
  ObserveOptions,
  Action,
  AgentResult,
  ModelConfiguration,
} from "../types/public";
import type { StagehandZodSchema } from "../zodCompat";
import { jsonSchemaToZod, type JsonSchema } from "../../utils";
import { SessionManager } from "./sessions";
import { createStreamingResponse } from "./stream";
import {
  actSchemaV3,
  extractSchemaV3,
  observeSchemaV3,
  agentExecuteSchemaV3,
  navigateSchemaV3,
} from "./schemas";
import type { StartSessionParams } from "../types/private/api";
import type {
  StagehandServerEventMap,
  StagehandRequestReceivedEvent,
  StagehandRequestCompletedEvent,
} from "./events";
import { StagehandEventBus, createEventBus } from "../eventBus";

// Re-export event types for consumers
export * from "./events";

export interface StagehandServerOptions {
  port?: number;
  host?: string;
  sessionTTL?: number;
  /** Optional: shared event bus instance. If not provided, a new one will be created. */
  eventBus?: StagehandEventBus;
}

/**
 * StagehandServer - Embedded API server for peer-to-peer Stagehand communication
 *
 * This server implements the same API as the cloud Stagehand API, allowing
 * remote Stagehand instances to connect and execute actions on this machine.
 *
 * Uses a shared event bus to allow cloud servers to hook into lifecycle events.
 */
export class StagehandServer {
  private app: FastifyInstance;
  private sessionManager: SessionManager;
  private port: number;
  private host: string;
  private isListening: boolean = false;
  private eventBus: StagehandEventBus;

  constructor(options: StagehandServerOptions) {
    this.eventBus = options.eventBus || createEventBus();
    this.port = options.port || 3000;
    this.host = options.host || "0.0.0.0";
    this.sessionManager = new SessionManager(options.sessionTTL, this.eventBus);
    this.app = Fastify({
      logger: false, // Disable Fastify's built-in logger for cleaner output
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Emit an event and wait for all async listeners to complete
   */
  private async emitAsync<K extends keyof StagehandServerEventMap>(
    event: K,
    data: StagehandServerEventMap[K],
  ): Promise<void> {
    await this.eventBus.emitAsync(event, data);
  }

  private setupMiddleware(): void {
    // CORS support
    this.app.register(cors, {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: "*",
      credentials: true,
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", async () => {
      return { status: "ok", sessions: this.sessionManager.getActiveSessions().length };
    });

    // Start session - creates a new V3 instance
    this.app.post("/v1/sessions/start", async (request, reply) => {
      return this.handleStartSession(request, reply);
    });

    // Act endpoint
    this.app.post<{ Params: { id: string } }>(
      "/v1/sessions/:id/act",
      async (request, reply) => {
        return this.handleAct(request, reply);
      },
    );

    // Extract endpoint
    this.app.post<{ Params: { id: string } }>(
      "/v1/sessions/:id/extract",
      async (request, reply) => {
        return this.handleExtract(request, reply);
      },
    );

    // Observe endpoint
    this.app.post<{ Params: { id: string } }>(
      "/v1/sessions/:id/observe",
      async (request, reply) => {
        return this.handleObserve(request, reply);
      },
    );

    // Agent execute endpoint
    this.app.post<{ Params: { id: string } }>(
      "/v1/sessions/:id/agentExecute",
      async (request, reply) => {
        return this.handleAgentExecute(request, reply);
      },
    );

    // Navigate endpoint - navigate to URL
    this.app.post<{ Params: { id: string } }>(
      "/v1/sessions/:id/navigate",
      async (request, reply) => {
        return this.handleNavigate(request, reply);
      },
    );

    // End session
    this.app.post<{ Params: { id: string } }>(
      "/v1/sessions/:id/end",
      async (request, reply) => {
        return this.handleEndSession(request, reply);
      },
    );
  }

  /**
   * Handle /sessions/start - Create new session
   */
  private async handleStartSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const requestId = randomUUID();
    const startTime = Date.now();

    try {
      // Emit request received event
      await this.emitAsync("StagehandRequestReceived", {
        type: "StagehandRequestReceived",
        timestamp: new Date(),
        requestId,
        sessionId: "",
        // No session yet
        method: "POST",
        path: "/v1/sessions/start",
        headers: {
          "x-stream-response": request.headers["x-stream-response"] === "true",
          "x-bb-api-key": request.headers["x-bb-api-key"] as string | undefined,
          "x-model-api-key": request.headers["x-model-api-key"] as string | undefined,
          "x-sdk-version": request.headers["x-sdk-version"] as string | undefined,
          "x-language": request.headers["x-language"] as string | undefined,
          "x-sent-at": request.headers["x-sent-at"] as string | undefined,
        },
        bodySize: JSON.stringify(request.body).length,
      });

      const body = request.body as unknown;

      let v3Config: V3Options;

      if (body && typeof body === "object" && "env" in (body as any)) {
        // Backwards-compatible path: accept full V3Options directly
        v3Config = body as V3Options;
      } else {
        // Cloud-compatible path: accept StartSessionParams and derive V3Options
        const params = body as StartSessionParams;

        const modelConfig: ModelConfiguration = {
          modelName: params.modelName as any,
          apiKey: params.modelApiKey,
        };

        v3Config = {
          env: "LOCAL",
          model: modelConfig,
          systemPrompt: params.systemPrompt,
          domSettleTimeout: params.domSettleTimeoutMs,
          verbose: params.verbose as 0 | 1 | 2,
          selfHeal: params.selfHeal,
        };
      }

      // Create session (will emit StagehandSessionCreated)
      const sessionId = this.sessionManager.createSession(v3Config);

      // Emit request completed event
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });

      // Match cloud API shape: { success: true, data: { sessionId, available } }
      reply.status(200).send({
        success: true,
        data: {
          sessionId,
          available: true,
        },
      });
    } catch (error) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        requestId,
        sessionId: "",
        statusCode: 500,
        durationMs: Date.now() - startTime,
      });

      reply.status(500).send({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to create session",
      });
    }
  }

  /**
   * Handle /sessions/:id/act - Execute act command
   */
  private async handleAct(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { id: sessionId } = request.params;
    const requestId = randomUUID();
    const startTime = Date.now();

    // Emit request received event
    await this.emitAsync("StagehandRequestReceived", {
      type: "StagehandRequestReceived",
      timestamp: new Date(),
      sessionId,
      requestId,
      method: "POST",
      path: `/v1/sessions/${sessionId}/act`,
      headers: {
        "x-stream-response": request.headers["x-stream-response"] === "true",
        "x-bb-api-key": request.headers["x-bb-api-key"] as string | undefined,
        "x-model-api-key": request.headers["x-model-api-key"] as string | undefined,
        "x-sdk-version": request.headers["x-sdk-version"] as string | undefined,
        "x-language": request.headers["x-language"] as string | undefined,
        "x-sent-at": request.headers["x-sent-at"] as string | undefined,
      },
      bodySize: JSON.stringify(request.body).length,
    });

    if (!this.sessionManager.hasSession(sessionId)) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 404,
        durationMs: Date.now() - startTime,
      });
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      // Validate request body
      const data = actSchemaV3.parse(request.body);

      await createStreamingResponse<z.infer<typeof actSchemaV3>>({
        sessionId,
        requestId,
        actionType: "act",
        sessionManager: this.sessionManager,
        request,
        reply,
        eventBus: this.eventBus,
        handler: async (ctx, data) => {
          const stagehand = ctx.stagehand as any;
          const { frameId } = data;

          // Get the page
          const page = frameId
            ? stagehand.context.resolvePageByMainFrameId(frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

          // Build options
          const safeOptions: ActOptions = {
            model: data.options?.model
              ? ({
                  ...data.options.model,
                  modelName: data.options.model.model ?? "gpt-4o",
                } as ModelConfiguration)
              : undefined,
            variables: data.options?.variables,
            timeout: data.options?.timeout,
            page,
          };

          // Execute act
          let result: ActResult;
          if (typeof data.input === "string") {
            result = await stagehand.act(data.input, safeOptions);
          } else {
            result = await stagehand.act(data.input as Action, safeOptions);
          }

          return { result };
        },
      });

      // Emit request completed event
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: error instanceof z.ZodError ? 400 : 500,
        durationMs: Date.now() - startTime,
      });

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: error.issues,
        });
      }
      throw error;
    }
  }

  /**
   * Handle /sessions/:id/extract - Execute extract command
   */
  private async handleExtract(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { id: sessionId } = request.params;
    const requestId = randomUUID();
    const startTime = Date.now();

    await this.emitAsync("StagehandRequestReceived", {
      type: "StagehandRequestReceived",
      timestamp: new Date(),
      sessionId,
      requestId,
      method: "POST",
      path: `/v1/sessions/${sessionId}/extract`,
      headers: {
        "x-stream-response": request.headers["x-stream-response"] === "true",
        "x-bb-api-key": request.headers["x-bb-api-key"] as string | undefined,
        "x-model-api-key": request.headers["x-model-api-key"] as string | undefined,
        "x-sdk-version": request.headers["x-sdk-version"] as string | undefined,
        "x-language": request.headers["x-language"] as string | undefined,
        "x-sent-at": request.headers["x-sent-at"] as string | undefined,
      },
      bodySize: JSON.stringify(request.body).length,
    });

    if (!this.sessionManager.hasSession(sessionId)) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 404,
        durationMs: Date.now() - startTime,
      });
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      const data = extractSchemaV3.parse(request.body);

      await createStreamingResponse<z.infer<typeof extractSchemaV3>>({
        sessionId,
        requestId,
        actionType: "extract",
        sessionManager: this.sessionManager,
        request,
        reply,
        eventBus: this.eventBus,
        handler: async (ctx, data) => {
          const stagehand = ctx.stagehand as any;
          const { frameId } = data;

          const page = frameId
            ? stagehand.context.resolvePageByMainFrameId(frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

          const safeOptions: ExtractOptions = {
            model: data.options?.model
              ? ({
                  ...data.options.model,
                  modelName: data.options.model.model ?? "gpt-4o",
                } as ModelConfiguration)
              : undefined,
            timeout: data.options?.timeout,
            selector: data.options?.selector,
            page,
          };

          let result: ExtractResult<StagehandZodSchema>;

          if (data.instruction) {
            if (data.schema) {
              // Convert JSON schema (sent by StagehandAPIClient) back to a Zod schema
              const zodSchema = jsonSchemaToZod(
                data.schema as unknown as JsonSchema,
              ) as StagehandZodSchema;
              result = await stagehand.extract(
                data.instruction,
                zodSchema,
                safeOptions,
              );
            } else {
              result = await stagehand.extract(data.instruction, safeOptions);
            }
          } else {
            result = await stagehand.extract(safeOptions);
          }

          return { result };
        },
      });

      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: error instanceof z.ZodError ? 400 : 500,
        durationMs: Date.now() - startTime,
      });

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: error.issues,
        });
      }
      throw error;
    }
  }

  /**
   * Handle /sessions/:id/observe - Execute observe command
   */
  private async handleObserve(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { id: sessionId } = request.params;
    const requestId = randomUUID();
    const startTime = Date.now();

    await this.emitAsync("StagehandRequestReceived", {
      type: "StagehandRequestReceived",
      timestamp: new Date(),
      sessionId,
      requestId,
      method: "POST",
      path: `/v1/sessions/${sessionId}/observe`,
      headers: {
        "x-stream-response": request.headers["x-stream-response"] === "true",
        "x-bb-api-key": request.headers["x-bb-api-key"] as string | undefined,
        "x-model-api-key": request.headers["x-model-api-key"] as string | undefined,
        "x-sdk-version": request.headers["x-sdk-version"] as string | undefined,
        "x-language": request.headers["x-language"] as string | undefined,
        "x-sent-at": request.headers["x-sent-at"] as string | undefined,
      },
      bodySize: JSON.stringify(request.body).length,
    });

    if (!this.sessionManager.hasSession(sessionId)) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 404,
        durationMs: Date.now() - startTime,
      });
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      const data = observeSchemaV3.parse(request.body);

      await createStreamingResponse<z.infer<typeof observeSchemaV3>>({
        sessionId,
        requestId,
        actionType: "observe",
        sessionManager: this.sessionManager,
        request,
        reply,
        eventBus: this.eventBus,
        handler: async (ctx, data) => {
          const stagehand = ctx.stagehand as any;
          const { frameId } = data;

          const page = frameId
            ? stagehand.context.resolvePageByMainFrameId(frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

          const safeOptions: ObserveOptions = {
            model:
              data.options?.model && typeof data.options.model.model === "string"
                ? ({
                    ...data.options.model,
                    modelName: data.options.model.model,
                  } as ModelConfiguration)
                : undefined,
            timeout: data.options?.timeout,
            selector: data.options?.selector,
            page,
          };

          let result: Action[];

          if (data.instruction) {
            result = await stagehand.observe(data.instruction, safeOptions);
          } else {
            result = await stagehand.observe(safeOptions);
          }

          return { result };
        },
      });

      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: error instanceof z.ZodError ? 400 : 500,
        durationMs: Date.now() - startTime,
      });

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: error.issues,
        });
      }
      throw error;
    }
  }

  /**
   * Handle /sessions/:id/agentExecute - Execute agent command
   */
  private async handleAgentExecute(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { id: sessionId } = request.params;
    const requestId = randomUUID();
    const startTime = Date.now();

    await this.emitAsync("StagehandRequestReceived", {
      type: "StagehandRequestReceived",
      timestamp: new Date(),
      sessionId,
      requestId,
      method: "POST",
      path: `/v1/sessions/${sessionId}/agentExecute`,
      headers: {
        "x-stream-response": request.headers["x-stream-response"] === "true",
        "x-bb-api-key": request.headers["x-bb-api-key"] as string | undefined,
        "x-model-api-key": request.headers["x-model-api-key"] as string | undefined,
        "x-sdk-version": request.headers["x-sdk-version"] as string | undefined,
        "x-language": request.headers["x-language"] as string | undefined,
        "x-sent-at": request.headers["x-sent-at"] as string | undefined,
      },
      bodySize: JSON.stringify(request.body).length,
    });

    if (!this.sessionManager.hasSession(sessionId)) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 404,
        durationMs: Date.now() - startTime,
      });
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      const data = agentExecuteSchemaV3.parse(request.body);

      await createStreamingResponse<z.infer<typeof agentExecuteSchemaV3>>({
        sessionId,
        requestId,
        actionType: "agentExecute",
        sessionManager: this.sessionManager,
        request,
        reply,
        eventBus: this.eventBus,
        handler: async (ctx, data) => {
          const stagehand = ctx.stagehand as any;
          const { agentConfig, executeOptions, frameId } = data;

          const page = frameId
            ? stagehand.context.resolvePageByMainFrameId(frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

          const fullExecuteOptions = {
            ...executeOptions,
            page,
          };

          const result: AgentResult = await stagehand
            .agent(agentConfig)
            .execute(fullExecuteOptions);

          return { result };
        },
      });

      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: error instanceof z.ZodError ? 400 : 500,
        durationMs: Date.now() - startTime,
      });

      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: error.issues,
        });
      }
      throw error;
    }
  }

  /**
   * Handle /sessions/:id/navigate - Navigate to URL
   */
  private async handleNavigate(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { id: sessionId } = request.params;
    const requestId = randomUUID();
    const startTime = Date.now();

    await this.emitAsync("StagehandRequestReceived", {
      type: "StagehandRequestReceived",
      timestamp: new Date(),
      sessionId,
      requestId,
      method: "POST",
      path: `/v1/sessions/${sessionId}/navigate`,
      headers: {
        "x-stream-response": request.headers["x-stream-response"] === "true",
        "x-bb-api-key": request.headers["x-bb-api-key"] as string | undefined,
        "x-model-api-key": request.headers["x-model-api-key"] as string | undefined,
        "x-sdk-version": request.headers["x-sdk-version"] as string | undefined,
        "x-language": request.headers["x-language"] as string | undefined,
        "x-sent-at": request.headers["x-sent-at"] as string | undefined,
      },
      bodySize: JSON.stringify(request.body).length,
    });

    if (!this.sessionManager.hasSession(sessionId)) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 404,
        durationMs: Date.now() - startTime,
      });
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      await createStreamingResponse({
        sessionId,
        requestId,
        actionType: "navigate",
        sessionManager: this.sessionManager,
        request,
        reply,
        eventBus: this.eventBus,
        handler: async (ctx, data: any) => {
          const stagehand = ctx.stagehand as any;
          const { url, options, frameId } = data;

          if (!url) {
            throw new Error("url is required");
          }

          // Get the page
          const page = frameId
            ? stagehand.context.resolvePageByMainFrameId(frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

          // Navigate to the URL
          const response = await page.goto(url, options);

          return { result: response };
        },
      });

      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 500,
        durationMs: Date.now() - startTime,
      });

      if (!reply.sent) {
        reply.status(500).send({
          error: error instanceof Error ? error.message : "Failed to navigate",
        });
      }
    }
  }

  /**
   * Handle /sessions/:id/end - End session and cleanup
   */
  private async handleEndSession(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { id: sessionId } = request.params;
    const requestId = randomUUID();
    const startTime = Date.now();

    await this.emitAsync("StagehandRequestReceived", {
      type: "StagehandRequestReceived",
      timestamp: new Date(),
      sessionId,
      requestId,
      method: "POST",
      path: `/v1/sessions/${sessionId}/end`,
      headers: {
        "x-stream-response": request.headers["x-stream-response"] === "true",
        "x-bb-api-key": request.headers["x-bb-api-key"] as string | undefined,
        "x-model-api-key": request.headers["x-model-api-key"] as string | undefined,
        "x-sdk-version": request.headers["x-sdk-version"] as string | undefined,
        "x-language": request.headers["x-language"] as string | undefined,
        "x-sent-at": request.headers["x-sent-at"] as string | undefined,
      },
      bodySize: JSON.stringify(request.body).length,
    });

    try {
      await this.sessionManager.endSession(sessionId, "manual");

      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });

      reply.status(200).send({ success: true });
    } catch (error) {
      await this.emitAsync("StagehandRequestCompleted", {
        type: "StagehandRequestCompleted",
        timestamp: new Date(),
        sessionId,
        requestId,
        statusCode: 500,
        durationMs: Date.now() - startTime,
      });

      reply.status(500).send({
        error: error instanceof Error ? error.message : "Failed to end session",
      });
    }
  }

  /**
   * Start the server
   */
  async listen(port?: number): Promise<void> {
    const listenPort = port || this.port;

    try {
      await this.app.listen({
        port: listenPort,
        host: this.host,
      });
      this.isListening = true;

      // Emit server started event
      await this.emitAsync("StagehandServerStarted", {
        type: "StagehandServerStarted",
        timestamp: new Date(),
        port: listenPort,
        host: this.host,
      });

      // Emit server ready event
      await this.emitAsync("StagehandServerReady", {
        type: "StagehandServerReady",
        timestamp: new Date(),
      });

      console.log(`Stagehand server listening on http://${this.host}:${listenPort}`);
    } catch (error) {
      console.error("Failed to start server:", error);
      throw error;
    }
  }

  /**
   * Stop the server and cleanup
   */
  async close(): Promise<void> {
    const graceful = this.isListening;

    // Emit server shutdown event
    await this.emitAsync("StagehandServerShutdown", {
      type: "StagehandServerShutdown",
      timestamp: new Date(),
      graceful,
    });

    if (this.isListening) {
      await this.app.close();
      this.isListening = false;
    }
    await this.sessionManager.destroy();
  }

  /**
   * Get server URL
   */
  getUrl(): string {
    if (!this.isListening) {
      throw new Error("Server is not listening");
    }
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.sessionManager.getActiveSessions().length;
  }
}
