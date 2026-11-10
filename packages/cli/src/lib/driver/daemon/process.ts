import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isDaemonProcess(pid: number): boolean {
  if (!isProcessAlive(pid)) return false;
  try {
    const cmdline = getProcessCommandLine(pid);
    if (!cmdline) return false;
    return cmdline.includes("daemon") && cmdline.includes("--session");
  } catch {
    return false;
  }
}

function getProcessCommandLine(pid: number): string | null {
  if (process.platform === "win32") {
    return getWindowsProcessCommandLine(pid);
  }
  return getPosixProcessCommandLine(pid);
}

function getPosixProcessCommandLine(pid: number): string | null {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.split(String.fromCharCode(0)).join(" ").trim();
  } catch {
    return null;
  }
}

function getWindowsProcessCommandLine(pid: number): string | null {
  try {
    const result = execFileSync(
      "wmic",
      ["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/format:list"],
      { encoding: "utf8", timeout: 2000, windowsHide: true },
    );
    const match = result.match(/CommandLine=(.+)/);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export function killProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}
