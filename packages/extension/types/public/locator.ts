import { z } from "zod/v4";

export type MouseButton = "left" | "right" | "middle";

export const SetInputFilePayloadSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  buffer: z.union([z.string(), z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
  lastModified: z.number().nonnegative().optional(),
});

export type SetInputFilePayload = z.infer<typeof SetInputFilePayloadSchema>;

export type SetInputFilesArgument = SetInputFilePayload | SetInputFilePayload[];
