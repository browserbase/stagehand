import { describe, expect, it, vi } from "vitest";
import { ResponseHandleNotFoundError, ResponseHandleTable } from "../responseHandleTable.js";
import { createStagehandRuntime, type UnderstudyRuntimePage } from "../runtime.js";
import type { Response } from "../understudy/response.js";

type StubResponse = Response & { disposeMock: ReturnType<typeof vi.fn> };

function response(name: string): StubResponse {
  const disposeMock = vi.fn();
  return { name, dispose: disposeMock, disposeMock } as unknown as StubResponse;
}

function sequentialHandles(): () => string {
  let sequence = 0;
  return () => `response-${++sequence}`;
}

describe("ResponseHandleTable", () => {
  it("maps an opaque handle to the exact live response", () => {
    const table = new ResponseHandleTable({ createHandle: () => "response-1" });
    const liveResponse = response("first");

    const responseId = table.register("page-1", liveResponse);

    expect(responseId).toBe("response-1");
    expect(table.resolve(responseId)).toBe(liveResponse);
  });

  it("collects the oldest handle without treating access as recency", () => {
    const table = new ResponseHandleTable({
      maxHandles: 2,
      createHandle: sequentialHandles(),
    });
    const first = response("first");
    const second = response("second");
    const third = response("third");

    const firstId = table.register("page-1", first);
    const secondId = table.register("page-1", second);
    expect(table.resolve(firstId)).toBe(first);
    const thirdId = table.register("page-1", third);

    expect(() => table.resolve(firstId)).toThrow(ResponseHandleNotFoundError);
    expect(table.resolve(secondId)).toBe(second);
    expect(table.resolve(thirdId)).toBe(third);
    expect(table.size).toBe(2);
    expect(first.disposeMock).toHaveBeenCalledOnce();
    expect(second.disposeMock).not.toHaveBeenCalled();
    expect(third.disposeMock).not.toHaveBeenCalled();
  });

  it("removes only handles owned by the selected page", () => {
    const table = new ResponseHandleTable({ createHandle: sequentialHandles() });
    const first = response("first");
    const second = response("second");
    const firstId = table.register("page-1", first);
    const secondId = table.register("page-2", second);

    table.deleteForPage("page-1");

    expect(() => table.resolve(firstId)).toThrow(ResponseHandleNotFoundError);
    expect(table.resolve(secondId)).toBeDefined();
    expect(first.disposeMock).toHaveBeenCalledOnce();
    expect(second.disposeMock).not.toHaveBeenCalled();
  });

  it("isolates handles between tables", () => {
    const firstTable = new ResponseHandleTable({ createHandle: () => "shared-id" });
    const secondTable = new ResponseHandleTable({ createHandle: () => "shared-id" });
    const first = response("first");
    const second = response("second");

    firstTable.register("page-1", first);
    secondTable.register("page-1", second);

    expect(firstTable.resolve("shared-id")).toBe(first);
    expect(secondTable.resolve("shared-id")).toBe(second);
    firstTable.clear();
    expect(() => firstTable.resolve("shared-id")).toThrow(ResponseHandleNotFoundError);
    expect(secondTable.resolve("shared-id")).toBe(second);
    expect(first.disposeMock).toHaveBeenCalledOnce();
    expect(second.disposeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid capacity and repeated handle collisions", () => {
    expect(() => new ResponseHandleTable({ maxHandles: 0 })).toThrow(RangeError);

    const table = new ResponseHandleTable({ createHandle: () => "same-id" });
    table.register("page-1", response("first"));
    expect(() => table.register("page-1", response("second"))).toThrow(
      "Could not allocate a unique response handle",
    );
  });
});

describe("StagehandRuntime response handles", () => {
  it("cleans up handles when their page closes or disappears", async () => {
    const runtime = createStagehandRuntime();
    const close = vi.fn(async () => {});
    runtime.pagesById.set("page-1", { close } as unknown as UnderstudyRuntimePage);
    runtime.responseHandles.register("page-1", response("first"));

    await runtime.pageClose({ pageId: "page-1" });

    expect(close).toHaveBeenCalledOnce();
    expect(runtime.responseHandles.size).toBe(0);

    runtime.pagesById.set("page-2", {} as UnderstudyRuntimePage);
    runtime.responseHandles.register("page-2", response("second"));
    runtime.refreshPageRegistry([]);

    expect(runtime.responseHandles.size).toBe(0);
  });

  it("clears every handle when the runtime closes", async () => {
    const runtime = createStagehandRuntime();
    runtime.responseHandles.register("page-1", response("first"));
    runtime.responseHandles.register("page-2", response("second"));

    await runtime.close();

    expect(runtime.responseHandles.size).toBe(0);
  });
});
