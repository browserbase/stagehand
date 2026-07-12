import type { z } from "zod/v4";
import type {
  JSONRPCErrorObjectSchema,
  JSONRPCErrorResponseSchema,
  JSONRPCNotificationSchema,
  JSONRPCRequestBatchSchema,
  JSONRPCRequestIdSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseBatchSchema,
  JSONRPCResponseSchema,
  JSONRPCSuccessResponseSchema,
} from "./schemas.js";

export type JSONRPCErrorObject = z.infer<typeof JSONRPCErrorObjectSchema>;
export type JSONRPCRequestId = z.infer<typeof JSONRPCRequestIdSchema>;
export type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;
export type JSONRPCNotification = z.infer<typeof JSONRPCNotificationSchema>;
export type JSONRPCSuccessResponse = z.infer<typeof JSONRPCSuccessResponseSchema>;
export type JSONRPCErrorResponse = z.infer<typeof JSONRPCErrorResponseSchema>;
export type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;
export type JSONRPCRequestBatch = z.infer<typeof JSONRPCRequestBatchSchema>;
export type JSONRPCResponseBatch = z.infer<typeof JSONRPCResponseBatchSchema>;
