import { describe, expect, it } from "vitest";

import { reduceLogs } from "../src/lib/cloud/reduce-logs.js";

function cdpEvent(method: string, params: unknown) {
  return {
    method,
    request: { rawBody: JSON.stringify({ params }) },
  };
}

describe("reduceLogs", () => {
  it("projects supported console errors", () => {
    expect(
      reduceLogs([
        cdpEvent("Runtime.consoleAPICalled", {
          args: [{ value: "request failed" }],
          type: "error",
        }),
        cdpEvent("Runtime.consoleAPICalled", {
          args: [{ description: "deprecated call" }],
          type: "warning",
        }),
        cdpEvent("Runtime.consoleAPICalled", {
          args: [{ value: "ignored" }],
          type: "info",
        }),
      ]),
    ).toEqual([
      {
        kind: "console.error",
        domain: "Runtime",
        severity: "error",
        text: "request failed",
      },
      {
        kind: "console.warning",
        domain: "Runtime",
        severity: "warning",
        text: "deprecated call",
      },
    ]);
  });

  it("projects supported log entries", () => {
    expect(
      reduceLogs([
        cdpEvent("Log.entryAdded", {
          entry: {
            level: "error",
            text: "certificate failure",
            url: "https://example.com/app.js",
          },
        }),
        cdpEvent("Log.entryAdded", {
          entry: { level: "info", text: "ignored" },
        }),
      ]),
    ).toEqual([
      {
        kind: "log.error",
        domain: "Log",
        severity: "error",
        text: "certificate failure",
        url: "https://example.com/app.js",
      },
    ]);
  });

  it("accepts only numeric error response statuses", () => {
    expect(
      reduceLogs([
        cdpEvent("Network.responseReceived", {
          response: { status: 404, url: "https://example.com/missing" },
          type: "Document",
        }),
        cdpEvent("Network.responseReceived", {
          response: { status: 399, url: "https://example.com/redirect" },
        }),
        cdpEvent("Network.responseReceived", {
          response: { status: "500", url: "https://example.com/string-status" },
        }),
      ]),
    ).toEqual([
      {
        kind: "network",
        domain: "Network",
        status: 404,
        url: "https://example.com/missing",
        type: "Document",
      },
    ]);
  });

  it("keeps exceptions and non-aborted loading failures", () => {
    expect(
      reduceLogs([
        cdpEvent("Runtime.exceptionThrown", {
          exceptionDetails: {
            exception: { description: "TypeError: broken" },
          },
        }),
        cdpEvent("Network.loadingFailed", {
          errorText: "net::ERR_CONNECTION_REFUSED",
          type: "Document",
        }),
        cdpEvent("Network.loadingFailed", {
          errorText: "net::ERR_ABORTED",
          type: "Document",
        }),
      ]),
    ).toEqual([
      {
        kind: "exception",
        domain: "Runtime",
        severity: "error",
        text: "TypeError: broken",
      },
      {
        kind: "network.failed",
        domain: "Network",
        error: "net::ERR_CONNECTION_REFUSED",
        type: "Document",
      },
    ]);
  });

  it("ignores malformed, partial, and invalid payloads", () => {
    expect(
      reduceLogs([
        {},
        {
          method: "Runtime.consoleAPICalled",
          request: { rawBody: "{not-json" },
        },
        cdpEvent("Runtime.consoleAPICalled", {
          args: [{ value: "wrong type" }],
          type: 1,
        }),
        cdpEvent("Runtime.consoleAPICalled", {
          args: {},
          type: "error",
        }),
        cdpEvent("Runtime.consoleAPICalled", {
          args: [null, 42],
          type: "warning",
        }),
        cdpEvent("Log.entryAdded", {
          entry: { level: null, text: "missing level" },
        }),
        cdpEvent("Network.responseReceived", {
          response: { status: null, url: "https://example.com" },
        }),
        cdpEvent("Network.responseReceived", {}),
        cdpEvent("Page.lifecycleEvent", { name: "load" }),
      ]),
    ).toEqual([]);
  });
});
