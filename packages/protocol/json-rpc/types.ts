import type { z } from "zod/v4";
import type {
  JSONRPCEnvelopeSchema,
  JSONRPCErrorObjectSchema,
  JSONRPCErrorResponseSchema,
  JSONRPCMessageSchema,
  JSONRPCNotificationSchema,
  JSONRPCRequestIdSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  JSONRPCSuccessResponseSchema,
  JSONRPCWireInputSchema,
} from "./schemas.js";

export type JSONRPCEnvelope = z.infer<typeof JSONRPCEnvelopeSchema>;
export type JSONRPCErrorObject = z.infer<typeof JSONRPCErrorObjectSchema>;
export type JSONRPCRequestId = z.infer<typeof JSONRPCRequestIdSchema>;
export type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;
export type JSONRPCNotification = z.infer<typeof JSONRPCNotificationSchema>;
export type JSONRPCSuccessResponse = z.infer<typeof JSONRPCSuccessResponseSchema>;
export type JSONRPCErrorResponse = z.infer<typeof JSONRPCErrorResponseSchema>;
export type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;
export type JSONRPCMessage = z.infer<typeof JSONRPCMessageSchema>;
export type JSONRPCWireInput = z.infer<typeof JSONRPCWireInputSchema>;
