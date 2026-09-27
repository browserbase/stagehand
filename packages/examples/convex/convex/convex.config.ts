import { defineApp } from "convex/server";
import stagehand from "@browserbasehq/convex-stagehand/convex.config";

const app = defineApp();
app.use(stagehand, { name: "stagehand" });

export default app;
