import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentHarnessOptions,
  AgentHarnessRunResult,
  AgentRunInput,
  NamedStdioLaunchConfig,
} from "../../types.js";

export interface AgentHarness {
  readonly name: AgentHarnessOptions["type"];
  start(): Promise<void>;
  stop(): Promise<void>;
  runTurn(input: AgentRunInput): Promise<AgentHarnessRunResult>;
}

export abstract class BaseHarness implements AgentHarness {
  protected sessionId?: string;
  private readonly tempDirs = new Set<string>();

  constructor(protected readonly options: AgentHarnessOptions) {}

  abstract readonly name: AgentHarnessOptions["type"];

  async start(): Promise<void> {
    // default no-op
  }

  async stop(): Promise<void> {
    await Promise.all(
      [...this.tempDirs].map(async (tempDir) => {
        await fs.rm(tempDir, { recursive: true, force: true });
      }),
    );
    this.tempDirs.clear();
  }

  abstract runTurn(input: AgentRunInput): Promise<AgentHarnessRunResult>;

  protected async writeTempFile(
    baseName: string,
    contents: string,
  ): Promise<string> {
    const tempDir = await this.createTempDir();
    const filePath = path.join(tempDir, baseName);
    await fs.writeFile(filePath, contents, "utf8");
    return filePath;
  }

  protected async createTempDir(prefix = "multiagent"): Promise<string> {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `${prefix}-${randomUUID()}-`),
    );
    this.tempDirs.add(tempDir);
    return tempDir;
  }

  protected normalizeMcpServers(
    servers: NamedStdioLaunchConfig[],
  ): NamedStdioLaunchConfig[] {
    return servers.map((server) => ({
      name: server.name,
      config: {
        command: server.config.command,
        args: server.config.args ?? [],
        env: server.config.env ?? {},
        cwd: server.config.cwd,
      },
    }));
  }
}
