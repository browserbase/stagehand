import { DefaultExtractDataSchema } from "@browserbasehq/stagehand-protocol/schemas";
import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  Action,
  ActResult,
  DefaultExtractData,
  ObserveResult,
} from "@browserbasehq/stagehand-protocol/types";
import { z } from "zod/v4";
import { serializeClientLocatorOptions } from "./clientLocatorOptions.js";
import {
  StagehandClientActOptionsSchema,
  StagehandClientExtractOptionsSchema,
  StagehandClientObserveOptionsSchema,
  type StagehandClientActOptions,
  type StagehandClientExtractOptions,
  type StagehandClientObserveOptions,
} from "./clientSchemas.js";
import type { Page } from "./page.js";
import type { RPCClient } from "./rpcClient.js";
import type { ExtractResult } from "./stagehand.js";
import { isZodSchema } from "./zodSchema.js";

/** What the namespace needs from its Stagehand: a live RPC client and the page to work on. */
export type ExperimentalDecisionsHost = {
  rpcClient(): RPCClient;
  activePage(): Promise<Page | undefined>;
};

/**
 * `stagehand.experimentalDecisions`: act, observe and extract resolved by a
 * decision model (typed questions answered with probabilities, a few hundred
 * milliseconds each) instead of an LLM call, falling back to the LLM when the
 * model is not confident. Same arguments and results as the methods on
 * `Stagehand`; requires `experimentalDecisions` in `Stagehand.create()`.
 *
 * Experimental: the surface and its behaviour may change between releases.
 */
export class ExperimentalDecisions {
  constructor(private readonly host: ExperimentalDecisionsHost) {}

  async act(instruction: string, options?: StagehandClientActOptions): Promise<ActResult>;
  async act(instruction: Action, options?: StagehandClientActOptions): Promise<ActResult>;
  async act(instruction: string | Action, options?: StagehandClientActOptions): Promise<ActResult> {
    const { page, ...clientOptions } = StagehandClientActOptionsSchema.parse(options ?? {});
    const targetPage = page ?? (await this.host.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const protocolOptions = serializeClientLocatorOptions("act", targetPage.pageId, clientOptions);
    return await this.host.rpcClient().send(StagehandMethods.stagehandExperimentalDecisionsAct, {
      pageId: targetPage.pageId,
      instruction,
      ...(options === undefined ? {} : { options: protocolOptions }),
    });
  }

  async observe(
    instruction?: string,
    options?: StagehandClientObserveOptions,
  ): Promise<ObserveResult> {
    const { page, ...clientOptions } = StagehandClientObserveOptionsSchema.parse(options ?? {});
    const targetPage = page ?? (await this.host.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const protocolOptions = serializeClientLocatorOptions(
      "observe",
      targetPage.pageId,
      clientOptions,
    );
    return await this.host
      .rpcClient()
      .send(StagehandMethods.stagehandExperimentalDecisionsObserve, {
        pageId: targetPage.pageId,
        ...(instruction === undefined ? {} : { instruction }),
        ...(options === undefined ? {} : { options: protocolOptions }),
      });
  }

  async extract(
    instruction: string,
    options?: StagehandClientExtractOptions,
  ): Promise<ExtractResult<z.ZodType<DefaultExtractData>>>;
  async extract<Schema extends z.ZodType>(
    instruction: string,
    schema: Schema,
    options?: StagehandClientExtractOptions,
  ): Promise<ExtractResult<Schema>>;
  async extract<Schema extends z.ZodType | StagehandClientExtractOptions>(
    instruction: string,
    schema?: Schema,
    options?: StagehandClientExtractOptions,
  ): Promise<ExtractResult<z.ZodType>> {
    const hasCustomSchema = isZodSchema(schema);
    const resolvedSchema = hasCustomSchema ? schema : DefaultExtractDataSchema;
    const resolvedOptions = hasCustomSchema ? options : schema;
    const { page, ...clientOptions } = StagehandClientExtractOptionsSchema.parse(
      resolvedOptions ?? {},
    );
    const targetPage = page ?? (await this.host.activePage());
    if (!targetPage) throw new Error("Stagehand has no active page.");
    const protocolOptions = serializeClientLocatorOptions(
      "extract",
      targetPage.pageId,
      clientOptions,
    );
    const response = await this.host
      .rpcClient()
      .send(StagehandMethods.stagehandExperimentalDecisionsExtract, {
        pageId: targetPage.pageId,
        instruction,
        ...(hasCustomSchema ? { schema: z.json().parse(z.toJSONSchema(resolvedSchema)) } : {}),
        ...(resolvedOptions === undefined ? {} : { options: protocolOptions }),
      });

    return {
      ...response,
      data: resolvedSchema.parse(response.data),
    };
  }
}
