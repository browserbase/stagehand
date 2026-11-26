import { fail } from "../errors.js";
import { resolveContextRefDetailed } from "./contexts-store.js";

export async function resolveContextRefOrFail(ref: string): Promise<string> {
  const { id, suggestions } = await resolveContextRefDetailed(ref);
  if (id !== null) {
    return id;
  }
  if (suggestions.length === 0) {
    return ref;
  }
  return fail(
    `No saved context named "${ref}". Did you mean: ${suggestions.join(", ")}? ` +
      `Pass a Browserbase context ID, save one with "browse cloud contexts create --name <name>", ` +
      `or list saved names with "browse cloud contexts list".`,
  );
}
