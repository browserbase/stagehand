import type { HybridSnapshot } from "../../types/private/snapshot.js";
import type { JsonSchema } from "./extractionSchema.js";
import { parseOutline } from "./outline.js";

export type DestinationRequest = {
  field: string;
  target: string;
  matchBy: "literal" | "name" | "description";
  quoted: boolean;
  conditional: boolean;
  representation: "absolute" | "relative" | "raw";
  optional: boolean;
};

const destination =
  /^(?:copy|extract|give(?: me)?|return|what is) (?:the )?(?:exact )?(?:(absolute|resolved|relative|raw) )?((?:link )?(?:destination(?: address| URL)?|URL|href|address)) (of|for|behind|from) (?:the )?(.+?)[.?]?$/iu;

export function requestedDestination(
  instruction: string,
  schema: JsonSchema,
): DestinationRequest | undefined {
  if (!schema || schema.type !== "object" || !schema.properties) return;
  const fields = Object.entries(schema.properties);
  if (fields.length !== 1) return;
  const [field, property] = fields[0]!;
  if (
    property?.type !== "string" ||
    Object.keys(property).some((key) => key !== "type" && key !== "format") ||
    (property.format && property.format !== "uri") ||
    schema.required?.some((key) => key !== field) ||
    Object.keys(schema).some(
      (key) => !["$schema", "type", "properties", "required", "additionalProperties"].includes(key),
    )
  )
    return;

  let prompt = instruction.trim();
  const output = /\. Return the result in (\w+)\.$/iu.exec(prompt);
  if (output) {
    if (output[1] !== field) return;
    prompt = prompt.slice(0, output.index + 1);
  }
  // Let inference interpret conditions. An exact label alone cannot determine their result.
  const conditional = /[.?!]\s+if\b/iu.exec(prompt);
  if (conditional) prompt = prompt.slice(0, conditional.index + 1);
  const question =
    /^(?:where does (the .+?) (?:lead|point to)\?(?: copy the (?:address|URL)\.?)?|what (?:address|URL) does (the .+?) point to\?)$/iu.exec(
      prompt,
    );
  const match = destination.exec(
    question ? `Return the URL of ${question[1] ?? question[2]}` : prompt,
  );
  if (!match) return;
  const [, form, kind = "", relation = "", subject = ""] = match;
  const named =
    /^(?:link|anchor) (?:named|labeled|labelled|to) (.+)$/iu.exec(subject)?.[1] ??
    /^(.+?) (?:link|hyperlink|anchor)\??$/iu.exec(subject)?.[1];
  if (
    !named &&
    !/link destination/iu.test(kind) &&
    !(kind.toLowerCase() === "url" && relation.toLowerCase() === "behind")
  )
    return;
  const label = (named ?? subject).trim();
  const pairs: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’" };
  const closing = pairs[label.charAt(0)];
  if (closing && (!label.endsWith(closing) || label.length < 3)) return;
  if (!closing && /[“”‘"]|^[’]|[’']$/u.test(label)) return;
  // Multiple quoted phrases may describe alternatives rather than one literal label.
  if (
    closing &&
    label
      .slice(1, -1)
      .replace(/(?<=\p{L})['’](?=\p{L})/gu, "")
      .includes(closing)
  )
    return;
  const target = (closing ? label.slice(1, -1) : label).replace(/\s+/gu, " ").trim();
  if (
    !target ||
    target.length > 180 ||
    /[;\n]|[.!?]\s|\b(?:instead|rather than|but|except|if)\b/iu.test(target)
  )
    return;
  const literal =
    named !== undefined && (closing || /^(?:link|anchor) (?:named|labell?ed) /iu.test(subject));
  const modifier = form?.toLowerCase();
  let representation: DestinationRequest["representation"] = "absolute";
  if (modifier === "relative") representation = "relative";
  if (modifier === "raw" || (!modifier && /href$/iu.test(kind))) representation = "raw";
  if (representation !== "absolute" && property.format) return;
  return {
    field,
    target,
    matchBy: literal ? "literal" : named ? "name" : "description",
    quoted: Boolean(closing),
    conditional: Boolean(conditional),
    representation,
    optional: !schema.required?.includes(field),
  };
}

type Anchor = { xpath: string; name: string; href: string; raw: string };

// Serialized into the page. Re-enumerate visible anchors to catch changed labels or hrefs,
// and read the authored attribute, which the accessibility tree has already resolved.
export function readAnchorDestinations(pattern: string): Anchor[] | undefined {
  if (document.readyState === "loading" || document.querySelector("frame,iframe,object,embed"))
    return;
  if (document.links.length > 4096) return;
  const label = new RegExp(pattern, "iu");
  const matches: Anchor[] = [];
  for (const anchor of document.links) {
    if (!(anchor instanceof HTMLAnchorElement)) continue;
    const name = (anchor.getAttribute("aria-label") || anchor.innerText)
      .replace(/\s+/gu, " ")
      .trim();
    if (
      !label.test(name) ||
      !anchor.getClientRects().length ||
      anchor.closest('[hidden],[inert],[aria-hidden="true" i]') ||
      !anchor.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      })
    )
      continue;
    // Snapshot paths index each element among siblings with the same tag.
    const steps: string[] = [];
    for (let node: Element | null = anchor; node; node = node.parentElement) {
      let index = 1;
      for (
        let sibling = node.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      )
        if (sibling.tagName === node.tagName) index++;
      steps.push(`${node.tagName.toLowerCase()}[${index}]`);
    }
    matches.push({
      xpath: "/" + steps.reverse().join("/"),
      name,
      href: anchor.href,
      raw: anchor.getAttribute("href") ?? "",
    });
    if (matches.length > 32) return;
  }
  return matches;
}

export async function extractLinkDestination(
  request: DestinationRequest,
  snapshot: HybridSnapshot,
  read: (pattern: string) => Promise<unknown>,
): Promise<{ data: Record<string, string> } | { evidence: string | undefined }> {
  if (snapshot.perFrame?.length !== 1) throw new Error("unsupported link scope");
  const links = parseOutline(snapshot.combinedTree)
    .filter((node) => node.role === "link")
    .map((node) => ({ id: node.id, name: node.name.replace(/\s+/gu, " ").trim() }));
  const select = (source: string) => {
    const pattern = new RegExp(source, "iu");
    return links.filter((link) => pattern.test(link.name));
  };
  const escaped = request.target.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  let source = `^${escaped}$`;
  let matches = select(source);
  const exact = request.matchBy === "literal" || (request.matchBy === "name" && matches.length > 0);
  if (!exact) {
    // Shared words retrieve options for inference. They cannot establish a direct answer.
    const words = request.target.match(/[\p{L}\d]{3,}/gu);
    if (!words?.length) throw new Error("no searchable link description");
    // A named link can include extra words, but dropping a qualifier can select another target.
    const terms = request.matchBy === "name" ? escaped : words.join("|");
    source = `(?<![\\p{L}\\d])(?:${terms})(?![\\p{L}\\d])`;
    matches = select(source);
  }
  if (matches.length > 32) throw new Error("too many matching links");
  const expected = matches
    .map((node) =>
      JSON.stringify([
        snapshot.combinedXpathMap[node.id],
        node.name,
        snapshot.combinedUrlMap[node.id],
      ]),
    )
    .sort();
  const live = (await read(source)) as Anchor[] | undefined;
  if (
    !Array.isArray(live) ||
    live.length !== matches.length ||
    live.some((link) => !link.raw.trim() || !/^https?:\/\//iu.test(link.href)) ||
    live
      .map((link) => JSON.stringify([link.xpath, link.name, link.href]))
      .sort()
      .some((key, i) => key !== expected[i])
  )
    throw new Error("inconsistent link evidence");

  if (
    !request.conditional &&
    request.optional &&
    request.matchBy === "literal" &&
    request.quoted &&
    !live.length
  )
    return { data: {} };
  if (exact && !request.conditional) {
    const values = new Set(
      live.map((link) => (request.representation === "absolute" ? link.href : link.raw)),
    );
    const destinations = new Set(live.map((link) => link.href));
    const [value] = values;
    if (
      destinations.size === 1 &&
      values.size === 1 &&
      value &&
      (request.representation !== "relative" || !/^[a-z][a-z\d+.-]*:/iu.test(value.trim()))
    )
      return { data: { [request.field]: value } };
    if (request.optional && (values.size > 1 || destinations.size > 1)) return { data: {} };
  }
  // An empty name search cannot rule out a semantic match elsewhere on the page.
  // Let ordinary extraction choose a snapshot ID for the resolved URL in that case.
  if (!live.length && !request.quoted && request.representation === "absolute")
    return { evidence: undefined };
  const evidence = JSON.stringify({
    pattern: source,
    match: exact ? "full label" : "possible labels matching the search pattern",
    anchors: live.map(({ name, href, raw }) => ({ label: name, resolvedUrl: href, href: raw })),
  });
  if (evidence.length > 8192) throw new Error("link evidence too large");
  return { evidence };
}
