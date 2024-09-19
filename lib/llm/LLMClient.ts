export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
  }
  
  export interface ChatCompletionOptions {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    [key: string]: any; // Additional provider-specific options
  }
  
  export interface ExtractionOptions extends ChatCompletionOptions {
    response_model: {
      name: string;
      schema: any;
    }; // Schema for the structured output
  }
  
  export interface LLMClient {
    createChatCompletion(options: ChatCompletionOptions): Promise<{
      [key: string]: any; // Additional response properties
    }>;
  
    createExtraction(options: ExtractionOptions): Promise<any>;
  }