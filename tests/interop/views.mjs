/** Capture the actual part workspace at equal viewport dimensions for side-by-side inspection. */
import { chromium } from "playwright-core";
import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
const out=resolve(process.env.QA_INTEROP_OUT||"test-evidence/interop");
const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROMIUM||chromium.executablePath(),args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const cases=(await readdir(out)).filter(f=>f.endsWith(".native.json")).map(f=>f.slice(0,-12)).sort();
const page=await browser.newPage({viewport:{width:1250,height:790}});page.setDefaultTimeout(180000);
const issues=[];page.on("pageerror",e=>issues.push(String(e)));
try{
 await page.goto(process.env.QA_URL||"http://127.0.0.1:4179/");await page.getByRole("button",{name:"Part",exact:true}).waitFor();
 for(const name of cases){
   if(process.env.QA_ONLY_CASE && !name.startsWith(process.env.QA_ONLY_CASE))continue;
   if(process.env.QA_MISSING_ONLY && await access(join(out,name+".app-iso.png")).then(()=>true,()=>false))continue;
   const meta=JSON.parse(await readFile(join(out,name+".native.json"),"utf8"));
   let project;
   if(name==="SYS-002"){project=JSON.parse(await readFile("test-evidence/systems/SYS-002/rotated-graphic.turnmill","utf8"));}
   else{
     const p=JSON.parse(await readFile(join(out,meta.model+".turnmill"),"utf8"));
     if(meta.model!==name){
       const i=Number(name.slice(meta.model.length+1))-1;
       const starts=p.features.map((f,i)=>f.operation==="new"&&!f.suppressed?i:-1).filter(i=>i>=0);
       p.features=p.features.slice(starts[i],starts[i+1]);
     }
     project=p;
   }
   project.name=name;
   await page.getByLabel("Open Turnmill project file").setInputFiles({name:name+".turnmill",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(project))});
   await page.waitForFunction(n=>document.querySelector(".project-trigger")?.textContent.includes(n),name);
   await page.waitForFunction(expected=>{
     const text=document.querySelector(".status-bar")?.innerText||"";
     return text.includes("Ready") && text.includes(expected);
   },meta.parts.length===1?"1 body":meta.parts.length+" bodies");
   await page.keyboard.press("f");
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.locator(".solid-viewport").screenshot({path:join(out,name+".app-iso.png")});
   console.log(name,"captured");
 }
 await writeFile(join(out,"app-views.json"),JSON.stringify({cases,issues},null,2));
 if(issues.length)throw Error(issues.join("\n"));
}finally{await browser.close();}
