import type { StagehandFacadeTools } from "@browserbasehq/stagehand-integrations/facade";
import type { ProbeEvidence } from "stagehand-v3";
import type { RunnerToolCallResult, ToolStartResult } from "../core/contracts/tool.js";
import { isBrowserSessionLostError } from "../core/tools/browserSessionLoss.js";

export type CuaFacadeTools = Pick<
  StagehandFacadeTools,
  "run" | "runActions" | "snapshot" | "screenshot"
>;
export type FacadeToolCaller = NonNullable<ToolStartResult["callTool"]>;

export function bridgeCuaFacadeTools(
  callTool: FacadeToolCaller,
  timeoutMs = 90_000,
): CuaFacadeTools {
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await callTool(name, args, { timeoutMs });
    if (result.isError) throw new Error(resultText(result) || `${name} failed`);
    return result;
  };
  return {
    async run(code) {
      const value = resultText(await call("run", { code }));
      if (!value) return undefined;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    },
    async runActions(actions) {
      const value: unknown = JSON.parse(resultText(await call("run", { actions })));
      if (
        !value ||
        typeof value !== "object" ||
        !("completed" in value) ||
        typeof value.completed !== "number" ||
        !("url" in value) ||
        typeof value.url !== "string"
      ) {
        throw new Error("Facade run actions returned an invalid result.");
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
      throw new Error("Facade screenshot returned no image.");
    },
  };
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
export async function captureCuaEvidence(callTool: FacadeToolCaller): Promise<ProbeEvidence> {
  const facade = bridgeCuaFacadeTools(callTool, 15_000);
  const evidence: ProbeEvidence = {};
  try {
    const image = await facade.screenshot({ type: "jpeg", quality: 60 });
    evidence.screenshot = Buffer.from(image.data, "base64");
  } catch (error) {
    if (isBrowserSessionLostError(error instanceof Error ? error.message : String(error)))
      throw error;
  }
  try {
    const url = await facade.run("return page.url();");
    if (typeof url === "string" && /^[a-z][a-z0-9+.-]*:/iu.test(url)) evidence.url = url;
  } catch (error) {
    if (isBrowserSessionLostError(error instanceof Error ? error.message : String(error)))
      throw error;
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
