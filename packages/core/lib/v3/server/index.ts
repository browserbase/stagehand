import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type {
  V3Options,
  ActOptions,
  ActResult,
  ExtractResult,
  ExtractOptions,
  ObserveOptions,
  Action,
  AgentResult,
} from "../types/public";
import type { StagehandZodSchema } from "../zodCompat";
import { SessionManager } from "./sessions";
import { createStreamingResponse } from "./stream";

export interface StagehandServerOptions {
  port?: number;
  host?: string;
  sessionTTL?: number;
}

// Zod schemas for V3 API (we only support V3 in the library server)
const actSchemaV3 = z.object({
  input: z.string().or(
    z.object({
      selector: z.string(),
      description: z.string(),
      backendNodeId: z.number().optional(),
      method: z.string().optional(),
      arguments: z.array(z.string()).optional(),
    }),
  ),
  options: z
    .object({
      model: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        })
        .optional(),
      variables: z.record(z.string(), z.string()).optional(),
      timeout: z.number().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

const extractSchemaV3 = z.object({
  instruction: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  options: z
    .object({
      model: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        })
        .optional(),
      timeout: z.number().optional(),
      selector: z.string().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

const observeSchemaV3 = z.object({
  instruction: z.string().optional(),
  options: z
    .object({
      model: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        })
        .optional(),
      timeout: z.number().optional(),
      selector: z.string().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

const agentExecuteSchemaV3 = z.object({
  agentConfig: z.object({
    provider: z.enum(["openai", "anthropic", "google"]).optional(),
    model: z
      .string()
      .optional()
      .or(
        z.object({
          provider: z.enum(["openai", "anthropic", "google"]).optional(),
          modelName: z.string(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        }),
      )
      .optional(),
    systemPrompt: z.string().optional(),
    cua: z.boolean().optional(),
  }),
  executeOptions: z.object({
    instruction: z.string(),
    maxSteps: z.number().optional(),
    highlightCursor: z.boolean().optional(),
  }),
  frameId: z.string().optional(),
});

/**
 * StagehandServer - Embedded API server for peer-to-peer Stagehand communication
 *
 * This server implements the same API as the cloud Stagehand API, allowing
 * remote Stagehand instances to connect and execute actions on this machine.
 */
export class StagehandServer {
  private app: FastifyInstance;
  private sessionManager: SessionManager;
  private port: number;
  private host: string;
  private isListening: boolean = false;

  constructor(options: StagehandServerOptions = {}) {
    this.port = options.port || 3000;
    this.host = options.host || "0.0.0.0";
    this.sessionManager = new SessionManager(options.sessionTTL);
    this.app = Fastify({
      logger: false, // Disable Fastify's built-in logger for cleaner output
    });

    this.setupMiddleware();
    this.setupRoutes();
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
    try {
      // Parse V3Options from request body
      const config = request.body as V3Options;

      // Create session
      const sessionId = this.sessionManager.createSession(config);

      reply.status(200).send({
        sessionId,
        available: true,
      });
    } catch (error) {
      reply.status(500).send({
        error: error instanceof Error ? error.message : "Failed to create session",
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

    if (!this.sessionManager.hasSession(sessionId)) {
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      // Validate request body
      const data = actSchemaV3.parse(request.body);

      await createStreamingResponse<z.infer<typeof actSchemaV3>>({
        sessionId,
        sessionManager: this.sessionManager,
        request,
        reply,
        handler: async (ctx, data) => {
          const { stagehand } = ctx;
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
              ? {
                  ...data.options.model,
                  modelName: data.options.model.model ?? "gpt-4o",
                }
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
    } catch (error) {
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

    if (!this.sessionManager.hasSession(sessionId)) {
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      const data = extractSchemaV3.parse(request.body);

      await createStreamingResponse<z.infer<typeof extractSchemaV3>>({
        sessionId,
        sessionManager: this.sessionManager,
        request,
        reply,
        handler: async (ctx, data) => {
          const { stagehand } = ctx;
          const { frameId } = data;

          const page = frameId
            ? stagehand.context.resolvePageByMainFrameId(frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

          const safeOptions: ExtractOptions = {
            model: data.options?.model
              ? {
                  ...data.options.model,
                  modelName: data.options.model.model ?? "gpt-4o",
                }
              : undefined,
            timeout: data.options?.timeout,
            selector: data.options?.selector,
            page,
          };

          let result: ExtractResult<StagehandZodSchema>;

          if (data.instruction) {
            if (data.schema) {
              // Convert JSON schema to Zod schema
              // For simplicity, we'll just pass the data through
              // The cloud API does jsonSchemaToZod conversion but that's complex
              result = await stagehand.extract(data.instruction, safeOptions);
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

    if (!this.sessionManager.hasSession(sessionId)) {
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      const data = observeSchemaV3.parse(request.body);

      await createStreamingResponse<z.infer<typeof observeSchemaV3>>({
        sessionId,
        sessionManager: this.sessionManager,
        request,
        reply,
        handler: async (ctx, data) => {
          const { stagehand } = ctx;
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
                ? {
                    ...data.options.model,
                    modelName: data.options.model.model,
                  }
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

    if (!this.sessionManager.hasSession(sessionId)) {
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      const data = agentExecuteSchemaV3.parse(request.body);

      await createStreamingResponse<z.infer<typeof agentExecuteSchemaV3>>({
        sessionId,
        sessionManager: this.sessionManager,
        request,
        reply,
        handler: async (ctx, data) => {
          const { stagehand } = ctx;
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
    } catch (error) {
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

    if (!this.sessionManager.hasSession(sessionId)) {
      return reply.status(404).send({ error: "Session not found" });
    }

    try {
      const body = request.body as { url: string; options?: any; frameId?: string };

      if (!body.url) {
        return reply.status(400).send({ error: "url is required" });
      }

      await createStreamingResponse({
        sessionId,
        sessionManager: this.sessionManager,
        request,
        reply,
        handler: async (ctx) => {
          const { stagehand } = ctx;

          // Get the page
          const page = body.frameId
            ? stagehand.context.resolvePageByMainFrameId(body.frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            throw new Error("Page not found");
          }

          // Navigate to the URL
          const response = await page.goto(body.url, body.options);

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
  private async handleEndSession(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { id: sessionId } = request.params;

    try {
      await this.sessionManager.endSession(sessionId);
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
