import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type {
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
import type { SessionStore, RequestContext, CreateSessionParams } from "./SessionStore";
import { InMemorySessionStore } from "./InMemorySessionStore";
import { createStreamingResponse } from "./stream";
import {
  actSchemaV3,
  extractSchemaV3,
  observeSchemaV3,
  agentExecuteSchemaV3,
} from "./schemas";
import type { StartSessionParams } from "../types/private/api";

// =============================================================================
// Generic HTTP interfaces for cross-version Fastify compatibility
// =============================================================================

/**
 * Generic HTTP request interface.
 * Structurally compatible with FastifyRequest from any version.
 */
export interface StagehandHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  params: unknown;
}

/**
 * Generic HTTP reply interface.
 * Structurally compatible with FastifyReply from any version.
 */
export interface StagehandHttpReply {
  status(code: number): StagehandHttpReply;
  send(payload: unknown): Promise<unknown> | unknown;
  raw: {
    write(chunk: string | Buffer): boolean;
    end(): void;
    on(event: string, handler: (...args: unknown[]) => void): unknown;
  };
  sent: boolean;
  hijack(): void;
}

// Re-export event types for consumers (only LLM events are actually used)
export * from "./events";

// Re-export SessionStore types
export type { SessionStore, RequestContext, CreateSessionParams, StartSessionResult } from "./SessionStore";
export { InMemorySessionStore } from "./InMemorySessionStore";

// Re-export API schemas and types for consumers
export * from "./schemas";

export interface StagehandServerOptions {
  port?: number;
  host?: string;
  /**
   * Session store for managing session lifecycle and V3 instances.
   * Defaults to InMemorySessionStore if not provided.
   * Cloud environments should provide a database-backed implementation.
   */
  sessionStore?: SessionStore;
}

/**
 * StagehandServer - Embedded API server for peer-to-peer Stagehand communication
 *
 * This server implements the same API as the cloud Stagehand API, allowing
 * remote Stagehand instances to connect and execute actions on this machine.
 *
 * Uses a SessionStore interface for session management, allowing cloud environments
 * to provide database-backed implementations for stateless pod architectures.
 */
export class StagehandServer {
  private app: FastifyInstance;
  private sessionStore: SessionStore;
  private port: number;
  private host: string;
  private isListening: boolean = false;

  constructor(options: StagehandServerOptions = {}) {
    this.port = options.port || 3000;
    this.host = options.host || "0.0.0.0";
    this.sessionStore = options.sessionStore ?? new InMemorySessionStore();
    this.app = Fastify({
      logger: false,
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Get the session store instance
   */
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  private setupMiddleware(): void {
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
      return { status: "ok" };
    });

    // Start session
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

    // Navigate endpoint
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
  async handleStartSession(
    request: StagehandHttpRequest,
    reply: StagehandHttpReply,
  ): Promise<void> {
    try {
      const body = request.body as StartSessionParams;

      const createParams: CreateSessionParams = {
        modelName: body.modelName,
        verbose: body.verbose as 0 | 1 | 2,
        systemPrompt: body.systemPrompt,
        selfHeal: body.selfHeal,
        domSettleTimeoutMs: body.domSettleTimeoutMs,
        experimental: body.experimental,
        waitForCaptchaSolves: body.waitForCaptchaSolves,
        browserbaseSessionID: body.browserbaseSessionID ?? body.sessionId,
        browserbaseSessionCreateParams: body.browserbaseSessionCreateParams,
        debugDom: body.debugDom,
        actTimeoutMs: body.actTimeoutMs,
        browserbaseApiKey: request.headers["x-bb-api-key"] as string | undefined,
        browserbaseProjectId: request.headers["x-bb-project-id"] as string | undefined,
        clientLanguage: request.headers["x-language"] as string | undefined,
        sdkVersion: request.headers["x-sdk-version"] as string | undefined,
      };

      const result = await this.sessionStore.startSession(createParams);

      reply.status(200).send({
        success: true,
        data: {
          sessionId: result.sessionId,
          available: result.available,
        },
      });
    } catch (error) {
      reply.status(500).send({
        success: false,
        message: error instanceof Error ? error.message : "Failed to create session",
      });
    }
  }

  /**
   * Handle /sessions/:id/act - Execute act command
   */
  async handleAct(
    request: StagehandHttpRequest,
    reply: StagehandHttpReply,
  ): Promise<void> {
    const { id: sessionId } = request.params as { id: string };

    if (!(await this.sessionStore.hasSession(sessionId))) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    try {
      actSchemaV3.parse(request.body); // Validate request body
      const ctx: RequestContext = {
        modelApiKey: request.headers["x-model-api-key"] as string | undefined,
      };

      await createStreamingResponse<z.infer<typeof actSchemaV3>>({
        sessionId,
        sessionStore: this.sessionStore,
        requestContext: ctx,
        request,
        reply,
        handler: async (handlerCtx, data) => {
          const stagehand = handlerCtx.stagehand as any;
          const { frameId } = data;

          const page = frameId
            ? stagehand.context.resolvePageByMainFrameId(frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

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

          let result: ActResult;
          if (typeof data.input === "string") {
            result = await stagehand.act(data.input, safeOptions);
          } else {
            result = await stagehand.act(data.input as Action, safeOptions);
          }

          return { result };
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400).send({
          error: "Invalid request body",
          details: error.issues,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Handle /sessions/:id/extract - Execute extract command
   */
  async handleExtract(
    request: StagehandHttpRequest,
    reply: StagehandHttpReply,
  ): Promise<void> {
    const { id: sessionId } = request.params as { id: string };

    if (!(await this.sessionStore.hasSession(sessionId))) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    try {
      extractSchemaV3.parse(request.body); // Validate request body
      const ctx: RequestContext = {
        modelApiKey: request.headers["x-model-api-key"] as string | undefined,
      };

      await createStreamingResponse<z.infer<typeof extractSchemaV3>>({
        sessionId,
        sessionStore: this.sessionStore,
        requestContext: ctx,
        request,
        reply,
        handler: async (handlerCtx, data) => {
          const stagehand = handlerCtx.stagehand as any;
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
              const zodSchema = jsonSchemaToZod(
                data.schema as unknown as JsonSchema,
              ) as StagehandZodSchema;
              result = await stagehand.extract(data.instruction, zodSchema, safeOptions);
            } else {
              result = await stagehand.extract(data.instruction, safeOptions);
            }
          } else {
            result = await stagehand.extract(safeOptions);
          }

          return { result };
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400).send({
          error: "Invalid request body",
          details: error.issues,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Handle /sessions/:id/observe - Execute observe command
   */
  async handleObserve(
    request: StagehandHttpRequest,
    reply: StagehandHttpReply,
  ): Promise<void> {
    const { id: sessionId } = request.params as { id: string };

    if (!(await this.sessionStore.hasSession(sessionId))) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    try {
      observeSchemaV3.parse(request.body); // Validate request body
      const ctx: RequestContext = {
        modelApiKey: request.headers["x-model-api-key"] as string | undefined,
      };

      await createStreamingResponse<z.infer<typeof observeSchemaV3>>({
        sessionId,
        sessionStore: this.sessionStore,
        requestContext: ctx,
        request,
        reply,
        handler: async (handlerCtx, data) => {
          const stagehand = handlerCtx.stagehand as any;
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
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400).send({
          error: "Invalid request body",
          details: error.issues,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Handle /sessions/:id/agentExecute - Execute agent command
   */
  async handleAgentExecute(
    request: StagehandHttpRequest,
    reply: StagehandHttpReply,
  ): Promise<void> {
    const { id: sessionId } = request.params as { id: string };

    if (!(await this.sessionStore.hasSession(sessionId))) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    try {
      agentExecuteSchemaV3.parse(request.body); // Validate request body
      const ctx: RequestContext = {
        modelApiKey: request.headers["x-model-api-key"] as string | undefined,
      };

      await createStreamingResponse<z.infer<typeof agentExecuteSchemaV3>>({
        sessionId,
        sessionStore: this.sessionStore,
        requestContext: ctx,
        request,
        reply,
        handler: async (handlerCtx, data) => {
          const stagehand = handlerCtx.stagehand as any;
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

          const result: AgentResult = await stagehand.agent(agentConfig).execute(fullExecuteOptions);

          return { result };
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400).send({
          error: "Invalid request body",
          details: error.issues,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Handle /sessions/:id/navigate - Navigate to URL
   */
  async handleNavigate(
    request: StagehandHttpRequest,
    reply: StagehandHttpReply,
  ): Promise<void> {
    const { id: sessionId } = request.params as { id: string };

    if (!(await this.sessionStore.hasSession(sessionId))) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

    try {
      const ctx: RequestContext = {
        modelApiKey: request.headers["x-model-api-key"] as string | undefined,
      };

      await createStreamingResponse({
        sessionId,
        sessionStore: this.sessionStore,
        requestContext: ctx,
        request,
        reply,
        handler: async (handlerCtx, data: any) => {
          const stagehand = handlerCtx.stagehand as any;
          const { url, options, frameId } = data;

          if (!url) {
            throw new Error("url is required");
          }

          const page = frameId
            ? stagehand.context.resolvePageByMainFrameId(frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

          const response = await page.goto(url, options);

          return { result: response };
        },
      });
    } catch (error) {
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
  async handleEndSession(
    request: StagehandHttpRequest,
    reply: StagehandHttpReply,
  ): Promise<void> {
    const { id: sessionId } = request.params as { id: string };

    try {
      await this.sessionStore.endSession(sessionId);
      reply.status(200).send({ success: true });
    } catch (error) {
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
    if (this.isListening) {
      await this.app.close();
      this.isListening = false;
    }
    await this.sessionStore.destroy();
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
}
