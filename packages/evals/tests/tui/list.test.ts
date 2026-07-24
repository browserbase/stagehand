import { describe, expect, it } from "vite-plus/test";
import { printList } from "../../tui/commands/list.js";
import type { TaskRegistry } from "../../framework/types.js";

const emptyRegistry: TaskRegistry = {
  tasks: [],
  byTier: new Map(),
  byCategory: new Map(),
  byName: new Map(),
};

describe("printList", () => {
  it("rejects unknown tier filters", () => {
    expect(() => printList(emptyRegistry, "benhc")).toThrow('Unknown list filter "benhc"');
  });
});
