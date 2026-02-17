import { randomUUID } from "crypto";

import { StatusCodes } from "http-status-codes";

import { AppError } from "../../../lib/errorHandler.js";
import type { V4ServiceConfig } from "../../config.js";
import {
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
} from "../../events.js";
import type { V4UnderstudyStepRecord } from "../../types.js";
import { nowIso, type ServiceDeps } from "../base.js";

type RemoteUnderstudyKind =
  | "act"
  | "click"
  | "fill"
  | "type"
  | "press"
  | "scroll"
  | "scrollIntoView"
  | "scrollByPixelOffset"
  | "mouseWheel"
  | "nextChunk"
  | "prevChunk"
  | "selectOptionFromDropdown"
  | "hover"
  | "doubleClick"
  | "dragAndDrop"
  | "screenshot";

export class RemoteUnderstudyService {
  private readonly endpoint: string;

  constructor(
    private readonly deps: ServiceDeps,
    config: V4ServiceConfig,
  ) {
    if (!config.understudyRemoteUrl) {
      throw new Error(
        "V4_UNDERSTUDY_REMOTE_URL is required when V4_UNDERSTUDY_MODE=remote",
      );
    }

    this.endpoint = config.understudyRemoteUrl;

    this.deps.bus.on(UnderstudyClickEvent, this.on_UnderstudyClickEvent.bind(this));
    this.deps.bus.on(UnderstudyFillEvent, this.on_UnderstudyFillEvent.bind(this));
    this.deps.bus.on(UnderstudyTypeEvent, this.on_UnderstudyTypeEvent.bind(this));
    this.deps.bus.on(UnderstudyPressEvent, this.on_UnderstudyPressEvent.bind(this));
    this.deps.bus.on(UnderstudyScrollEvent, this.on_UnderstudyScrollEvent.bind(this));
    this.deps.bus.on(
      UnderstudyScrollIntoViewEvent,
      this.on_UnderstudyScrollIntoViewEvent.bind(this),
    );
    this.deps.bus.on(
      UnderstudyScrollByPixelOffsetEvent,
      this.on_UnderstudyScrollByPixelOffsetEvent.bind(this),
    );
    this.deps.bus.on(
      UnderstudyMouseWheelEvent,
      this.on_UnderstudyMouseWheelEvent.bind(this),
    );
    this.deps.bus.on(
      UnderstudyNextChunkEvent,
      this.on_UnderstudyNextChunkEvent.bind(this),
    );
    this.deps.bus.on(
      UnderstudyPrevChunkEvent,
      this.on_UnderstudyPrevChunkEvent.bind(this),
    );
    this.deps.bus.on(
      UnderstudySelectOptionFromDropdownEvent,
      this.on_UnderstudySelectOptionFromDropdownEvent.bind(this),
    );
    this.deps.bus.on(UnderstudyHoverEvent, this.on_UnderstudyHoverEvent.bind(this));
    this.deps.bus.on(
      UnderstudyDoubleClickEvent,
      this.on_UnderstudyDoubleClickEvent.bind(this),
    );
    this.deps.bus.on(
      UnderstudyDragAndDropEvent,
      this.on_UnderstudyDragAndDropEvent.bind(this),
    );
    this.deps.bus.on(
      UnderstudyScreenshotEvent,
      this.on_UnderstudyScreenshotEvent.bind(this),
    );
    this.deps.bus.on(UnderstudyActEvent, this.on_UnderstudyActEvent.bind(this));
    this.deps.bus.on(
      UnderstudyStepGetEvent,
      this.on_UnderstudyStepGetEvent.bind(this),
    );
  }

  private createStep(input: {
    stepId?: string;
    kind: RemoteUnderstudyKind;
    browserId?: string;
    pageId?: string;
  }): V4UnderstudyStepRecord {
    const timestamp = nowIso();
    const step: V4UnderstudyStepRecord = {
      stepId: input.stepId ?? randomUUID(),
      kind: input.kind,
      status: "running",
      browserId: input.browserId ?? "remote",
      pageId: input.pageId ?? "remote",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.deps.state.putUnderstudyStep(step);
    return step;
  }

  private updateStep(
    step: V4UnderstudyStepRecord,
    patch: Partial<V4UnderstudyStepRecord>,
  ): V4UnderstudyStepRecord {
    const updated: V4UnderstudyStepRecord = {
      ...step,
      ...patch,
      updatedAt: nowIso(),
    };

    this.deps.state.putUnderstudyStep(updated);
    return updated;
  }

  private async callRemote(kind: string, payload: unknown): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event: kind,
        payload,
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new AppError(
        `Remote understudy request failed: ${message || response.statusText}`,
        StatusCodes.BAD_GATEWAY,
      );
    }

    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private async runRemote(
    kind: RemoteUnderstudyKind,
    payload: {
      stepId?: string;
      browserId?: string;
      pageId?: string;
      [key: string]: unknown;
    },
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    const step = this.createStep({
      stepId: payload.stepId,
      kind,
      browserId: payload.browserId,
      pageId: payload.pageId,
    });

    try {
      const result = await this.callRemote(kind, {
        ...payload,
        stepId: step.stepId,
      });

      return {
        step: this.updateStep(step, {
          status: "completed",
          result,
        }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        step: this.updateStep(step, {
          status: "failed",
          error: message,
        }),
      };
    }
  }

  private async on_UnderstudyClickEvent(
    event: ReturnType<typeof UnderstudyClickEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("click", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyFillEvent(
    event: ReturnType<typeof UnderstudyFillEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("fill", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyTypeEvent(
    event: ReturnType<typeof UnderstudyTypeEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("type", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyPressEvent(
    event: ReturnType<typeof UnderstudyPressEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("press", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyScrollEvent(
    event: ReturnType<typeof UnderstudyScrollEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("scroll", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyScrollIntoViewEvent(
    event: ReturnType<typeof UnderstudyScrollIntoViewEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote(
      "scrollIntoView",
      event as unknown as Record<string, unknown>,
    );
  }

  private async on_UnderstudyScrollByPixelOffsetEvent(
    event: ReturnType<typeof UnderstudyScrollByPixelOffsetEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote(
      "scrollByPixelOffset",
      event as unknown as Record<string, unknown>,
    );
  }

  private async on_UnderstudyMouseWheelEvent(
    event: ReturnType<typeof UnderstudyMouseWheelEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("mouseWheel", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyNextChunkEvent(
    event: ReturnType<typeof UnderstudyNextChunkEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("nextChunk", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyPrevChunkEvent(
    event: ReturnType<typeof UnderstudyPrevChunkEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("prevChunk", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudySelectOptionFromDropdownEvent(
    event: ReturnType<typeof UnderstudySelectOptionFromDropdownEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote(
      "selectOptionFromDropdown",
      event as unknown as Record<string, unknown>,
    );
  }

  private async on_UnderstudyHoverEvent(
    event: ReturnType<typeof UnderstudyHoverEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("hover", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyDoubleClickEvent(
    event: ReturnType<typeof UnderstudyDoubleClickEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote(
      "doubleClick",
      event as unknown as Record<string, unknown>,
    );
  }

  private async on_UnderstudyDragAndDropEvent(
    event: ReturnType<typeof UnderstudyDragAndDropEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote(
      "dragAndDrop",
      event as unknown as Record<string, unknown>,
    );
  }

  private async on_UnderstudyScreenshotEvent(
    event: ReturnType<typeof UnderstudyScreenshotEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("screenshot", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyActEvent(
    event: ReturnType<typeof UnderstudyActEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runRemote("act", event as unknown as Record<string, unknown>);
  }

  private async on_UnderstudyStepGetEvent(
    event: ReturnType<typeof UnderstudyStepGetEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    const payload = event as unknown as { stepId: string };
    const step = this.deps.state.getUnderstudyStep(payload.stepId);

    if (!step) {
      throw new AppError(
        `Understudy step not found: ${payload.stepId}`,
        StatusCodes.NOT_FOUND,
      );
    }

    return { step };
  }
}
