import { ExtractHandlerParams } from "@/lib/v3/types";

export class ExtractHandler {
  async extract(params: ExtractHandlerParams): Promise<void> {
    const { instruction, frameId } = params;
    console.log(`[ExtractHandler] instruction: ${instruction}`);
    if (frameId) {
      console.log(`[ExtractHandler] frameId: ${frameId}`);
    } else {
      console.log("[ExtractHandler] no frameId provided");
    }
  }
}
