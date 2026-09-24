/**
 * Model capability checks, used to keep tool results within what the active
 * model can actually consume.
 *
 * pi's model catalogue declares what each model accepts through `input`.
 * `screenshot` returns real image content, so a model whose `input` has no
 * `"image"` entry cannot use it: the capture is dropped or ignored, and the turn
 * is spent for nothing. pi does not raise an error in that case, so the tool has
 * to check for itself.
 *
 * Unknown shapes return `undefined` and callers should fail open rather than
 * block a model they cannot classify.
 */

export type ModelCapabilities = { readonly input?: unknown } | undefined;

/**
 * `true` when the model accepts image input, `false` when it only accepts text,
 * `undefined` when the model or its `input` list is unknown.
 */
export function modelAcceptsImages(model: ModelCapabilities): boolean | undefined {
  const input = model?.input;
  if (!Array.isArray(input)) return undefined;
  return input.includes("image");
}
