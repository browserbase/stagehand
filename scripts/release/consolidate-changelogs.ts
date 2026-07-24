import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const rootChangelogPath = path.join(repositoryRoot, "CHANGELOG.md");
const packageChangelogs = [
  {
    label: "TypeScript SDK",
    path: path.join(repositoryRoot, "packages/sdk-ts/CHANGELOG.md"),
  },
  {
    label: "Python SDK",
    path: path.join(repositoryRoot, "packages/sdk-python/CHANGELOG.md"),
  },
];

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === "ENOENT"
  );
}

async function readIfPresent(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export function formatPackageChangelog(contents: string, label: string): string {
  const lines = contents.trim().split(/\r?\n/);
  const firstVersionHeading = lines.findIndex((line) => /^##\s+\S/.test(line));
  if (firstVersionHeading === -1) {
    throw new Error(`The ${label} changelog does not contain a version heading`);
  }

  return lines
    .slice(firstVersionHeading)
    .join("\n")
    .replace(/^##\s+(.+)$/gm, `## ${label} $1`);
}

function sectionHeadings(section: string): string[] {
  return [...section.matchAll(/^##\s+.+$/gm)].map(([heading]) => heading);
}

export function consolidateChangelog(rootChangelog: string, sections: string[]): string {
  const historyIndex = rootChangelog.search(/^##\s+/m);
  if (historyIndex === -1) {
    throw new Error("The root changelog does not contain a version heading");
  }

  const additions = sections.filter((section) => {
    const headings = sectionHeadings(section);
    if (headings.length === 0) {
      throw new Error("A generated changelog section does not contain a version heading");
    }

    const existingHeadings = headings.filter((heading) => rootChangelog.includes(`${heading}\n`));
    if (existingHeadings.length > 0 && existingHeadings.length !== headings.length) {
      throw new Error(`The root changelog contains only part of ${headings.join(", ")}`);
    }
    return existingHeadings.length === 0;
  });

  if (additions.length === 0) {
    return rootChangelog;
  }

  const introduction = rootChangelog.slice(0, historyIndex).trimEnd();
  const history = rootChangelog.slice(historyIndex).trim();
  return `${introduction}\n\n${additions.join("\n\n")}\n\n${history}\n`;
}

async function checkPackageChangelogsAreTemporary(): Promise<void> {
  const existingPaths: string[] = [];
  for (const changelog of packageChangelogs) {
    if ((await readIfPresent(changelog.path)) !== undefined) {
      existingPaths.push(path.relative(repositoryRoot, changelog.path));
    }
  }

  if (existingPaths.length > 0) {
    throw new Error(
      `SDK changelogs must be consolidated into CHANGELOG.md: ${existingPaths.join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    await readFile(rootChangelogPath, "utf8");
    await checkPackageChangelogsAreTemporary();
    return;
  }

  const generated: Array<{ path: string; section: string }> = [];
  for (const changelog of packageChangelogs) {
    const contents = await readIfPresent(changelog.path);
    if (contents !== undefined) {
      generated.push({
        path: changelog.path,
        section: formatPackageChangelog(contents, changelog.label),
      });
    }
  }

  if (generated.length === 0) {
    return;
  }

  const currentRootChangelog = await readFile(rootChangelogPath, "utf8");
  const nextRootChangelog = consolidateChangelog(
    currentRootChangelog,
    generated.map(({ section }) => section),
  );
  if (nextRootChangelog !== currentRootChangelog) {
    await writeFile(rootChangelogPath, nextRootChangelog);
  }

  for (const { path: generatedPath } of generated) {
    await unlink(generatedPath);
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  await main();
}
