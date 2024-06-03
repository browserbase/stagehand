import { actTools, buildActSystemPrompt, buildActUserPrompt } from './prompt';
import OpenAI from 'openai';

export async function act({
  action,
  domElements,
  steps,
  client,
}: {
  action: string;
  steps?: string;
  domElements: string;
  client: OpenAI;
}): Promise<{
  method: string;
  element: number;
  args: any[];
  completed: boolean;
  step: string;
  why?: string;
} | null> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      buildActSystemPrompt(),
      buildActUserPrompt(action, steps, domElements),
    ],
    temperature: 0.1,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    tool_choice: 'auto',
    tools: actTools,
  });

  const toolCalls = response.choices[0].message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    if (toolCalls[0].function.name === 'skipSection') {
      return null;
    }
    return JSON.parse(toolCalls[0].function.arguments);
  } else {
    throw new Error('No tool calls found in response');
  }
}
