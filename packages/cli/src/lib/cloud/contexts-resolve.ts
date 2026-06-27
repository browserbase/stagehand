import { fail } from "../errors.js";
import { resolveContextRefDetailed } from "./contexts-store.js";

/**
 * Resolve a context name-or-id for a command. A saved name or a context id
 * resolves to the id; an unknown name fails with an actionable message (and a
 * "did you mean?" hint) instead of letting it hit the API as a bogus id and
 * return a cryptic "Invalid Context ID".
 */
export async function resolveContextRefOrFail(ref: string): Promise<string> {
  const { id, suggestions } = await resolveContextRefDetailed(ref);
  if (id !== null) {
    return id;
  }
  const didYouMean = suggestions.length
    ? ` Did you mean: ${suggestions.join(", ")}?`
    : "";
  return fail(
    `No saved context named "${ref}".${didYouMean} ` +
      `Pass a Browserbase context ID, save one with "browse cloud contexts create --name <name>", ` +
      `or list saved names with "browse cloud contexts list".`,
  );
}
