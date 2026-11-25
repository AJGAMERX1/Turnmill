import assert from "node:assert/strict";
import { openBrowser,appUrl,measure } from "./browser.mjs";
const browser=await openBrowser();
try {
 const page=await browser.newPage(); await page.goto(appUrl);
 const s=await measure(page); assert.equal(s.error,"");assert.equal(s.bodies.length,1);
 assert.equal(s.bodies[0].valid,true);assert.equal(s.bodies[0].solids,1);
 assert.ok(s.bodies[0].bbox[1][0]>0 && s.bodies[0].faces>1 && s.bodies[0].edges>1);
 assert.ok(Math.abs(s.volume-s.bodies[0].volume)<1e-8);
 assert.equal(await page.evaluate(async()=>{const h=window.__cadTest;const s=await h.snapshot();s.project.name="mutation sentinel";return Object.isFrozen(h) && !(await h.snapshot()).project.name.includes("mutation sentinel");}),true);
 console.log(JSON.stringify({volume:s.volume,area:s.area,mass:s.mass,centerOfMass:s.centerOfMass,bodies:s.bodies},null,2));
}finally{await browser.close();}
