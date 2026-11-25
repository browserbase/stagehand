import { spawnSync, type ChildProcess } from "node:child_process";
import { win32 } from "node:path";

/**
 * Windows signals terminate only the immediate process. Kill its descendants
 * first as well, including Node processes started by npm .cmd shims or tsx watch.
 */
export function terminateChild(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): boolean {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return false;
  if (process.platform === "win32") {
    // Use the system executable even when a caller supplies a restricted PATH.
    const taskkill = win32.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    const result = spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 5_000,
    });
    if (result.status === 0) return true;
  }
  return child.kill(signal);
}
