import { BrowserContext } from "./browserContext.js";
import {
  buildStagehandProtocolRequest,
  parseStagehandProtocolResponse,
  type StagehandProtocolClient,
} from "./protocolClient.js";

export type StagehandOptions = {
  client: StagehandProtocolClient;
};

export class Stagehand {
  readonly context: BrowserContext;
  #initialized = false;

  constructor(private readonly options: StagehandOptions) {
    this.context = new BrowserContext(options.client);
  }

  get initialized(): boolean {
    return this.#initialized;
  }

  async init(): Promise<void> {
    this.#initialized = true;
  }

  async close(): Promise<void> {
    const request = buildStagehandProtocolRequest("stagehand.close", {});
    const response = await this.options.client.send(request);
    parseStagehandProtocolResponse(request.method, response);
    this.#initialized = false;
  }
}
