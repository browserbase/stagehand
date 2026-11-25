import type { Rubric } from "stagehand-v3";

export function adHocRubric(...criteria: string[]): Rubric {
  if (criteria.length === 0) {
    throw new Error("adHocRubric requires at least one criterion");
  }
  return {
    items: criteria.map((c) => ({
      criterion: c,
      description: c,
      maxPoints: 1,
    })),
  };
}
