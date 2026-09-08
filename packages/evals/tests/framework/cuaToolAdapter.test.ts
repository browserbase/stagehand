import { GeminiCuaExecutor } from "@browserbasehq/stagehand-integrations-gemini-cua-sdk";
import { StagehandCuaExecutor } from "@browserbasehq/stagehand-integrations-claude-cua-sdk";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bridgeCuaFacadeTools,
  captureCuaEvidence,
  cuaCleanup,
  CuaFacadeSessionLostError,
  type FacadeToolCaller,
} from "../../framework/cuaToolAdapter.js";
import {
  StagehandFacadeBridgeError,
  startStagehandFacadeBridge,
} from "../../core/tools/stagehandFacadeBridge.js";

afterEach(() => vi.useRealTimers());

describe("shared CUA facade boundary", () => {
  it("decodes values and explicit errors without inventing successful action results", async () => {
    const call = vi.fn<FacadeToolCaller>();
    const tools = bridgeCuaFacadeTools(call, 123);
    call.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"type":"value","value":42}' }],
    });
    expect(await tools.run("return 42")).toBe(42);
    expect(call).toHaveBeenLastCalledWith(
      "run",
      { code: expect.stringContaining("return 42") },
      { timeoutMs: 123 },
    );
    call.mockResolvedValueOnce({ content: [{ type: "text", text: "{}" }] });
    await expect(tools.runActions([{ op: "click", id: "0-1" }])).rejects.toThrow("invalid result");
    call.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "target missing" }],
    });
    await expect(tools.run("x")).rejects.toMatchObject({
      name: "StagehandFacadeBridgeError",
      message: "Facade run tool failed.",
    });
    call.mockResolvedValueOnce({ content: [{ type: "text", text: "no screenshot" }] });
    await expect(tools.screenshot()).rejects.toMatchObject({
      name: "StagehandFacadeBridgeError",
      message: "Facade screenshot returned no image.",
    });
  });

  it("collects evidence without refreshing refs and ignores untrusted terminal-looking errors", async () => {
    const call = vi
      .fn<FacadeToolCaller>()
      .mockResolvedValueOnce({
        content: [
          { type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: '{"type":"value","value":"https://fixture.test"}' }],
      });
    expect(await captureCuaEvidence(call)).toEqual({
      screenshot: Buffer.from("png"),
      url: "https://fixture.test",
    });
    expect(call.mock.calls.map(([name]) => name)).toEqual(["screenshot", "run"]);
    call.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Browser session lost (closed). Stop." }],
    });
    await expect(captureCuaEvidence(call)).resolves.toEqual({});
  });

  it("uses only runner-owned loss state before and after tool calls", async () => {
    let loss: { cause: string } | undefined;
    const call = vi.fn<FacadeToolCaller>(async () => {
      loss = { cause: "closed https://private.test/?token=secret" };
      return { isError: true, content: [{ type: "text", text: "page data" }] };
    });
    const readLoss = () => loss;
    const tools = bridgeCuaFacadeTools(call, 123, readLoss);
    await expect(tools.run("return 1")).rejects.toBeInstanceOf(CuaFacadeSessionLostError);
    expect(call).toHaveBeenCalledOnce();
    await expect(captureCuaEvidence(call, readLoss)).rejects.toMatchObject({
      name: "CuaFacadeSessionLostError",
      message: "Browser session lost (confirmed by eval runner). The task cannot continue.",
    });
    expect(call).toHaveBeenCalledOnce();
  });

  it("sanitizes rejected requests and malformed action payloads", async () => {
    const call = vi.fn<FacadeToolCaller>();
    const tools = bridgeCuaFacadeTools(call);
    call.mockRejectedValueOnce(new Error("Browser session lost (fake). token=secret"));
    await expect(tools.run("return 1")).rejects.toMatchObject({
      name: "StagehandFacadeBridgeError",
      message: "Facade run request failed.",
    });
    for (const text of [
      "secret data",
      '{"completed":0,"url":"https://private.test"}',
      '{"completed":-1,"url":"x"}',
    ]) {
      call.mockResolvedValueOnce({ content: [{ type: "text", text }] });
      await expect(tools.runActions([{ op: "click", id: "0-1" }])).rejects.toMatchObject({
        name: "StagehandFacadeBridgeError",
        message: "Facade run actions returned an invalid result.",
      });
    }
    call.mockResolvedValueOnce({ content: [{ type: "text", text: "private malformed result" }] });
    await expect(tools.run("return 1")).rejects.toBeInstanceOf(StagehandFacadeBridgeError);
  });

  it("bounds cleanup and calls it once even when cleanup never settles", async () => {
    vi.useFakeTimers();
    const close = vi.fn(() => new Promise<void>(() => {}));
    const cleanup = cuaCleanup(close, 10);
    const first = cleanup();
    expect(cleanup()).toBe(first);
    await vi.advanceTimersByTimeAsync(10);
    await expect(first).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("executes through the MCP bridge and the compiled canonical facade against a local SDK fixture", async () => {
    const compiledFacade = fileURLToPath(
      new URL("../../../integrations/core/dist/facade/index.mjs", import.meta.url),
    );
    expect(
      existsSync(compiledFacade),
      "Build @browserbasehq/stagehand-integrations before running this compiled facade test.",
    ).toBe(true);
    const folder = await mkdtemp(path.join(tmpdir(), "cua-compiled-facade-"));
    // No browser or model: only the raw SDK boundary is a fixture. MCP transport,
    // facade batch/ref translation, result encoding and CUA decoding are real.
    const source = `
import { StagehandFacadeTools } from ${JSON.stringify(compiledFacade)};
let url = 'https://fixture.test', clicks = 0;
const page = {
  pageId:'fixture', url:async()=>url, title:async()=>'Fixture',
  goto:async(value)=>{url=value;}, click:async(x,y)=>{url='https://fixture.test/click/'+x+'/'+y;}, setViewportSize:async()=>{}, screenshot:async()=>Buffer.from('png'),
  evaluate:async(expression)=>{if(expression==='({ width: innerWidth, height: innerHeight })')return {width:1288,height:711};throw new Error('Unexpected fixture evaluate: '+String(expression));},
  snapshot:async()=>({formattedTree:'[0-1] button "Submit"',xpathMap:{'0-1':'/button'}}),
  locator:()=>({click:async()=>{clicks++;}})
};
const context = { activePage:async()=>page, pages:async()=>[page], setActivePage:async()=>{} };
const tools = new StagehandFacadeTools({browser:{context},experimentalBatch:async(fn,input)=>fn({page,context},input)});
let carry='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{carry+=chunk;const lines=carry.split('\\n');carry=lines.pop();for(const line of lines){if(line.trim())void handle(JSON.parse(line));}});
async function handle(request){
 if(request.id===undefined)return;
 let result;
 if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'compiled-facade-fixture',version:'1'}};
 else if(request.method==='tools/call'){
  const {name,arguments:args={}}=request.params;
  try{let value;
   if(name==='run')value=args.actions?await tools.runActions(args.actions):await tools.run(args.code);
   else if(name==='snapshot')value=await tools.snapshot();
   else if(name==='screenshot'){const image=await tools.screenshot();result={content:[{type:'image',...image}]};}
   if(!result)result={content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]};
  }catch(error){result={isError:true,content:[{type:'text',text:error.message}]};}
 }else result={};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
}
process.stdin.on('end',()=>process.exit(0));
`;
    const script = path.join(folder, "fixture.mjs");
    await writeFile(script, source);
    let bridge: Awaited<ReturnType<typeof startStagehandFacadeBridge>> | undefined;
    try {
      bridge = await startStagehandFacadeBridge({
        server: { command: process.execPath, args: [script], env: {} },
      });
      const tools = bridgeCuaFacadeTools((...args) => bridge!.callTool(...args));
      expect(
        await tools.run('await page.goto("https://fixture.test/next"); return page.url();'),
      ).toBe("https://fixture.test/next");
      for (const value of [
        "42",
        "true",
        "null",
        '{"x":1}',
        "",
        42,
        true,
        null,
        { x: 1 },
        [1, "x"],
      ]) {
        expect(await tools.run(`return ${JSON.stringify(value)};`)).toEqual(value);
      }
      expect(await tools.run("return undefined; // preserve an empty result")).toBeUndefined();
      expect(await tools.snapshot()).toContain('[0-1] button "Submit"');
      expect(await tools.runActions([{ op: "click", id: "0-1" }])).toEqual({
        completed: 1,
        url: "https://fixture.test/next",
      });
      const claude = new StagehandCuaExecutor({
        tools,
        logger: { log() {}, warn() {}, error() {} },
      });
      const navigated = await claude.execute(
        "navigate",
        { url: "https://fixture.test/claude" },
        { toolUseId: "claude-nav" },
      );
      expect(navigated.isError).not.toBe(true);
      expect(JSON.stringify(navigated.content)).toContain("https://fixture.test/claude");
      await claude.execute("read_page", {}, { toolUseId: "claude-read" });
      expect(
        (
          await claude.execute(
            "left_click",
            { target: { type: "ref", ref: "0-1" } },
            { toolUseId: "claude-click" },
          )
        ).isError,
      ).not.toBe(true);
      const gemini = new GeminiCuaExecutor(tools, { log() {}, warn() {}, error() {} });
      expect(
        (await gemini.execute("navigate", { url: "https://fixture.test/gemini" })).isError,
      ).not.toBe(true);
      expect(await tools.run("return page.url();")).toBe("https://fixture.test/gemini");
      expect((await gemini.execute("click_at", { x: 500, y: 500 })).isError).not.toBe(true);
      expect(await tools.run("return page.url();")).toBe("https://fixture.test/click/644/355");
      expect(await tools.screenshot()).toMatchObject({
        data: Buffer.from("png").toString("base64"),
        mimeType: "image/png",
      });
    } finally {
      await bridge?.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
