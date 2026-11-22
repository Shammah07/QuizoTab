// Run with node --import tsx scripts/test-staff-browser.mts. CHROME_BIN selects Chromium on other platforms.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const chrome = [process.env.CHROME_BIN,process.env.ProgramFiles && join(process.env.ProgramFiles,"Google","Chrome","Application","chrome.exe"),
  process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"],"Microsoft","Edge","Application","msedge.exe")].find(p=>p && existsSync(p));
if (!chrome) throw new Error("Set CHROME_BIN to an installed Chrome or Edge executable.");
const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve("tsx/package.json"))("esbuild") as typeof import("esbuild");
const operations=process.argv.includes("--operations");
const bundle = await build({entryPoints:[operations?"scripts/operations-browser-fixture.tsx":"scripts/staff-browser-fixture.tsx"],bundle:true,write:false,
  platform:"browser",jsx:"automatic",define:{"process.env":"{}","process.env.NODE_ENV":'"production"'}});
const html = '<!doctype html><meta charset="utf-8"><div id="app"></div><pre id="result"></pre><script>window.onerror=(msg)=>{document.getElementById("result").textContent="FAIL "+msg}</script><script src="/test.js"></script>';
const server = createServer((req,res)=>{
  const js = req.url==="/test.js";
  res.writeHead(200,{"Content-Type":js?"application/javascript":"text/html","Cache-Control":"no-store"});
  res.end(js ? bundle.outputFiles[0].contents : html);
});
const profile=await mkdtemp(join(tmpdir(),"quizotab-staff-browser-"));
try {
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();
  if(!address || typeof address==="string") throw new Error("Missing test server port");
  const child=spawn(chrome,["--headless","--disable-gpu","--disable-extensions","--no-first-run","--disable-background-networking",
    "--user-data-dir="+profile,"--virtual-time-budget=12000","--dump-dom","http://127.0.0.1:"+address.port],{windowsHide:true,stdio:["ignore","pipe","ignore"]});
  let dom="";
  child.stdout.on("data",chunk=>{dom+=chunk;});
  const timeout=setTimeout(()=>child.kill(),45000);
  try {
    const status=await new Promise<number|null>((resolve,reject)=>{child.on("error",reject);child.on("close",resolve);});
    const result=dom.match(/<pre id="result">(.*?)<\/pre>/s)?.[1];
    if(status!==0 || result!=="PASS") throw new Error("Browser check failed: "+(result || "no completed result"));
    console.log(operations ? "ok  administrator plan editor, stale draft, release readiness and room monitor" : "ok  real browser: repeated click, lost response, page refresh, retry identity, delayed room switch, adjudication, completion blockers and revocation");
  } finally {clearTimeout(timeout);}
} finally {
  server.close();
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
