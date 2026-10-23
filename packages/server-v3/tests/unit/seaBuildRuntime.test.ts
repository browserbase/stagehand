import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertSeaBuildRuntime } from "../../scripts/seaBuildRuntime.js";

describe("SEA build Node runtime", () => {
  for (const version of [
    "22.23.4",
    "22.23.5",
    "22.24.0",
    "24.22.1",
    "24.22.2",
    "24.23.0",
    "26.12.1",
    "26.12.2",
    "26.13.0",
  ]) {
    it(`accepts patched Node ${version}`, () => {
      assert.doesNotThrow(() => assertSeaBuildRuntime(version));
    });
  }

  for (const version of [
    "20.19.0",
    "22.23.3",
    "22.22.99",
    "24.22.0",
    "24.21.99",
    "26.12.0",
    "26.11.99",
    "23.99.0",
    "25.99.0",
    "27.0.0",
    "28.0.0",
    "24.22.1-rc.1",
    "24.22",
    "invalid",
  ]) {
    it(`rejects unsupported Node ${version} with upgrade instructions`, () => {
      assert.throws(
        () => assertSeaBuildRuntime(version),
        (error: Error) => {
          assert.ok(error.message.includes(`Node ${version}`));
          assert.match(error.message, /binary embeds Node/);
          assert.match(error.message, /Install Node 24\.22\.1/);
          return true;
        },
      );
    });
  }
});
