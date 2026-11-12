import { describe, expect, it, vi } from "vitest";
import type { Frame } from "../frame.js";
import type { Page } from "../page.js";
import { Progress } from "../progress.js";
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
});
