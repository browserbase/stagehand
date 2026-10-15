import { fail } from "../errors.js";
import { resolveContextRefDetailed } from "./contexts-store.js";
import { parseUuid } from "./ids.js";

/** Resolve saved names first, then validate the ID before it reaches the API. */
export async function resolveContextRefOrFail(ref: string): Promise<string> {
  const { id, suggestions } = await resolveContextRefDetailed(ref);
  if (id === null && suggestions.length > 0) {
    fail(
      `No saved context named "${ref}". Did you mean: ${suggestions.join(", ")}? ` +
        `Pass a Browserbase context ID, save one with "browse cloud contexts create --name <name>", ` +
        `or list saved names with "browse cloud contexts list".`,
    );
  }
  return parseUuid(id ?? ref, "Context ID");
}
