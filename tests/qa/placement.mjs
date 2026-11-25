import {openBrowser,appUrl,measure} from "./browser.mjs";
import {resolve} from "node:path";
import {writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
const dir=resolve("test-evidence/ASM-001"),browser=await openBrowser();
try {
 const p=await browser.newPage({viewport:{width:1400,height:930},acceptDownloads:true});p.setDefaultTimeout(80000);await p.goto(appUrl);await measure(p);
 await p.getByLabel("Open Turnmill project file").setInputFiles(dir+"/two-blocks.turnmill");
 await p.waitForFunction(()=>document.querySelector(".status-bar")?.innerText.includes("2 bodies"));
 await p.getByRole("button",{name:"Assembly",exact:true}).click();
 await p.getByRole("button",{name:"3D assembly",exact:true}).click();
 await p.getByLabel("Component",{exact:true}).selectOption("upper");
 await p.waitForFunction(async()=>{const s=await window.__cadTest.snapshot();return s.joints?.selected==="upper" && s.joints.matrices[1]?.[14]===20});
 const info=await measure(p);assert.equal(info.joints.matrices[1][14],20);
 await p.screenshot({path:dir+"/seated-assembly.png"});
 await p.getByRole("button",{name:"Export",exact:true}).click();
 const next=p.waitForEvent("download");await p.getByRole("button",{name:/STEP solid/}).click();
 await(await next).saveAs(dir+"/two-blocks.step");
 await writeFile(dir+"/native.json",JSON.stringify({matrices:info.joints.matrices,workpiece:info.bodies,expectedBBox:[[0,0,0],[20,10,25]],expectedOverlap:0},null,2));
}finally{await browser.close();}
