export type BugSeverity = "critical" | "major" | "minor" | "cosmetic";

export type BugCategory =
  | "functional"
  | "visual"
  | "accessibility"
  | "performance"
  | "validation"
  | "navigation";

export interface BugReport {
  id: string;
  title: string;
  severity: BugSeverity;
  category: BugCategory;
  page: string;
  description: string;
  stepsToReproduce: string[];
  expected: string;
  actual: string;
}

export interface QARunResult {
  approach: "primitives" | "agent";
  bugs: BugReport[];
  pagesVisited: string[];
  totalDuration: number;
  stepsExecuted: number;
}
