import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { defineFlueJsonTool, runFlueSession } from "../src/index.js";

describe("Flue SDK session", () => {
  it("runs native tools and captures Flue events", async () => {
    const faux = fauxProvider();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("inspect", { url: "https://example.com" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxText("done")),
    ]);
    const execute = vi.fn(async () => ({ title: "Example Domain" }));
    const onToolResult = vi.fn();
    const result = await runFlueSession({
      prompt: "inspect",
      model: "faux/faux-1",
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      session: {
        instructions: "Use inspect.",
        tools: [defineFlueJsonTool({ name: "inspect", description: "Inspect a URL", execute })],
      },
      startRuntime: async ({ agents }) => {
        const { start } = await import("@flue/runtime/node");
        return start({ agents, providers: [faux.provider] });
      },
      onToolResult,
    });
    expect(result.status).toBe("completed");
    expect(result.finalMessage).toBe("done");
    expect(result.events.some((event) => event.type === "tool_start")).toBe(true);
    expect(result.events.some((event) => event.type === "tool")).toBe(true);
    expect(execute).toHaveBeenCalledWith({ url: "https://example.com" });
    expect(onToolResult).toHaveBeenCalledWith("inspect", expect.any(Object));
  });
});
