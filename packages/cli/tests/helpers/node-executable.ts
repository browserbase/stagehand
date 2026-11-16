import { writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

/**
 * Write a fake external command backed by Node, even when PATH contains only
 * the fixture directory. Windows gets a .cmd launcher, like npm and npx.
 * The caller owns the directory and its cleanup.
 */
export async function writeNodeExecutable(
  directory: string,
  name: string,
  source: string,
): Promise<void> {
  const script = join(directory, name + ".cjs");
  await writeFile(script, source + "\n");
  if (process.platform === "win32") {
    await writeFile(
      join(directory, name + ".cmd"),
      [
        "@echo off",
        "setlocal",
        '"' + process.execPath.replaceAll("%", "%%") + '" "%~dp0' + name + '.cjs" %*',
        "exit /b %errorlevel%",
        "",
      ].join("\r\n"),
    );
  } else {
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    await writeFile(
      join(directory, name),
      "#!/bin/sh\nexec " + quote(process.execPath) + " " + quote(script) + ' "$@"\n',
      { mode: 0o755 },
    );
  }
}

export function prependPath(directory: string): string {
  return [directory, process.env.PATH].filter(Boolean).join(delimiter);
}
