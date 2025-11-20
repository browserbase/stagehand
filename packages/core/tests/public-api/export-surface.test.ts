import StagehandDefaultExport, * as Stagehand from "../../dist/index.js";
import { runExportSurfaceSuite } from "../../../../tests/shared/exportSurfaceSuite";

runExportSurfaceSuite(
  "Stagehand public API export surface",
  Stagehand,
  StagehandDefaultExport,
);
