import { z } from "zod/v4";
import { Locator } from "../../understudy/locator.js";

export const ScreenshotClipSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

export const UnderstudyScreenshotOptionsSchema = z
  .object({
    animations: z.enum(["disabled", "allow"]).optional(),
    caret: z.enum(["hide", "initial"]).optional(),
    clip: ScreenshotClipSchema.optional(),
    fullPage: z.boolean().optional(),
    mask: z.array(z.instanceof(Locator)).optional(),
    maskColor: z.string().optional(),
    omitBackground: z.boolean().optional(),
    quality: z.number().int().min(0).max(100).optional(),
    scale: z.enum(["css", "device"]).optional(),
    style: z.string().optional(),
    timeout: z.number().nonnegative().optional(),
    type: z.enum(["png", "jpeg"]).optional(),
  })
  .strict();

export type ScreenshotClip = z.infer<typeof ScreenshotClipSchema>;
export type UnderstudyScreenshotOptions = z.infer<typeof UnderstudyScreenshotOptionsSchema>;

// TODO(protocol): A future screenshot RPC needs a separate wire schema whose
// mask contains LocatorDescriptor values rather than live Understudy Locator
// instances.
