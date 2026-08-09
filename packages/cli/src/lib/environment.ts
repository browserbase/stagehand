import { existsSync } from "node:fs";

import { hasTTY, provider } from "std-env";

export interface EnvironmentInfo {
  /** Running inside a Docker/Podman-style container (microVM sandboxes are caught by runtime_provider instead). */
  is_container: boolean;
  /** Attached to an interactive terminal — false for CI, sandboxes, agents, and piped runs. */
  is_tty: boolean;
  /** Normalized execution environment: a CI/host provider (via std-env) or a sandbox (via env-var allowlist), else "unknown". */
  runtime_provider: string;
}

// Sandboxes/dev-environments std-env does not (reliably) name, identified by the
// env var they self-set. Verified empirically (E2B/Modal/Daytona live probes) and
// against provider docs (Codespaces/Gitpod/Replit). DAYTONA_SANDBOX_ID is observed
// at runtime but undocumented, so treat it as best-effort.
const SANDBOX_ENV_VARS: ReadonlyArray<readonly [string, string]> = [
  ["E2B_SANDBOX", "e2b"],
  ["MODAL_SANDBOX_ID", "modal"],
  ["MODAL_TASK_ID", "modal"],
  ["DAYTONA_SANDBOX_ID", "daytona"],
  ["CODESPACES", "codespaces"],
  ["GITPOD_WORKSPACE_ID", "gitpod"],
  ["REPL_ID", "replit"],
];

function detectContainer(): boolean {
  // Docker and Podman expose a marker file; Firecracker/gVisor microVM sandboxes
  // (e2b, modal) do not — those resolve via runtime_provider + is_tty instead.
  try {
    return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
  } catch {
    return false;
  }
}

function detectProvider(env: NodeJS.ProcessEnv): string {
  if (provider) {
    return provider.toLowerCase();
  }
  for (const [key, name] of SANDBOX_ENV_VARS) {
    if (env[key]) {
      return name;
    }
  }
  return "unknown";
}

let cached: EnvironmentInfo | undefined;

/**
 * Classify the execution environment for telemetry segmentation. The result is
 * static for the life of the process, so it is computed once and memoized.
 */
export function classifyEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): EnvironmentInfo {
  if (!cached) {
    cached = {
      is_container: detectContainer(),
      is_tty: hasTTY,
      runtime_provider: detectProvider(env),
    };
  }
  return cached;
}
