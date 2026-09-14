export type EncodedId = `${number}-${number}`;

/**
 * Represents a path through a Zod schema from the root object down to a
 * particular field. The `segments` array describes the chain of keys/indices.
 *
 * - **String** segments indicate object property names.
 * - **Number** segments indicate array indices.
 *
 * For example, `["users", 0, "homepage"]` might describe reaching
 * the `homepage` field in `schema.users[0].homepage`.
 */
export interface ZodPathSegments {
  /**
   * The ordered list of keys/indices leading from the schema root
   * to the targeted field.
   */
  segments: Array<string | number>;
}

export type InitScriptSource<Arg> = string | { content: string } | ((arg: Arg) => unknown);
