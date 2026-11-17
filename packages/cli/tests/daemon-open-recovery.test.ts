import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommandFailure } from "../src/lib/errors.js";

const clientMocks = vi.hoisted(() => ({
  ensureDriverDaemon: vi.fn(),
  openViaDaemon: vi.fn(),
  runDriverCommandViaDaemon: vi.fn(),
  stopDriverDaemon: vi.fn(),
}));

vi.mock("../src/lib/driver/daemon/client.js", () => ({
  ensureDriverDaemon: clientMocks.ensureDriverDaemon,
  openViaDaemon: clientMocks.openViaDaemon,
  runDriverCommandViaDaemon: clientMocks.runDriverCommandViaDaemon,
  stopDriverDaemon: clientMocks.stopDriverDaemon,
}));

import { runDriverCommand } from "../src/lib/driver/runtime.js";

describe("open command auto-recovery", () => {
  beforeEach(() => {
    clientMocks.ensureDriverDaemon.mockReset();
    clientMocks.openViaDaemon.mockReset();
    clientMocks.runDriverCommandViaDaemon.mockReset();
    clientMocks.stopDriverDaemon.mockReset();
    clientMocks.stopDriverDaemon.mockResolvedValue({ stopped: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("recovers from driver_error by stopping and restarting daemon", async () => {
    const driverError = new CommandFailure("page.goto failed: target closed", 1, {
      resultCode: "driver_error",
    });

    clientMocks.openViaDaemon
      .mockRejectedValueOnce(driverError)
      .mockResolvedValueOnce({ url: "https://example.com" });
    clientMocks.ensureDriverDaemon.mockResolvedValue(undefined);

    const selection = {
      kind: "existing" as const,
      fallbackTarget: { kind: "managed-local" as const, headless: false },
    };

    const result = await runDriverCommand("default", selection, "open", {
      url: "https://example.com",
    });

    expect(result).toEqual({ url: "https://example.com" });
    expect(clientMocks.stopDriverDaemon).toHaveBeenCalledWith("default", true);
    expect(clientMocks.ensureDriverDaemon).toHaveBeenCalledWith({
      session: "default",
      target: { kind: "managed-local", headless: false },
    });
    expect(clientMocks.openViaDaemon).toHaveBeenCalledTimes(2);
  });

  it("recovers from daemon_not_running without stopping (daemon already gone)", async () => {
    const socketError = new CommandFailure("daemon not running", 1, {
      resultCode: "daemon_not_running",
    });

    clientMocks.openViaDaemon
      .mockRejectedValueOnce(socketError)
      .mockResolvedValueOnce({ url: "https://example.com" });
    clientMocks.ensureDriverDaemon.mockResolvedValue(undefined);

    const selection = {
      kind: "existing" as const,
      fallbackTarget: { kind: "managed-local" as const, headless: false },
    };

    const result = await runDriverCommand("default", selection, "open", {
      url: "https://example.com",
    });

    expect(result).toEqual({ url: "https://example.com" });
    expect(clientMocks.stopDriverDaemon).not.toHaveBeenCalled();
    expect(clientMocks.ensureDriverDaemon).toHaveBeenCalled();
    expect(clientMocks.openViaDaemon).toHaveBeenCalledTimes(2);
  });

  it("recovers from daemon_connection_lost without stopping", async () => {
    const connectionError = new CommandFailure("connection lost", 1, {
      resultCode: "daemon_connection_lost",
    });

    clientMocks.openViaDaemon
      .mockRejectedValueOnce(connectionError)
      .mockResolvedValueOnce({ url: "https://example.com" });
    clientMocks.ensureDriverDaemon.mockResolvedValue(undefined);

    const selection = {
      kind: "existing" as const,
      fallbackTarget: { kind: "managed-local" as const, headless: false },
    };

    const result = await runDriverCommand("default", selection, "open", {
      url: "https://example.com",
    });

    expect(result).toEqual({ url: "https://example.com" });
    expect(clientMocks.stopDriverDaemon).not.toHaveBeenCalled();
    expect(clientMocks.ensureDriverDaemon).toHaveBeenCalled();
  });

  it("does not recover from daemon_socket_timeout (daemon may still be alive)", async () => {
    const timeoutError = new CommandFailure("socket timeout", 1, {
      resultCode: "daemon_socket_timeout",
    });

    clientMocks.openViaDaemon.mockRejectedValueOnce(timeoutError);

    const selection = {
      kind: "existing" as const,
      fallbackTarget: { kind: "managed-local" as const, headless: false },
    };

    await expect(
      runDriverCommand("default", selection, "open", { url: "https://example.com" }),
    ).rejects.toThrow(timeoutError);

    expect(clientMocks.stopDriverDaemon).not.toHaveBeenCalled();
    expect(clientMocks.ensureDriverDaemon).not.toHaveBeenCalled();
    expect(clientMocks.openViaDaemon).toHaveBeenCalledTimes(1);
  });

  it("does not recover without fallbackTarget", async () => {
    const driverError = new CommandFailure("page.goto failed", 1, {
      resultCode: "driver_error",
    });

    clientMocks.openViaDaemon.mockRejectedValueOnce(driverError);

    const selection = { kind: "existing" as const };

    await expect(
      runDriverCommand("default", selection, "open", { url: "https://example.com" }),
    ).rejects.toThrow(driverError);

    expect(clientMocks.stopDriverDaemon).not.toHaveBeenCalled();
    expect(clientMocks.ensureDriverDaemon).not.toHaveBeenCalled();
  });

  it("does not recover for kind=create (should not need recovery)", async () => {
    const driverError = new CommandFailure("page.goto failed", 1, {
      resultCode: "driver_error",
    });

    clientMocks.ensureDriverDaemon.mockResolvedValue(undefined);
    clientMocks.openViaDaemon.mockRejectedValueOnce(driverError);

    const selection = {
      kind: "create" as const,
      target: { kind: "managed-local" as const, headless: false },
    };

    await expect(
      runDriverCommand("default", selection, "open", { url: "https://example.com" }),
    ).rejects.toThrow(driverError);

    expect(clientMocks.ensureDriverDaemon).toHaveBeenCalledTimes(1);
    expect(clientMocks.openViaDaemon).toHaveBeenCalledTimes(1);
  });
});
