// Source imports and repository tests use the Node-capable variant. Published consumers are routed
// to the Node or web artifact by the package export conditions.
export * from "./runtime/node/index.js";
