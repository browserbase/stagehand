import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exclusive } from "../../src/cli.js";

await exclusive(async () => {
  await writeFile(join(process.argv[2]!, "saved.json"), JSON.stringify({ attempted: true }));
  process.stdout.write("locked\n");
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
}, process.argv[2]!);
