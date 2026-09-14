const projectHeadingPattern = /^\s*\[project\]\s*(?:#.*)?$/m;
const sectionHeadingPattern = /^\s*\[[^\]]+\]\s*(?:#.*)?$/m;
const versionPattern = /^(\s*version\s*=\s*")([^"]+)(".*)$/m;

type VersionLocation = {
  value: string;
  start: number;
  end: number;
};

function locatePythonProjectVersion(contents: string): VersionLocation {
  const projectHeading = projectHeadingPattern.exec(contents);
  if (projectHeading?.index === undefined) {
    throw new Error("Could not find the [project] section in pyproject.toml");
  }

  const sectionStart = projectHeading.index + projectHeading[0].length;
  const remainingContents = contents.slice(sectionStart);
  const nextSection = sectionHeadingPattern.exec(remainingContents);
  const sectionEnd =
    nextSection?.index === undefined ? contents.length : sectionStart + nextSection.index;
  const projectSection = contents.slice(sectionStart, sectionEnd);
  const version = versionPattern.exec(projectSection);
  if (version?.index === undefined || version[1] === undefined || version[2] === undefined) {
    throw new Error("Could not find the Python project version in pyproject.toml");
  }

  const start = sectionStart + version.index + version[1].length;
  return { value: version[2], start, end: start + version[2].length };
}

export function readPythonProjectVersion(contents: string): string {
  return locatePythonProjectVersion(contents).value;
}

export function updatePythonProjectVersion(contents: string, nextVersion: string): string {
  const current = locatePythonProjectVersion(contents);
  return `${contents.slice(0, current.start)}${nextVersion}${contents.slice(current.end)}`;
}
