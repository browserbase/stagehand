import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Protocol } from "devtools-protocol";
import { WebSocketServer, type WebSocket as ServerWebSocket } from "ws";

import { V3Context } from "../../lib/v3/understudy/context.js";
import type { Page } from "../../lib/v3/understudy/page.js";

type FakeTarget = {
  targetId: string;
  sessionId: string;
  frameId: string;
  url: string;
  parent?: FakeTarget;
};

type CdpRequest = { id: number; method: string; sessionId?: string };

const page: FakeTarget = {
  targetId: "page-target",
  sessionId: "page-session",
  frameId: "main-frame",
  url: "https://app.example.com/",
};
const editor: FakeTarget = {
  targetId: "editor-target",
  sessionId: "editor-session",
  frameId: "editor-frame",
  url: "https://editor.example.net/",
  parent: page,
};
const nestedEditor: FakeTarget = {
  targetId: "nested-target",
  sessionId: "nested-session",
  frameId: "nested-frame",
  url: "https://widget.example.org/",
  parent: editor,
};

function frame(target: FakeTarget): Protocol.Page.Frame {
  return {
    id: target.frameId,
    parentId: target.parent?.frameId,
    loaderId: `${target.frameId}-loader`,
    url: target.url,
    domainAndRegistry: "",
    securityOrigin: new URL(target.url).origin,
    mimeType: "text/html",
    secureContextType: "Secure",
    crossOriginIsolatedContextType: "NotIsolated",
    gatedAPIFeatures: [],
  };
}

function targetInfo(target: FakeTarget): Protocol.Target.TargetInfo {
  return {
    targetId: target.targetId,
    type: target.parent ? "iframe" : "page",
    title: "",
    url: target.url,
    attached: true,
    canAccessOpener: false,
  };
}

/**
 * Scripted browser whose cross-origin iframes already exist: they are
 * reported via auto-attach, but no parent `Page.frameAttached` ever fires and
 * the parent's `Page.getFrameTree` omits them.
 */
class FakeBrowser {
  readonly wss = new WebSocketServer({ port: 0 });
  readonly frameTreeGates = new Map<string, Promise<void>>();
  private readonly frameTreeServed = new Map<string, () => void>();
  private readonly frameTreeServedPromises = new Map<string, Promise<void>>();
  private socket: ServerWebSocket | undefined;

  constructor(private readonly targets: FakeTarget[]) {
    for (const t of targets) {
      this.frameTreeServedPromises.set(
        t.sessionId,
        new Promise((resolve) =>
          this.frameTreeServed.set(t.sessionId, resolve),
        ),
      );
    }
    this.wss.on("connection", (socket) => {
      this.socket = socket;
      socket.on("message", (raw) => {
        void this.respond(JSON.parse(raw.toString()) as CdpRequest);
      });
    });
  }

  get url(): string {
    return `ws://localhost:${(this.wss.address() as AddressInfo).port}`;
  }

  frameTreeServedFor(target: FakeTarget): Promise<void> {
    return this.frameTreeServedPromises.get(target.sessionId)!;
  }

  emit(method: string, params: object, sessionId?: string): void {
    this.socket?.send(JSON.stringify({ method, params, sessionId }));
  }

  async close(): Promise<void> {
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private async respond({ id, method, sessionId }: CdpRequest): Promise<void> {
    const reply = (result: object = {}) =>
      this.socket?.send(JSON.stringify({ id, result, sessionId }));

    if (method === "Target.getTargets") {
      reply({ targetInfos: this.targets.map(targetInfo) });
      return;
    }

    if (method === "Page.getFrameTree") {
      const target = this.targets.find((t) => t.sessionId === sessionId)!;
      await this.frameTreeGates.get(target.sessionId);
      reply({ frameTree: { frame: frame(target) } });
      this.frameTreeServed.get(target.sessionId)!();
      return;
    }

    reply();
    if (method !== "Target.setAutoAttach") return;
    for (const child of this.targets) {
      if (child.parent?.sessionId !== sessionId) continue;
      this.emit(
        "Target.attachedToTarget",
        {
          sessionId: child.sessionId,
          targetInfo: targetInfo(child),
          waitingForDebugger: true,
        },
        sessionId,
      );
    }
  }
}

async function expectOwnedByOwnSession(
  owner: Page,
  target: FakeTarget,
): Promise<void> {
  await vi.waitFor(() => {
    expect(owner.listAllFrameIds()).toContain(target.frameId);
    expect(owner.getSessionForFrame(target.frameId).id).toBe(target.sessionId);
  });
}

describe("V3Context OOPIF adoption", () => {
  let browser: FakeBrowser | undefined;
  let ctx: V3Context | undefined;

  afterEach(async () => {
    await ctx?.close();
    await browser?.close();
    ctx = undefined;
    browser = undefined;
  });

  async function connect(fake: FakeBrowser): Promise<Page> {
    browser = fake;
    ctx = await V3Context.create(fake.url);
    expect(ctx.pages()).toHaveLength(1);
    return ctx.pages()[0];
  }

  it("adopts a cross-origin iframe that already existed before connecting", async () => {
    const fake = new FakeBrowser([page, editor]);
    let releaseEditor!: () => void;
    fake.frameTreeGates.set(
      editor.sessionId,
      new Promise((resolve) => (releaseEditor = resolve)),
    );

    const owner = await connect(fake);
    releaseEditor();

    await expectOwnedByOwnSession(owner, editor);
  });

  it("adopts an iframe that attaches before its parent page registers", async () => {
    const fake = new FakeBrowser([page, editor]);
    fake.frameTreeGates.set(
      page.sessionId,
      fake
        .frameTreeServedFor(editor)
        .then(() => new Promise((resolve) => setTimeout(resolve, 50))),
    );

    const owner = await connect(fake);

    await expectOwnedByOwnSession(owner, editor);
  });

  it("adopts an OOPIF nested inside another OOPIF", async () => {
    const owner = await connect(new FakeBrowser([page, editor, nestedEditor]));

    await expectOwnedByOwnSession(owner, editor);
    await expectOwnedByOwnSession(owner, nestedEditor);
  });

  it("keeps the iframe session as owner when the parent reports the frame late", async () => {
    const fake = new FakeBrowser([page, editor]);
    const owner = await connect(fake);
    await expectOwnedByOwnSession(owner, editor);

    fake.emit(
      "Page.frameAttached",
      { frameId: editor.frameId, parentFrameId: page.frameId },
      page.sessionId,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(owner.getSessionForFrame(editor.frameId).id).toBe(editor.sessionId);
  });
});
