import { glob, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "smol-toml";

// Alpha and preview builds run in disposable checkouts. Their SDK version can
// fall below a member's stable minimum. Pin those consumers to the development
// version in that checkout, keeping the SDK's own metadata and dev tools intact.
export async function pinPythonWorkspaceSdkVersion(repositoryRoot: string, version: string) {
  const root = parse(await readFile(path.join(repositoryRoot, "pyproject.toml"), "utf8"));
  const members = (root.tool as { uv?: { workspace?: { members?: unknown } } })?.uv?.workspace
    ?.members;
  if (!Array.isArray(members) || !members.every((member) => typeof member === "string")) {
    throw new Error("Expected workspace members to be strings");
  }
  const files = new Set<string>();
  for (const member of members) {
    for await (const file of glob(`${member}/pyproject.toml`, { cwd: repositoryRoot })) {
      files.add(file);
    }
  }
  for (const file of files) {
    const location = path.join(repositoryRoot, file);
    const document = parse(await readFile(location, "utf8"), { integersAsBigInt: false });
    const project = document.project as { dependencies?: string[] } | undefined;
    if (!project?.dependencies) continue;
    let changed = false;
    project.dependencies = project.dependencies.map((dependency) => {
      if (!/^stagehand(?:\s|[<>=!~;@[]|$)/i.test(dependency)) return dependency;
      changed = true;
      return `stagehand==${version}`;
    });
    if (changed) await writeFile(location, stringify(document));
  }
}
