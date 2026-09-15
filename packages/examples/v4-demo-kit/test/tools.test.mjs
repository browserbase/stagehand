import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_DEFINITIONS, validateToolCall } from "../src/tools.mjs";

test("the agent tool surface stays small", () => {
  assert.deepEqual(
    TOOL_DEFINITIONS.map((tool) => tool.name),
    ["run", "snapshot", "screenshot"],
  );
});

test("run needs code", () => {
  assert.throws(() => validateToolCall({ name: "run", input: {} }), /exactly one/);
});

test("run rejects code and actions together", () => {
  assert.throws(
    () =>
      validateToolCall({
        name: "run",
        input: { code: "return 1", actions: [{ op: "click", id: "1-1" }] },
      }),
    /exactly one/,
  );
});

test("valid calls pass", () => {
  const call = { name: "snapshot", input: {} };
  assert.equal(validateToolCall(call), call);
});
