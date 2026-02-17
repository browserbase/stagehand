import { randomUUID } from "crypto";

import type { Action } from "@browserbasehq/stagehand";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../lib/errorHandler.js";
import { jsonSchemaToZod } from "../../lib/utils.js";
import {
  StagehandActEvent,
  StagehandExtractEvent,
  StagehandObserveEvent,
  StagehandStepCancelEvent,
  StagehandStepGetEvent,
} from "../events.js";
import type { V4StagehandStepRecord } from "../types.js";
import {
  getStagehandForBrowser,
  nowIso,
  resolveBrowserOrThrow,
  resolvePageForAction,
  type ServiceDeps,
} from "./base.js";

export class StagehandService {
  constructor(private readonly deps: ServiceDeps) {
    this.deps.bus.on(StagehandActEvent, this.on_StagehandActEvent.bind(this));
    this.deps.bus.on(
      StagehandObserveEvent,
      this.on_StagehandObserveEvent.bind(this),
    );
    this.deps.bus.on(
      StagehandExtractEvent,
      this.on_StagehandExtractEvent.bind(this),
    );
    this.deps.bus.on(
      StagehandStepGetEvent,
      this.on_StagehandStepGetEvent.bind(this),
    );
    this.deps.bus.on(
      StagehandStepCancelEvent,
      this.on_StagehandStepCancelEvent.bind(this),
    );
  }

  private createStep(input: {
    stepId?: string;
    kind: "act" | "observe" | "extract";
    browserId: string;
    pageId?: string;
  }): V4StagehandStepRecord {
    const timestamp = nowIso();

    const step: V4StagehandStepRecord = {
      stepId: input.stepId ?? randomUUID(),
      kind: input.kind,
      status: "running",
      browserId: input.browserId,
      pageId: input.pageId,
      createdAt: timestamp,
      updatedAt: timestamp,
      logs: [],
    };

    this.deps.state.putStagehandStep(step);
    return step;
  }

  private updateStep(
    step: V4StagehandStepRecord,
    patch: Partial<V4StagehandStepRecord>,
  ): V4StagehandStepRecord {
    const updated: V4StagehandStepRecord = {
      ...step,
      ...patch,
      updatedAt: nowIso(),
    };
    this.deps.state.putStagehandStep(updated);
    return updated;
  }

  private normalizeOptions(options?: Record<string, unknown>): Record<string, unknown> {
    const model = options?.model;
    const normalizedModel =
      typeof model === "string"
        ? { modelName: model }
        : model && typeof model === "object"
          ? {
              ...(model as Record<string, unknown>),
              modelName:
                (model as Record<string, unknown>).modelName ?? "gpt-4o",
            }
          : undefined;

    return {
      ...(options ?? {}),
      model: normalizedModel,
    };
  }

  private async on_StagehandActEvent(
    event: ReturnType<typeof StagehandActEvent>,
  ): Promise<{ step: V4StagehandStepRecord }> {
    const payload = event as unknown as {
      stepId?: string;
      sessionId?: string;
      browserId?: string;
      pageId?: string;
      frameId?: string;
      modelApiKey?: string;
      instruction?: string;
      action?: Record<string, unknown>;
      options?: Record<string, unknown>;
    };

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    const step = this.createStep({
      stepId: payload.stepId,
      kind: "act",
      browserId: browser.id,
      pageId: payload.pageId,
    });

    try {
      const stagehand = await getStagehandForBrowser(
        this.deps,
        browser,
        payload.modelApiKey,
      );
      const page = await resolvePageForAction(stagehand, {
        pageId: payload.pageId,
        frameId: payload.frameId,
      });

      const options = {
        ...this.normalizeOptions(payload.options),
        page,
      };

      let result;
      if (payload.instruction) {
        result = await stagehand.act(payload.instruction, options as any);
      } else if (payload.action) {
        result = await stagehand.act(
          payload.action as unknown as Action,
          options as any,
        );
      } else {
        throw new AppError(
          "Act request requires params.instruction or params.action",
          StatusCodes.BAD_REQUEST,
        );
      }

      return {
        step: this.updateStep(step, {
          status: "completed",
          result,
          pageId: page.targetId(),
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStep(step, {
        status: "failed",
        error: message,
      });
      throw error;
    }
  }

  private async on_StagehandObserveEvent(
    event: ReturnType<typeof StagehandObserveEvent>,
  ): Promise<{ step: V4StagehandStepRecord }> {
    const payload = event as unknown as {
      stepId?: string;
      sessionId?: string;
      browserId?: string;
      pageId?: string;
      frameId?: string;
      modelApiKey?: string;
      instruction?: string;
      options?: Record<string, unknown>;
    };

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    const step = this.createStep({
      stepId: payload.stepId,
      kind: "observe",
      browserId: browser.id,
      pageId: payload.pageId,
    });

    try {
      const stagehand = await getStagehandForBrowser(
        this.deps,
        browser,
        payload.modelApiKey,
      );
      const page = await resolvePageForAction(stagehand, {
        pageId: payload.pageId,
        frameId: payload.frameId,
      });

      const options = {
        ...this.normalizeOptions(payload.options),
        page,
      };

      const result = payload.instruction
        ? await stagehand.observe(payload.instruction, options as any)
        : await stagehand.observe(options as any);

      return {
        step: this.updateStep(step, {
          status: "completed",
          result,
          pageId: page.targetId(),
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStep(step, {
        status: "failed",
        error: message,
      });
      throw error;
    }
  }

  private async on_StagehandExtractEvent(
    event: ReturnType<typeof StagehandExtractEvent>,
  ): Promise<{ step: V4StagehandStepRecord }> {
    const payload = event as unknown as {
      stepId?: string;
      sessionId?: string;
      browserId?: string;
      pageId?: string;
      frameId?: string;
      modelApiKey?: string;
      instruction?: string;
      options?: Record<string, unknown>;
      extractSchema?: Record<string, unknown>;
    };

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    const step = this.createStep({
      stepId: payload.stepId,
      kind: "extract",
      browserId: browser.id,
      pageId: payload.pageId,
    });

    try {
      const stagehand = await getStagehandForBrowser(
        this.deps,
        browser,
        payload.modelApiKey,
      );
      const page = await resolvePageForAction(stagehand, {
        pageId: payload.pageId,
        frameId: payload.frameId,
      });

      const options = {
        ...this.normalizeOptions(payload.options),
        page,
      };

      let result: unknown;
      if (payload.instruction && payload.extractSchema) {
        const zodSchema = jsonSchemaToZod(payload.extractSchema as any);
        result = await stagehand.extract(
          payload.instruction,
          zodSchema as any,
          options as any,
        );
      } else if (payload.instruction) {
        result = await stagehand.extract(payload.instruction, options as any);
      } else {
        result = await stagehand.extract(options as any);
      }

      return {
        step: this.updateStep(step, {
          status: "completed",
          result,
          pageId: page.targetId(),
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStep(step, {
        status: "failed",
        error: message,
      });
      throw error;
    }
  }

  private async on_StagehandStepGetEvent(
    event: ReturnType<typeof StagehandStepGetEvent>,
  ): Promise<{ step: V4StagehandStepRecord }> {
    const payload = event as unknown as { stepId: string };
    const step = this.deps.state.getStagehandStep(payload.stepId);

    if (!step) {
      throw new AppError(
        `Stagehand step not found: ${payload.stepId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    return { step };
  }

  private async on_StagehandStepCancelEvent(
    event: ReturnType<typeof StagehandStepCancelEvent>,
  ): Promise<{ step: V4StagehandStepRecord }> {
    const payload = event as unknown as {
      stepId: string;
    };

    const step = this.deps.state.getStagehandStep(payload.stepId);
    if (!step) {
      throw new AppError(
        `Stagehand step not found: ${payload.stepId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    if (step.status === "running" || step.status === "queued") {
      return {
        step: this.updateStep(step, {
          status: "cancelled",
        }),
      };
    }

    return { step };
  }
}
