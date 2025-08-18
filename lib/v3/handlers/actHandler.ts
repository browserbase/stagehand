import { ActHandlderParams } from "@/lib/v3/types";

export class ActHandler {
  async act(params: ActHandlderParams): Promise<void> {
    const { instruction, frameId } = params;
    console.log(`[ActHandler] instruction: ${instruction}`);
    if (frameId) {
      console.log(`[ActHandler] frameId: ${frameId}`);
    } else {
      console.log("[ActHandler] no frameId provided");
    }
  }
}
