import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

// The Python build removes artifacts produced before the distribution was
// renamed. These exact legacy cleanup patterns are data, not public identities.
const legacyDistributionName = ["stagehand", "v4"].join("_");
const allowedLegacyCleanupMatches = new Set([
  `packages/sdk-python/scripts/build.py:"${legacyDistributionName}-*.whl",`,
  `packages/sdk-python/scripts/build.py:"${legacyDistributionName}-*.tar.gz",`,
  `packages/sdk-python/tests/test_build.py:"${legacyDistributionName}-0.1.0-py3-none-any.whl",`,
  `packages/sdk-python/tests/test_build.py:"${legacyDistributionName}-0.1.0.tar.gz",`,
]);

const findUnexpectedMatches = (stdout: string): string[] =>
  stdout
    .trim()
    // Windows git writes CRLF; retaining the carriage return breaks the anchored parser below.
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((match) => {
      const parsed = /^(?<file>[^:]+):\d+:(?<contents>.*)$/u.exec(match)?.groups;
      if (!parsed?.file || parsed.contents === undefined) return [match];
      const identity = `${parsed.file}:${parsed.contents.trim()}`;
      return allowedLegacyCleanupMatches.has(identity) ? [] : [match];
    });

describe("Retired package identities", () => {
  it("accepts exact legacy cleanup matches with CRLF line endings", () => {
    const output = [
      `packages/sdk-python/scripts/build.py:18:        "${legacyDistributionName}-*.whl",`,
      `packages/sdk-python/tests/test_build.py:13:        "${legacyDistributionName}-0.1.0.tar.gz",`,
    ].join("\r\n");

    expect(findUnexpectedMatches(output)).toEqual([]);
  });

  it("does not reintroduce a Stagehand v4 package or test identity", async () => {
    const pattern = ["stagehand", "[-_]v4"].join("");
    let stdout = "";
    try {
      ({ stdout } = await execFileAsync("git", ["grep", "-n", "-I", "-E", pattern, "--", "."], {
        encoding: "utf8",
      }));
    } catch (error) {
      const grepError = error as Error & { code?: number; stdout?: string };
      if (grepError.code !== 1) throw error;
      stdout = grepError.stdout ?? "";
    }
    const unexpected = findUnexpectedMatches(stdout);

    expect(
      unexpected,
      "Use the stable Stagehand package identity; only exact Python legacy-artifact cleanup patterns are allowed",
    ).toEqual([]);
  });
});
