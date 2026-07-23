import { z } from "zod/v4";

export const SetInputFilePayloadSchema = z
  .object({
    name: z.string().min(1),
    mimeType: z.string().min(1).optional(),
    buffer: z.union([z.string(), z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
    lastModified: z.number().int().nonnegative().optional(),
  })
  .strict();

export const SetInputFilesArgumentSchema = z.union([
  SetInputFilePayloadSchema,
  z.array(SetInputFilePayloadSchema),
]);

export type SetInputFilesArgument = z.infer<typeof SetInputFilesArgumentSchema>;

// TODO(protocol): Before file upload is exposed through JSON-RPC, introduce a
// wire-safe schema with an explicit text or base64 encoding instead of binary
// ArrayBuffer and Uint8Array values.
