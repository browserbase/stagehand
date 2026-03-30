import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { describe, it } from "node:test";

describe("app database boot", () => {
  it("boots the full app with PGlite and serves /healthz", async () => {
    const configDir = fs.mkdtempSync(`${os.tmpdir()}/stagehand-server-v4-app-`);

    const previousEnv = {
      BROWSERBASE_CONFIG_DIR: process.env.BROWSERBASE_CONFIG_DIR,
      DATABASE_URL: process.env.DATABASE_URL,
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      STAGEHAND_DB_MODE: process.env.STAGEHAND_DB_MODE,
    };

    process.env.BROWSERBASE_CONFIG_DIR = configDir;
    process.env.NODE_ENV = "test";
    process.env.PORT = "3010";
    process.env.STAGEHAND_DB_MODE = "pglite";
    delete process.env.DATABASE_URL;

    try {
      const { buildApp } = await import(
        new URL(`../../../src/app.js?t=${Date.now()}`, import.meta.url).href
      );
      const app = await buildApp();

      try {
        assert.equal(app.hasDatabase, true);

        const response = await app.inject({
          method: "GET",
          url: "/healthz",
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.json().status, "ok");
      } finally {
        await app.close();
      }
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });
});
