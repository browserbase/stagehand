import { describe, expect, it } from "vitest";

import { DriverError } from "../src/lib/driver/errors.js";
import {
  ErrorResponseSchema,
  serializeResponse,
} from "../src/lib/driver/daemon/protocol.js";
import { classifyRemoteInitError } from "../src/lib/driver/remote.js";
import {
  initFailureBackoffMs,
  isChromeNotFoundError,
} from "../src/lib/driver/session-manager.js";

describe("classifyRemoteInitError", () => {
  it("maps 401 to an actionable invalid-key message", () => {
    const error = Object.assign(new Error("401 Unauthorized"), {
      status: 401,
    });
    const classified = classifyRemoteInitError(error);
    expect(classified.code).toBe("remote_auth_401");
    expect(classified.httpStatus).toBe(401);
    expect(classified.message).toContain("BROWSERBASE_API_KEY");
    expect(classified.message).toContain("--local");
    expect(classified.message).toContain("browse doctor");
  });

  it("maps 403 to a permissions/plan message with the same escape hatches", () => {
    const error = Object.assign(new Error("403 Forbidden"), { status: 403 });
    const classified = classifyRemoteInitError(error);
    expect(classified.code).toBe("remote_auth_403");
    expect(classified.httpStatus).toBe(403);
    expect(classified.message).toContain("--local");
    expect(classified.message).toContain("browse doctor");
  });

  it("preserves the original message for other failures", () => {
    const classified = classifyRemoteInitError(
      new Error("session quota exceeded"),
    );
    expect(classified.code).toBe("remote_session_create_failed");
    expect(classified.httpStatus).toBeUndefined();
    expect(classified.message).toContain("session quota exceeded");
    expect(classified.message).toContain("browse doctor");
  });

  it("handles non-Error values and non-numeric statuses", () => {
    const classified = classifyRemoteInitError("boom");
    expect(classified.code).toBe("remote_session_create_failed");
    expect(classified.message).toContain("boom");
  });
});

describe("initFailureBackoffMs", () => {
  it("doubles from 5s per consecutive failure", () => {
    expect(initFailureBackoffMs(1)).toBe(5_000);
    expect(initFailureBackoffMs(2)).toBe(10_000);
    expect(initFailureBackoffMs(3)).toBe(20_000);
    expect(initFailureBackoffMs(4)).toBe(40_000);
  });

  it("caps at 5 minutes", () => {
    expect(initFailureBackoffMs(7)).toBe(300_000);
    expect(initFailureBackoffMs(50)).toBe(300_000);
  });

  it("treats nonsense counts as the first failure", () => {
    expect(initFailureBackoffMs(0)).toBe(5_000);
    expect(initFailureBackoffMs(-3)).toBe(5_000);
  });
});

describe("isChromeNotFoundError", () => {
  it("matches chrome-launcher not-installed and path-not-set codes", () => {
    expect(
      isChromeNotFoundError(
        Object.assign(new Error("No Chrome installations found."), {
          code: "ERR_LAUNCHER_NOT_INSTALLED",
        }),
      ),
    ).toBe(true);
    expect(
      isChromeNotFoundError(
        Object.assign(new Error("CHROME_PATH must be set"), {
          code: "ERR_LAUNCHER_PATH_NOT_SET",
        }),
      ),
    ).toBe(true);
  });

  it("matches the message shape when no code is present", () => {
    expect(
      isChromeNotFoundError(new Error("No Chrome installations found.")),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isChromeNotFoundError(new Error("ECONNREFUSED"))).toBe(false);
    expect(isChromeNotFoundError(undefined)).toBe(false);
  });
});

describe("daemon error protocol", () => {
  it("round-trips code and httpStatus on error responses", () => {
    const line = serializeResponse({
      code: "remote_auth_401",
      error: "Browserbase rejected your key",
      httpStatus: 401,
      id: "req-1",
      type: "error",
    });
    const parsed = ErrorResponseSchema.parse(JSON.parse(line));
    expect(parsed.code).toBe("remote_auth_401");
    expect(parsed.httpStatus).toBe(401);
  });

  it("stays backward compatible with old daemons that omit the new fields", () => {
    const parsed = ErrorResponseSchema.parse({
      error: "plain failure",
      type: "error",
    });
    expect(parsed.code).toBeUndefined();
    expect(parsed.httpStatus).toBeUndefined();
  });
});

describe("driverInitHints", () => {
  it("mentions the API key in the full build", async () => {
    const { driverInitHints } = await import("../src/lib/driver/remote.js");
    const hints = driverInitHints();
    expect(hints.chromeNotFound).toContain("BROWSERBASE_API_KEY");
    expect(hints.repeatedInitFailure).toContain("BROWSERBASE_API_KEY");
  });

  it("stays key-free in the local-only capability", async () => {
    const { driverInitHints } = await import(
      "../src/lib/driver/remote.disabled.js"
    );
    const hints = driverInitHints();
    expect(hints.chromeNotFound).not.toContain("BROWSERBASE_API_KEY");
    expect(hints.repeatedInitFailure).not.toContain("BROWSERBASE_API_KEY");
    expect(hints.chromeNotFound).toContain("--cdp");
  });
});

describe("DriverError", () => {
  it("carries code, httpStatus, and cause", () => {
    const cause = new Error("401 Unauthorized");
    const error = new DriverError("actionable message", {
      cause,
      code: "remote_auth_401",
      httpStatus: 401,
    });
    expect(error.code).toBe("remote_auth_401");
    expect(error.httpStatus).toBe(401);
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("actionable message");
  });
});
