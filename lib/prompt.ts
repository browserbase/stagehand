import OpenAI from 'openai';

const actSystemPrompt = `
You are helping the user automate browser by finding one or more actions to take.

you will be given a numbered list of relevant DOM elements to consider and an action to accomplish. for each action required to complete the goal, follow this format in raw JSON, no markdown

[{
    method: string (the required playwright function to call)
     element: number (the element number to act on), args: Array<string | number> (the required arguments)
}]
`;

export function buildActSystemPrompt(): OpenAI.ChatCompletionMessageParam {
  const content = actSystemPrompt.replace(/\s+/g, ' ');
  return {
    role: 'system',
    content,
  };
}

export function buildActUserPrompt(
  action: string,
  domElements: string
): OpenAI.ChatCompletionMessageParam {
  return {
    role: 'user',
    content: `action: ${action}, DOM: ${domElements}`,
  };
}
