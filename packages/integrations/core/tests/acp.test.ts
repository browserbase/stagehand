import type { RequestPermissionRequest, ToolCallUpdate } from "@agentclientprotocol/sdk";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveAcpFacadePermission,
  runAcpFacadeAgent,
  type AcpFacadeAgentProfile,
} from "../src/acp/index.js";
import { FACADE_AGENT_INSTRUCTIONS } from "../src/facade/contract.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-acp-agent.mjs", import.meta.url));
const resolvedFacadeLauncher = fileURLToPath(
  new URL("../src/acp/facade-launcher.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("ACP facade helpers", () => {
  it("allows one-time only for active-session facade calls", () => {
    const request = permissionRequest({ allowed: true });
    expect(resolveAcpFacadePermission(request, "session-1", isAllowed)).toStrictEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
    expect(
      resolveAcpFacadePermission(permissionRequest({ allowed: false }), "session-1", isAllowed),
    ).toStrictEqual({ outcome: { outcome: "selected", optionId: "reject" } });
    expect(resolveAcpFacadePermission(request, "other-session", isAllowed)).toStrictEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(
      resolveAcpFacadePermission({ ...request, options: [] }, "session-1", isAllowed),
    ).toStrictEqual({ outcome: { outcome: "cancelled" } });
  });
});

describe("ACP facade runner", () => {
  it("initializes, authenticates, mounts one facade, delivers instructions, and streams text", async () => {
    const runtime = await makeRuntime("permission");
    const text = await runAcpFacadeAgent({
      profile: profile(),
      instruction: "Open example.com",
      cwd: runtime.cwd,
      env: runtime.env,
      facadeServerPath: "/absolute/facade.mjs",
    });

    expect(text).toBe("Hello browser");
    const events = await readEvents(runtime.recordPath);
    expect(events.find((event) => event.type === "initialize")?.params).toMatchObject({
      protocolVersion: 1,
      clientCapabilities: {},
    });
    expect(events.find((event) => event.type === "authenticate")?.params).toStrictEqual({
      methodId: "test-auth",
    });
    expect(events.find((event) => event.type === "session-new")?.params).toStrictEqual({
      cwd: runtime.cwd,
      mcpServers: [
        {
          name: "stagehand",
          command: process.execPath,
          args: [resolvedFacadeLauncher, "/absolute/facade.mjs"],
          env: [{ name: "STAGEHAND_BROWSER", value: "local" }],
        },
      ],
      _meta: { rules: FACADE_AGENT_INSTRUCTIONS },
    });
    expect(events.find((event) => event.type === "prompt")?.params.prompt).toStrictEqual([
      { type: "text", text: "Open example.com" },
    ]);
    expect(events.find((event) => event.type === "permission-result")?.permission).toStrictEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
  });

  it("rejects non-facade permission requests", async () => {
    const runtime = await makeRuntime("deny-permission");
    await expect(
      runAcpFacadeAgent({
        profile: profile(),
        instruction: "Task",
        cwd: runtime.cwd,
        env: runtime.env,
        facadeServerPath: "/facade.mjs",
      }),
    ).resolves.toBe("Hello browser");
    const events = await readEvents(runtime.recordPath);
    expect(events.find((event) => event.type === "permission-result")?.permission).toStrictEqual({
      outcome: { outcome: "selected", optionId: "reject" },
    });
  });

  it("skips optional auth and prepends instructions when a profile has no native mapping", async () => {
    const runtime = await makeRuntime("no-auth");
    const fallbackProfile: AcpFacadeAgentProfile = {
      id: "fallback",
      command: process.execPath,
      args: [fixture],
      isFacadeToolCall: isAllowed,
    };
    await expect(
      runAcpFacadeAgent({
        profile: fallbackProfile,
        instruction: "Task only",
        cwd: runtime.cwd,
        env: runtime.env,
        facadeServerPath: "/facade.mjs",
      }),
    ).resolves.toBe("Hello browser");
    const events = await readEvents(runtime.recordPath);
    expect(events.some((event) => event.type === "authenticate")).toBe(false);
    expect(events.find((event) => event.type === "session-new")?.params).not.toHaveProperty(
      "_meta",
    );
    expect(events.find((event) => event.type === "prompt")?.params.prompt).toStrictEqual([
      {
        type: "text",
        text: `${FACADE_AGENT_INSTRUCTIONS}\n\nTask:\nTask only`,
      },
    ]);
  });

  it("fails when required authentication cannot be selected", async () => {
    const runtime = await makeRuntime("success");
    const missingAuth = { ...profile(), resolveAuthentication: undefined };
    await expect(
      runAcpFacadeAgent({
        profile: missingAuth,
        instruction: "Task",
        cwd: runtime.cwd,
        env: runtime.env,
        facadeServerPath: "/facade.mjs",
      }),
    ).rejects.toThrow("requires authentication");
  });

  it("reports an agent process that exits during startup", async () => {
    const runtime = await makeRuntime("exit-after-initialize");
    await expect(
      runAcpFacadeAgent({
        profile: profile(),
        instruction: "Task",
        cwd: runtime.cwd,
        env: runtime.env,
        facadeServerPath: "/facade.mjs",
      }),
    ).rejects.toThrow();
  });

  it.each([
    { behavior: "empty", message: "returned no assistant text" },
    { behavior: "refusal", message: "stopped with refusal" },
    { behavior: "protocol-mismatch", message: "unsupported protocol version 99" },
  ])("reports $behavior failures", async ({ behavior, message }) => {
    const runtime = await makeRuntime(behavior);
    await expect(
      runAcpFacadeAgent({
        profile: profile(),
        instruction: "Task",
        cwd: runtime.cwd,
        env: runtime.env,
        facadeServerPath: "/facade.mjs",
      }),
    ).rejects.toThrow(message);
  });

  it("cancels and force-terminates an unresponsive agent", async () => {
    const runtime = await makeRuntime("hang");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(
      runAcpFacadeAgent({
        profile: profile(),
        instruction: "Task",
        cwd: runtime.cwd,
        env: runtime.env,
        facadeServerPath: "/facade.mjs",
        signal: controller.signal,
        terminationGraceMs: 50,
      }),
    ).rejects.toThrow();
  });

  it("force-terminates descendants of an unresponsive agent wrapper", async () => {
    const runtime = await makeRuntime("hang-with-descendant");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(
      runAcpFacadeAgent({
        profile: profile(),
        instruction: "Task",
        cwd: runtime.cwd,
        env: runtime.env,
        facadeServerPath: "/facade.mjs",
        signal: controller.signal,
        terminationGraceMs: 50,
      }),
    ).rejects.toThrow();

    const events = await readEvents(runtime.recordPath);
    const descendant = events.find((event) => event.type === "descendant");
    expect(descendant?.pid).toEqual(expect.any(Number));
    await expectProcessToStop(descendant?.pid as number);
  });
});

function profile(): AcpFacadeAgentProfile {
  return {
    id: "fake",
    command: process.execPath,
    args: [fixture],
    resolveAuthentication: () => ({ methodId: "test-auth" }),
    buildSessionMeta: (instructions) => ({ rules: instructions }),
    buildPrompt: (instruction) => instruction,
    isFacadeToolCall: isAllowed,
  };
}

function isAllowed(toolCall: ToolCallUpdate): boolean {
  return toolCall._meta?.allowed === true;
}

function permissionRequest({ allowed }: { allowed: boolean }): RequestPermissionRequest {
  return {
    sessionId: "session-1",
    toolCall: { toolCallId: "call-1", _meta: { allowed } },
    options: [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ],
  };
}

async function makeRuntime(behavior: string): Promise<{
  cwd: string;
  recordPath: string;
  env: NodeJS.ProcessEnv;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "stagehand-acp-test-"));
  temporaryDirectories.push(cwd);
  const recordPath = join(cwd, "events.jsonl");
  await writeFile(recordPath, "");
  return {
    cwd,
    recordPath,
    env: {
      ...process.env,
      ACP_FAKE_BEHAVIOR: behavior,
      ACP_RECORD_PATH: recordPath,
      STAGEHAND_BROWSER: "local",
      XAI_API_KEY: "agent-only-secret",
      OTHER_SECRET: "agent-only-secret",
    },
  };
}

async function readEvents(path: string): Promise<Array<Record<string, any>>> {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

async function expectProcessToStop(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`ACP descendant process ${pid} is still running.`);
}
