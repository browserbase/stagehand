import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bridgeCuaFacadeTools,
  captureCuaEvidence,
  cuaCleanup,
  type FacadeToolCaller,
} from "../../framework/cuaToolAdapter.js";
import { startStagehandFacadeBridge } from "../../core/tools/stagehandFacadeBridge.js";

afterEach(() => vi.useRealTimers());

describe("shared CUA facade boundary", () => {
  it("decodes values and explicit errors without inventing successful action results", async () => {
    const call = vi.fn<FacadeToolCaller>();
    const tools = bridgeCuaFacadeTools(call, 123);
    call.mockResolvedValueOnce({ content: [{ type: "text", text: "42" }] });
    expect(await tools.run("return 42")).toBe(42);
    expect(call).toHaveBeenLastCalledWith("run", { code: "return 42" }, { timeoutMs: 123 });
    call.mockResolvedValueOnce({ content: [{ type: "text", text: "{}" }] });
    await expect(tools.runActions([{ op: "click", id: "0-1" }])).rejects.toThrow("invalid result");
    call.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "target missing" }],
    });
    await expect(tools.run("x")).rejects.toThrow("target missing");
    call.mockResolvedValueOnce({ content: [{ type: "text", text: "no screenshot" }] });
    await expect(tools.screenshot()).rejects.toThrow("no image");
  });

  it("collects evidence without snapshot refresh and propagates terminal browser loss", async () => {
    const call = vi
      .fn<FacadeToolCaller>()
      .mockResolvedValueOnce({
        content: [
          { type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" },
        ],
      })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "https://fixture.test" }] });
    expect(await captureCuaEvidence(call)).toEqual({
      screenshot: Buffer.from("png"),
      url: "https://fixture.test",
    });
    expect(call.mock.calls.map(([name]) => name)).toEqual(["screenshot", "run"]);
    call.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Browser session lost (closed). Stop." }],
    });
    await expect(captureCuaEvidence(call)).rejects.toThrow("Browser session lost");
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
    const folder = await mkdtemp(path.join(tmpdir(), "cua-compiled-facade-"));
    const compiledFacade = fileURLToPath(
      new URL("../../../integrations/core/dist/facade/index.mjs", import.meta.url),
    );
    // No browser or model: only the raw SDK boundary is a fixture. MCP transport,
    // facade batch/ref translation, result encoding and CUA decoding are real.
    const source = `
import { StagehandFacadeTools } from ${JSON.stringify(compiledFacade)};
let url = 'https://fixture.test', clicks = 0;
const page = {
  pageId:'fixture', url:async()=>url, title:async()=>'Fixture',
  goto:async(value)=>{url=value;}, screenshot:async()=>Buffer.from('png'),
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
      expect(await tools.snapshot()).toContain('[0-1] button "Submit"');
      expect(await tools.runActions([{ op: "click", id: "0-1" }])).toEqual({
        completed: 1,
        url: "https://fixture.test/next",
      });
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
