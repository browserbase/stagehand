import { parse, stringify, type TomlTableWithoutBigInt } from "smol-toml";

export type PreviewPythonProject = {
  name: string;
  version: string;
};

export function parsePreviewPythonProject(contents: string): PreviewPythonProject {
  const project = projectTable(parse(contents));
  if (typeof project.name !== "string" || typeof project.version !== "string") {
    throw new Error("pyproject.toml must define string project name and version fields");
  }
  return { name: project.name, version: project.version };
}

export function updatePreviewPythonProjectVersion(contents: string, version: string): string {
  const document = parse(contents);
  const project = projectTable(document);
  if (typeof project.version !== "string") {
    throw new Error("pyproject.toml must define a string project version field");
  }
  project.version = version;
  return stringify(document);
}

function projectTable(document: TomlTableWithoutBigInt): TomlTableWithoutBigInt {
  const { project } = document;
  if (typeof project !== "object" || project === null || Array.isArray(project)) {
    throw new Error("pyproject.toml must define a [project] table");
  }
  return project;
}
