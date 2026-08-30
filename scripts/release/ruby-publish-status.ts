import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readRubyGemVersion } from "./ruby-version.ts";

type StatusResponse = {
  ok: boolean;
  status: number;
};

export type RubyPublishStatusOptions = {
  repositoryRoot?: string;
  fetchStatus?: (url: string) => Promise<StatusResponse>;
};

/**
 * The `stagehand` gem name is shared with the retired v3 HTTP-API client
 * (last published as 3.x from browserbase/stagehand-ruby); v4 continues the
 * name at 4.x. Prerelease checked-in versions never auto-publish.
 */
export async function shouldPublishRuby({
  repositoryRoot = path.resolve(import.meta.dirname, "../.."),
  fetchStatus = async (url) => await fetch(url),
}: RubyPublishStatusOptions = {}): Promise<boolean> {
  const changesetDirectory = path.join(repositoryRoot, ".changeset");
  const pendingChangesets = (await readdir(changesetDirectory)).filter(
    (file) => file.endsWith(".md") && file !== "README.md",
  );

  if (pendingChangesets.length > 0) {
    return false;
  }

  const versionFile = await readFile(
    path.join(repositoryRoot, "packages/sdk-ruby/lib/stagehand/version.rb"),
    "utf8",
  );
  const version = readRubyGemVersion(versionFile);
  if (version.includes("pre")) {
    return false;
  }
  const response = await fetchStatus(
    `https://rubygems.org/api/v2/rubygems/stagehand/versions/${version}.json`,
  );
  if (response.status === 404) {
    return true;
  }
  if (response.ok) {
    return false;
  }
  throw new Error(`RubyGems returned ${response.status} while checking stagehand ${version}`);
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  process.stdout.write(`${String(await shouldPublishRuby())}\n`);
}
