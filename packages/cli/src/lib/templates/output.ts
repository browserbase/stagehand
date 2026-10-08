import type { Template } from "./api.js";
import { outputTable } from "../output.js";

export function outputTemplateTable(
  templates: Template[],
  options: { heading?: string; wide?: boolean } = {},
): void {
  if (templates.length === 0) {
    console.log("No templates found.");
    return;
  }

  if (options.heading) {
    console.log(`${options.heading} (${templates.length})`);
  }

  outputTable(
    templates,
    [
      {
        header: "Template",
        maxWidth: 34,
        value: (template) => template.slug,
      },
      {
        header: "Title",
        maxWidth: 42,
        value: (template) => template.title,
      },
      {
        header: "Source",
        maxWidth: 12,
        value: (template) => template.source,
      },
      {
        header: "Categories",
        maxWidth: 34,
        value: (template) => formatList(template.category),
      },
      {
        header: "Tags",
        maxWidth: 34,
        value: (template) => formatList(template.tags),
      },
    ],
    { wide: options.wide },
  );

  console.log("Use --wide for full values or --json for full descriptions.");
}

export function printTemplateDetail(template: Template): void {
  console.log(`${template.title}`);
  console.log(`slug: ${template.slug}`);
  console.log(`source: ${template.source ?? "-"}`);
  console.log(`categories: ${formatList(template.category)}`);
  console.log(`tags: ${formatList(template.tags)}`);

  if (template.shortDescription) {
    console.log(`\n${template.shortDescription}`);
  }

  if (template.description) {
    console.log(`\n${template.description}`);
  }

  if (template.steps.length > 0) {
    console.log("\nSteps:");
    for (const step of template.steps) {
      console.log(`  - ${step}`);
    }
  }

  if (template.commands.length > 0) {
    console.log("\nScaffold commands:");
    for (const command of template.commands) {
      console.log(`  ${command}`);
    }
  }
}

export function templateMatchesQuery(
  template: Template,
  query: string,
): boolean {
  const normalizedQuery = query.toLowerCase();
  const haystack = [
    template.slug,
    template.title,
    template.shortDescription,
    template.description,
    template.descriptionTitle,
    template.source,
    ...template.category,
    ...template.tags,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}
