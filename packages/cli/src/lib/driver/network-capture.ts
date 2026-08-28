import { promises as fs } from "node:fs";
import path from "node:path";

import { ensurePrivateDir, getNetworkDir } from "./daemon/paths.js";
import { DriverError } from "./errors.js";

/**
 * Filesystem-facing network command state for the V4 runtime migration.
 *
 * Stagehand V4 does not expose the frame CDP session used by the V3 CLI. Keep
 * the user-facing command surface intact, but fail explicitly until the
 * CLI-owned CDP sidecar is added by the next PR in the stack. This avoids
 * making a public Stagehand network-event schema part of the runtime migration.
 */
export class NetworkCapture {
  private networkDir: string | null = null;

  constructor(private readonly session: string) {}

  async enable(
    _page: unknown,
  ): Promise<{ alreadyEnabled?: boolean; enabled: true; path: string }> {
    void _page;
    throw new DriverError(
      "Network capture is not available in this Stagehand V4 runtime. Apply the CLI CDP sidecar fast-follow to restore `browse network on`.",
      { code: "network_capture_unavailable" },
    );
  }

  async disable(): Promise<{
    alreadyDisabled: true;
    enabled: false;
    path: string | null;
  }> {
    return {
      alreadyDisabled: true,
      enabled: false,
      path: this.networkDir,
    };
  }

  path(): { enabled: false; path: string } {
    return {
      enabled: false,
      path: this.networkDir ?? getNetworkDir(this.session),
    };
  }

  async clear(): Promise<{ cleared: boolean; error?: string; path: string }> {
    const dir = this.networkDir ?? getNetworkDir(this.session);
    this.networkDir = dir;
    try {
      await ensurePrivateDir(dir);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            fs.rm(path.join(dir, entry.name), { recursive: true }),
          ),
      );
      return { cleared: true, path: dir };
    } catch (error) {
      return {
        cleared: false,
        error: error instanceof Error ? error.message : String(error),
        path: dir,
      };
    }
  }
}
