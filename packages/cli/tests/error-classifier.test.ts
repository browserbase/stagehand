import { describe, expect, it } from "vitest";

import { classifyDriverError } from "../src/lib/driver/error-classifier.js";
import { DriverError } from "../src/lib/driver/errors.js";

describe("classifyDriverError", () => {
  it.each([
    {
      message: "Could not find an element for the given xPath(s): .my-button",
      expectedCode: "element_not_found",
      expectedMessage:
        'No element matches ".my-button". Run browse snapshot for fresh refs or check the selector.',
    },
    {
      message: 'Could not find an element for the given xPath(s): //div[@id="container"]',
      expectedCode: "element_not_found",
      expectedMessage:
        'No element matches "//div[@id="container"]". Run browse snapshot for fresh refs or check the selector.',
    },
    {
      message: "waitForSelector timed out after 30000ms while waiting for selector",
      expectedCode: "wait_timeout",
      expectedMessage: "waitForSelector timed out after 30000ms while waiting for selector",
    },
    {
      message: "waitForSelector timed out after 2000ms while waiting for selector",
      expectedCode: "wait_timeout",
      expectedMessage: "waitForSelector timed out after 2000ms while waiting for selector",
    },
    {
      message: "RPC response timed out after 30000ms: page.goto",
      expectedCode: "navigation_timeout",
      expectedMessage: "RPC response timed out after 30000ms: page.goto",
    },
    {
      message: "RPC response timed out after 30000ms: page.reload",
      expectedCode: "navigation_timeout",
      expectedMessage: "RPC response timed out after 30000ms: page.reload",
    },
    {
      message: "RPC response timed out after 30000ms: page.go_back",
      expectedCode: "navigation_timeout",
      expectedMessage: "RPC response timed out after 30000ms: page.go_back",
    },
    {
      message: "RPC response timed out after 30000ms: page.go_forward",
      expectedCode: "navigation_timeout",
      expectedMessage: "RPC response timed out after 30000ms: page.go_forward",
    },
    {
      message: "Navigation start timed out after 30000ms",
      expectedCode: "navigation_timeout",
      expectedMessage: "Navigation start timed out after 30000ms",
    },
    {
      message: "RPC response timed out after 30000ms: page.title",
      expectedCode: "page_unresponsive",
      expectedMessage:
        "RPC response timed out after 30000ms: page.title. The page may have a JavaScript dialog open or be busy; run browse open <url> to reset.",
    },
    {
      message: "RPC response timed out after 30000ms: page.url",
      expectedCode: "page_unresponsive",
      expectedMessage:
        "RPC response timed out after 30000ms: page.url. The page may have a JavaScript dialog open or be busy; run browse open <url> to reset.",
    },
    {
      message: "RPC response timed out after 30000ms: page.evaluate",
      expectedCode: "page_unresponsive",
      expectedMessage:
        "RPC response timed out after 30000ms: page.evaluate. The page may have a JavaScript dialog open or be busy; run browse open <url> to reset.",
    },
    {
      message: "RPC response timed out after 30000ms: page.screenshot",
      expectedCode: "page_unresponsive",
      expectedMessage:
        "RPC response timed out after 30000ms: page.screenshot. The page may have a JavaScript dialog open or be busy; run browse open <url> to reset.",
    },
    {
      message: "timed out after 5000ms while enabling DOM",
      expectedCode: "page_unresponsive",
      expectedMessage:
        "timed out after 5000ms while enabling DOM. The page may have a JavaScript dialog open or be busy; run browse open <url> to reset.",
    },
    {
      message: "Cannot navigate to invalid URL",
      expectedCode: "invalid_url",
      expectedMessage: "Cannot navigate to invalid URL",
    },
    {
      message: "RPC client is closed",
      expectedCode: "browser_disconnected",
      expectedMessage: "RPC client is closed",
    },
    {
      message: "Unable to resolve CDP endpoint from http://localhost:9222",
      expectedCode: "cdp_unreachable",
      expectedMessage: "Unable to resolve CDP endpoint from http://localhost:9222",
    },
    {
      message:
        "Unable to resolve CDP endpoint from port 9222. Is Chrome running with remote debugging?",
      expectedCode: "cdp_unreachable",
      expectedMessage:
        "Unable to resolve CDP endpoint from port 9222. Is Chrome running with remote debugging?",
    },
    {
      message: "Cannot close the last tab.",
      expectedCode: "last_tab",
      expectedMessage: "Cannot close the last tab.",
    },
  ])("classifies '$message' as $expectedCode", ({ message, expectedCode, expectedMessage }) => {
    const error = new Error(message);
    const classified = classifyDriverError(error);
    expect(classified).toBeInstanceOf(DriverError);
    expect(classified?.code).toBe(expectedCode);
    expect(classified?.message).toBe(expectedMessage);
  });

  it("returns null for unrecognized errors", () => {
    expect(classifyDriverError(new Error("Something went wrong"))).toBeNull();
    expect(classifyDriverError(new Error("ECONNREFUSED"))).toBeNull();
    expect(classifyDriverError("string error")).toBeNull();
    expect(classifyDriverError({ message: "object error" })).toBeNull();
  });

  it("preserves the original error as cause", () => {
    const original = new Error("Could not find an element for the given xPath(s): .btn");
    const classified = classifyDriverError(original);
    expect(classified?.cause).toBe(original);
  });

  it("handles string errors", () => {
    const classified = classifyDriverError("Cannot close the last tab.");
    expect(classified?.code).toBe("last_tab");
  });
});
