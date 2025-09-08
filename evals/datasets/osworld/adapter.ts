import * as fs from "fs";
import * as path from "path";
import type { OSWorldTask, OSWorldStagehandTask } from "./types";

export class OSWorldAdapter {
  private rawDataPath: string;

  constructor(rawDataPath?: string) {
    this.rawDataPath = rawDataPath || path.join(__dirname, "raw");
  }

  /**
   * Load all OSWorld Chrome JSON files from the raw directory
   */
  loadRawTasks(): OSWorldTask[] {
    const files = fs
      .readdirSync(this.rawDataPath)
      .filter((file) => file.endsWith(".json"));

    const tasks: OSWorldTask[] = [];

    for (const file of files) {
      const filePath = path.join(this.rawDataPath, file);
      const content = fs.readFileSync(filePath, "utf-8");
      try {
        const task = JSON.parse(content) as OSWorldTask;
        tasks.push(task);
      } catch (error) {
        console.warn(`Failed to parse OSWorld task file ${file}:`, error);
      }
    }

    return tasks;
  }

  /**
   * Convert OSWorld task to Stagehand format
   */
  convertTask(osWorldTask: OSWorldTask): OSWorldStagehandTask {
    const startUrl = this.extractStartUrl(osWorldTask);
    const evaluationType = this.determineEvaluationType(osWorldTask.evaluator);
    const evaluationCriteria = this.convertEvaluationCriteria(
      osWorldTask.evaluator,
    );

    return {
      id: osWorldTask.id,
      instruction: osWorldTask.instruction,
      source: osWorldTask.source,
      startUrl,
      evaluationType,
      evaluationCriteria,
      timeout: this.extractTimeout(),
      requiresProxy: osWorldTask.proxy,
    };
  }

  /**
   * Convert all raw tasks to Stagehand format
   */
  convertAllTasks(): OSWorldStagehandTask[] {
    const rawTasks = this.loadRawTasks();
    return rawTasks.map((task) => this.convertTask(task));
  }

  private extractStartUrl(task: OSWorldTask): string | undefined {
    // Look for chrome_open_tabs config to find starting URL
    for (const config of task.config) {
      if (
        config.type === "chrome_open_tabs" &&
        config.parameters.urls_to_open
      ) {
        const urls = config.parameters.urls_to_open;
        if (Array.isArray(urls) && urls.length > 0) {
          return urls[0];
        }
      }
    }
    return undefined;
  }

  private determineEvaluationType(
    evaluator: OSWorldTask["evaluator"],
  ): OSWorldStagehandTask["evaluationType"] {
    const func = Array.isArray(evaluator.func)
      ? evaluator.func[0]
      : evaluator.func;

    switch (func) {
      case "is_expected_active_tab":
        return "url_match";
      case "exact_match":
        return "string_match";
      case "check_direct_json_object":
        return "dom_state";
      default:
        return "custom";
    }
  }

  private convertEvaluationCriteria(
    evaluator: OSWorldTask["evaluator"],
  ): OSWorldStagehandTask["evaluationCriteria"] {
    const func = Array.isArray(evaluator.func)
      ? evaluator.func[0]
      : evaluator.func;
    const expected = Array.isArray(evaluator.expected)
      ? evaluator.expected[0]
      : evaluator.expected;

    return {
      type: func,
      expected: expected?.rules || expected,
      rules: expected?.rules,
    };
  }

  private extractTimeout(): number {
    // Default timeout for Chrome tasks (can be made configurable)
    return 60000; // 60 seconds
  }
}

export const osworldAdapter = new OSWorldAdapter();
