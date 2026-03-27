import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseEnvironment } from "../../../src/env.js";

describe("environment parsing", () => {
  it("defaults BROWSERBASE_CONFIG_DIR from the user home directory", () => {
    const env = parseEnvironment({});

    assert.equal(
      env.BROWSERBASE_CONFIG_DIR,
      path.resolve(os.homedir(), ".stagehand"),
    );
    assert.equal(env.NODE_ENV, "development");
    assert.equal(env.PORT, 3000);
  });

  it("resolves BROWSERBASE_CONFIG_DIR when explicitly provided", () => {
    const env = parseEnvironment({
      BROWSERBASE_CONFIG_DIR: "/tmp/browserbase-config",
      NODE_ENV: "test",
      PORT: "4100",
    });

    assert.equal(
      env.BROWSERBASE_CONFIG_DIR,
      path.resolve("/tmp/browserbase-config"),
    );
    assert.equal(env.NODE_ENV, "test");
    assert.equal(env.PORT, 4100);
  });
});
