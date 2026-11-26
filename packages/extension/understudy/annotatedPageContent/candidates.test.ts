import { describe, expect, it, vi } from "vitest";
import type { Frame } from "../frame.js";
import type { Page } from "../page.js";
import { Progress } from "../progress.js";
import type { ContentNodeJson } from "./common_quality_data_pb.js";
import { control, controls, text } from "./fixtures/controls.js";
import { prepareAnnotatedPageContentQuery } from "./query.js";
import {
  actionForLocatorOperation,
  prepareAnnotatedPageContentCandidates,
  queryAnnotatedPageContentCandidates,
} from "./candidates.js";

describe("APC locator candidates", () => {
  it("maps action operations and leaves reads and intermediate queries unfiltered", () => {
    expect(
      (
        [
          "click",
          "sendClickEvent",
          "fill",
          "type",
          "selectOption",
          "setInputFiles",
          "hover",
          "scrollTo",
        ] as const
      ).map((operation) => actionForLocatorOperation(operation)),
    ).toEqual(["click", "click", "fill", "type", "select", "upload", "hover", "scroll"]);
    expect(actionForLocatorOperation("textContent")).toBeUndefined();
    expect(actionForLocatorOperation("count")).toBeUndefined();
    expect(actionForLocatorOperation()).toBeUndefined();
  });

  it("keeps labels, one choice per identity, and unresolved matches separate from no matches", () => {
    const frame = { frameId: "main" } as Frame;
    const query = prepareAnnotatedPageContentQuery(controls, ["fill", "select"]);
    const first = query.nodes[0]!;
    const target = { frame, backendNodeId: 42, id: "0-42" };
    const resolved = { ...first, id: target.id };
    const result = prepareAnnotatedPageContentCandidates({
      ...query,
      nodes: [resolved, resolved, query.nodes[1]!],
      targetsById: new Map([[target.id, target]]),
      unresolvedCount: 1,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.description).toContain("Email address");
    expect(result.targetsById.get(target.id)).toBe(target);
    expect(result.content).toBe("[0-42] " + result.candidates[0]!.description);
    expect(result.unresolvedCount).toBe(1);

    const unresolved = prepareAnnotatedPageContentCandidates(query);
    expect(unresolved.candidates).toEqual([]);
    expect(unresolved.unresolvedCount).toBe(2);
    const empty = prepareAnnotatedPageContentCandidates(
      prepareAnnotatedPageContentQuery({}, ["fill"]),
    );
    expect(empty.candidates).toEqual([]);
    expect(empty.unresolvedCount).toBe(0);
  });

  it("describes unfiltered text nodes and redacted controls without recovering their contents", () => {
    const frame = { frameId: "main" } as Frame;
    const paragraph = text("Account settings");
    const password = control("FORM_CONTROL_TYPE_INPUT_PASSWORD", "password", {
      redactionDecision: "REDACTION_DECISION_REDACTED_HAS_BEEN_PASSWORD",
      formControlData: { fieldValue: "secret", selectOptions: [{ text: "secret-option" }] },
    });
    const query = prepareAnnotatedPageContentQuery(
      { rootNode: { childrenNodes: [paragraph, password] } },
      [],
      undefined,
      new Map([
        [paragraph, { id: "0-1", frame, backendNodeId: 1 }],
        [password, { id: "0-2", frame, backendNodeId: 2 }],
      ]),
    );
    const result = prepareAnnotatedPageContentCandidates(query);
    expect(result.candidates.map((candidate) => candidate.description)).toEqual([
      'text: "Account settings"',
      'input_password [name="password"; redacted]',
    ]);
    expect(result.content).not.toContain("secret");
  });

  it("passes action and scope intent through one query and preserves its deadline", async () => {
    const frame = { frameId: "main" } as Frame;
    const query = prepareAnnotatedPageContentQuery({}, ["select"]);
    const prepare = vi.fn(async () => query);
    const page = { queryAnnotatedPageContent: prepare } as unknown as Page;
    const scopes = [{ type: "document" as const, frame }];
    const progress = new Progress("locate", 1000);
    try {
      const result = await queryAnnotatedPageContentCandidates(
        page,
        { operation: "selectOption", scopes },
        progress,
      );
      expect(prepare).toHaveBeenCalledExactlyOnceWith({ actions: ["select"], scopes }, progress);
      expect(result.limitations).toEqual(["select-option-disabled-state"]);
    } finally {
      progress.dispose();
    }
  });

  it("does not read DOM metadata from redacted upload candidates", async () => {
    const send = vi.fn();
    const frame = { frameId: "main", session: { send } } as unknown as Frame;
    const upload = control("FORM_CONTROL_TYPE_INPUT_FILE", "upload", {
      redactionDecision: "REDACTION_DECISION_REDACTED_HAS_BEEN_PASSWORD",
    });
    const query = prepareAnnotatedPageContentQuery(
      { rootNode: upload },
      ["upload"],
      undefined,
      new Map([[upload, { id: "0-1", frame, backendNodeId: 1 }]]),
    );
    const page = { queryAnnotatedPageContent: async () => query } as unknown as Page;
    const progress = new Progress("locate", 1000);
    try {
      const result = await queryAnnotatedPageContentCandidates(
        page,
        { operation: "setInputFiles" },
        progress,
      );
      expect(result.candidates[0]?.description).toContain("redacted");
      expect(result.limitations).toEqual(["hidden-file-inputs"]);
      expect(send).not.toHaveBeenCalled();
    } finally {
      progress.dispose();
    }
  });

  it("describes plain anchors as links with their path and numbers identical descriptions", () => {
    const frame = { frameId: "main" } as Frame;
    const link = (url: string): ContentNodeJson => ({
      contentAttributes: {
        attributeType: "CONTENT_ATTRIBUTE_ANCHOR",
        interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_CLICKABLE_CONTROL"] },
        anchorData: { url },
      },
      childrenNodes: [text("Details")],
    });
    const first = link("https://shop.test/orders/1?ref=a");
    const second = link("https://shop.test/orders/2");
    const box = (name: string) => control("FORM_CONTROL_TYPE_INPUT_CHECKBOX", name);
    const boxes = [box("opt"), box("opt")];
    const nodes = [first, second, ...boxes];
    const query = prepareAnnotatedPageContentQuery(
      { rootNode: { childrenNodes: nodes } },
      ["click"],
      undefined,
      new Map(
        nodes.map((node, index) => [node, { id: `0-${index}`, frame, backendNodeId: index }]),
      ),
    );
    const descriptions = prepareAnnotatedPageContentCandidates(query).candidates.map(
      (candidate) => candidate.description,
    );
    expect(descriptions.slice(0, 2)).toEqual([
      'link: "Details" [href="/orders/1"]',
      'link: "Details" [href="/orders/2"]',
    ]);
    expect(descriptions[2]).toBe(descriptions[3]);
  });

  it("names unlabeled action candidates from the accessibility tree and numbers twins", async () => {
    const send = vi.fn(async (method: string, params: { backendNodeId?: number }) => {
      if (method === "Accessibility.getPartialAXTree") {
        const name = params.backendNodeId === 1 ? "Subscribe to news" : "";
        return {
          nodes: [
            {
              backendDOMNodeId: params.backendNodeId,
              role: { value: "checkbox" },
              name: { value: name },
            },
          ],
        };
      }
      if (method === "DOM.resolveNode") return { object: { objectId: "box" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: "" } };
      return {};
    });
    const frame = { frameId: "main", session: { send } } as unknown as Frame;
    const boxes = [1, 2, 3].map(() => control("FORM_CONTROL_TYPE_INPUT_CHECKBOX", "opt"));
    const query = prepareAnnotatedPageContentQuery(
      { rootNode: { childrenNodes: boxes } },
      ["click"],
      undefined,
      new Map(
        boxes.map((node, index) => [
          node,
          { id: `0-${index + 1}`, frame, backendNodeId: index + 1 },
        ]),
      ),
    );
    const page = { queryAnnotatedPageContent: async () => query } as unknown as Page;
    const progress = new Progress("locate", 1000);
    try {
      const result = await queryAnnotatedPageContentCandidates(
        page,
        { operation: "click" },
        progress,
      );
      expect(result.candidates.map((candidate) => candidate.description)).toEqual([
        'input_checkbox: "Subscribe to news"',
        'input_checkbox [name="opt"] [1 of 2]',
        'input_checkbox [name="opt"] [2 of 2]',
      ]);
      expect(result.content).toContain('[0-1] input_checkbox: "Subscribe to news"');
      expect(send).toHaveBeenCalledWith("Runtime.releaseObject", { objectId: "box" });
    } finally {
      progress.dispose();
    }
  });

  it("uses the accessibility role when APC reports an unspecified control type", async () => {
    const send = vi.fn(async (method: string, params: { backendNodeId?: number }) =>
      method === "Accessibility.getPartialAXTree"
        ? {
            nodes: [
              {
                backendDOMNodeId: params.backendNodeId,
                role: { value: "switch" },
                name: { value: "Dark mode" },
              },
            ],
          }
        : {},
    );
    const frame = { frameId: "main", session: { send } } as unknown as Frame;
    const toggle = control("FORM_CONTROL_TYPE_UNSPECIFIED", "", {
      interactionInfo: { clickabilityReasons: ["CLICKABILITY_REASON_CLICK_HANDLER"] },
    });
    const query = prepareAnnotatedPageContentQuery(
      { rootNode: { childrenNodes: [toggle] } },
      ["click"],
      undefined,
      new Map([[toggle, { id: "0-1", frame, backendNodeId: 1 }]]),
    );
    const page = { queryAnnotatedPageContent: async () => query } as unknown as Page;
    const progress = new Progress("locate", 1000);
    try {
      const result = await queryAnnotatedPageContentCandidates(
        page,
        { operation: "click" },
        progress,
      );
      expect(result.candidates.map((candidate) => candidate.description)).toEqual([
        'switch: "Dark mode"',
      ]);
    } finally {
      progress.dispose();
    }
  });

  it("stops reading nearby text once the deadline passes", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "Accessibility.getPartialAXTree") {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { nodes: [] };
      }
      return {};
    });
    const frame = { frameId: "main", session: { send } } as unknown as Frame;
    const box = control("FORM_CONTROL_TYPE_INPUT_CHECKBOX", "opt");
    const query = prepareAnnotatedPageContentQuery(
      { rootNode: { childrenNodes: [box] } },
      ["click"],
      undefined,
      new Map([[box, { id: "0-1", frame, backendNodeId: 1 }]]),
    );
    const page = { queryAnnotatedPageContent: async () => query } as unknown as Page;
    const progress = new Progress("locate", 10);
    try {
      await expect(
        queryAnnotatedPageContentCandidates(page, { operation: "click" }, progress),
      ).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(send.mock.calls.map(([method]) => method)).toEqual(["Accessibility.getPartialAXTree"]);
    } finally {
      progress.dispose();
    }
  });
});
