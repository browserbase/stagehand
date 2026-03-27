import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ZodError } from "zod";
import { parseEnvironment } from "../../../src/env.js";

describe("environment parsing", () => {
  it("requires a real DATABASE_URL in postgres mode", () => {
    assert.throws(
      () =>
        parseEnvironment({
          STAGEHAND_DB_MODE: "postgres",
        }),
      /DATABASE_URL must be set when STAGEHAND_DB_MODE=postgres/,
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

  it("defaults DATABASE_URL to the placeholder in pglite mode", () => {
    const env = parseEnvironment({
      STAGEHAND_DB_MODE: "pglite",
    });

    assert.equal(env.DATABASE_URL, "postgresql://example.com/stagehand_v4");
  });

  it("defaults PORT and NODE_ENV", () => {
    const env = parseEnvironment({});

    assert.equal(env.PORT, 3000);
    assert.equal(env.NODE_ENV, "development");
  });

  it("throws a ZodError for an invalid DATABASE_URL", () => {
    assert.throws(
      () =>
        parseEnvironment({
          STAGEHAND_DB_MODE: "postgres",
          DATABASE_URL: "not-a-url",
        }),
      ZodError,
    );
  });
});
