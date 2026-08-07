/**
 * String-scoring helpers for bench tasks.
 *
 * v4 bench tasks may only import "zod" and "../../../framework/*.js", which is
 * why several of them carried inlined copies of these functions. This module is
 * the boundary-compliant path to them: the implementation stays in utils.ts,
 * shared with the v3 suite, so both suites score identically by construction
 * rather than by keeping copies in sync.
 */
export { compareStrings, normalizeString } from "../utils.js";
