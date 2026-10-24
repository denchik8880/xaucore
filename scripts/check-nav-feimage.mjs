// Optional browser regression. Requires playwright and installed Chrome; XAUCORE_TOOL_ROOT may point to a tooling package, like prepare-nav-optics.mjs.
// Run: node scripts/check-nav-feimage.mjs
// Counterfactual: node scripts/check-nav-feimage.mjs --expect-cors-failure
// XAUCORE_PROJECT_ROOT is only needed when running this file outside the repository's scripts/ directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const root=process.env.XAUCORE_PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(process.env.XAUCORE_TOOL_ROOT || root,'package.json'));
const {chromium}=require('playwright');
const html=(await fs.readFile(path.join(root,'public/index.html'),'utf8')).replaceAll('\r\n','\n');
const start=html.indexOf('const NAV_OPTICS ='),end=html.indexOf('function navBind(bar){',start);
assert.ok(start>=0&&end>start,'Actual navigation optics are present');
let source=html.slice(start,end);
const packPath=source.match(/\bfields: "([^"]+)"/)?.[1];
assert.ok(packPath?.startsWith('/')&&!packPath.includes('..'),'The committed field pack has a local asset path');
const packet=(await fs.readFile(path.join(root,'public',packPath.slice(1)))).toString('base64');
const counterfactual=process.argv.includes('--expect-cors-failure');
if(counterfactual){
  const marker='const image = images[i] = new Image();';
  assert.ok(source.includes(marker),'The counterfactual targets the actual prepared-image loader');
  source=source.replace(marker,marker+' image.crossOrigin = "anonymous";');
}
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:384,height:100},deviceScaleFactor:1});
  const page=await context.newPage();
  // A real origin, with all requests fulfilled/blocked locally. No application server or account API.
  await page.route('**/*',route=>route.request().url()==='https://nav-check.invalid/'
    ?route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'})
    :route.abort('blockedbyclient'));
  await page.goto('https://nav-check.invalid/');
  await page.setContent('<svg width="0" height="0"><defs></defs></svg><div id="bar" style="width:384px;height:60px;--nav-on:#ef1f24;--nav-hole:#fff"><span class="nr-optics"></span></div><canvas id="out" width="384" height="60"></canvas>');
  await page.evaluate(base64=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    // Execute the production header validation and all 129 production PNG decoders, not a copied loader.
    window.fetch=async()=>new Response(bytes,{status:200,headers:{'Content-Type':'application/octet-stream'}});
  },packet);
  await page.addScriptTag({content:`
    const NB={clear:1,opticalEnergy:0,a:0,b:1,lift:0}, LG_LENS=true, LG_UI={refract:1}, LGQ={r:2.155}, DISP={on:false,drops:true,str:50};
    const _lgDefs=document.querySelector('defs'), clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    const QA_BOX={left:1.2,sx:114/76.8,sy:55.8/51};
    function lgDefsReady(){} function glassOn(){return true;} function navBox(){return QA_BOX;}
    ${source}
    navOpticsBind(document.getElementById('bar'));
  `});
  const result=await page.evaluate(async()=>{
    const fields=await navFieldsPrepare();
    if(!fields)throw new Error('Actual field preparation failed');
    const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    await raf();await raf();
    const source=document.createElement('canvas');source.width=384;source.height=60;
    const g=source.getContext('2d'),pixels=g.createImageData(384,60);
    for(let y=0;y<60;y++)for(let x=0;x<384;x++){
      const p=(y*384+x)*4,v=Math.round(x/383*255);
      pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=v;pixels.data[p+3]=255;
    }
    g.putImageData(pixels,0,0);
    const out=document.getElementById('out'),ctx=out.getContext('2d');
    const sample=x=>{
      ctx.filter='none';ctx.clearRect(0,0,384,60);
      ctx.filter='url(#xc-nav-optics)';ctx.drawImage(source,0,0);
      return [...ctx.getImageData(x,30,1,1).data];
    };
    const rows=[];
    // These URLs have been decoded by HTMLImageElement, but have never been used by SVG feImage.
    // The initial filter used aspect index67. Avoid it so every row exercises a FIRST href use.
    for(const index of [0,16,32,48,64,80,96,112,128]){
      const width=(1+index/64)*55.8;QA_BOX.sx=width/76.8;
      navLens(1);
      const x=Math.floor(NB.optical.tabW*QA_BOX.left+width/2);
      const immediate=sample(x);
      await raf();const nextFrame=sample(x);
      await raf();const settled=sample(x);
      const maximumError=Math.max(...immediate.map((v,i)=>Math.abs(v-settled[i])));
      rows.push({index,x,immediate,nextFrame,settled,maximumError,
        blankInputPrediction:Math.round((x-+NB.optical.dms[1].getAttribute('scale')/2)/383*255)});
    }
    return {rows,preparedImages:fields.images.length};
  });
  const failures=result.rows.filter(row=>row.maximumError>1);
  if(counterfactual){
    assert.ok(failures.length>0,'Counterfactual anonymous preload must expose a first-frame resource gap');
    for(const row of failures)assert.ok(Math.abs(row.immediate[0]-row.blankInputPrediction)<=2,
      'The failed first frame samples p-scale/2, proving a black/missing map rather than a shape change');
  }else{
    assert.equal(failures.length,0,'First-use SVG fields must render the same pixels immediately and on the next frames');
  }
  console.log(JSON.stringify({mode:counterfactual?'counterfactual detected':'production passed',preparedImages:result.preparedImages,
    firstUseChecks:result.rows.length,resourceGaps:failures.length,rows:result.rows}));
  await context.close();
}finally{await browser.close();}
