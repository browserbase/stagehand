import { timestampFromDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { z } from "zod";

const timestampShape = z.object({
  seconds: z.bigint({ message: "timestamp seconds required" }),
  nanos: z
    .number({ message: "timestamp nanos required" })
    .int({ message: "timestamp nanos must be an integer" })
    .gte(0, { message: "timestamp nanos must be >= 0" })
    .lte(999_999_999, { message: "timestamp nanos must be < 1,000,000,000" }),
});

const preprocessTimestamp = (value: unknown) => {
  if (value instanceof Date) {
    return timestampFromDate(value);
  }
  if (typeof value === "number") {
    return timestampFromDate(new Date(value));
  }
  return value;
};

const timestampSchema = z
  .preprocess(preprocessTimestamp, timestampShape)
  .refine(
    (value) =>
      value.seconds > BigInt(0) ||
      (value.seconds === BigInt(0) && value.nanos > 0),
    {
      message: "timestamp must be greater than zero milliseconds",
    },
  );

/**
 * Converts a plain object with seconds and nanos back to a Timestamp Message.
 * This is needed because Zod validation strips the Message type metadata.
 */
export function timestampFromSecondsAndNanos(value: {
  seconds: bigint;
  nanos: number;
}): Timestamp {
  // Convert seconds (Unix timestamp) to milliseconds for Date constructor
  const date = new Date(Number(value.seconds) * 1000 + value.nanos / 1_000_000);
  return timestampFromDate(date);
}

export const pingRequestSchema = z.object({
  clientSendTime: timestampSchema,
});

export const pingResponseSchema = z.object({
  clientSendTime: timestampSchema,
  serverSendTime: timestampSchema,
});
