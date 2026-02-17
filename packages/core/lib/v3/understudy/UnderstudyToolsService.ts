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
    this.bus.on(USClickEvent, this.onClickEvent.bind(this));
    this.bus.on(USFillEvent, this.onFillEvent.bind(this));
    this.bus.on(USTypeEvent, this.onTypeEvent.bind(this));
    this.bus.on(USPressEvent, this.onPressEvent.bind(this));
    this.bus.on(USScrollEvent, this.onScrollEvent.bind(this));
    this.bus.on(USScrollIntoViewEvent, this.onScrollIntoViewEvent.bind(this));
    this.bus.on(
      USScrollByPixelOffsetEvent,
      this.onScrollByPixelOffsetEvent.bind(this),
    );
    this.bus.on(USMouseWheelEvent, this.onMouseWheelEvent.bind(this));
    this.bus.on(USNextChunkEvent, this.onNextChunkEvent.bind(this));
    this.bus.on(USPrevChunkEvent, this.onPrevChunkEvent.bind(this));
    this.bus.on(
      USSelectOptionFromDropdownEvent,
      this.onSelectOptionFromDropdownEvent.bind(this),
    );
    this.bus.on(USHoverEvent, this.onHoverEvent.bind(this));
    this.bus.on(USDoubleClickEvent, this.onDoubleClickEvent.bind(this));
    this.bus.on(USDragAndDropEvent, this.onDragAndDropEvent.bind(this));
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

  private async onClickEvent(
    event: ReturnType<typeof USClickEvent>,
  ): Promise<void> {
    const payload = event as unknown as USClickEventPayload;
    const args: unknown[] = [];
    if (payload.Button) args.push(payload.Button);
    if (typeof payload.ClickCount === "number") args.push(payload.ClickCount);
    await this.execute(payload, "click", args);
  }

  private async onFillEvent(event: ReturnType<typeof USFillEvent>): Promise<void> {
    const payload = event as unknown as USFillEventPayload;
    await this.execute(payload, "fill", [payload.Value]);
  }

  private async onTypeEvent(event: ReturnType<typeof USTypeEvent>): Promise<void> {
    const payload = event as unknown as USTypeEventPayload;
    await this.execute(payload, "type", [payload.Text]);
  }

  private async onPressEvent(
    event: ReturnType<typeof USPressEvent>,
  ): Promise<void> {
    const payload = event as unknown as USPressEventPayload;
    await this.execute(payload, "press", [payload.Key]);
  }

  private async onScrollEvent(
    event: ReturnType<typeof USScrollEvent>,
  ): Promise<void> {
    const payload = event as unknown as USScrollEventPayload;
    await this.execute(payload, "scrollTo", [payload.Percent]);
  }

  private async onScrollIntoViewEvent(
    event: ReturnType<typeof USScrollIntoViewEvent>,
  ): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "scrollIntoView", []);
  }

  private async onScrollByPixelOffsetEvent(
    event: ReturnType<typeof USScrollByPixelOffsetEvent>,
  ): Promise<string> {
    const payload = event as unknown as USScrollByPixelOffsetEventPayload;
    const result = await this.execute(payload, "scrollByPixelOffset", [
      payload.DeltaX,
      payload.DeltaY,
    ]);
    return String(result ?? "");
  }

  private async onMouseWheelEvent(
    event: ReturnType<typeof USMouseWheelEvent>,
  ): Promise<void> {
    const payload = event as unknown as USMouseWheelEventPayload;
    await this.execute(payload, "mouse.wheel", [payload.DeltaY ?? 200]);
  }

  private async onNextChunkEvent(
    event: ReturnType<typeof USNextChunkEvent>,
  ): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "nextChunk", []);
  }

  private async onPrevChunkEvent(
    event: ReturnType<typeof USPrevChunkEvent>,
  ): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "prevChunk", []);
  }

  private async onSelectOptionFromDropdownEvent(
    event: ReturnType<typeof USSelectOptionFromDropdownEvent>,
  ): Promise<string[]> {
    const payload = event as unknown as USSelectOptionFromDropdownEventPayload;
    const result = await this.execute(payload, "selectOptionFromDropdown", [
      payload.OptionText,
    ]);
    return Array.isArray(result) ? result.map((item) => String(item)) : [];
  }

  private async onHoverEvent(event: ReturnType<typeof USHoverEvent>): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "hover", []);
  }

  private async onDoubleClickEvent(
    event: ReturnType<typeof USDoubleClickEvent>,
  ): Promise<void> {
    await this.execute(event as unknown as SelectorEventLike, "doubleClick", []);
  }

  private async onDragAndDropEvent(
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
