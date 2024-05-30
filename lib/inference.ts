import { buildActSystemPrompt, buildActUserPrompt } from './prompt';
import OpenAI from 'openai';

export async function act({
  action,
  domElements,
  client,
}: {
  action: string;
  domElements: string;
  client: OpenAI;
}): Promise<Array<{ method: string; element: number; args: any[] }>> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [buildActSystemPrompt(), buildActUserPrompt(action, domElements)],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  if (!response.choices[0].message.content) {
    throw new Error('no response from action model');
  }

  return JSON.parse(response.choices[0].message.content);
}
