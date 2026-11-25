import { expectTypeOf } from "vitest";
import type {
  LocatorChain,
  RoleSelectorQuery,
  LocatorFrameStep,
  LocatorNthStep,
  LocatorFilterStep,
  LocatorQuerySelector,
  LocatorQueryStep,
  LocatorStep,
} from "../../types.js";

expectTypeOf<LocatorQuerySelector>().toEqualTypeOf<
  | RoleSelectorQuery
  | { kind: "css"; value: string }
  | { kind: "xpath"; value: string }
  | { kind: "text"; value: string }
  | { kind: "textMatch"; value: string; exact?: boolean }
>();
expectTypeOf<LocatorQueryStep>().toEqualTypeOf<{
  type: "query";
  selector: LocatorQuerySelector;
}>();
expectTypeOf<LocatorFrameStep>().toEqualTypeOf<{
  type: "frame";
  selector: LocatorQuerySelector;
}>();
expectTypeOf<LocatorNthStep>().toEqualTypeOf<{ type: "nth"; index: number }>();
expectTypeOf<LocatorFilterStep>().toEqualTypeOf<{
  type: "filter";
  hasText?: string;
  hasNotText?: string;
}>();
expectTypeOf<LocatorStep>().toEqualTypeOf<
  LocatorQueryStep | LocatorFrameStep | LocatorNthStep | LocatorFilterStep
>();
expectTypeOf<LocatorChain["steps"]>().toEqualTypeOf<[LocatorQueryStep, ...LocatorStep[]]>();

expectTypeOf<{ steps: [] }>().not.toExtend<LocatorChain>();
expectTypeOf<{ steps: [LocatorNthStep] }>().not.toExtend<LocatorChain>();
expectTypeOf<{ steps: [LocatorFilterStep] }>().not.toExtend<LocatorChain>();
expectTypeOf<{ steps: [LocatorFrameStep, LocatorQueryStep] }>().not.toExtend<LocatorChain>();
expectTypeOf<{
  steps: [LocatorQueryStep, LocatorNthStep, LocatorFrameStep, LocatorQueryStep, LocatorNthStep];
}>().toExtend<LocatorChain>();
expectTypeOf<Extract<LocatorStep, { type: "query" }>>().toEqualTypeOf<LocatorQueryStep>();
expectTypeOf<Extract<LocatorStep, { type: "frame" }>>().toEqualTypeOf<LocatorFrameStep>();
expectTypeOf<Extract<LocatorStep, { type: "nth" }>>().toEqualTypeOf<LocatorNthStep>();
