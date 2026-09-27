import { mkdtemp, readdir, rename, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scopedChangesets } from "./release-scope.ts";

// The action chooses version vs. publish by counting *all* changeset files.
// When only Browse is pending, hide those files for its publish-only invocation.
// Nothing is hidden while it creates/updates the SDK release PR.
if (process.argv[2] === "hide") {
  if ((await scopedChangesets(process.cwd(), "sdk")).length === 0) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "browse-changesets-"));
    process.stdout.write(`directory=${directory}\n`);
    for (const changeset of await scopedChangesets(process.cwd(), "cli")) {
      await rename(`.changeset/${changeset.id}.md`, path.join(directory, `${changeset.id}.md`));
    }
  }
} else if (process.argv[2] === "restore" && process.argv[3]) {
  const directory = process.argv[3];
  for (const file of await readdir(directory))
    await rename(path.join(directory, file), `.changeset/${file}`);
  await rmdir(directory);
} else {
  throw new Error("Expected hide or restore <directory>");
}
