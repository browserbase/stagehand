import parseChangeset from "@changesets/parse";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const allowedPackages = new Set([
  "@browserbasehq/stagehand",
  "@browserbasehq/stagehand-go",
  "@browserbasehq/stagehand-protocol",
  "@browserbasehq/stagehand-python",
  "@browserbasehq/stagehand-extension",
  "browse",
]);

export function validateChangeset(contents: string, file: string): void {
  let releases: Array<{ name: string }>;
  try {
    releases = parseChangeset(contents).releases;
  } catch (error) {
    throw new Error(`${file} does not contain valid changeset frontmatter`, { cause: error });
  }

  const invalidPackages = releases
    .map(({ name }) => name)
    .filter((packageName) => !allowedPackages.has(packageName));
  if (invalidPackages.length > 0) {
    throw new Error(`${file} selects non-versioned packages: ${invalidPackages.join(", ")}`);
  }
}

export async function checkChangesets(
  changesetDirectory = path.resolve(".changeset"),
): Promise<void> {
  const files = (await readdir(changesetDirectory))
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort();

  for (const file of files) {
    const contents = await readFile(path.join(changesetDirectory, file), "utf8");
    validateChangeset(contents, file);
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  await checkChangesets();
}
