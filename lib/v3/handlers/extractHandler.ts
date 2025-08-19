import { ExtractHandlerParams } from "@/lib/v3/types";

export class ExtractHandler {
  async extract(params: ExtractHandlerParams): Promise<void> {
    const { instruction, page } = params;
    console.log(`[ExtractHandler] instruction: ${instruction}`);
    console.log(`[ExtractHandler] frame ID: ${page.mainFrame().frameId}`);
  }
}
