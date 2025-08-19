import { ActHandlerParams } from "@/lib/v3/types";

export class ActHandler {
  async act(params: ActHandlerParams): Promise<void> {
    const { instruction, page } = params;
    console.log(`[ActHandler] instruction: ${instruction}`);
    console.log(`[ActHandler] frame ID: ${page.mainFrame().frameId}`);
  }
}
