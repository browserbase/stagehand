import { ObserveHandlderParams } from "@/lib/v3/types";

export class ObserveHandler {
  async observe(params: ObserveHandlderParams): Promise<void> {
    const { instruction, frameId } = params;
    console.log(`[ObserveHandler] instruction: ${instruction}`);
    if (frameId) {
      console.log(`[ObserveHandler] frameId: ${frameId}`);
    } else {
      console.log("[ObserveHandler] no frameId provided");
    }
  }
}
