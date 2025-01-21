import process from "process";
import { EvalCategorySchema } from "@/types/evals";

// Extract command-line arguments passed to this script.
const args = process.argv.slice(2);

/**
 * The default categories of evaluations to run if none is specified.
 * These categories represent different styles or types of tasks.
 */
const DEFAULT_EVAL_CATEGORIES = process.env.EVAL_CATEGORIES
  ? process.env.EVAL_CATEGORIES.split(",")
  : [
      "observe",
      "act",
      "combination",
      "extract",
      "experimental",
      "text_extract",
    ];

/**
 * Determine which extraction method to use for tasks that involve extraction.
 * By default, "domExtract" is used. However, if a `--extract-method=<method>`
 * argument is provided, it will override the default.
 */
let extractMethod = "domExtract";
const extractMethodArg = args.find((arg) =>
  arg.startsWith("--extract-method="),
);
if (extractMethodArg) {
  extractMethod = extractMethodArg.split("=")[1];
}

// Set the extraction method in the process environment so tasks can reference it.
process.env.EXTRACT_METHOD = extractMethod;
const useTextExtract = process.env.EXTRACT_METHOD === "textExtract";
const useAccessibilityTree = process.env.EXTRACT_METHOD === "accessibilityTree";

/**
 * Variables for filtering which tasks to run:
 * - `filterByCategory`: if provided, only tasks that belong to this category will be run.
 * - `filterByEvalName`: if provided, only the task with this name will be run.
 */
let filterByCategory: string | null = null;
let filterByEvalName: string | null = null;

/**
 * Check the first argument:
 * - If it is "category", the next argument should be the category name.
 * - Otherwise, assume it is a specific evaluation (task) name.
 */
if (args.length > 0) {
  if (args[0].toLowerCase() === "category") {
    filterByCategory = args[1];
    if (!filterByCategory) {
      console.error("Error: Category name not specified.");
      process.exit(1);
    }
    // Validate that the category is one of the known ones.
    try {
      EvalCategorySchema.parse(filterByCategory);
    } catch {
      console.error(
        `Error: Invalid category "${filterByCategory}". Valid categories are: ${DEFAULT_EVAL_CATEGORIES.join(", ")}`,
      );
      process.exit(1);
    }
  } else {
    // Otherwise, treat it as a filter by evaluation name.
    filterByEvalName = args[0];
  }
}

export {
  filterByCategory,
  filterByEvalName,
  useTextExtract,
  useAccessibilityTree,
  DEFAULT_EVAL_CATEGORIES,
};
