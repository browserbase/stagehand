import { ActHandlerParams } from "@/lib/v3/types";
import { captureHybridSnapshot } from "@/lib/v3/understudy/a11y/snapshot";
import fs from "fs";

export class ActHandler {
  async act(params: ActHandlerParams): Promise<void> {
    const { instruction, page } = params;
    console.log(`[ActHandler] instruction: ${instruction}`);
    console.log(`[ActHandler] frame ID: ${page.mainFrame().frameId}`);

    // 🔍 Build the hybrid snapshot
    const snapshot = await captureHybridSnapshot(page, {
      experimental: true,
      detectScrollable: true,
    });

    fs.writeFileSync(`snapshot.json`, JSON.stringify(snapshot, null, 2));
    fs.writeFileSync(`combinedtree.txt`, snapshot.combinedTree);

    // later: feed `snapshot` + instruction into the LLM prompt
  }
}
