import semver from "semver";

export type Middleware = typeof import("stagehand-middleware");

export const MIDDLEWARE_PACKAGE = "stagehand-middleware";
export const MIDDLEWARE_RANGE = "^0.1.1";
export const MCP_SDK_PACKAGE = "@modelcontextprotocol/sdk";
export const MCP_SDK_RANGE = "^1.32.2";
export const NODE_RANGE = ">=22.18.0";

export interface PackageManifest {
  name: string;
  version: string;
  engines?: { node?: string };
  peerDependencies?: Record<string, string>;
}

export function isCompatible(
  manifest: PackageManifest,
  sdkVersion: string,
  nodeVersion: string,
): boolean {
  const peer = manifest.peerDependencies?.["@browserbasehq/stagehand"];
  return (
    manifest.name === MIDDLEWARE_PACKAGE &&
    semver.satisfies(manifest.version, MIDDLEWARE_RANGE) &&
    typeof peer === "string" &&
    semver.satisfies(sdkVersion, peer) &&
    semver.satisfies(nodeVersion, NODE_RANGE) &&
    (!manifest.engines?.node ||
      semver.satisfies(nodeVersion, manifest.engines.node))
  );
}
