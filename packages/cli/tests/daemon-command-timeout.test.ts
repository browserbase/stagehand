import { describe, expect, it } from "vitest";

import { daemonRequestTimeoutMs } from "../src/lib/driver/daemon/client.js";

describe("daemonRequestTimeoutMs for command requests", () => {
  it("keeps the transport default when the command declares no page timeout", () => {
    expect(
      daemonRequestTimeoutMs({
        command: "snapshot",
        id: "no-timeout",
        type: "command",
      }),
    ).toBe(35_000);
    expect(
      daemonRequestTimeoutMs({
        command: "wait",
        id: "selector-wait",
        params: { arg: "#app", state: "visible", type: "selector" },
        type: "command",
      }),
    ).toBe(35_000);
  });

  it("outlives `wait timeout <ms>` instead of aborting the command", () => {
    expect(
      daemonRequestTimeoutMs({
        command: "wait",
        id: "long-wait",
        params: { arg: "40000", type: "timeout" },
        type: "command",
      }),
    ).toBe(45_000);
  });

  it("outlives a navigation command's own timeout", () => {
    expect(
      daemonRequestTimeoutMs({
        command: "reload",
        id: "long-reload",
        params: { timeoutMs: 45_000 },
        type: "command",
      }),
    ).toBe(50_000);
  });

  it("never shortens the transport default for a command that asks for less", () => {
    expect(
      daemonRequestTimeoutMs({
        command: "wait",
        id: "short-wait",
        params: { arg: "1000", type: "timeout" },
        type: "command",
      }),
    ).toBe(35_000);
  });

  it("ignores a wait duration that is not a positive integer", () => {
    expect(
      daemonRequestTimeoutMs({
        command: "wait",
        id: "bad-wait",
        params: { arg: "soon", type: "timeout" },
        type: "command",
      }),
    ).toBe(35_000);
  });

  it("caps a very long wait at Node's maximum timer delay", () => {
    expect(
      daemonRequestTimeoutMs({
        command: "wait",
        id: "huge-wait",
        params: { arg: "9999999999", type: "timeout" },
        type: "command",
      }),
    ).toBe(2_147_483_647);
  });
});
