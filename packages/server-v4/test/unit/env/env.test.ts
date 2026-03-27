import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ZodError } from "zod";
import { parseEnvironment } from "../../../src/env.js";

describe("environment parsing", () => {
  it("requires DATABASE_URL in postgres mode", () => {
    assert.throws(
      () =>
        parseEnvironment({
          STAGEHAND_DB_MODE: "postgres",
        }),
      ZodError,
    );
  });

  it("rejects PGLITE_DATA_DIR in postgres mode", () => {
    assert.throws(
      () =>
        parseEnvironment({
          STAGEHAND_DB_MODE: "postgres",
          DATABASE_URL: "postgres://user:pass@localhost:5432/stagehand",
        }),
      ZodError,
    );
  });

  it("ignores DATABASE_URL in pglite mode", () => {
    const env = parseEnvironment({
      STAGEHAND_DB_MODE: "pglite",
      DATABASE_URL: "postgres://user:pass@localhost:5432/stagehand",
    });

    assert.equal(env.STAGEHAND_DB_MODE, "pglite");
  });

  it("defaults BROWSERBASE_CONFIG_DIR from the user home directory", () => {
    const env = parseEnvironment({
      STAGEHAND_DB_MODE: "pglite",
    });

    assert.equal(
      env.BROWSERBASE_CONFIG_DIR,
      path.resolve(os.homedir(), ".stagehand"),
    );
  });

  it("resolves BROWSERBASE_CONFIG_DIR when explicitly provided", () => {
    const env = parseEnvironment({
      STAGEHAND_DB_MODE: "pglite",
      BROWSERBASE_CONFIG_DIR: "/tmp/browserbase-config",
    });

    assert.equal(
      env.BROWSERBASE_CONFIG_DIR,
      path.resolve("/tmp/browserbase-config"),
    );
  });
});
