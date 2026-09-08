import {
  isBrowserSessionLostError,
  type StagehandFacadeTools,
} from "@browserbasehq/stagehand-integrations/facade";
import type { HarnessLogger } from "@browserbasehq/stagehand-integrations/harness";

export type CuaFacadeTools = Pick<StagehandFacadeTools, "run" | "screenshot">;

export type GeminiToolResult = { text: string; isError?: boolean };
export type GeminiToolExecutor = {
  execute(
    name: string,
    input: Record<string, unknown>,
    context?: { signal?: AbortSignal; toolUseId?: string },
  ): Promise<GeminiToolResult>;
};

const WIDTH = 1288;
const HEIGHT = 711;
const KEY_NAMES: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  space: " ",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  shift: "Shift",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  pageup: "PageUp",
  pagedown: "PageDown",
};

export function denormalizeCoordinate(value: unknown, size: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.floor((Math.max(0, Math.min(999, number)) / 1000) * size);
}

export class GeminiCuaExecutor implements GeminiToolExecutor {
  constructor(
    private readonly tools: CuaFacadeTools,
    private readonly logger: HarnessLogger,
    private readonly onMutation?: (toolUseId: string) => Promise<void>,
  ) {}

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: { signal?: AbortSignal; toolUseId?: string } = {},
  ): Promise<GeminiToolResult> {
    const result = await this.executeAction(name, input, context);
    if (!result.isError && context.toolUseId && this.onMutation) {
      await this.onMutation(context.toolUseId).catch((error: unknown) => {
        if (isBrowserSessionLostError(error instanceof Error ? error.message : String(error)))
          throw error;
      });
    }
    return result;
  }

  private async executeAction(
    name: string,
    input: Record<string, unknown>,
    context: { signal?: AbortSignal } = {},
  ): Promise<GeminiToolResult> {
    try {
      if (context.signal?.aborted) throw new Error("operation aborted");
      switch (name) {
        case "click_at":
        case "click":
        case "left_click":
          return await this.click(input, "left", 1);
        case "double_click":
          return await this.click(input, "left", 2);
        case "triple_click":
          return await this.click(input, "left", 3);
        case "right_click":
          return await this.click(input, "right", 1);
        case "middle_click":
          return await this.click(input, "middle", 1);
        case "move":
        case "hover_at":
        case "hover":
          return await this.hover(input);
        case "type_text_at":
        case "type":
        case "type_text":
          return await this.type(input);
        case "key_combination":
        case "key":
        case "keys":
        case "key_press":
        case "press_key":
        case "press_keys":
        case "hotkey":
          return await this.pressKeys(name, input);
        case "scroll_document":
        case "scroll_at":
        case "scroll":
          return await this.scroll(name, input);
        case "navigate":
          return await this.navigate(input);
        case "go_back":
          await this.runWithTabs("await page.goBack();");
          return { text: "Went back." };
        case "go_forward":
          await this.runWithTabs("await page.goForward();");
          return { text: "Went forward." };
        case "wait_5_seconds":
        case "wait": {
          const seconds = name === "wait_5_seconds" ? 5 : (input.seconds ?? 1);
          if (typeof seconds !== "number" || seconds < 0 || !Number.isFinite(seconds * 1000)) {
            return {
              text: "Error: wait requires a finite nonnegative duration in seconds.",
              isError: true,
            };
          }
          await this.runWithTabs(`await page.waitForTimeout(${seconds * 1000});`);
          return { text: `Waited ${seconds} seconds.` };
        }
        case "take_screenshot":
        case "screenshot":
          return { text: "Screenshot captured." };
        case "open_web_browser":
          return { text: "Browser is already open." };
        case "search":
          await this.runWithTabs('await page.goto("https://www.google.com");');
          return { text: "Opened Google search." };
        case "drag_and_drop":
        case "drag":
          return await this.drag(input);
        default:
          return { text: `Error: unknown computer-use action "${name}".`, isError: true };
      }
    } catch (error) {
      if (
        context.signal?.aborted ||
        isBrowserSessionLostError(error instanceof Error ? error.message : String(error))
      )
        throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ category: "gemini_cua", message: `${name} failed: ${message}`, level: 1 });
      return { text: `Error: ${message}`, isError: true };
    }
  }

  private async click(
    input: Record<string, unknown>,
    button: "left" | "middle" | "right",
    clickCount: number,
  ): Promise<GeminiToolResult> {
    const [x, y] = this.requiredCoordinate(input);
    await this.runWithTabs(
      `await batchStagehand.page.click(${x}, ${y}, ${JSON.stringify({ button, clickCount })});`,
    );
    return { text: `Clicked at (${x}, ${y}).` };
  }

  private async hover(input: Record<string, unknown>): Promise<GeminiToolResult> {
    const [x, y] = this.requiredCoordinate(input);
    await this.runWithTabs(`await batchStagehand.page.hover(${x}, ${y});`);
    return { text: `Moved to (${x}, ${y}).` };
  }

  private async type(input: Record<string, unknown>): Promise<GeminiToolResult> {
    const lines: string[] = [];
    const hasCoordinates = typeof input.x === "number" && typeof input.y === "number";
    if (hasCoordinates) {
      const [x, y] = this.requiredCoordinate(input);
      lines.push(`await batchStagehand.page.click(${x}, ${y});`);
    }
    if (
      input.clear_before_typing === true ||
      (hasCoordinates && input.clear_before_typing !== false)
    ) {
      lines.push(
        'await batchStagehand.page.keyPress("Control+a");',
        'await batchStagehand.page.keyPress("Backspace");',
      );
    }
    lines.push(`await batchStagehand.page.type(${JSON.stringify(String(input.text ?? ""))});`);
    if (input.press_enter === true) lines.push('await batchStagehand.page.keyPress("Enter");');
    await this.runWithTabs(lines.join("\n"));
    return { text: `Typed ${JSON.stringify(String(input.text ?? ""))}.` };
  }

  private async pressKeys(name: string, input: Record<string, unknown>): Promise<GeminiToolResult> {
    const raw = input.keys ?? input.key ?? input.text;
    const values = Array.isArray(raw)
      ? raw
      : String(raw ?? "")
          .split(/\s+/u)
          .filter(Boolean);
    if (values.length === 0) return { text: "Error: no keys supplied.", isError: true };
    // Gemini hotkey arrays describe one simultaneous chord, while the legacy
    // key-sequence aliases still execute their entries one after another.
    const pressed =
      name === "hotkey" && Array.isArray(raw)
        ? [values.map((value) => this.chord(value)).join("+")]
        : values.map((value) => this.chord(value));
    await this.runWithTabs(
      pressed
        .map((key) => `await batchStagehand.page.keyPress(${JSON.stringify(key)});`)
        .join("\n"),
    );
    return { text: `Pressed ${pressed.join(", ")}.` };
  }

  private async scroll(name: string, input: Record<string, unknown>): Promise<GeminiToolResult> {
    const direction = String(input.direction ?? "down").toLowerCase();
    if (name === "scroll_document" || (input.x === undefined && input.y === undefined)) {
      await this.runWithTabs(
        `await batchStagehand.page.keyPress(${JSON.stringify(direction === "up" ? "PageUp" : "PageDown")});`,
      );
      return { text: "Scrolled." };
    }
    const [x, y] = this.requiredCoordinate(input);
    const amount =
      typeof input.magnitude === "number"
        ? input.magnitude
        : typeof input.magnitude_in_pixels === "number"
          ? input.magnitude_in_pixels
          : name === "scroll"
            ? 300
            : 800;
    const deltaX = direction === "left" ? -amount : direction === "right" ? amount : 0;
    const deltaY = direction === "up" ? -amount : direction === "down" ? amount : 0;
    await this.runWithTabs(`await batchStagehand.page.scroll(${x}, ${y}, ${deltaX}, ${deltaY});`);
    return { text: "Scrolled." };
  }

  private async navigate(input: Record<string, unknown>): Promise<GeminiToolResult> {
    const url = String(input.url ?? "").trim();
    if (!/^https?:\/\//u.test(url))
      return { text: "Error: navigate requires an http(s) URL.", isError: true };
    await this.runWithTabs(
      `await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded" });`,
    );
    return { text: `Navigated to ${url}.` };
  }

  private async drag(input: Record<string, unknown>): Promise<GeminiToolResult> {
    const values = [
      input.start_x ?? input.x,
      input.start_y ?? input.y,
      input.end_x ?? input.destination_x,
      input.end_y ?? input.destination_y,
    ];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value)))
      throw new Error("drag requires four finite coordinates");
    const start = [
      denormalizeCoordinate(values[0], WIDTH),
      denormalizeCoordinate(values[1], HEIGHT),
    ];
    const end = [denormalizeCoordinate(values[2], WIDTH), denormalizeCoordinate(values[3], HEIGHT)];
    // Delegate the full gesture to the SDK, retaining the midpoint movement
    // before the destination without relying on a raw CDP method on Page.
    await this.runWithTabs(
      `await batchStagehand.page.dragAndDrop(${start[0]}, ${start[1]}, ${end[0]}, ${end[1]}, { steps: 2 });`,
    );
    return { text: `Dragged from (${start[0]}, ${start[1]}) to (${end[0]}, ${end[1]}).` };
  }

  private requiredCoordinate(input: Record<string, unknown>): [number, number] {
    if (
      typeof input.x !== "number" ||
      !Number.isFinite(input.x) ||
      typeof input.y !== "number" ||
      !Number.isFinite(input.y)
    )
      throw new Error("missing or invalid coordinates (x, y)");
    return [denormalizeCoordinate(input.x, WIDTH), denormalizeCoordinate(input.y, HEIGHT)];
  }

  private chord(value: unknown): string {
    return String(value)
      .split("+")
      .map((part) => KEY_NAMES[part.toLowerCase()] ?? part)
      .join("+");
  }

  private async runWithTabs(code: string): Promise<unknown> {
    return await this.tools.run(code);
  }
}

export const GEMINI_CUA_VIEWPORT = { width: WIDTH, height: HEIGHT };
