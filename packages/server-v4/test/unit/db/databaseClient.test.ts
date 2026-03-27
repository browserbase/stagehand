import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createDatabaseConnection } from "../../../src/db/client.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("database client", () => {
  it("persists PGlite state across reconnects", async () => {
    const dataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagehand-server-v4-pglite-client-"),
    );
    tempDirs.push(dataDir);

    const firstConnection = await createDatabaseConnection({
      mode: "pglite",
      dataDir,
    });

    await firstConnection.ping();
    await firstConnection.client.exec(`
      create table if not exists smoke(
        id integer primary key,
        name text not null
      );
      insert into smoke(id, name) values (1, 'first run');
    `);
    await firstConnection.close();

    const secondConnection = await createDatabaseConnection({
      mode: "pglite",
      dataDir,
    });

    const result = await secondConnection.client.query<{
      count: number;
    }>("select count(*)::int as count from smoke");

    assert.equal(result.rows[0]?.count, 1);

    await secondConnection.close();
  });
});
