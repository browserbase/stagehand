import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

import {
  USClickEvent,
  USDoubleClickEvent,
  USDragAndDropEvent,
  USFillEvent,
  USHoverEvent,
  USMouseWheelEvent,
  USNextChunkEvent,
  USPressEvent,
  USPrevChunkEvent,
  USScrollByPixelOffsetEvent,
  USScrollEvent,
  USScrollIntoViewEvent,
  USSelectOptionFromDropdownEvent,
  USTypeEvent,
} from "@browserbasehq/stagehand";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../../../lib/errorHandler.js";
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
import {
  getStagehandForBrowser,
  nowIso,
  resolveBrowserOrThrow,
  resolvePageForAction,
  type ServiceDeps,
} from "../base.js";

const DEFAULT_SCREENSHOT_DIR = path.join(
  process.cwd(),
  ".stagehand",
  "screenshots",
);

type UnderstudyMethodKind =
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
  | "dragAndDrop";

interface UnderstudyPayload {
  stepId?: string;
  sessionId?: string;
  browserId?: string;
  pageId?: string;
  frameId?: string;
  modelApiKey?: string;
  xpath?: string;
  selector?: string;
  locatorId?: string;
  outputPath?: string;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  percent?: string | number;
  deltaX?: number;
  deltaY?: number;
  value?: string;
  text?: string;
  key?: string;
  optionText?: string;
  toSelector?: string;
}

export class LocalUnderstudyService {
  constructor(private readonly deps: ServiceDeps) {
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
    kind: V4UnderstudyStepRecord["kind"];
    browserId: string;
    pageId: string;
  }): V4UnderstudyStepRecord {
    const timestamp = nowIso();

    const step: V4UnderstudyStepRecord = {
      stepId: input.stepId ?? randomUUID(),
      kind: input.kind,
      status: "running",
      browserId: input.browserId,
      pageId: input.pageId,
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

  private async writeScreenshot(
    screenshot: Buffer,
    stepId: string,
    outputPath?: string,
  ): Promise<string> {
    const screenshotPath =
      outputPath ?? path.join(DEFAULT_SCREENSHOT_DIR, `${stepId}.png`);

    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, screenshot);

    return screenshotPath;
  }

  private async emitUnderstudyMethod(
    method: UnderstudyMethodKind,
    page: Awaited<ReturnType<typeof resolvePageForAction>>,
    payload: UnderstudyPayload,
  ): Promise<unknown> {
    const selector = payload.xpath ?? payload.selector ?? payload.locatorId ?? "/html";
    const bus = page.getUnderstudyEventBus();

    if (!bus) {
      throw new AppError(
        "No understudy event bus attached to page",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    const base = {
      TargetId: page.targetId(),
      FrameId: payload.frameId,
      Selector: selector,
    };

    const emitOnBus = (eventPayload: unknown) => bus.emit(eventPayload as any);
    let emitted: ReturnType<typeof emitOnBus>;

    switch (method) {
      case "click":
        emitted = emitOnBus(
          USClickEvent({
            ...base,
            Button: payload.button,
            ClickCount: payload.clickCount,
          }),
        );
        break;
      case "fill":
        emitted = emitOnBus(
          USFillEvent({
            ...base,
            Value: payload.value ?? "",
          }),
        );
        break;
      case "type":
        emitted = emitOnBus(
          USTypeEvent({
            ...base,
            Text: payload.text ?? "",
          }),
        );
        break;
      case "press":
        emitted = emitOnBus(
          USPressEvent({
            ...base,
            Key: payload.key ?? "Enter",
          }),
        );
        break;
      case "scroll":
        emitted = emitOnBus(
          USScrollEvent({
            ...base,
            Percent: payload.percent ?? "50%",
          }),
        );
        break;
      case "scrollIntoView":
        emitted = emitOnBus(USScrollIntoViewEvent(base));
        break;
      case "scrollByPixelOffset":
        emitted = emitOnBus(
          USScrollByPixelOffsetEvent({
            ...base,
            DeltaX: payload.deltaX ?? 0,
            DeltaY: payload.deltaY ?? 0,
          }),
        );
        break;
      case "mouseWheel":
        emitted = emitOnBus(
          USMouseWheelEvent({
            ...base,
            DeltaY: payload.deltaY,
          }),
        );
        break;
      case "nextChunk":
        emitted = emitOnBus(USNextChunkEvent(base));
        break;
      case "prevChunk":
        emitted = emitOnBus(USPrevChunkEvent(base));
        break;
      case "selectOptionFromDropdown":
        emitted = emitOnBus(
          USSelectOptionFromDropdownEvent({
            ...base,
            OptionText: payload.optionText ?? "",
          }),
        );
        break;
      case "hover":
        emitted = emitOnBus(USHoverEvent(base));
        break;
      case "doubleClick":
        emitted = emitOnBus(USDoubleClickEvent(base));
        break;
      case "dragAndDrop":
        emitted = emitOnBus(
          USDragAndDropEvent({
            ...base,
            ToSelector: payload.toSelector ?? "",
          }),
        );
        break;
      default:
        throw new AppError(
          `Unsupported understudy method: ${String(method)}`,
          StatusCodes.BAD_REQUEST,
        );
    }

    await emitted.done();

    // Bubus done() waits for completion but does not throw handler errors by default.
    // Enforce failure propagation so step status reflects underlying action failures.
    if (typeof emitted.eventResultsList === "function") {
      await emitted.eventResultsList({
        raise_if_any: true,
        raise_if_none: false,
      });
    }

    return emitted.event_result;
  }

  private async runUnderstudyMethod(
    method: UnderstudyMethodKind,
    payload: UnderstudyPayload,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    const stagehand = await getStagehandForBrowser(
      this.deps,
      browser,
      payload.modelApiKey,
    );
    const page = await resolvePageForAction(stagehand, {
      pageId: payload.pageId,
      frameId: payload.frameId,
    });

    const step = this.createStep({
      stepId: payload.stepId,
      kind: method,
      browserId: browser.id,
      pageId: page.targetId(),
    });

    try {
      const eventResult = await this.emitUnderstudyMethod(method, page, payload);

      const screenshot = await page.screenshot();
      const screenshotPath = await this.writeScreenshot(
        screenshot,
        step.stepId,
        payload.outputPath,
      );

      return {
        step: this.updateStep(step, {
          status: "completed",
          result: {
            screenshot_path: screenshotPath,
            event_result: eventResult,
          },
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
    return this.runUnderstudyMethod("click", event as unknown as UnderstudyPayload);
  }

  private async on_UnderstudyFillEvent(
    event: ReturnType<typeof UnderstudyFillEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod("fill", event as unknown as UnderstudyPayload);
  }

  private async on_UnderstudyTypeEvent(
    event: ReturnType<typeof UnderstudyTypeEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod("type", event as unknown as UnderstudyPayload);
  }

  private async on_UnderstudyPressEvent(
    event: ReturnType<typeof UnderstudyPressEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod("press", event as unknown as UnderstudyPayload);
  }

  private async on_UnderstudyScrollEvent(
    event: ReturnType<typeof UnderstudyScrollEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod("scroll", event as unknown as UnderstudyPayload);
  }

  private async on_UnderstudyScrollIntoViewEvent(
    event: ReturnType<typeof UnderstudyScrollIntoViewEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod(
      "scrollIntoView",
      event as unknown as UnderstudyPayload,
    );
  }

  private async on_UnderstudyScrollByPixelOffsetEvent(
    event: ReturnType<typeof UnderstudyScrollByPixelOffsetEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod(
      "scrollByPixelOffset",
      event as unknown as UnderstudyPayload,
    );
  }

  private async on_UnderstudyMouseWheelEvent(
    event: ReturnType<typeof UnderstudyMouseWheelEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod(
      "mouseWheel",
      event as unknown as UnderstudyPayload,
    );
  }

  private async on_UnderstudyNextChunkEvent(
    event: ReturnType<typeof UnderstudyNextChunkEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod("nextChunk", event as unknown as UnderstudyPayload);
  }

  private async on_UnderstudyPrevChunkEvent(
    event: ReturnType<typeof UnderstudyPrevChunkEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod("prevChunk", event as unknown as UnderstudyPayload);
  }

  private async on_UnderstudySelectOptionFromDropdownEvent(
    event: ReturnType<typeof UnderstudySelectOptionFromDropdownEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod(
      "selectOptionFromDropdown",
      event as unknown as UnderstudyPayload,
    );
  }

  private async on_UnderstudyHoverEvent(
    event: ReturnType<typeof UnderstudyHoverEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod("hover", event as unknown as UnderstudyPayload);
  }

  private async on_UnderstudyDoubleClickEvent(
    event: ReturnType<typeof UnderstudyDoubleClickEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod(
      "doubleClick",
      event as unknown as UnderstudyPayload,
    );
  }

  private async on_UnderstudyDragAndDropEvent(
    event: ReturnType<typeof UnderstudyDragAndDropEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    return this.runUnderstudyMethod(
      "dragAndDrop",
      event as unknown as UnderstudyPayload,
    );
  }

  private async on_UnderstudyScreenshotEvent(
    event: ReturnType<typeof UnderstudyScreenshotEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    const payload = event as unknown as {
      stepId?: string;
      sessionId?: string;
      browserId?: string;
      pageId?: string;
      frameId?: string;
      modelApiKey?: string;
      fullPage?: boolean;
      outputPath?: string;
    };

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    const stagehand = await getStagehandForBrowser(
      this.deps,
      browser,
      payload.modelApiKey,
    );
    const page = await resolvePageForAction(stagehand, {
      pageId: payload.pageId,
      frameId: payload.frameId,
    });

    const step = this.createStep({
      stepId: payload.stepId,
      kind: "screenshot",
      browserId: browser.id,
      pageId: page.targetId(),
    });

    try {
      const screenshot = await page.screenshot({ fullPage: payload.fullPage });
      const screenshotPath = await this.writeScreenshot(
        screenshot,
        step.stepId,
        payload.outputPath,
      );

      return {
        step: this.updateStep(step, {
          status: "completed",
          result: {
            screenshot_path: screenshotPath,
          },
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

  private async on_UnderstudyActEvent(
    event: ReturnType<typeof UnderstudyActEvent>,
  ): Promise<{ step: V4UnderstudyStepRecord }> {
    const payload = event as unknown as {
      stepId?: string;
      sessionId?: string;
      browserId?: string;
      pageId?: string;
      frameId?: string;
      modelApiKey?: string;
      instruction?: string;
      outputPath?: string;
    };

    if (!payload.instruction) {
      throw new AppError(
        "Understudy act requires params.instruction",
        StatusCodes.BAD_REQUEST,
      );
    }

    const browser = resolveBrowserOrThrow(
      this.deps.state,
      payload.browserId,
      payload.sessionId,
    );
    const stagehand = await getStagehandForBrowser(
      this.deps,
      browser,
      payload.modelApiKey,
    );
    const page = await resolvePageForAction(stagehand, {
      pageId: payload.pageId,
      frameId: payload.frameId,
    });

    const step = this.createStep({
      stepId: payload.stepId,
      kind: "act",
      browserId: browser.id,
      pageId: page.targetId(),
    });

    try {
      const actionResult = await stagehand.act(payload.instruction, {
        page,
      });
      const screenshot = await page.screenshot();
      const screenshotPath = await this.writeScreenshot(
        screenshot,
        step.stepId,
        payload.outputPath,
      );

      return {
        step: this.updateStep(step, {
          status: "completed",
          result: {
            ...actionResult,
            screenshot_path: screenshotPath,
          },
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
