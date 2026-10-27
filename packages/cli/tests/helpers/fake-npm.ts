import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

/**
 * Puts a POSIX `npm` stub first on PATH that "installs" the Stagehand MCP
 * runtime packages into `--prefix`. FAKE_MIDDLEWARE_VERSION picks the version.
 */
export async function fakeNpm(dir: string): Promise<{ PATH: string }> {
  const bin = join(dir, "fake-bin");
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, "npm"),
    `#!/bin/sh
prefix=""
while [ $# -gt 0 ]; do
  [ "$1" = "--prefix" ] && prefix="$2"
  shift
done
modules="$prefix/node_modules"
mkdir -p "$modules/stagehand-middleware" "$modules/@browserbasehq/stagehand"
printf '{"name":"stagehand-middleware","version":"%s","peerDependencies":{"@browserbasehq/stagehand":">=4.3.0 <5"}}' "\${FAKE_MIDDLEWARE_VERSION:-0.1.1}" > "$modules/stagehand-middleware/package.json"
printf '{"name":"@browserbasehq/stagehand","version":"4.3.0"}' > "$modules/@browserbasehq/stagehand/package.json"
`,
  );
  await chmod(join(bin, "npm"), 0o755);
  return { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
}
