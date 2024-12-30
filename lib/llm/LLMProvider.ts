import type { LogLine } from "../../types/log";
import type { ClientOptions } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import type { LLMClient } from "./LLMClient";

type LLMClientConstructor = new (
  logger: (message: LogLine) => void, 
	enableCaching: boolean,
	cache: LLMCache | undefined,
	modelName: string,
	options?: ClientOptions,
) => LLMClient;

export class LLMProvider {
	private logger: (message: LogLine) => void;
	private enableCaching: boolean;
	private cache: LLMCache | undefined;
	private llmClient: LLMClientConstructor;

	constructor({
		logger,
		enableCaching,
		llmClient,
	}: {
		logger?: (message: LogLine) => void,
		enableCaching: boolean,
		llmClient: LLMClientConstructor,
	}) {
		this.logger = logger || ((message: LogLine) =>
      console.log(`[stagehand::${message.category}] ${message.message}`)
    );
		this.enableCaching = enableCaching;
		this.cache = enableCaching ? new LLMCache(this.logger) : undefined;
		this.llmClient = llmClient;
	}

	cleanRequestCache(requestId: string): void {
		if (!this.enableCaching) {
			return;
		}

		this.logger({
			category: "llm_cache",
			message: "cleaning up cache",
			level: 1,
			auxiliary: {
				requestId: {
					value: requestId,
					type: "string",
				},
			},
		});
		this.cache.deleteCacheForRequestId(requestId);
	}

	getClient(modelName: string, clientOptions?: ClientOptions): LLMClient {
		return new this.llmClient(
      this.logger,
			this.enableCaching,
			this.cache,
			modelName,
			clientOptions,
		);
	}
}