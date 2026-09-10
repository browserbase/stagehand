import type { StagehandFacadeTools } from "@browserbasehq/stagehand-integrations/facade";
import type { ProbeEvidence } from "stagehand-v3";
import type {
  BrowserSessionLoss,
  RunnerToolCallResult,
  ToolStartResult,
} from "../core/contracts/tool.js";
import {
  StagehandFacadeBridgeError,
  StagehandFacadeTimeoutError,
} from "../core/tools/stagehandFacadeBridge.js";

export type CuaFacadeTools = Pick<
  StagehandFacadeTools,
  "run" | "runActions" | "snapshot" | "screenshot"
>;
export type FacadeToolCaller = NonNullable<ToolStartResult["callTool"]>;
type SessionLossReader = () => BrowserSessionLoss | undefined;

/** Only runner-owned telemetry can create a terminal CUA facade error. */
export class CuaFacadeSessionLostError extends StagehandFacadeBridgeError {
  constructor() {
    super("Browser session lost (confirmed by eval runner). The task cannot continue.");
    this.name = "CuaFacadeSessionLostError";
  }
}

export function bridgeCuaFacadeTools(
  callTool: FacadeToolCaller,
  timeoutMs = 90_000,
  browserSessionLoss?: SessionLossReader,
): CuaFacadeTools {
  const checkSession = () => {
    if (browserSessionLoss?.()) throw new CuaFacadeSessionLostError();
  };
  const call = async (name: "run" | "snapshot" | "screenshot", args: Record<string, unknown>) => {
    checkSession();
    let result: RunnerToolCallResult;
    try {
      result = await callTool(name, args, { timeoutMs });
    } catch (error) {
      checkSession();
      if (error instanceof StagehandFacadeTimeoutError) throw error;
      throw new StagehandFacadeBridgeError(`Facade ${name} request failed.`);
    }
    checkSession();
    if (result.isError) throw new StagehandFacadeBridgeError(`Facade ${name} tool failed.`);
    return result;
  };
  return {
    async run(code) {
      // The canonical facade renders strings raw and objects as JSON. Wrap the
      // result inside this callback so strings such as "42", "null", and ""
      // retain their type without changing the shared model-facing tool.
      const wrapped = `const __cuaValue = await (async () => {\n${code}\n})();\nreturn __cuaValue === undefined ? { type: "undefined" } : { type: "value", value: __cuaValue };`;
      const result = await call("run", { code: wrapped });
      let value: unknown;
      try {
        value = JSON.parse(resultText(result)) as unknown;
      } catch {
        throw new StagehandFacadeBridgeError("Facade run returned an invalid result.");
      }
      if (isRecord(value) && value.type === "undefined") return undefined;
      if (isRecord(value) && value.type === "value" && "value" in value) return value.value;
      throw new StagehandFacadeBridgeError("Facade run returned an invalid result.");
    },
    async runActions(actions) {
      const result = await call("run", { actions });
      let value: unknown;
      try {
        value = JSON.parse(resultText(result)) as unknown;
      } catch {
        throw new StagehandFacadeBridgeError("Facade run actions returned an invalid result.");
      }
      if (!isRecord(value) || value.completed !== actions.length || typeof value.url !== "string") {
        throw new StagehandFacadeBridgeError("Facade run actions returned an invalid result.");
      }
      return { completed: value.completed, url: value.url };
    },
    async snapshot(options) {
      return resultText(
        await call("snapshot", { includeIframes: options?.includeIframes ?? true }),
      );
    },
    async screenshot(options) {
      const result = await call("screenshot", { ...options });
      for (const block of result.content) {
        if (
          block.type === "image" &&
          "data" in block &&
          typeof block.data === "string" &&
          block.data &&
          "mimeType" in block &&
          (block.mimeType === "image/png" || block.mimeType === "image/jpeg")
        ) {
          return { data: block.data, mimeType: block.mimeType };
        }
      }
      throw new StagehandFacadeBridgeError("Facade screenshot returned no image.");
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resultText(result: RunnerToolCallResult): string {
  return result.content
    .flatMap((block) =>
      block.type === "text" && "text" in block && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}

/** Evidence must not refresh the snapshot/ref map between model actions. */
export async function captureCuaEvidence(
  callTool: FacadeToolCaller,
  browserSessionLoss?: SessionLossReader,
): Promise<ProbeEvidence> {
  const facade = bridgeCuaFacadeTools(callTool, 15_000, browserSessionLoss);
  const evidence: ProbeEvidence = {};
  try {
    const image = await facade.screenshot({ type: "jpeg", quality: 60 });
    evidence.screenshot = Buffer.from(image.data, "base64");
  } catch (error) {
    if (error instanceof CuaFacadeSessionLostError) throw error;
  }
  try {
    const url = await facade.run("return page.url();");
    if (typeof url === "string" && /^[a-z][a-z0-9+.-]*:/iu.test(url)) evidence.url = url;
  } catch (error) {
    if (error instanceof CuaFacadeSessionLostError) throw error;
  }
  return evidence;
}

export function cuaCleanup(cleanup: () => Promise<void>, timeoutMs = 30_000): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () =>
    (pending ??= new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      Promise.resolve()
        .then(cleanup)
        .catch((): undefined => undefined)
        .finally(() => {
          clearTimeout(timer);
          resolve();
        });
    }));
}
