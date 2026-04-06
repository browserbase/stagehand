import { z } from "zod";
import { SupportedUnderstudyAction } from "./handlers.js";

export const elementRefSchema = z.strictObject({
  frameOrdinal: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "The frame ordinal from the accessibility tree element identifier.",
    ),
  backendNodeId: z
    .number()
    .int()
    .positive()
    .describe(
      "The backend node ID from the accessibility tree element identifier.",
    ),
});

export type ElementRef = z.infer<typeof elementRefSchema>;

const modelActionBaseSchema = z.strictObject({
  target: elementRefSchema.describe(
    "The element to act on, represented as a frame ordinal plus backend node ID.",
  ),
  description: z
    .string()
    .describe("A description of the accessible element and its purpose."),
});

export const modelActionSchema = z.union([
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.CLICK),
    button: z
      .enum(["right", "middle"])
      .nullable()
      .describe(
        "Mouse button override for click actions. Use null for the default left click.",
      ),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.DOUBLE_CLICK),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.HOVER),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.FILL),
    value: z
      .string()
      .describe("The text value to fill into the target element."),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.TYPE),
    text: z.string().describe("The text to type into the target element."),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.PRESS),
    key: z
      .string()
      .describe("The keyboard key to press, for example 'Enter' or 'Tab'."),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.SCROLL),
    position: z
      .string()
      .describe("The target scroll position, such as '50%' or '75%'."),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.NEXT_CHUNK),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.PREV_CHUNK),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.SELECT_OPTION_FROM_DROPDOWN),
    option: z
      .string()
      .describe("The exact dropdown option text that should be selected."),
  }),
  modelActionBaseSchema.extend({
    method: z.literal(SupportedUnderstudyAction.DRAG_AND_DROP),
    destination: elementRefSchema.describe(
      "The target destination element for the drag-and-drop action.",
    ),
  }),
]);

const modelActResponseSchemaInner = z.strictObject({
  action: modelActionSchema.describe("The action to perform."),
  twoStep: z.boolean(),
});

export const modelActResponseSchema = modelActResponseSchemaInner;

export type ModelAction = z.infer<typeof modelActionSchema>;
export type ModelActResponse = z.infer<typeof modelActResponseSchema>;
