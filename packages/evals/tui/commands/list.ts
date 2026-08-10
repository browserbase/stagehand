import { bold, dim, cyan, gray, bb, separator } from "../format.js";
import type { TaskRegistry, Tier } from "../../framework/types.js";

export function printList(
  registry: TaskRegistry,
  tierFilter?: string,
  detailed = false,
): void {
  if (tierFilter && tierFilter !== "core" && tierFilter !== "bench") {
    throw new Error(
      `Unknown list filter "${tierFilter}". Use "core" or "bench".`,
    );
  }

  const tiers: Tier[] = tierFilter
    ? [tierFilter as Tier]
    : (["core", "bench"] as const);

  for (const tier of tiers) {
    const tasks = registry.byTier.get(tier);
    if (!tasks || tasks.length === 0) continue;

    console.log(
      `\n  ${bold(bb(tier.toUpperCase()))} ${dim(`(${tasks.length} tasks)`)}`,
    );
    console.log(separator());

    const byCategory = new Map<string, string[]>();
    for (const t of tasks) {
      const existing = byCategory.get(t.primaryCategory) ?? [];
      existing.push(t.name);
      byCategory.set(t.primaryCategory, existing);
    }

    for (const [category, names] of byCategory) {
      console.log(`\n    ${cyan(bold(category))} ${gray(`(${names.length})`)}`);
      const limit = detailed ? names.length : 15;
      for (const name of names.slice(0, limit)) {
        console.log(`      ${dim("•")} ${name}`);
      }
      if (!detailed && names.length > 15) {
        console.log(`      ${gray(`... and ${names.length - 15} more`)}`);
      }
    }
  }

  if (!detailed) {
    console.log(
      `\n  ${dim("Use")} ${cyan("list --detailed")} ${dim("to see all tasks.")}`,
    );
  }
  console.log("");
}
