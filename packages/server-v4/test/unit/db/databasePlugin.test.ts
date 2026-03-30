import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { describe, it } from "node:test";
import fastify from "fastify";
import { databasePlugin } from "../../../src/db/plugin.js";

describe("database plugin", () => {
  it("registers a persistent local pglite database", async () => {
    const dataDir = fs.mkdtempSync(
      `${os.tmpdir()}/stagehand-server-v4-pglite-`,
    );
    const app = fastify({ logger: false });

    await app.register(databasePlugin, {
      database: {
        mode: "pglite",
        dataDir,
      },
      migrateOnStartup: true,
    });

    assert.equal(app.hasDatabase, true);
    assert.notEqual(app.db, null);
    assert.notEqual(app.dbClient, null);
    assert.equal("dataDir" in (app.dbClient as object), true);

    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
