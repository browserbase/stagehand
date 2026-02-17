import { EventBus } from "../bubus";
import { performUnderstudyMethod } from "../handlers/handlerUtils/actHandlerUtils";
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
  type USClickEventPayload,
  type USDragAndDropEventPayload,
  type USFillEventPayload,
  type USMouseWheelEventPayload,
  type USPressEventPayload,
  type USScrollByPixelOffsetEventPayload,
  type USScrollEventPayload,
  type USSelectOptionFromDropdownEventPayload,
  type USSelectorTargetPayload,
  type USTypeEventPayload,
} from "../types/public/events";
import { PageNotFoundError, StagehandNotInitializedError } from "../types/public/sdkErrors";
import type { V3Context } from "./context";
import type { Page } from "./page";

type SelectorEventLike = USSelectorTargetPayload;

export class UnderstudyToolsService {
  private readonly bus: EventBus;
  private readonly getContext: () => V3Context | null;

  constructor(bus: EventBus, getContext: () => V3Context | null) {
    this.bus = bus;
    this.getContext = getContext;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.bus.on(USClickEvent, this.on_USClickEvent.bind(this));
    this.bus.on(USFillEvent, this.on_USFillEvent.bind(this));
    this.bus.on(USTypeEvent, this.on_USTypeEvent.bind(this));
    this.bus.on(USPressEvent, this.on_USPressEvent.bind(this));
    this.bus.on(USScrollEvent, this.on_USScrollEvent.bind(this));
    this.bus.on(USScrollIntoViewEvent, this.on_USScrollIntoViewEvent.bind(this));
    this.bus.on(
      USScrollByPixelOffsetEvent,
      this.on_USScrollByPixelOffsetEvent.bind(this),
    );
    this.bus.on(USMouseWheelEvent, this.on_USMouseWheelEvent.bind(this));
    this.bus.on(USNextChunkEvent, this.on_USNextChunkEvent.bind(this));
    this.bus.on(USPrevChunkEvent, this.on_USPrevChunkEvent.bind(this));
    this.bus.on(
      USSelectOptionFromDropdownEvent,
      this.on_USSelectOptionFromDropdownEvent.bind(this),
    );
    this.bus.on(USHoverEvent, this.on_USHoverEvent.bind(this));
    this.bus.on(USDoubleClickEvent, this.on_USDoubleClickEvent.bind(this));
    this.bus.on(USDragAndDropEvent, this.on_USDragAndDropEvent.bind(this));
  }

  private requirePage(targetId: string): Page {
    const ctx = this.getContext();
    if (!ctx) throw new StagehandNotInitializedError("UnderstudyToolsService");
    const page = ctx.resolvePageByTargetId(targetId);
    if (!page) throw new PageNotFoundError(`targetId=${targetId}`);
    return page;
  }

  private async execute(
    event: SelectorEventLike,
    method: string,
    args: ReadonlyArray<unknown>,
  ): Promise<unknown> {
    const page = this.requirePage(event.TargetId);
    const frame = event.FrameId ? page.frameForId(event.FrameId) : page.mainFrame();
    return performUnderstudyMethod(
      page,
      frame,
      method,
      event.Selector,
      args,
      event.DomSettleTimeoutMs,
      false,
    );
  }

  private async on_USClickEvent(
    event: ReturnType<typeof USClickEvent>,
  ): Promise<void> {
    const payload = event as unknown as USClickEventPayload;
    const args: unknown[] = [];
    if (payload.Button) args.push(payload.Button);
    if (typeof payload.ClickCount === "number") args.push(payload.ClickCount);
    await this.execute(payload, "click", args);
  }

  private async on_USFillEvent(event: ReturnType<typeof USFillEvent>): Promise<void> {
    const payload = event as unknown as USFillEventPayload;
    await this.execute(payload, "fill", [payload.Value]);
  }

  private async on_USTypeEvent(event: ReturnType<typeof USTypeEvent>): Promise<void> {
    const payload = event as unknown as USTypeEventPayload;
    await this.execute(payload, "type", [payload.Text, payload.DelayMs]);
  }

  private async on_USPressEvent(
    event: ReturnType<typeof USPressEvent>,
  ): Promise<void> {
    const payload = event as unknown as USPressEventPayload;
    await this.execute(payload, "press", [payload.Key]);
  }

  private async on_USScrollEvent(
    event: ReturnType<typeof USScrollEvent>,
  ): Promise<void> {
    const payload = event as unknown as USScrollEventPayload;
    await this.execute(payload, "scrollTo", [payload.Percent]);
  }

  private async on_USScrollIntoViewEvent(
    event: ReturnType<typeof USScrollIntoViewEvent>,
  ): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "scrollIntoView", []);
  }

  private async on_USScrollByPixelOffsetEvent(
    event: ReturnType<typeof USScrollByPixelOffsetEvent>,
  ): Promise<string> {
    const payload = event as unknown as USScrollByPixelOffsetEventPayload;
    const result = await this.execute(payload, "scrollByPixelOffset", [
      payload.DeltaX,
      payload.DeltaY,
    ]);
    return String(result ?? "");
  }

  private async on_USMouseWheelEvent(
    event: ReturnType<typeof USMouseWheelEvent>,
  ): Promise<void> {
    const payload = event as unknown as USMouseWheelEventPayload;
    await this.execute(payload, "mouse.wheel", [payload.DeltaY ?? 200]);
  }

  private async on_USNextChunkEvent(
    event: ReturnType<typeof USNextChunkEvent>,
  ): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "nextChunk", []);
  }

  private async on_USPrevChunkEvent(
    event: ReturnType<typeof USPrevChunkEvent>,
  ): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "prevChunk", []);
  }

  private async on_USSelectOptionFromDropdownEvent(
    event: ReturnType<typeof USSelectOptionFromDropdownEvent>,
  ): Promise<string[]> {
    const payload = event as unknown as USSelectOptionFromDropdownEventPayload;
    const optionValues =
      Array.isArray(payload.OptionTexts) && payload.OptionTexts.length > 0
        ? payload.OptionTexts
        : [payload.OptionText];
    const result = await this.execute(payload, "selectOptionFromDropdown", [
      optionValues,
    ]);
    return Array.isArray(result) ? result.map((item) => String(item)) : [];
  }

  private async on_USHoverEvent(event: ReturnType<typeof USHoverEvent>): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "hover", []);
  }

  private async on_USDoubleClickEvent(
    event: ReturnType<typeof USDoubleClickEvent>,
  ): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "doubleClick", []);
  }

  private async on_USDragAndDropEvent(
    event: ReturnType<typeof USDragAndDropEvent>,
  ): Promise<[string, string]> {
    const payload = event as unknown as USDragAndDropEventPayload;
    const result = await this.execute(payload, "dragAndDrop", [payload.ToSelector]);
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      typeof result[0] === "string" &&
      typeof result[1] === "string"
    ) {
      return [result[0], result[1]];
    }
    return ["", ""];
  }
}
