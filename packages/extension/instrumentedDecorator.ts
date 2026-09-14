import type { StagehandLogger } from "./logger.js";

type InstrumentedLoggerContext = {
  logger: StagehandLogger;
};

type InstrumentedMethod<
  This,
  Args extends unknown[],
  Context extends InstrumentedLoggerContext,
  Result,
> = (this: This, ...args: [...Args, Context]) => Promise<Result>;

export function Instrumented(spanName?: string) {
  return function <This, Args extends unknown[], Context extends InstrumentedLoggerContext, Result>(
    originalMethod: InstrumentedMethod<This, Args, Context, Result>,
    decoratorContext: ClassMethodDecoratorContext<
      This,
      InstrumentedMethod<This, Args, Context, Result>
    >,
  ): InstrumentedMethod<This, Args, Context, Result> {
    const resolvedSpanName = spanName ?? String(decoratorContext.name);

    return function (this: This, ...args: [...Args, Context]): Promise<Result> {
      const requestContext = args.at(-1) as Context;
      const methodArgs = args.slice(0, -1) as Args;

      return requestContext.logger.span(resolvedSpanName, {}, (logger) =>
        originalMethod.call(this, ...methodArgs, { ...requestContext, logger }),
      );
    };
  };
}
