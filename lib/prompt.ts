import OpenAI from 'openai';

const actSystemPrompt = `
You are a browser automation assistant.

You are given:
1. the user's overall goal
2. the steps that have been taken so far
3. a list of relevant DOM elements in this chunk to consider to accompish the goal

You have 2 tools that you can call: doAction, and skipSection
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
  steps = 'None',
  domElements: string
): OpenAI.ChatCompletionMessageParam {
  const actUserPrompt = `
    goal: ${action}, 
    steps so far: ${steps},
    elements: ${domElements}
    `;
  const content = actUserPrompt.replace(/\s+/g, ' ');

  console.log('prompt', content);
  return {
    role: 'user',
    content,
  };
}

export const actTools: Array<OpenAI.ChatCompletionTool> = [
  {
    type: 'function',
    function: {
      name: 'doAction',
      description:
        'execute the next playwright step that accomplishes the goal',
      parameters: {
        type: 'object',
        required: ['method', 'element', 'args', 'step', 'continue'],
        properties: {
          method: {
            type: 'string',
            description: 'The playwright function to call',
          },
          element: {
            type: 'number',
            description: 'The element number to act on',
          },
          args: {
            type: 'array',
            description: 'The required arguments',
            items: {
              type: 'string',
              description: 'The argument to pass to the function',
            },
          },
          step: {
            type: 'string',
            description: 'human readable description of the step that is taken',
          },
          why: {
            type: 'string',
            description:
              'why is this step taken? how does it advance the goal?',
          },
          continue: {
            type: 'boolean',
            description:
              'true if this step does not complete the goal and more work is required',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skipSection',
      description:
        'skips this area of the webpage because the current goal cannot be accomplished here',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'reason that no action is taken',
          },
        },
      },
    },
  },
];
