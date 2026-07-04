import { fail } from "../errors.js";
import { resolveContextRefDetailed } from "./contexts-store.js";

/**
 * Resolve a context name-or-id for a command. A saved name or a context id
 * resolves to its id. When a ref is neither but is close to a saved name, we
 * treat it as a typo and fail with a "did you mean?" hint instead of sending a
 * bogus id. Otherwise we pass the ref through unchanged so raw ids of any shape
 * still reach the API — preserving raw-id compatibility.
 */
export async function resolveContextRefOrFail(ref: string): Promise<string> {
  const { id, suggestions } = await resolveContextRefDetailed(ref);
  if (id !== null) {
    return id;
  }
  if (suggestions.length === 0) {
    // Not a known name and not close to one — could be a raw id we don't
    // recognize the shape of. Let the API be the judge rather than blocking it.
    return ref;
  }
  return fail(
    `No saved context named "${ref}". Did you mean: ${suggestions.join(", ")}? ` +
      `Pass a Browserbase context ID, save one with "browse cloud contexts create --name <name>", ` +
      `or list saved names with "browse cloud contexts list".`,
  );
}
