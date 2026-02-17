import { randomUUID } from "crypto";

import type { FastifyPluginAsync } from "fastify";
import { StatusCodes } from "http-status-codes";

import { authMiddleware } from "../../lib/auth.js";
import { AppError } from "../../lib/errorHandler.js";
import { getOptionalHeader } from "../../lib/header.js";
import {
  AgentCreateEvent,
  AgentGetEvent,
  AgentListEvent,
  AgentTaskCreateEvent,
  AgentTaskModifyEvent,
  BrowserGetEvent,
  BrowserKillEvent,
  BrowserLaunchEvent,
  BrowserListEvent,
  BrowserSetViewportEvent,
  BrowserSetWindowSizeEvent,
  BrowserTriggerExtensionActionEvent,
  LLMConnectEvent,
  LLMGetEvent,
  LLMListEvent,
  LLMRequestEvent,
  SessionCreateEvent,
  SessionGetEvent,
  SessionListEvent,
  StagehandActEvent,
  StagehandExtractEvent,
  StagehandObserveEvent,
  StagehandStepCancelEvent,
  StagehandStepGetEvent,
  UnderstudyActEvent,
  UnderstudyClickEvent,
  UnderstudyDoubleClickEvent,
  UnderstudyDragAndDropEvent,
  UnderstudyFillEvent,
  UnderstudyHoverEvent,
  UnderstudyMouseWheelEvent,
  UnderstudyNextChunkEvent,
  UnderstudyPressEvent,
  UnderstudyPrevChunkEvent,
  UnderstudyScreenshotEvent,
  UnderstudyScrollByPixelOffsetEvent,
  UnderstudyScrollEvent,
  UnderstudyScrollIntoViewEvent,
  UnderstudySelectOptionFromDropdownEvent,
  UnderstudyStepGetEvent,
  UnderstudyTypeEvent,
} from "../../v4/events.js";
import {
  createV4RequestRuntime,
  emitV4Event,
  getV4Runtime,
  type V4RequestRuntime,
  type V4Runtime,
} from "../../v4/runtime.js";
import { resolveRequestId, sendV4Error, sendV4Success } from "./response.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeBody(body: unknown): { id: string; params: Record<string, unknown> } {
  const requestId = resolveRequestId(body);
  if (!isRecord(body)) {
    return { id: requestId, params: {} };
  }

  const params = isRecord(body.params)
    ? body.params
    : isRecord(body)
      ? (body as Record<string, unknown>)
      : {};

  return {
    id: requestId,
    params,
  };
}

function unwrapError(err: unknown): { message: string; statusCode: number } {
  if (err instanceof AppError) {
    return {
      message: err.getClientMessage(),
      statusCode: err.statusCode,
    };
  }

  if (err instanceof Error) {
    return {
      message: err.message,
      statusCode: StatusCodes.BAD_REQUEST,
    };
  }

  return {
    message: String(err),
    statusCode: StatusCodes.BAD_REQUEST,
  };
}

async function ensureAuth(
  request: Parameters<typeof authMiddleware>[0],
): Promise<boolean> {
  return authMiddleware(request);
}

const understudyEventFactories = {
  act: UnderstudyActEvent,
  click: UnderstudyClickEvent,
  fill: UnderstudyFillEvent,
  type: UnderstudyTypeEvent,
  press: UnderstudyPressEvent,
  scroll: UnderstudyScrollEvent,
  scrollIntoView: UnderstudyScrollIntoViewEvent,
  scrollByPixelOffset: UnderstudyScrollByPixelOffsetEvent,
  mouseWheel: UnderstudyMouseWheelEvent,
  nextChunk: UnderstudyNextChunkEvent,
  prevChunk: UnderstudyPrevChunkEvent,
  selectOptionFromDropdown: UnderstudySelectOptionFromDropdownEvent,
  hover: UnderstudyHoverEvent,
  doubleClick: UnderstudyDoubleClickEvent,
  dragAndDrop: UnderstudyDragAndDropEvent,
  screenshot: UnderstudyScreenshotEvent,
} as const;

type UnderstudyRouteKind = keyof typeof understudyEventFactories;
const REQUEST_RUNTIME_KEY = "__v4RequestRuntime";

type RequestWithV4Runtime = Parameters<typeof authMiddleware>[0] & {
  [REQUEST_RUNTIME_KEY]?: V4RequestRuntime;
};

function getRequestRuntime(
  _runtime: V4Runtime,
  request: Parameters<typeof authMiddleware>[0],
): V4RequestRuntime {
  const withRuntime = request as RequestWithV4Runtime;

  if (!withRuntime[REQUEST_RUNTIME_KEY]) {
    withRuntime[REQUEST_RUNTIME_KEY] = createV4RequestRuntime(request.id);
  }

  return withRuntime[REQUEST_RUNTIME_KEY] as V4RequestRuntime;
}

const v4Routes: FastifyPluginAsync = async (instance) => {
  const runtime = getV4Runtime();

  instance.addHook("onRequest", async (request) => {
    getRequestRuntime(runtime, request);
  });

  instance.get("/sessions", async (request, reply) => {
    const id = resolveRequestId(undefined);
    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    try {
      const result = await emitV4Event<{ sessions: unknown[] }>(
        getRequestRuntime(runtime, request).bus,
        SessionListEvent({}),
      );
      return sendV4Success(reply, { runtime, id, result });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.post("/sessions", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    try {
      const result = await emitV4Event<{
        session: Record<string, unknown>;
        browser: Record<string, unknown>;
      }>(
        getRequestRuntime(runtime, request).bus,
        SessionCreateEvent({
          sessionId:
            typeof params.sessionId === "string" ? params.sessionId : undefined,
          llmId: typeof params.llmId === "string" ? params.llmId : undefined,
          browserId:
            typeof params.browserId === "string"
              ? params.browserId
              : undefined,
          modelName:
            typeof params.modelName === "string" ? params.modelName : undefined,
          modelApiKey:
            typeof params.modelApiKey === "string"
              ? params.modelApiKey
              : getOptionalHeader(request, "x-model-api-key"),
          browserType:
            params.browserType === "browserbase"
              ? "browserbase"
              : params.browserType === "remote"
                ? "remote"
                : "local",
          cdpUrl: typeof params.cdpUrl === "string" ? params.cdpUrl : undefined,
          region: typeof params.region === "string" ? params.region : "local",
          browserLaunchOptions: isRecord(params.browserLaunchOptions)
            ? params.browserLaunchOptions
            : undefined,
          browserbaseSessionId:
            typeof params.browserbaseSessionId === "string"
              ? params.browserbaseSessionId
              : undefined,
          browserbaseSessionCreateParams: isRecord(
            params.browserbaseSessionCreateParams,
          )
            ? params.browserbaseSessionCreateParams
            : undefined,
          browserbaseApiKey:
            typeof params.browserbaseApiKey === "string"
              ? params.browserbaseApiKey
              : getOptionalHeader(request, "x-bb-api-key"),
          browserbaseProjectId:
            typeof params.browserbaseProjectId === "string"
              ? params.browserbaseProjectId
              : getOptionalHeader(request, "x-bb-project-id"),
        }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/sessions/:sessionId", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { sessionId } = request.params as { sessionId: string };

    try {
      const result = await emitV4Event<{ session: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        SessionGetEvent({ sessionId }),
      );
      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/llm", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    try {
      const result = await emitV4Event<{ llms: unknown[] }>(
        getRequestRuntime(runtime, request).bus,
        LLMListEvent({}),
      );
      return sendV4Success(reply, { runtime, id, result });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/llm/:llmId", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { llmId } = request.params as { llmId: string };

    try {
      const result = await emitV4Event<{ llm: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        LLMGetEvent({ llmId }),
      );
      return sendV4Success(reply, { runtime, id, result });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.post("/llm", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const hasLlmId = typeof params.llmId === "string" && Boolean(params.llmId);
    const hasSessionId =
      typeof params.sessionId === "string" && Boolean(params.sessionId);
    const hasModelName =
      typeof params.modelName === "string" && Boolean(params.modelName);

    if (!hasLlmId && !hasSessionId && !hasModelName) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "params.llmId, params.sessionId, or params.modelName is required",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    try {
      const result = await emitV4Event<{
        ok: boolean;
        llm: Record<string, unknown>;
      }>(
        getRequestRuntime(runtime, request).bus,
        LLMConnectEvent({
          llmId: typeof params.llmId === "string" ? params.llmId : undefined,
          sessionId:
            typeof params.sessionId === "string" ? params.sessionId : undefined,
          browserId:
            typeof params.browserId === "string" ? params.browserId : undefined,
          clientType:
            params.clientType === "custom" || params.clientType === "aisdk"
              ? params.clientType
              : undefined,
          mode:
            params.mode === "dom" ||
            params.mode === "hybrid" ||
            params.mode === "cua"
              ? params.mode
              : undefined,
          modelName:
            typeof params.modelName === "string" ? params.modelName : undefined,
          modelApiKey:
            typeof params.modelApiKey === "string"
              ? params.modelApiKey
              : getOptionalHeader(request, "x-model-api-key"),
          provider:
            typeof params.provider === "string" ? params.provider : undefined,
          baseURL: typeof params.baseURL === "string" ? params.baseURL : undefined,
          clientOptions: isRecord(params.clientOptions)
            ? params.clientOptions
            : undefined,
        }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.post("/llm/request", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const hasPrompt = typeof params.prompt === "string" && Boolean(params.prompt);
    const hasMessages = Array.isArray(params.messages) && params.messages.length > 0;

    if (!hasPrompt && !hasMessages) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "params.prompt or params.messages is required",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    try {
      const result = await emitV4Event<{
        llmId: string;
        mode: string;
        modelName: string;
        result: unknown;
      }>(
        getRequestRuntime(runtime, request).bus,
        LLMRequestEvent({
          llmId: typeof params.llmId === "string" ? params.llmId : undefined,
          sessionId:
            typeof params.sessionId === "string" ? params.sessionId : undefined,
          browserId:
            typeof params.browserId === "string" ? params.browserId : undefined,
          modelApiKey:
            typeof params.modelApiKey === "string"
              ? params.modelApiKey
              : getOptionalHeader(request, "x-model-api-key"),
          mode:
            params.mode === "dom" ||
            params.mode === "hybrid" ||
            params.mode === "cua"
              ? params.mode
              : undefined,
          prompt: typeof params.prompt === "string" ? params.prompt : undefined,
          messages: Array.isArray(params.messages) ? params.messages : undefined,
          options: isRecord(params.options) ? params.options : undefined,
        }),
      );
      return sendV4Success(reply, { runtime, id, result });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/agent", async (request, reply) => {
    const id = resolveRequestId(undefined);
    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    try {
      const result = await emitV4Event<{ agents: unknown[] }>(
        getRequestRuntime(runtime, request).bus,
        AgentListEvent({}),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.post("/agent", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    if (typeof params.instruction !== "string" || !params.instruction) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "params.instruction is required",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    if (typeof params.sessionId !== "string" || !params.sessionId) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "params.sessionId is required. Create one via POST /v4/sessions first.",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    try {
      const result = await emitV4Event<{
        agent: Record<string, unknown>;
        task: Record<string, unknown>;
        output?: string;
        actions?: unknown[];
        rawResult?: unknown;
      }>(
        getRequestRuntime(runtime, request).bus,
        AgentCreateEvent({
          instruction: params.instruction,
          sessionId:
            typeof params.sessionId === "string" ? params.sessionId : undefined,
          agentConfig: isRecord(params.agentConfig) ? params.agentConfig : undefined,
          llmId: typeof params.llmId === "string" ? params.llmId : undefined,
          browserId:
            typeof params.browserId === "string" ? params.browserId : undefined,
          pageId: typeof params.pageId === "string" ? params.pageId : undefined,
          modelApiKey:
            typeof params.modelApiKey === "string"
              ? params.modelApiKey
              : getOptionalHeader(request, "x-model-api-key"),
        }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result: {
          output: result.output,
          actions: result.actions,
          agent: result.agent,
          task: result.task,
          rawResult: result.rawResult,
        },
        statusCode: StatusCodes.OK,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/agent/:agentId", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { agentId } = request.params as { agentId: string };

    try {
      const result = await emitV4Event<{ agent: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        AgentGetEvent({ agentId }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.post("/agent/:agentId/tasks/:taskId", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    if (typeof params.instruction !== "string" || !params.instruction) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "params.instruction is required",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    if (typeof params.sessionId !== "string" || !params.sessionId) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "params.sessionId is required. Create one via POST /v4/sessions first.",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    const { agentId, taskId } = request.params as {
      agentId: string;
      taskId: string;
    };

    try {
      const result = await emitV4Event<{
        agent: Record<string, unknown>;
        task: Record<string, unknown>;
        output?: string;
        actions?: unknown[];
        rawResult?: unknown;
      }>(
        getRequestRuntime(runtime, request).bus,
        AgentTaskCreateEvent({
          agentId,
          taskId,
          instruction: params.instruction,
          sessionId:
            typeof params.sessionId === "string" ? params.sessionId : undefined,
          agentConfig: isRecord(params.agentConfig) ? params.agentConfig : undefined,
          pageId: typeof params.pageId === "string" ? params.pageId : undefined,
          browserId:
            typeof params.browserId === "string" ? params.browserId : undefined,
          modelApiKey:
            typeof params.modelApiKey === "string"
              ? params.modelApiKey
              : getOptionalHeader(request, "x-model-api-key"),
        }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result: {
          output: result.output,
          actions: result.actions,
          agent: result.agent,
          task: result.task,
          rawResult: result.rawResult,
        },
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.patch("/agent/:agentId/tasks/:taskId", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const method =
      typeof (request.body as { method?: unknown })?.method === "string"
        ? ((request.body as { method: "pause" | "resume" | "cancel" }).method ??
          "pause")
        : "pause";

    const { agentId, taskId } = request.params as {
      agentId: string;
      taskId: string;
    };

    try {
      const result = await emitV4Event<{
        agent: Record<string, unknown>;
        task: Record<string, unknown>;
      }>(
        getRequestRuntime(runtime, request).bus,
        AgentTaskModifyEvent({
          agentId,
          taskId,
          method,
          resumeAt: typeof params.resumeAt === "string" ? params.resumeAt : undefined,
        }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.post("/stagehand/:kind", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { kind } = request.params as { kind: "act" | "observe" | "extract" };
    const stepId =
      typeof params.stepId === "string" && params.stepId ? params.stepId : randomUUID();

    if (typeof params.sessionId !== "string" || !params.sessionId) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "params.sessionId is required. Create one via POST /v4/sessions first.",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    const basePayload = {
      stepId,
      sessionId:
        typeof params.sessionId === "string" ? params.sessionId : undefined,
      browserId: typeof params.browserId === "string" ? params.browserId : undefined,
      pageId: typeof params.pageId === "string" ? params.pageId : undefined,
      frameId: typeof params.frameId === "string" ? params.frameId : undefined,
      instruction:
        typeof params.instruction === "string" ? params.instruction : undefined,
      action: isRecord(params.action) ? params.action : undefined,
      options: isRecord(params.options) ? params.options : undefined,
      extractSchema: isRecord(params.extractSchema)
        ? params.extractSchema
        : isRecord(params.schema)
          ? params.schema
          : undefined,
      modelApiKey:
        typeof params.modelApiKey === "string"
          ? params.modelApiKey
          : getOptionalHeader(request, "x-model-api-key"),
    };

    try {
      const eventFactory = {
        act: StagehandActEvent,
        observe: StagehandObserveEvent,
        extract: StagehandExtractEvent,
      }[kind];

      if (!eventFactory) {
        return sendV4Error(reply, {
          runtime,
          id,
          message: `Unsupported stagehand operation: ${kind}`,
          statusCode: StatusCodes.NOT_FOUND,
        });
      }

      const result = await emitV4Event<{ step: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        eventFactory(basePayload),
      );

      const stepResult = (result.step.result as unknown) ?? null;

      return sendV4Success(reply, {
        runtime,
        id,
        result: {
          stepId: result.step.stepId,
          output:
            typeof stepResult === "string"
              ? stepResult
              : isRecord(stepResult) && typeof stepResult.output === "string"
                ? stepResult.output
                : undefined,
          result: stepResult,
          step: result.step,
        },
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/stagehand/:kind/:stepId", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { stepId } = request.params as { stepId: string };

    try {
      const result = await emitV4Event<{ step: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        StagehandStepGetEvent({ stepId }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.patch("/stagehand/:kind/:stepId", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const method =
      typeof (request.body as { method?: unknown })?.method === "string"
        ? ((request.body as { method: "cancel" }).method ?? "cancel")
        : "cancel";

    const { stepId } = request.params as { stepId: string };

    try {
      const result = await emitV4Event<{ step: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        StagehandStepCancelEvent({
          stepId,
          method,
          resumeAt: typeof params.resumeAt === "string" ? params.resumeAt : undefined,
        }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result: {
          action: result.step,
        },
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.post("/page/:kind", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { kind } = request.params as {
      kind: UnderstudyRouteKind;
    };

    if (typeof params.sessionId !== "string" || !params.sessionId) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "params.sessionId is required. Create one via POST /v4/sessions first.",
        statusCode: StatusCodes.BAD_REQUEST,
      });
    }

    try {
      const eventFactory = understudyEventFactories[kind];

      if (!eventFactory) {
        return sendV4Error(reply, {
          runtime,
          id,
          message: `Unsupported understudy operation: ${kind}`,
          statusCode: StatusCodes.NOT_FOUND,
        });
      }

      const result = await emitV4Event<{ step: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        eventFactory({
          stepId:
            typeof params.stepId === "string" && params.stepId
              ? params.stepId
              : randomUUID(),
          sessionId:
            typeof params.sessionId === "string" ? params.sessionId : undefined,
          browserId:
            typeof params.browserId === "string" ? params.browserId : undefined,
          pageId: typeof params.pageId === "string" ? params.pageId : undefined,
          frameId: typeof params.frameId === "string" ? params.frameId : undefined,
          xpath: typeof params.xpath === "string" ? params.xpath : undefined,
          selector:
            typeof params.selector === "string" ? params.selector : undefined,
          locatorId:
            typeof params.locatorId === "string" ? params.locatorId : undefined,
          instruction:
            typeof params.instruction === "string" ? params.instruction : undefined,
          fullPage:
            typeof params.fullPage === "boolean" ? params.fullPage : undefined,
          deltaX: typeof params.deltaX === "number" ? params.deltaX : undefined,
          deltaY: typeof params.deltaY === "number" ? params.deltaY : undefined,
          percent:
            typeof params.percent === "number" || typeof params.percent === "string"
              ? params.percent
              : undefined,
          clickCount:
            typeof params.clickCount === "number" ? params.clickCount : undefined,
          button:
            params.button === "left" ||
            params.button === "right" ||
            params.button === "middle"
              ? params.button
              : undefined,
          outputPath:
            typeof params.outputPath === "string" ? params.outputPath : undefined,
          value: typeof params.value === "string" ? params.value : undefined,
          text: typeof params.text === "string" ? params.text : undefined,
          key: typeof params.key === "string" ? params.key : undefined,
          optionText:
            typeof params.optionText === "string" ? params.optionText : undefined,
          toSelector:
            typeof params.toSelector === "string" ? params.toSelector : undefined,
          modelApiKey:
            typeof params.modelApiKey === "string"
              ? params.modelApiKey
              : getOptionalHeader(request, "x-model-api-key"),
        }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result: {
          ...(isRecord(result.step.result) ? result.step.result : {}),
          step: result.step,
        },
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/page/:kind/:stepId", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { stepId } = request.params as { stepId: string };

    try {
      const result = await emitV4Event<{ step: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        UnderstudyStepGetEvent({ stepId }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/browser", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    try {
      const result = await emitV4Event<{ browsers: unknown[] }>(
        getRequestRuntime(runtime, request).bus,
        BrowserListEvent({}),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.post("/browser", async (request, reply) => {
    const { id, params } = normalizeBody(request.body);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const method =
      typeof (request.body as { method?: unknown })?.method === "string"
        ? String((request.body as { method: string }).method)
        : "launch";

    try {
      const result = await (async () => {
        switch (method) {
          case "launch": {
            const sessionId =
              typeof params.sessionId === "string" ? params.sessionId : undefined;
            return emitV4Event(getRequestRuntime(runtime, request).bus, BrowserLaunchEvent({
              browserType:
                params.browserType === "browserbase"
                  ? "browserbase"
                  : params.browserType === "remote"
                    ? "remote"
                    : "local",
              browserId:
                typeof params.browserId === "string"
                  ? params.browserId
                  : sessionId,
              apiSessionId: sessionId,
              modelName:
                typeof params.modelName === "string"
                  ? params.modelName
                  : "openai/gpt-4o-mini",
              modelApiKey:
                typeof params.modelApiKey === "string"
                  ? params.modelApiKey
                  : getOptionalHeader(request, "x-model-api-key"),
              cdpUrl: typeof params.cdpUrl === "string" ? params.cdpUrl : undefined,
              region:
                typeof params.region === "string" ? params.region : "local",
              browserLaunchOptions: isRecord(params.browserLaunchOptions)
                ? params.browserLaunchOptions
                : undefined,
              browserbaseSessionId:
                typeof params.browserbaseSessionId === "string"
                  ? params.browserbaseSessionId
                  : undefined,
              browserbaseSessionCreateParams: isRecord(
                params.browserbaseSessionCreateParams,
              )
                ? params.browserbaseSessionCreateParams
                : undefined,
              browserbaseApiKey:
                typeof params.browserbaseApiKey === "string"
                  ? params.browserbaseApiKey
                  : getOptionalHeader(request, "x-bb-api-key"),
              browserbaseProjectId:
                typeof params.browserbaseProjectId === "string"
                  ? params.browserbaseProjectId
                  : getOptionalHeader(request, "x-bb-project-id"),
            }));
          }
          case "kill": {
            const browserId =
              typeof params.browserId === "string"
                ? params.browserId
                : typeof params.sessionId === "string"
                  ? params.sessionId
                  : undefined;

            if (!browserId) {
              throw new AppError(
                "params.browserId or params.sessionId is required for method=kill",
                StatusCodes.BAD_REQUEST,
              );
            }

            return emitV4Event(getRequestRuntime(runtime, request).bus, BrowserKillEvent({
              browserId,
            }));
          }
          case "setViewport": {
            if (
              typeof params.width !== "number" ||
              typeof params.height !== "number"
            ) {
              throw new AppError(
                "params.width and params.height are required for method=setViewport",
                StatusCodes.BAD_REQUEST,
              );
            }

            return emitV4Event(getRequestRuntime(runtime, request).bus, BrowserSetViewportEvent({
              browserId:
                typeof params.browserId === "string" ? params.browserId : undefined,
              sessionId:
                typeof params.sessionId === "string" ? params.sessionId : undefined,
              width: params.width,
              height: params.height,
              deviceScaleFactor:
                typeof params.deviceScaleFactor === "number"
                  ? params.deviceScaleFactor
                  : undefined,
              modelApiKey:
                typeof params.modelApiKey === "string"
                  ? params.modelApiKey
                  : getOptionalHeader(request, "x-model-api-key"),
            }));
          }
          case "setWindowSize": {
            if (
              typeof params.width !== "number" ||
              typeof params.height !== "number"
            ) {
              throw new AppError(
                "params.width and params.height are required for method=setWindowSize",
                StatusCodes.BAD_REQUEST,
              );
            }

            return emitV4Event(getRequestRuntime(runtime, request).bus, BrowserSetWindowSizeEvent({
              browserId:
                typeof params.browserId === "string" ? params.browserId : undefined,
              sessionId:
                typeof params.sessionId === "string" ? params.sessionId : undefined,
              width: params.width,
              height: params.height,
              modelApiKey:
                typeof params.modelApiKey === "string"
                  ? params.modelApiKey
                  : getOptionalHeader(request, "x-model-api-key"),
            }));
          }
          case "triggerExtensionAction":
            return emitV4Event(getRequestRuntime(runtime, request).bus, BrowserTriggerExtensionActionEvent({
              browserId:
                typeof params.browserId === "string" ? params.browserId : undefined,
              sessionId:
                typeof params.sessionId === "string" ? params.sessionId : undefined,
              action:
                typeof params.action === "string" ? params.action : "unknown",
              payload: isRecord(params.payload) ? params.payload : undefined,
            }));
          default:
            throw new AppError(
              `Unsupported browser method: ${method}`,
              StatusCodes.BAD_REQUEST,
            );
        }
      })();

      return sendV4Success(reply, {
        runtime,
        id,
        result: result as Record<string, unknown>,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.get("/browser/:browserId", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { browserId } = request.params as { browserId: string };

    try {
      const result = await emitV4Event<{ browser: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        BrowserGetEvent({ browserId }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });

  instance.delete("/browser/:browserId", async (request, reply) => {
    const id = resolveRequestId(undefined);

    if (!(await ensureAuth(request))) {
      return sendV4Error(reply, {
        runtime,
        id,
        message: "Unauthorized",
        statusCode: StatusCodes.UNAUTHORIZED,
      });
    }

    const { browserId } = request.params as { browserId: string };

    try {
      const result = await emitV4Event<{ browser: Record<string, unknown> }>(
        getRequestRuntime(runtime, request).bus,
        BrowserKillEvent({ browserId }),
      );

      return sendV4Success(reply, {
        runtime,
        id,
        result,
      });
    } catch (error) {
      const details = unwrapError(error);
      return sendV4Error(reply, {
        runtime,
        id,
        message: details.message,
        statusCode: details.statusCode,
      });
    }
  });
};

export default v4Routes;
