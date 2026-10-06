/**
 * The Stagehand mark, set on the pixel grid.
 *
 * Hand-set from the logo's geometry rather than rasterized: at terminal size
 * an anti-aliased render is all partial pixels and reads as blur (worse on
 * light-slate themes), and a plain snap closes the S's two slits. Every
 * pixel here is brand green or white, so it stays crisp on any background.
 * Pixels are square — two per terminal row, drawn with half-blocks — so the
 * 20 px mark is 10 rows × 20 columns.
 *
 * The S keeps what makes it the mark: a block with a slit from the right
 * (under the top bar) and one from the left (above the bottom bar), and the
 * chamfered top-left and bottom-right corners.
 */

/** 'G' brand green · 'W' white. */
export const MARK: readonly string[] = [
  "GGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGWWWWWWWWGGGGG",
  "GGGGGGWWWWWWWWWGGGGG",
  "GGGGGGWWWWWWWWWGGGGG",
  "GGGGGGWWWGGGGGGGGGGG",
  "GGGGGGWWWWWWWWWGGGGG",
  "GGGGGGWWWWWWWWWGGGGG",
  "GGGGGGWWWWWWWWWGGGGG",
  "GGGGGGGGGGGGWWWGGGGG",
  "GGGGGGWWWWWWWWWGGGGG",
  "GGGGGGWWWWWWWWWGGGGG",
  "GGGGGGWWWWWWWWGGGGGG",
  "GGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGG",
  "GGGGGGGGGGGGGGGGGGGG",
];
export const MARK_PX = MARK.length;
