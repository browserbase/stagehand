import { bold, dim, cyan, gray, green, bb, padRight, separator } from "../format.js";
import type { TaskRegistry, Tier } from "../../framework/types.js";

export function printList(registry: TaskRegistry, tierFilter?: string): void {
  const tiers: Tier[] = tierFilter
    ? [tierFilter as Tier]
    : (["core", "bench"] as const);

  for (const tier of tiers) {
    const tasks = registry.byTier.get(tier);
    if (!tasks || tasks.length === 0) continue;

    console.log(`\n  ${bold(bb(tier.toUpperCase()))} ${dim(`(${tasks.length} tasks)`)}`);
    console.log(separator());

    // Group by primary category
    const byCategory = new Map<string, string[]>();
    for (const t of tasks) {
      const existing = byCategory.get(t.primaryCategory) ?? [];
      existing.push(t.name);
      byCategory.set(t.primaryCategory, existing);
    }

    for (const [category, names] of byCategory) {
      console.log(`\n    ${cyan(bold(category))} ${gray(`(${names.length})`)}`);
      for (const name of names.slice(0, 15)) {
        console.log(`      ${dim("•")} ${name}`);
      }
      if (names.length > 15) {
        console.log(`      ${gray(`... and ${names.length - 15} more`)}`);
      }
    }
  }

  console.log("");
}
