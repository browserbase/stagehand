/**
 * A data view of an accessibility outline: repeated record groups with
 * aligned slots, and labelled facts. Stagehand builds it deterministically, so
 * a decision model only has to map schema fields onto slots or facts.
 */
import type { OutlineNode } from "./outline.js";
import { collectFacts } from "./evidence/facts.js";
import { indexOutline } from "./evidence/outlineIndex.js";
import { collectRecords } from "./evidence/records.js";
import { readSlot } from "./evidence/slots.js";

export { clip, readSlot, recordText } from "./evidence/slots.js";

export type Slot = {
  key: string;
  label?: string;
  /** Share of records that have this slot. */
  coverage: number;
  samples: string[];
  link: boolean;
  urlSamples: string[];
};

export type Group = {
  id: string;
  role: string;
  records: OutlineNode[];
  /** Short text that precedes each record outside it, e.g. a category row or section heading. */
  context: string[];
  sections: string[];
  slots: Slot[];
};

export type Fact = {
  id: string;
  node: OutlineNode;
  value: string;
  label: string;
  url?: string;
  /** Inside navigation, banner, footer or a form control's option list. */
  chrome: boolean;
};

export type DataView = {
  /** Joined text of unnamed nodes made only of inline pieces, by node index. */
  runs: Map<number, string>;
  numericNodes: Map<number, OutlineNode>;
  /** Rows that continue a record drawn over several sibling rows, by record index. */
  followers: Map<number, OutlineNode[]>;
  nodes: OutlineNode[];
  children: number[][];
  groups: Group[];
  facts: Fact[];
  urlMap: Record<string, string>;
};

export function buildDataView(tree: string, urlMap: Record<string, string>): DataView {
  const index = indexOutline(tree);
  const { runs, numericNodes, nodes, children } = index;
  const { groups, followers } = collectRecords(index, urlMap);
  const facts = collectFacts(index, urlMap);
  const view = { runs, numericNodes, followers, nodes, children, groups, facts, urlMap };
  for (const group of groups.filter((candidate) => candidate.id.startsWith("scope-"))) {
    group.slots = group.slots.map((slot) => {
      const values = group.records
        .map((record) => readSlot(view, record, slot.key))
        .filter((node) => node !== undefined);
      return {
        ...slot,
        coverage: values.length / group.records.length,
        samples: values.slice(0, 3).map((node) => node.name),
        urlSamples: values
          .flatMap((node) => (urlMap[node.id] ? [urlMap[node.id]!] : []))
          .slice(0, 3),
      };
    });
  }
  return view;
}
