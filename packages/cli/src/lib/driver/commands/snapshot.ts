import { z } from "zod";

import { formatSnapshotTree } from "./snapshot-format.js";
import type { DriverCommandHandlers } from "./types.js";

export const snapshotHandlers: DriverCommandHandlers = {
  async snapshot(manager, params) {
    const { compact, filter, maxDepth } = z
      .object({
        compact: z.boolean().optional(),
        filter: z.string().optional(),
        maxDepth: z.number().int().nonnegative().optional(),
      })
      .parse(params);
    const page = await manager.activePage();
    const snapshot = await page.snapshot();
    manager.setRefMaps({
      urlMap: snapshot.urlMap ?? {},
      xpathMap: snapshot.xpathMap ?? {},
    });

    const tree = formatSnapshotTree(snapshot.formattedTree, {
      compact,
      filter,
      maxDepth,
    });
    if (compact) {
      return { tree };
    }

    return {
      tree,
      urlMap: snapshot.urlMap,
      xpathMap: snapshot.xpathMap,
    };
  },

  async refs(manager) {
    const refMaps = manager.getRefMaps();
    return {
      count: Object.keys(refMaps.xpathMap).length,
      urlMap: refMaps.urlMap,
      xpathMap: refMaps.xpathMap,
    };
  },
};
