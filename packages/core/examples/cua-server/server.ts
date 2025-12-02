import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { sessionManager } from "./sessionManager";
import { executeAction } from "./actionExecutor";
import { captureBrowserState } from "./stateCapture";
import {
  ActionRequest,
  ActionResponse,
  SessionCreateRequest,
  SessionCreateResponse,
  ErrorResponse,
} from "./types";

/**
 * Create and configure the Fastify server with CUA primitive routes
 */
export function createServer(): FastifyInstance {
  const server = Fastify({
    logger: true,
  });

  // Health check endpoint
  server.get("/health", async () => {
    return { status: "ok", activeSessions: sessionManager.getActiveSessions().length };
  });

  // List all active sessions
  server.get("/sessions", async () => {
    return { sessions: sessionManager.getActiveSessions() };
  });

  // Create a new browser session
  server.post<{
    Body: SessionCreateRequest;
    Reply: SessionCreateResponse | ErrorResponse;
  }>("/sessions", async (request, reply) => {
    try {
      const session = await sessionManager.createSession(request.body);
      const state = await captureBrowserState(session.page);

      return {
        sessionId: session.id,
        state,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      reply.status(500);
      return { error: errorMessage, code: "SESSION_CREATE_FAILED" };
    }
  });

  // Get session state
  server.get<{
    Params: { id: string };
    Reply: { state: ReturnType<typeof captureBrowserState> extends Promise<infer T> ? T : never } | ErrorResponse;
  }>("/sessions/:id/state", async (request, reply) => {
    const { id } = request.params;

    const page = await sessionManager.getPage(id);
    if (!page) {
      reply.status(404);
      return { error: `Session ${id} not found`, code: "SESSION_NOT_FOUND" };
    }

    try {
      const state = await captureBrowserState(page);
      return { state };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      reply.status(500);
      return { error: errorMessage, code: "STATE_CAPTURE_FAILED" };
    }
  });

  // Delete a session
  server.delete<{
    Params: { id: string };
    Reply: { success: boolean } | ErrorResponse;
  }>("/sessions/:id", async (request, reply) => {
    const { id } = request.params;

    if (!sessionManager.hasSession(id)) {
      reply.status(404);
      return { error: `Session ${id} not found`, code: "SESSION_NOT_FOUND" };
    }

    try {
      await sessionManager.destroySession(id);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      reply.status(500);
      return { error: errorMessage, code: "SESSION_DESTROY_FAILED" };
    }
  });

  // Execute an action on a session
  server.post<{
    Params: { id: string };
    Body: ActionRequest;
    Reply: ActionResponse | ErrorResponse;
  }>("/sessions/:id/action", async (request, reply) => {
    const { id } = request.params;
    const action = request.body;

    const page = await sessionManager.getPage(id);
    if (!page) {
      reply.status(404);
      return { error: `Session ${id} not found`, code: "SESSION_NOT_FOUND" };
    }

    try {
      // Execute the action
      const result = await executeAction(page, action);

      // Capture state after action (always includes screenshot)
      const state = await captureBrowserState(page);

      return {
        success: result.success,
        error: result.error,
        state,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Try to capture state even on error
      let state;
      try {
        state = await captureBrowserState(page);
      } catch {
        state = {
          screenshot: "",
          url: "",
          viewport: { width: 0, height: 0 },
        };
      }

      reply.status(500);
      return {
        success: false,
        error: errorMessage,
        state,
      };
    }
  });

  return server;
}

