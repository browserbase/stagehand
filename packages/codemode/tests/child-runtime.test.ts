import { describe, expect, it } from "vitest";
import { StagehandChildRuntime } from "../src/child-runtime.js";

describe("StagehandChildRuntime", () => {
  it("hard-stops synchronous generated code from the parent and can recover", async () => {
    const runtime = new StagehandChildRuntime(
      "code_watchdog",
      {},
      {
        childModuleUrl: new URL("./fixtures/hung-runtime-child.mjs", import.meta.url),
      },
    );
    const startedAt = Date.now();

    await expect(runtime.run("hang", 25)).rejects.toMatchObject({
      kind: "timeout",
      retryable: false,
      mayHaveSideEffects: true,
    });
    expect(Date.now() - startedAt).toBeLessThan(3_000);

    await expect(runtime.run("recover", 1_000)).resolves.toMatchObject({
      value: "recovered",
      page: { url: "about:blank" },
    });
    await runtime.close();
  });

  it("awaits child-reported timeout cleanup before same-handle recovery", async () => {
    const runtime = fixtureRuntime("code_child_timeout");

    await expect(runtime.run("child-timeout", 1_000)).rejects.toMatchObject({
      kind: "timeout",
      retryable: false,
      mayHaveSideEffects: true,
    });
    await expect(runtime.run("recover", 1_000)).resolves.toMatchObject({
      value: "recovered",
    });
    await runtime.close();
  });

  it("awaits unexpected-exit cleanup before spawning a replacement child", async () => {
    const runtime = fixtureRuntime("code_child_crash");

    await expect(runtime.run("crash", 1_000)).rejects.toMatchObject({
      kind: "runtime",
    });
    await expect(runtime.run("recover", 1_000)).resolves.toMatchObject({
      value: "recovered",
    });
    await runtime.close();
  });
});

function fixtureRuntime(codeSessionId: string): StagehandChildRuntime {
  return new StagehandChildRuntime(
    codeSessionId,
    {},
    {
      childModuleUrl: new URL("./fixtures/hung-runtime-child.mjs", import.meta.url),
    },
  );
}
