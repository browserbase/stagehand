import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BROWSE_PACKAGE_NAME = "browse";
const BROWSE_BIN_NAME = "browse";

type BrowsePackageJson = {
  version?: unknown;
  bin?: string | Record<string, string>;
};

type ResolvedBrowseCliPackage = {
  entrypoint: string;
  packageJsonPath: string;
  version?: string;
};

let cachedBrowseCliPackage: ResolvedBrowseCliPackage | undefined;

function readBrowsePackageJson(): {
  packageJsonPath: string;
  parsed: BrowsePackageJson;
} {
  const packageJsonPath = require.resolve(
    `${BROWSE_PACKAGE_NAME}/package.json`,
  );
  const parsed = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ) as BrowsePackageJson;
  return { packageJsonPath, parsed };
}

export function resolveInstalledBrowseCliPackage(): ResolvedBrowseCliPackage {
  if (cachedBrowseCliPackage) {
    return cachedBrowseCliPackage;
  }

  let packageJsonPath: string;
  let parsed: BrowsePackageJson;
  try {
    ({ packageJsonPath, parsed } = readBrowsePackageJson());
  } catch {
    throw new Error(
      'browse_cli requires the published "browse" npm package to be installed. Run pnpm --filter @browserbasehq/stagehand-evals add browse.',
    );
  }

  const packageDir = path.dirname(packageJsonPath);
  const binField = parsed.bin;
  const relativeEntrypoint =
    typeof binField === "string" ? binField : binField?.[BROWSE_BIN_NAME];

  if (!relativeEntrypoint) {
    throw new Error(
      `browse_cli could not resolve the "${BROWSE_BIN_NAME}" bin from the installed "${BROWSE_PACKAGE_NAME}" package.`,
    );
  }

  const entrypoint = path.resolve(packageDir, relativeEntrypoint);
  if (!fs.existsSync(entrypoint)) {
    throw new Error(
      `browse_cli resolved "${BROWSE_PACKAGE_NAME}" to ${entrypoint}, but that file does not exist.`,
    );
  }

  cachedBrowseCliPackage = {
    entrypoint,
    packageJsonPath,
    version: typeof parsed.version === "string" ? parsed.version : undefined,
  };
  return cachedBrowseCliPackage;
}

export function resolveBrowseCliEntrypoint(): string {
  return resolveInstalledBrowseCliPackage().entrypoint;
}

export function readInstalledBrowseCliVersion(): { browseCliVersion?: string } {
  const { version } = resolveInstalledBrowseCliPackage();
  return version ? { browseCliVersion: version } : {};
}
