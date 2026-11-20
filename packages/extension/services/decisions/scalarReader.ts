import type { Progress } from "../../understudy/progress.js";
import type { DecisionsConfig } from "./config.js";
import type { ScalarReader } from "./extractionShared.js";
import { providerFor } from "./providers.js";
import { decide, locateAnswer } from "./client.js";

export function scalarReader(
  config: DecisionsConfig,
  progress: Progress,
): ScalarReader | undefined {
  if (!providerFor(config).supportsLocate) return undefined;
  return async ({ sheet, fields }) => {
    const response = await progress.run("reading scalar evidence", () =>
      decide(
        config,
        sheet,
        Object.fromEntries(
          fields.map((field) => [
            field.name,
            {
              type: "locate" as const,
              instructions: `Copy the requested values from the supplied evidence. Omit absent values.\nFind the exact value for ${field.name.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2")}.\n${field.instructions}`,
            },
          ]),
        ),
      ),
    );
    return Object.fromEntries(
      fields.map(({ name }) => [
        name,
        locateAnswer(response, name)
          .spans.toSorted((a, b) => b.score - a.score)[0]
          ?.text.trim(),
      ]),
    );
  };
}
