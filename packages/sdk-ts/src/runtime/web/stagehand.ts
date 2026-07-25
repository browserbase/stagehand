import { StagehandCore } from "../../stagehand.js";
import { resolveBrowserSource } from "./browserSource.js";
import {
  StagehandClientInitParamsSchema,
  type StagehandClientInitParams,
} from "./clientSchemas.js";

export class Stagehand extends StagehandCore<StagehandClientInitParams> {
  constructor(initParams: StagehandClientInitParams) {
    super(initParams, StagehandClientInitParamsSchema.parse(initParams), {
      resolveBrowserSource,
    });
  }
}
