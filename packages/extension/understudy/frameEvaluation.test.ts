import { describe, it, expect, vi, beforeEach } from "vitest";
import { Frame } from "./frame.js";
import type { CDPSessionLike } from "./cdp.js";
import type { StagehandLogger } from "../logger.js";
import { executionContexts } from "./executionContextRegistry.js";

describe("Frame.evaluate exceptionDetails error message extraction", () => {
  let session: CDPSessionLike;
  let frame: Frame;

  const createMockLogger = (): StagehandLogger =>
    ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }) as unknown as StagehandLogger;

  beforeEach(() => {
    session = {
      id: "test-session",
      send: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      close: vi.fn(),
    };
    frame = new Frame(session, "test-frame", "test-page", false, createMockLogger());
    vi.spyOn(executionContexts, "waitForMainWorld").mockResolvedValue(1);
  });

  it("prefers exception.description over text when both are present", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {
            exception: { description: "Error: description message" },
            text: "text message",
          },
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluate("throw new Error()")).rejects.toThrow("Error: description message");
  });

  it("uses text when exception.description is not present", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {
            text: "text fallback message",
          },
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluate("throw new Error()")).rejects.toThrow("text fallback message");
  });

  it("uses text when exception is present but description is undefined", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {
            exception: { type: "object" },
            text: "text from exception without description",
          },
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluate("throw new Error()")).rejects.toThrow(
      "text from exception without description",
    );
  });

  it("uses text when exception.description is an empty string", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {
            exception: { description: "" },
            text: "text when description is empty",
          },
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluate("throw new Error()")).rejects.toThrow(
      "text when description is empty",
    );
  });

  it("uses hardcoded fallback when neither description nor text is present", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {},
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluate("throw new Error()")).rejects.toThrow("Evaluation failed");
  });

  it("uses hardcoded fallback when text is an empty string", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {
            text: "",
          },
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluate("throw new Error()")).rejects.toThrow("Evaluation failed");
  });
});

describe("Frame.evaluateInLocatorWorld exceptionDetails error message extraction", () => {
  let session: CDPSessionLike;
  let frame: Frame;

  const createMockLogger = (): StagehandLogger =>
    ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }) as unknown as StagehandLogger;

  beforeEach(() => {
    session = {
      id: "test-session",
      send: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      close: vi.fn(),
    };
    frame = new Frame(session, "test-frame", "test-page", false, createMockLogger());
    vi.spyOn(executionContexts, "waitForLocatorWorld").mockResolvedValue({
      contextId: 1,
      kind: "cdp-fallback",
      capabilities: { closedShadowRoots: false },
    });
  });

  it("prefers exception.description over text when both are present", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {
            exception: { description: "Error: locator description message" },
            text: "locator text message",
          },
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluateInLocatorWorld(() => "test")).rejects.toThrow(
      "Error: locator description message",
    );
  });

  it("uses text when exception.description is not present", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {
            text: "locator text fallback message",
          },
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluateInLocatorWorld(() => "test")).rejects.toThrow(
      "locator text fallback message",
    );
  });

  it("uses hardcoded fallback when neither description nor text is present", async () => {
    vi.mocked(session.send).mockImplementation((method: string) => {
      if (method === "Runtime.enable") return Promise.resolve();
      if (method === "Runtime.evaluate") {
        return Promise.resolve({
          result: { type: "undefined" },
          exceptionDetails: {},
        });
      }
      return Promise.resolve();
    });

    await expect(frame.evaluateInLocatorWorld(() => "test")).rejects.toThrow(
      "Locator-world evaluation failed",
    );
  });
});
