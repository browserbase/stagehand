import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const changesetDirectory = path.resolve(".changeset");
const allowedPackages = new Set(["@browserbasehq/stagehand", "@browserbasehq/stagehand-python"]);

const files = (await readdir(changesetDirectory))
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .sort();

for (const file of files) {
  const contents = await readFile(path.join(changesetDirectory, file), "utf8");
  const lines = contents.split(/\r?\n/);
  const frontmatterEnd = lines.indexOf("---", 1);
  if (lines[0] !== "---" || frontmatterEnd === -1) {
    throw new Error(`${file} does not contain valid changeset frontmatter`);
  }
  const frontmatter = lines.slice(1, frontmatterEnd).join("\n");

  const packages = [...frontmatter.matchAll(/^"(?<name>[^"]+)":\s*(?:major|minor|patch)$/gm)]
    .map((match) => match.groups?.name)
    .filter((name): name is string => name !== undefined);

  const invalidPackages = packages.filter((packageName) => !allowedPackages.has(packageName));
  if (invalidPackages.length > 0) {
    throw new Error(`${file} selects non-published packages: ${invalidPackages.join(", ")}`);
  }
}
