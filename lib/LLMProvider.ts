import OpenAI from "openai";
import Instructor, { type InstructorClient } from "@instructor-ai/instructor";

export class LLMProvider {
  private openai: OpenAI;
  private instructor: InstructorClient<OpenAI>;

  constructor() {
    this.openai = new OpenAI();
    this.instructor = Instructor({
      client: this.openai,
      mode: "TOOLS",
    });
  }

  getOpenAIClient(): OpenAI {
    return this.openai;
  }

  getInstructorClient(): InstructorClient<OpenAI> {
    return this.instructor;
  }
}