import { copyFile, readFile } from "node:fs/promises";

const built = new URL("../dist/facade-bundle.json", import.meta.url);
const vendored = new URL("../python/src/stagehand_middleware/facade/_bundle.json", import.meta.url);

if (process.argv.includes("--check")) {
  const withoutVersion = async (url) =>
    JSON.stringify({ ...JSON.parse(await readFile(url, "utf8")), packageVersion: 0 });
  const [builtText, vendoredText] = await Promise.all([
    withoutVersion(built),
    withoutVersion(vendored),
  ]);
  if (builtText !== vendoredText) {
    process.stderr.write(
      "packages/integrations/core/python/src/stagehand_middleware/facade/_bundle.json " +
        "differs from dist/facade-bundle.json; build @browserbasehq/stagehand-integrations " +
        "and run `pnpm run sync:python` in packages/integrations/core.\n",
    );
    process.exit(1);
  }
} else {
  await copyFile(built, vendored);
}
