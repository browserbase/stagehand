import checkbox from "@inquirer/checkbox";
import password from "@inquirer/password";
import select from "@inquirer/select";
import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  agentNames,
  agentPaths,
  detectAgents,
  type SetupAgent,
} from "../lib/setup/agents.js";
import {
  readSetupConfig,
  setupConfigPath,
  writeSetupConfig,
  type BrowserMode,
} from "../lib/setup/config.js";
import { installMcpRuntime, mcpEntrypoint } from "../lib/mcp/install.js";
import {
  nodeExecutable,
  prepareSetup,
  writeSetup,
  type SetupMode,
} from "../lib/setup/install.js";

export default class Setup extends BrowseCommand {
  static override description =
    "Set up Browse CLI + Skills, Stagehand MCP, or both for your coding agent.";
  static override examples = [
    "browse setup",
    "browse setup --mode both --browser local --agent claude --agent codex --yes",
    "browse setup --mode mcp --browser cloud --agent cursor --project --yes",
  ];
  static override flags = {
    mode: Flags.string({
      options: ["cli", "mcp", "both"],
      description: "Choose Browse CLI + Skills, Stagehand MCP, or both.",
    }),
    browser: Flags.string({
      options: ["local", "cloud"],
      description: "Run browsers locally or on Browserbase.",
    }),
    agent: Flags.string({
      options: [...agentNames],
      multiple: true,
      description: "Agent to give browser access. Repeat for more than one.",
    }),
    project: Flags.boolean({
      description: "Add browse to this project only.",
    }),
    yes: Flags.boolean({
      char: "y",
      description:
        "Use defaults without prompts: CLI, local browsers, and detected agents.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Setup);
    const interactive =
      !flags.yes && Boolean(process.stdin.isTTY && process.stderr.isTTY);
    if (
      !interactive &&
      !flags.yes &&
      (!flags.mode || !flags.browser || !flags.agent?.length)
    ) {
      this.error(
        "Non-interactive setup needs --mode, --browser, and --agent, or --yes to use defaults.",
      );
    }
    if (interactive) this.log("Give your agent a browser.");
    const saved = await readSetupConfig();
    const detected = await detectAgents();
    const context = { output: process.stderr };
    let mode: SetupMode;
    let browser: BrowserMode;
    let agents: SetupAgent[];
    let apiKey = saved.apiKey;
    try {
      mode =
        (flags.mode as SetupMode | undefined) ??
        (interactive
          ? await select<SetupMode>(
              {
                message: "How should your agent browse?",
                choices: [
                  {
                    name: "Browse CLI + Skills",
                    value: "cli",
                    description:
                      "Use Browse CLI from your agent, with skills to guide it.",
                  },
                  {
                    name: "Stagehand MCP",
                    value: "mcp",
                    description: "Give your agent browser tools through MCP.",
                  },
                  {
                    name: "Browse CLI + Skills + MCP",
                    value: "both",
                    description:
                      "Set up Browse CLI skills and connect Stagehand MCP tools.",
                  },
                ],
              },
              context,
            )
          : "cli");
      browser =
        (flags.browser as BrowserMode | undefined) ??
        (interactive
          ? await select<BrowserMode>(
              {
                message: "Where will your browser run?",
                default: saved.browser ?? "local",
                choices: [
                  {
                    name: "Local only",
                    value: "local",
                    description:
                      "Chrome on this machine. No API key, ready to go.",
                  },
                  {
                    name: "Browserbase cloud",
                    value: "cloud",
                    description:
                      "Browsers hosted by Browserbase. Add a key now or later.",
                  },
                ],
              },
              context,
            )
          : "local");
      agents = flags.agent?.length
        ? ([...new Set(flags.agent)] as SetupAgent[])
        : interactive
          ? await checkbox<SetupAgent>(
              {
                message: "Which agents should get browser access?",
                choices: agentNames.map((agent) => ({
                  name: agentPaths(agent, "global").name,
                  value: agent,
                  checked: detected.includes(agent),
                })),
                required: true,
              },
              context,
            )
          : detected;
      if (!agents.length)
        this.error(
          "No agent settings found. Choose one with --agent claude, codex, cursor, or opencode.",
        );
      if (browser === "cloud" && interactive) {
        this.log(
          "For cloud browsers, get a key at https://www.browserbase.com/settings. Saved keys stay in your private browse settings.",
        );
        const enteredKey = (
          await password(
            {
              message:
                apiKey || process.env.BROWSERBASE_API_KEY
                  ? "Browserbase key (Enter keeps your current key)"
                  : "Browserbase key (optional, Enter skips)",
              mask: "*",
            },
            context,
          )
        ).trim();
        if (enteredKey) apiKey = enteredKey;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "ExitPromptError")
        this.error("Stopped setup. Run browse setup whenever you're ready.", {
          exit: 130,
        });
      throw error;
    }

    const node = mode === "cli" ? undefined : await nodeExecutable();
    const files = await prepareSetup({
      agents,
      mode,
      browser,
      scope: flags.project ? "project" : "global",
      ...(node
        ? { mcp: { node: node.path, entrypoint: mcpEntrypoint() } }
        : {}),
    });
    if (node) {
      this.log("Installing the latest Stagehand MCP...");
      const runtime = await installMcpRuntime(node.version);
      this.log(`Installed stagehand-middleware@${runtime.version}.`);
    }
    const paths = await writeSetup(files);
    await writeSetupConfig({
      ...saved,
      // The saved browser is the default for every project.
      ...(flags.project ? {} : { browser }),
      ...(apiKey ? { apiKey } : {}),
    });
    this.log(
      `Added ${mode === "both" ? "Browse CLI + Skills + MCP" : mode === "cli" ? "Browse CLI + Skills" : "Stagehand MCP"} to ${agents.map((agent) => agentPaths(agent, "global").name).join(", ")}.`,
    );
    for (const path of paths) this.log(`  ${path}`);
    this.log(
      flags.project
        ? `Browsers for this project: ${browser === "local" ? "local Chrome" : "Browserbase cloud"}. Your default browser for browse commands is unchanged.`
        : `Browsers: ${browser === "local" ? "local Chrome" : "Browserbase cloud"}. Preferences: ${setupConfigPath()}.`,
    );
    if (browser === "cloud" && !apiKey && !process.env.BROWSERBASE_API_KEY) {
      this.log(
        "Cloud browsers need BROWSERBASE_API_KEY. Export it before opening your agent, or add it later with browse setup.",
      );
    }
    this.log("Restart your agent to pick up the changes.");
    if (mode !== "cli")
      this.log("To update Stagehand MCP later, run this setup command again.");
    if (mode !== "mcp")
      this.log(
        `Try: browse open https://example.com --${browser === "local" ? "local" : "remote"}`,
      );
  }
}
