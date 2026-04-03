import {
  tool as aiTool,
  type Tool as AISdkTool,
  type ToolExecuteFunction,
} from "ai";

type NoInfer<T> = [T][T extends unknown ? 0 : never];

type ModernToModelOutput<INPUT, OUTPUT> = NonNullable<
  AISdkTool<INPUT, OUTPUT>["toModelOutput"]
>;

type CompatibleToModelOutputArg<INPUT, OUTPUT> = ([NoInfer<OUTPUT>] extends [
  object,
]
  ? NoInfer<OUTPUT>
  : Record<never, never>) & {
  toolCallId: string;
  input: [INPUT] extends [never] ? unknown : INPUT;
  output: [NoInfer<OUTPUT>] extends [never] ? unknown : NoInfer<OUTPUT>;
};

type CompatibleToolDefinition<INPUT, OUTPUT> = {
  description?: AISdkTool<INPUT, OUTPUT>["description"];
  title?: AISdkTool<INPUT, OUTPUT>["title"];
  providerOptions?: AISdkTool<INPUT, OUTPUT>["providerOptions"];
  inputSchema: AISdkTool<INPUT, OUTPUT>["inputSchema"];
  inputExamples?: AISdkTool<INPUT, OUTPUT>["inputExamples"];
  needsApproval?: AISdkTool<INPUT, OUTPUT>["needsApproval"];
  strict?: AISdkTool<INPUT, OUTPUT>["strict"];
  onInputStart?: AISdkTool<INPUT, OUTPUT>["onInputStart"];
  onInputDelta?: AISdkTool<INPUT, OUTPUT>["onInputDelta"];
  onInputAvailable?: AISdkTool<INPUT, OUTPUT>["onInputAvailable"];
  execute: ToolExecuteFunction<INPUT, OUTPUT>;
  outputSchema?: AISdkTool<INPUT, OUTPUT>["outputSchema"];
  toModelOutput?: (
    options: CompatibleToModelOutputArg<INPUT, OUTPUT>,
  ) => ReturnType<ModernToModelOutput<INPUT, OUTPUT>>;
};

export const tool = <INPUT, OUTPUT>(
  toolDefinition: CompatibleToolDefinition<INPUT, OUTPUT>,
): AISdkTool<INPUT, OUTPUT> => {
  const toModelOutput = toolDefinition.toModelOutput;

  if (!toModelOutput) {
    return aiTool(toolDefinition as AISdkTool<INPUT, OUTPUT>);
  }

  return aiTool({
    ...toolDefinition,
    toModelOutput: (options) =>
      toModelOutput(
        createCompatToModelOutputArgument(
          options,
        ) as CompatibleToModelOutputArg<INPUT, OUTPUT>,
      ),
  } as AISdkTool<INPUT, OUTPUT>);
};

function createCompatToModelOutputArgument(options: {
  toolCallId: string;
  input: unknown;
  output: unknown;
}) {
  const { toolCallId, input, output } = options;
  const outputBox =
    output !== null && output !== undefined ? Object(output) : undefined;

  return new Proxy(
    { toolCallId, input, output },
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }

        if (!outputBox) {
          return undefined;
        }

        const value = Reflect.get(outputBox, prop, outputBox);
        return typeof value === "function" ? value.bind(outputBox) : value;
      },
      has(target, prop) {
        return (
          Reflect.has(target, prop) ||
          (outputBox
            ? Object.prototype.hasOwnProperty.call(outputBox, prop)
            : false)
        );
      },
      ownKeys(target) {
        const keys = new Set<string | symbol>(Reflect.ownKeys(target));
        if (outputBox) {
          for (const key of Reflect.ownKeys(outputBox) as Array<
            string | symbol
          >) {
            keys.add(key);
          }
        }
        return [...keys];
      },
      getOwnPropertyDescriptor(target, prop) {
        return (
          Reflect.getOwnPropertyDescriptor(target, prop) ??
          (outputBox
            ? Reflect.getOwnPropertyDescriptor(outputBox, prop)
            : undefined)
        );
      },
    },
  );
}
