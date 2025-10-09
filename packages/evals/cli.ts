#!/usr/bin/env node
import process from "process";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const CONFIG_PATH = path.join(__dirname, "evals.config.json");

interface Config {
  defaults: {
    env: string;
    trials: number;
    concurrency: number;
    provider: string | null;
    model: string | null;
    api: boolean;
  };
  benchmarks: Record<
    string,
    {
      limit: number;
      filters?: string[];
      timeout?: number;
    }
  >;
  tasks: Array<{ name: string; categories: string[] }>;
}

function loadConfig(): Config {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(config: Config): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function printHelp(): void {
  console.log(
    chalk.yellow(`⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⡾⠻⣶⡀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢠⡶⠛⢳⡆⠀⠀⠀⠀⢸⡇⠀⢸⡇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇⠀⢸⣷⠶⣦⣴⠶⣾⡇⠀⢸⡇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇⠀⢸⡇⠀⢸⡇⠀⢸⡇⠀⢸⡇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇⠀⠘⠷⣤⢾⡏⠉⠉⠉⠙⣾⡇⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇⠀⠀⠀⠀⠈⣻⡿⠟⠂⠀⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠈⣷⠀⠀⠀⠀⢰⡏⠀⠀⠀⢀⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⣷⡀⠀⠀⠀⠀⠀⠀⢀⡾⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠷⣦⣤⣤⣴⠾⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀`),
  );
  console.log(chalk.yellow.bold("\nStagehand Evals CLI"));
  console.log(chalk.cyan("\nevals <command> <target> [options]\n"));

  console.log(chalk.magenta.underline("Commands"));
  console.log("  run       Execute evals or benchmarks");
  console.log("  list      List available evals/benchmarks");
  console.log("  config    Get/set default configuration");
  console.log("  help      Show this help message\n");

  console.log(chalk.magenta.underline("Examples"));
  console.log(chalk.dim("  # Run all custom evals"));
  console.log(chalk.green("  evals run all\n"));

  console.log(chalk.dim("  # Run specific category"));
  console.log(
    chalk.green("  evals run act") + chalk.cyan(" -e browserbase -t 5\n"),
  );

  console.log(chalk.dim("  # Run specific eval"));
  console.log(chalk.green("  evals run login\n"));

  console.log(chalk.dim("  # Run benchmark"));
  console.log(
    chalk.green("  evals run benchmark:onlineMind2Web") +
      chalk.cyan(" -l 10 -f difficulty=easy\n"),
  );

  console.log(chalk.dim("  # Configure defaults"));
  console.log(chalk.green("  evals config set env browserbase"));
  console.log(chalk.green("  evals config set trials 5\n"));

  console.log(chalk.magenta.underline("Options"));
  console.log(
    chalk.cyan("  -e, --env".padEnd(20)) + "Environment: local|browserbase",
  );
  console.log(
    chalk.cyan("  -t, --trials".padEnd(20)) + "Number of trials per eval",
  );
  console.log(
    chalk.cyan("  -c, --concurrency".padEnd(20)) + "Max parallel sessions",
  );
  console.log(chalk.cyan("  -m, --model".padEnd(20)) + "Model override");
  console.log(chalk.cyan("  -p, --provider".padEnd(20)) + "Provider override");
  console.log(chalk.cyan("  --api".padEnd(20)) + "Use Stagehand API\n");

  console.log(chalk.dim("  Benchmark-specific:"));
  console.log(chalk.cyan("  -l, --limit".padEnd(20)) + "Max tasks to run");
  console.log(
    chalk.cyan("  -s, --sample".padEnd(20)) + "Random sample before limit",
  );
  console.log(
    chalk.cyan("  -f, --filter".padEnd(20)) + "Benchmark filters (key=value)\n",
  );
}

function handleConfig(args: string[]): void {
  const config = loadConfig();

  if (args.length === 0) {
    // Show current config
    console.log(chalk.blue.bold("\nCurrent Configuration"));
    console.log(chalk.cyan("\nDefaults:"));
    Object.entries(config.defaults).forEach(([key, value]) => {
      console.log(`  ${key}: ${chalk.yellow(value ?? "not set")}`);
    });
    return;
  }

  if (args[0] === "set" && args.length >= 3) {
    const [, key, ...valueParts] = args;
    const value = valueParts.join(" ");

    if (!(key in config.defaults)) {
      console.error(chalk.red(`Error: Unknown config key "${key}"`));
      console.log(
        chalk.dim(`Valid keys: ${Object.keys(config.defaults).join(", ")}`),
      );
      process.exit(1);
    }

    // Parse value based on type
    let parsedValue: string | number | boolean | null = value;
    if (key === "trials" || key === "concurrency") {
      parsedValue = parseInt(value, 10);
      if (isNaN(parsedValue)) {
        console.error(chalk.red(`Error: ${key} must be a number`));
        process.exit(1);
      }
    } else if (key === "api") {
      parsedValue = value === "true";
    } else if (value === "null" || value === "none") {
      parsedValue = null;
    }

    // Type-safe assignment
    if (key === "env") {
      config.defaults.env = parsedValue as string;
    } else if (key === "trials") {
      config.defaults.trials = parsedValue as number;
    } else if (key === "concurrency") {
      config.defaults.concurrency = parsedValue as number;
    } else if (key === "provider") {
      config.defaults.provider = parsedValue as string | null;
    } else if (key === "model") {
      config.defaults.model = parsedValue as string | null;
    } else if (key === "api") {
      config.defaults.api = parsedValue as boolean;
    }
    saveConfig(config);
    console.log(chalk.green(`✓ Set ${key} to ${parsedValue}`));
  } else if (args[0] === "reset") {
    const defaultConfig: Config["defaults"] = {
      env: "local",
      trials: 3,
      concurrency: 3,
      provider: null,
      model: null,
      api: false,
    };

    if (args[1] && args[1] in config.defaults) {
      const key = args[1];
      // Type-safe reset by key
      if (key === "env") {
        config.defaults.env = defaultConfig.env;
      } else if (key === "trials") {
        config.defaults.trials = defaultConfig.trials;
      } else if (key === "concurrency") {
        config.defaults.concurrency = defaultConfig.concurrency;
      } else if (key === "provider") {
        config.defaults.provider = defaultConfig.provider;
      } else if (key === "model") {
        config.defaults.model = defaultConfig.model;
      } else if (key === "api") {
        config.defaults.api = defaultConfig.api;
      }
      saveConfig(config);
      console.log(chalk.green(`✓ Reset ${args[1]} to default`));
    } else if (!args[1]) {
      config.defaults = defaultConfig;
      saveConfig(config);
      console.log(chalk.green("✓ Reset all settings to defaults"));
    } else {
      console.error(chalk.red(`Error: Unknown config key "${args[1]}"`));
      process.exit(1);
    }
  } else if (args[0] === "path") {
    console.log(CONFIG_PATH);
  } else {
    console.error(chalk.red("Error: Invalid config command"));
    console.log(
      chalk.dim("Usage: evals config [set <key> <value> | reset [key] | path]"),
    );
    process.exit(1);
  }
}

function handleList(args: string[]): void {
  const config = loadConfig();

  console.log(chalk.blue.bold("\nAvailable Evals\n"));

  // Group tasks by category
  const categories = new Map<string, string[]>();
  config.tasks.forEach((task) => {
    task.categories.forEach((cat) => {
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat)!.push(task.name);
    });
  });

  // Show custom eval categories
  console.log(chalk.magenta.underline("Custom Eval Categories"));
  Array.from(categories.entries())
    .filter(([cat]) => !cat.includes("external_agent_benchmarks"))
    .forEach(([category, tasks]) => {
      console.log(
        `  ${chalk.cyan(category)} ${chalk.dim(`(${tasks.length} evals)`)}`,
      );
    });

  console.log(chalk.magenta.underline("\nBenchmarks"));
  Object.keys(config.benchmarks).forEach((name) => {
    const shorthand = `b:${name}`;
    console.log(
      `  ${chalk.cyan(shorthand.padEnd(20))} ${chalk.dim(`benchmark:${name}`)}`,
    );
  });

  if (args.includes("--detailed") || args.includes("-d")) {
    console.log(chalk.magenta.underline("\n\nDetailed Task List"));
    categories.forEach((tasks, category) => {
      if (!category.includes("external_agent_benchmarks")) {
        console.log(chalk.cyan(`\n${category}:`));
        tasks.forEach((task) => {
          console.log(`  - ${task}`);
        });
      }
    });
  } else {
    console.log(
      chalk.yellow(
        "\n💡 Tip: Use 'evals list --detailed' to see all individual tasks",
      ),
    );
  }
}

function parseArgs(rawArgs: string[]): {
  options: Record<string, string | number | boolean>;
  target?: string;
  filters: Array<[string, string]>;
} {
  const options: Record<string, string | number | boolean> = {};
  const filters: Array<[string, string]> = [];
  let target: string | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg.startsWith("-")) {
      // Handle options
      const flagName = arg.replace(/^--?/, "");

      // Map short flags to long names
      const flagMap: Record<string, string> = {
        e: "env",
        t: "trials",
        c: "concurrency",
        m: "model",
        p: "provider",
        l: "limit",
        s: "sample",
        f: "filter",
      };

      const optionName = flagMap[flagName] || flagName;

      if (optionName === "api") {
        options.api = true;
      } else if (optionName === "filter") {
        // Parse filter as key=value
        const filterValue = rawArgs[++i];
        if (filterValue && filterValue.includes("=")) {
          const [key, value] = filterValue.split("=");
          filters.push([key, value]);
        }
      } else {
        // Get next value
        const value = rawArgs[++i];
        if (value && !value.startsWith("-")) {
          // Parse numbers
          if (
            ["trials", "concurrency", "limit", "sample"].includes(optionName)
          ) {
            options[optionName] = parseInt(value, 10);
          } else {
            options[optionName] = value;
          }
        }
      }
    } else if (!target) {
      target = arg;
    }
  }

  return { options, target, filters };
}

function handleRun(args: string[]): void {
  const config = loadConfig();
  const { options, target, filters } = parseArgs(args);

  // Merge with defaults
  const finalOptions = { ...config.defaults, ...options };

  // Build environment variables
  const env = { ...process.env };

  // Set core environment variables
  if (finalOptions.env === "browserbase") {
    env.EVAL_ENV = "BROWSERBASE";
  } else {
    env.EVAL_ENV = "LOCAL";
  }

  if (finalOptions.api) {
    env.USE_API = "true";
  }

  if (finalOptions.trials) {
    env.EVAL_TRIAL_COUNT = String(finalOptions.trials);
  }

  if (finalOptions.concurrency) {
    env.EVAL_MAX_CONCURRENCY = String(finalOptions.concurrency);
  }

  if (finalOptions.provider) {
    env.EVAL_PROVIDER = finalOptions.provider;
  }

  if (finalOptions.model) {
    env.EVAL_MODEL_OVERRIDE = finalOptions.model;
  }

  // Handle benchmark-specific options
  let evalName: string | undefined;
  let categoryFilter: string | undefined;

  if (target) {
    if (target.startsWith("b:") || target.startsWith("benchmark:")) {
      // Running a benchmark
      const benchmarkName = target.replace(/^(b:|benchmark:)/, "");

      if (!config.benchmarks[benchmarkName]) {
        console.error(chalk.red(`Error: Unknown benchmark "${benchmarkName}"`));
        console.log(
          chalk.dim(
            `Available benchmarks: ${Object.keys(config.benchmarks).join(", ")}`,
          ),
        );
        process.exit(1);
      }

      // Map to the actual eval name
      const benchmarkMap: Record<string, string> = {
        webbench: "agent/webbench",
        gaia: "agent/gaia",
        webvoyager: "agent/webvoyager",
        osworld: "agent/osworld",
        onlineMind2Web: "agent/onlineMind2Web",
      };

      evalName = benchmarkMap[benchmarkName];
      env.EVAL_DATASET = benchmarkName;

      // Set benchmark-specific options
      if (options.limit) {
        env.EVAL_MAX_K = String(options.limit);
        env[`EVAL_${benchmarkName.toUpperCase()}_LIMIT`] = String(
          options.limit,
        );
      }

      if (options.sample) {
        env[`EVAL_${benchmarkName.toUpperCase()}_SAMPLE`] = String(
          options.sample,
        );
      }

      // Apply filters
      filters.forEach(([key, value]) => {
        const envKey = `EVAL_${benchmarkName.toUpperCase()}_${key.toUpperCase()}`;
        env[envKey] = value;
      });
    } else if (target === "all") {
      // Run all evals (no filter)
    } else if (target.includes("/") || target.includes("*")) {
      // Pattern matching - treat as eval name
      evalName = target;
    } else {
      // Check if it's a category
      const categories = new Set<string>();
      config.tasks.forEach((task) => {
        task.categories.forEach((cat) => categories.add(cat));
      });

      if (categories.has(target)) {
        categoryFilter = target;
      } else {
        // Assume it's a specific eval name
        evalName = target;
      }
    }
  }

  // Build the legacy command
  const legacyArgs: string[] = [];

  if (evalName) {
    legacyArgs.push(`name=${evalName}`);
  } else if (categoryFilter) {
    legacyArgs.push("category", categoryFilter);
  }

  // Run the existing eval system with our environment
  console.log(chalk.blue.bold("\nRunning evals...\n"));

  // Build first if needed
  const buildChild = spawn("pnpm", ["run", "build"], {
    stdio: "inherit",
    shell: true,
  });

  buildChild.on("exit", (buildCode) => {
    if (buildCode !== 0) {
      process.exit(buildCode || 1);
    }

    const compiledEvalPath = path.join(__dirname, "index.eval.js");
    const sourceEvalPath = path.resolve(
      __dirname,
      "..",
      "..",
      "evals",
      "index.eval.ts",
    );

    let child;

    if (fs.existsSync(compiledEvalPath)) {
      child = spawn(process.execPath, [compiledEvalPath, ...legacyArgs], {
        env,
        stdio: "inherit",
        shell: true,
      });
    } else {
      let tsxCliPath: string | undefined;
      try {
        // Resolve the local tsx CLI entry within this package installation
        // This avoids requiring a globally installed tsx binary
        tsxCliPath = require.resolve("tsx/dist/cli.js");
      } catch {
        // no-op; will fall back to shell-resolved "tsx" if not found
      }

      const tsxArgs = [sourceEvalPath, ...legacyArgs];

      if (tsxCliPath) {
        child = spawn(process.execPath, [tsxCliPath, ...tsxArgs], {
          env,
          stdio: "inherit",
          shell: true,
        });
      } else {
        child = spawn("tsx", tsxArgs, {
          env,
          stdio: "inherit",
          shell: true,
        });
      }
    }

    child.on("exit", (code) => {
      process.exit(code || 0);
    });
  });
}

// Main CLI logic
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "run":
      handleRun(commandArgs);
      break;

    case "list":
      handleList(commandArgs);
      break;

    case "config":
      handleConfig(commandArgs);
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    case undefined:
      console.error(chalk.red("Error: No command specified"));
      printHelp();
      process.exit(1);
      break;

    default:
      // Check if it's a direct target (backward compatibility)
      if (!command.startsWith("-")) {
        handleRun(args);
      } else {
        console.error(chalk.red(`Error: Unknown command "${command}"`));
        printHelp();
        process.exit(1);
      }
  }
}

// Run the CLI
main();
