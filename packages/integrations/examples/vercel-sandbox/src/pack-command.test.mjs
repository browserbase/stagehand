import assert from "node:assert/strict";
import test from "node:test";

import { runArtifactPackCommand } from "../scripts/pack-command.mjs";

void test("artifact pack command failures expose only a fixed typed error", async () => {
  const secret = "stderr-token=do-not-reflect";

  await assert.rejects(
    runArtifactPackCommand(
      process.execPath,
      ["-e", `require("node:fs").writeSync(2, ${JSON.stringify(secret)}); process.exit(1)`],
      process.cwd(),
    ),
    (error) => {
      assert.equal(error.name, "StagehandArtifactPackCommandError");
      assert.equal(error.message, "Stagehand sandbox artifact preparation failed.");
      assert.equal(error.message.includes(secret), false);
      assert.equal(Object.hasOwn(error, "stdout"), false);
      assert.equal(Object.hasOwn(error, "stderr"), false);
      return true;
    },
  );
});
