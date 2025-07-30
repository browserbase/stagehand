import type { CoreMessage, TextStreamPart, ToolSet } from "ai";

/**
 * Build system prompt for AI SDK agents
 * @param userGoal - The user's goal/instruction
 * @param userProvidedInstructions - Additional user-provided instructions
 * @returns Formatted system prompt
 */
export function buildAISDKSystemPrompt(
  userGoal: string,
  userProvidedInstructions?: string,
): string {
  const currentDateTime = new Date().toLocaleString();
  const additionalInstructions = userProvidedInstructions
    ? `\n\nAdditional instructions from user: ${userProvidedInstructions}`
    : "";

  return `You are a helpful web automation assistant using Stagehand tools to accomplish the user's goal: ${userGoal}${additionalInstructions}

PRIMARY APPROACH:
1. THINK first - Use the think tool to analyze the goal, break down your approach, and communicate your plan to the user
2. Take ONE atomic step at a time toward completion

ACTION EXECUTION HIERARCHY:

STEP 1: UNDERSTAND THE PAGE
- Use getText to get complete page context before taking actions
- Use screenshot for visual confirmation when needed

STEP 2: TAKE ACTIONS
- Use navigate to go to URLs
- Use actClick to click on buttons, links, or any clickable elements
- Use actType to type text into input fields or text areas
- Use wait after actions that may cause navigation

STEP 3: VERIFY RESULTS
- Take screenshot to verify success when needed
- Use getText to confirm changes


Current date and time: ${currentDateTime}`;
}

/**
 * Create an abortable stream wrapper
 * @param originalStream - The original stream to wrap
 * @param abortController - The abort controller to use
 * @returns Wrapped stream that respects abort signal
 */
export function createAbortableStream<T>(
  originalStream: AsyncIterable<T> & ReadableStream<T>,
  abortController: AbortController,
): AsyncIterable<T> & ReadableStream<T> {
  const reader = originalStream[Symbol.asyncIterator]();

  return new ReadableStream<T>({
    async pull(controller) {
      if (abortController.signal.aborted) {
        controller.close();
        return;
      }

      const { done, value } = await reader.next();
      if (done || abortController.signal.aborted) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel() {
      abortController.abort();
    },
  }) as AsyncIterable<T> & ReadableStream<T>;
}

/**
 * Build messages array for AI SDK
 * @param instruction - The current instruction
 * @param previousMessages - Optional previous messages
 * @returns Formatted messages array
 */
export function buildAISDKMessages(
  instruction: string,
  previousMessages?: CoreMessage[],
): CoreMessage[] {
  if (previousMessages) {
    return [...previousMessages, { role: "user", content: instruction }];
  }
  return [{ role: "user", content: instruction }];
}

/**
 * Process stream for tool call callbacks
 * @param stream - The full stream to process
 * @param onToolCall - Callback for tool calls
 * @param abortSignal - Abort signal to respect
 */
export async function processToolCallStream(
  stream: AsyncIterable<TextStreamPart<ToolSet>>,
  onToolCall: (toolName: string, args: unknown) => void,
  abortSignal: AbortSignal,
): Promise<void> {
  try {
    for await (const part of stream) {
      if (abortSignal.aborted) break;
      if (part.type === "tool-call") {
        onToolCall(part.toolName, part.args);
      }
    }
  } catch {
    // Stream was aborted or errored
  }
}

/**
 * Track streamed text from a text stream
 * @param stream - The text stream to track
 * @param abortSignal - Abort signal to respect
 * @returns The accumulated text
 */
export async function trackStreamedText(
  stream: AsyncIterable<string>,
  abortSignal: AbortSignal,
): Promise<string> {
  let streamedText = "";
  try {
    for await (const textPart of stream) {
      if (abortSignal.aborted) break;
      streamedText += textPart;
    }
  } catch {
    // Stream was aborted or errored
  }
  return streamedText;
}
