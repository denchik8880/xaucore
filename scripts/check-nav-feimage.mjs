// Browser check for first-use gaps in the original navigation normal map.
// Requires the optional tooling package selected by XAUCORE_TOOL_ROOT and installed Chrome.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(process.env.XAUCORE_TOOL_ROOT||root,'package.json'));
const {chromium}=require('playwright');
const html=(await fs.readFile(path.join(root,'public/index.html'),'utf8')).replaceAll('\r\n','\n');
const start=html.indexOf('const NAV_OPTICS ='),end=html.indexOf('function navBind(bar){',start);
assert.ok(start>=0&&end>start);
const source=html.slice(start,end);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const ctx=await browser.newContext({viewport:{width:384,height:100}});
  const page=await ctx.newPage();
  await page.setContent('<svg width="0" height="0"><defs></defs></svg><div id="bar" style="width:384px;height:60px;--nav-on:#ef1f24;--nav-hole:#fff"><span class="nr-optics"></span></div><canvas id="out" width="384" height="60"></canvas>');
  await page.addScriptTag({content:`
    const NB={clear:1,opticalEnergy:0,a:0,b:1,lift:0},LG_LENS=true,LG_UI={refract:1},LGQ={r:2.155},DISP={on:false,drops:true,str:50};
    const _lgDefs=document.querySelector('defs'),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    const QA_BOX={left:1.2,sx:114/76.8,sy:55.8/51};
    function lgDefsReady(){} function glassOn(){return true;} function navBox(){return QA_BOX;}
    ${source}
    navOpticsBind(document.getElementById('bar'));
  `});
  await page.waitForFunction(()=>_navMapReady);
  const result=await page.evaluate(async()=>{
    const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    const source=document.createElement('canvas');source.width=384;source.height=60;
    const g=source.getContext('2d'),pixels=g.createImageData(384,60);
    for(let y=0;y<60;y++)for(let x=0;x<384;x++){
      const p=(y*384+x)*4,v=Math.round(x/383*255);
      pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=v;pixels.data[p+3]=255;
    }
    g.putImageData(pixels,0,0);
    const out=document.getElementById('out'),canvas=out.getContext('2d');
    const sample=x=>{canvas.filter='none';canvas.clearRect(0,0,384,60);canvas.filter='url(#xc-nav-optics)';canvas.drawImage(source,0,0);return [...canvas.getImageData(x,30,1,1).data];};
    const rows=[];
    for(const ratio of[1,1.25,1.5,1.75,2,2.25,2.5,2.75,3]){
      const width=ratio*55.8;QA_BOX.sx=width/76.8;navLens(1);
      const x=Math.floor(NB.optical.tabW*QA_BOX.left+width/2);
      const immediate=sample(x);await raf();const settled=sample(x);
      rows.push({ratio,maximumError:Math.max(...immediate.map((v,i)=>Math.abs(v-settled[i])))});
    }
    return{rows,imageCount:document.querySelectorAll('#xc-nav-optics feImage').length};
  });
  assert.equal(result.imageCount,1);
  assert.ok(result.rows.every(row=>row.maximumError<=1),'The first use of every aspect must render without a missing-map flash');
  console.log(JSON.stringify({firstUseChecks:result.rows.length,resourceGaps:0}));
  await ctx.close();
}finally{await browser.close();}
