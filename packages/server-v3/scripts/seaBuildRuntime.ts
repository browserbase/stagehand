// Patched release floors from the October 2026 Node security release:
// https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
const minimumVersions = ["22.23.4", "24.22.1", "26.12.1"];

export function assertSeaBuildRuntime(version = process.versions.node): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match) {
    const [, major, minor, patch] = match.map(Number);
    const supported = minimumVersions.some((minimum) => {
      const [minMajor, minMinor, minPatch] = minimum.split(".").map(Number);
      return (
        major === minMajor &&
        (minor > minMinor || (minor === minMinor && patch >= minPatch))
      );
    });
    if (supported) return;
  }

  throw new Error(
    `Cannot build the Stagehand server binary with Node ${version}. ` +
      `The binary embeds Node, so use a patched runtime: ${minimumVersions.map((minimum) => `^${minimum}`).join(" || ")}. ` +
      "Install Node 24.22.1 or a newer Node 24 release and retry.",
  );
}
