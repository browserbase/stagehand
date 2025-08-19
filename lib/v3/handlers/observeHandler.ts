import { ObserveHandlerParams } from "@/lib/v3/types";

export class ObserveHandler {
  async observe(params: ObserveHandlerParams): Promise<void> {
    const { instruction, page } = params;
    console.log(`[ObserveHandler] instruction: ${instruction}`);
    console.log(`[ObserveHandler] main frame ID: ${page.mainFrame().frameId}`);
  }
}
