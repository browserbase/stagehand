import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DocEntry = {
  outputPath: string;
  sourcePath: string;
  title: string;
  description?: string;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const docsSourceRoot = path.join(repoRoot, "packages/docs/v3");
const docsOutputRoot = path.join(packageRoot, "dist/docs");
const packageJsonPath = path.join(packageRoot, "package.json");

const keyDocs = [
  "v3/first-steps/quickstart.md",
  "v3/first-steps/installation.md",
  "v3/references/stagehand.md",
  "v3/references/act.md",
  "v3/references/extract.md",
  "v3/references/observe.md",
  "v3/references/agent.md",
  "v3/references/page.md",
  "v3/references/context.md",
  "v3/configuration/models.md",
  "v3/best-practices/caching.md",
  "v3/best-practices/prompting-best-practices.md",
];

async function collectMdxFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectMdxFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith(".mdx") ? [entryPath] : [];
    }),
  );

  return files.flat().sort();
}

function readFrontmatter(content: string): {
  title?: string;
  description?: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*['"]?(.*?)['"]?\s*$/);
    if (field) {
      fields[field[1]] = field[2];
    }
  }

  return {
    title: fields.title,
    description: fields.description,
  };
}

function titleFromPath(relativePath: string): string {
  const basename = path.basename(relativePath, ".mdx");
  return basename
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function convertMdxToMarkdown(content: string): string {
  return content
    .replace(/^import\s+.*?;\s*$/gm, "")
    .replace(/^\s*<V3Banner\s*\/>\s*$/gm, "")
    .replace(/^\s*<V3Banner>\s*<\/V3Banner>\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

function tryGit(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

async function writeIndex(docs: DocEntry[]) {
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, "utf8"),
  ) as {
    version: string;
  };
  const commit = tryGit(["rev-parse", "--short", "HEAD"]);
  const sourceDate = tryGit([
    "log",
    "-1",
    "--format=%cI",
    "--",
    "packages/docs/v3",
  ]);

  const docByPath = new Map(docs.map((doc) => [doc.outputPath, doc]));
  const keyDocLines = keyDocs
    .filter((docPath) => docByPath.has(docPath))
    .map((docPath) => {
      const doc = docByPath.get(docPath);
      return `- [${doc?.title ?? docPath}](${docPath})`;
    })
    .join("\n");

  const allDocLines = docs
    .map((doc) => {
      const description = doc.description ? ` - ${doc.description}` : "";
      return `- [${doc.title}](${doc.outputPath})${description}`;
    })
    .join("\n");

  const metadata = [
    `- Package: \`@browserbasehq/stagehand@${packageJson.version}\``,
    `- Generated from: \`packages/docs/v3/**/*.mdx\``,
    commit ? `- Source commit: \`${commit}\`` : undefined,
    sourceDate
      ? `- Latest docs source commit date: \`${sourceDate}\``
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const content = `# Stagehand Local Docs

These docs ship inside the installed \`@browserbasehq/stagehand\` package so coding agents and developers can inspect version-matched Stagehand guidance without leaving the project.

## Metadata

${metadata}

## How To Search

\`\`\`bash
rg "Stagehand" node_modules/@browserbasehq/stagehand/dist/docs
rg "stagehand\\.act|stagehand\\.extract|stagehand\\.observe|stagehand\\.agent" node_modules/@browserbasehq/stagehand/dist/docs
\`\`\`

## Start Here

${keyDocLines}

## All Docs

${allDocLines}
`;

  await fs.writeFile(path.join(docsOutputRoot, "index.md"), content, "utf8");
}

async function main() {
  await fs.rm(docsOutputRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(docsOutputRoot, "v3"), { recursive: true });

  const mdxFiles = await collectMdxFiles(docsSourceRoot);
  const docs: DocEntry[] = [];

  for (const sourcePath of mdxFiles) {
    const relativeSourcePath = path.relative(docsSourceRoot, sourcePath);
    const relativeOutputPath = path
      .join("v3", relativeSourcePath)
      .replace(/\.mdx$/, ".md")
      .replaceAll(path.sep, "/");
    const outputPath = path.join(docsOutputRoot, relativeOutputPath);
    const content = await fs.readFile(sourcePath, "utf8");
    const frontmatter = readFrontmatter(content);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, convertMdxToMarkdown(content), "utf8");

    docs.push({
      outputPath: relativeOutputPath,
      sourcePath: path.relative(repoRoot, sourcePath).replaceAll(path.sep, "/"),
      title: frontmatter.title ?? titleFromPath(relativeSourcePath),
      description: frontmatter.description,
    });
  }

  await writeIndex(docs);

  console.log(
    `Generated ${docs.length + 1} Stagehand docs in ${docsOutputRoot}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
