import type { ElementFacts } from "./actionFacts.js";
import { actionNodes, type ActionSnapshot } from "./actionPlans.js";
import { describeCandidate } from "./tree.js";
import type { OutlineNode } from "./outline.js";
import type { JsonValue } from "./client.js";
import { trimTrailingTextNode } from "../../utils.js";

export type ObservationSnapshot = ActionSnapshot;
export type ObservationCandidate = {
  node: OutlineNode;
  selector: string;
  fact: ElementFacts;
  evidence: Record<string, JsonValue>;
};
const INTERACTIVE =
  /\b(link|button|checkbox|radio|switch|tab|menuitem|menuitemcheckbox|menuitemradio|textbox|searchbox|combobox|spinbutton|textarea|select|listbox|input|inputtime|slider|treeitem|disclosuretriangle)\b/i;
const NATIVE_CONTROLS = new Set(["a", "button", "input", "select", "textarea"]);

export function observationView(snapshot: ObservationSnapshot) {
  const nodes = actionNodes(snapshot);
  const candidates: ObservationCandidate[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const fact = snapshot.facts[node.id];
    if (
      !INTERACTIVE.test(node.role) &&
      !node.editable &&
      !/\bheading\b/i.test(node.role) &&
      !NATIVE_CONTROLS.has(fact?.tag ?? "")
    )
      continue;
    const path = trimTrailingTextNode(snapshot.xpathMap[node.id]);
    if (!path || !fact) {
      // Native inputs expose browser-owned child controls that their host already represents.
      let parent = node.parent;
      while (parent !== undefined) {
        const ancestor = nodes[parent]!;
        const host = snapshot.facts[ancestor.id];
        if (host && ["input", "textarea", "select"].includes(host.tag)) break;
        parent = ancestor.parent;
      }
      if (parent === undefined) unresolved.push(node.id);
      continue;
    }
    if (!fact.visible || seen.has(path)) continue;
    seen.add(path);
    const full = describeCandidate(nodes, node);
    candidates.push({
      node,
      selector: `xpath=${path}`,
      fact,
      evidence: {
        ...full,
        role: node.role,
        name: node.name,
        ...(fact.context ? { context: fact.context } : {}),
        ...(fact.href ? { destination: fact.href, link_text: fact.text } : {}),
        ...(fact.title ? { title: fact.title } : {}),
        ...(fact.tag ? { tag: fact.tag } : {}),
        ...(node.parent !== undefined ? { parent_role: nodes[node.parent]!.role } : {}),
        enabled: fact.enabled,
        ...(fact.editable ? { editable: true } : {}),
        ...(fact.readonly ? { readonly: true } : {}),
      },
    });
  }
  return { candidates, unresolved, url: snapshot.url };
}

export function isInteractive(candidate: ObservationCandidate) {
  return (
    INTERACTIVE.test(candidate.node.role) ||
    Boolean(candidate.node.editable) ||
    NATIVE_CONTROLS.has(candidate.fact.tag)
  );
}

export function observationSignature(view: ReturnType<typeof observationView>): string {
  return JSON.stringify({
    url: view.url,
    unresolved: view.unresolved,
    candidates: view.candidates.map((c) => ({
      id: c.node.id,
      selector: c.selector,
      evidence: c.evidence,
      fact: c.fact,
    })),
  });
}

export function matchesObservationType(
  candidate: ObservationCandidate,
  targetType: string,
): boolean {
  switch (targetType) {
    case "text_link":
      return (
        (candidate.fact.tag === "a" || /\blink\b/i.test(candidate.node.role)) &&
        Boolean(candidate.fact.text.trim())
      );
    case "link":
      return candidate.fact.tag === "a" || /\blink\b/i.test(candidate.node.role);
    case "button":
      return candidate.fact.tag === "button" || /\bbutton\b/i.test(candidate.node.role);
    case "field":
      return (
        candidate.fact.editable ||
        Boolean(candidate.node.editable) ||
        ["input", "select", "textarea"].includes(candidate.fact.tag) ||
        /\b(textbox|searchbox|combobox|spinbutton|checkbox|radio|switch|slider|listbox)\b/i.test(
          candidate.node.role,
        )
      );
    case "heading":
      return /\bheading\b/i.test(candidate.node.role);
    default:
      return true;
  }
}
