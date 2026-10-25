// Optional Chrome regression for the actual page. All account/API traffic is mocked locally.
// Requires playwright, sharp and Chrome; XAUCORE_TOOL_ROOT can point to a tooling package directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(process.env.XAUCORE_TOOL_ROOT||root,'package.json'));
const {chromium}=require('playwright'),sharp=require('sharp');
const html=await fs.readFile(path.join(root,'public/index.html'),'utf8'),origin='http://127.0.0.1:8777';
const browser=await chromium.launch({channel:'chrome',headless:true});
const raw=bytes=>sharp(bytes).removeAlpha().raw().toBuffer();
const difference=async(a,b)=>{const x=await raw(a),y=await raw(b);assert.equal(x.length,y.length);let sum=0,strong=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);sum+=d;if(d>25)strong++;}return{mean:sum/x.length,strong};};
async function pose(page,u,clear=1){await page.evaluate(({u,clear})=>{cancelAnimationFrame(NB.raf);NB.raf=0;Object.assign(NB,{a:u,b:u+1,u,target:u,va:0,vb:0,lift:0,opticalEnergy:0,rail:0,railV:0,railLight:0,railLightV:0,tw:null,_pm:null,t:0,clear,materialOn:!!clear,materialTween:null,drag:clear?{id:999,u}:null,pulseAt:-10000});navBubFrame(performance.now());cancelAnimationFrame(NB.raf);NB.raf=0;},{u,clear});}
let contexts=0,poses=0;const fallback=[];
try{
 for(const width of[360,412,480])for(const theme of['light','dark','aurora']){
  const ctx=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await ctx.addInitScript(({theme,origin})=>{if(location.origin!==origin)return;for(const[k,v]of Object.entries({xc_token:'navigation-regression',xc_lang:'ru',xc_theme:theme,xc_glass:'on',xc_glass_v:'2'}))localStorage.setItem(k,v);},{theme,origin});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let rev=1;
  await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/'&&req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
   if(!u.pathname.startsWith('/api/')){try{return route.fulfill({body:await fs.readFile(path.join(root,'public',decodeURIComponent(u.pathname).replace(/^\/+/,''))),contentType:u.pathname.endsWith('.woff2')?'font/woff2':u.pathname.endsWith('.png')?'image/png':'application/octet-stream'});}catch{return route.abort();}}
   let body={};try{body=req.postDataJSON()||{};}catch{}const lease={mine:true,free:false,holder:body.sid||'qa',exp:Date.now()+20000};let out={ok:true};
   if(u.pathname==='/api/me')out={id:'navigation-regression',email:'qa@example.invalid'};
   else if(u.pathname==='/api/state')out=req.method()==='GET'?{state:null,rev,lease}:body.op==='claim'?{granted:true,lease}:{ok:true,rev:++rev,updatedAt:Date.now(),lease,ops:[]};
   else if(u.pathname==='/api/hist')out={data:null};else if(['/api/owner','/api/lock'].includes(u.pathname))out={configured:false,isOwner:false,locked:false};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(out)});
  });
  await page.goto(origin);await page.waitForSelector('.bottomnav');await page.evaluate(()=>{stopLoop();_bootPaused=true;});await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>_navMapReady&&_navFields);contexts++;
  assert.deepEqual(await page.evaluate(()=>[glassClarity(),LG_UI.refract,DISP.str]),[85,1,50]);
  for(const u of[0,1,1.5,2,2.5,3,3.5,4]){
   await pose(page,u);poses++;
   const state=await page.evaluate(()=>({input:NB.optical.safeNormals.getAttribute('in'),neutral:getComputedStyle(NB.optical.neutral).display,clip:getComputedStyle(NB.optical.neutral).clipPath,scales:NB.optical.dms.map(n=>+n.getAttribute('scale'))}));
   assert.equal(state.input,'preparedNormals');assert.equal(state.neutral,'block');assert.ok(state.clip.startsWith('path(evenodd'));assert.ok(state.scales.every(Number.isFinite));
  }
  if(width===412&&theme==='light'){
   for(const u of[0,1.5,3.5,4]){
    await pose(page,u);const clip={x:0,y:790,width,height:110},a=await page.screenshot({clip});
    await page.evaluate(()=>{globalThis.qaFields=_navFields;_navFields=null;NB.optical.key='';navLens(1);});
    const d=await difference(a,await page.screenshot({clip}));assert.ok(d.mean<1,'Live fallback and cached refraction must agree');fallback.push(d.mean);
    await page.evaluate(()=>{_navFields=globalThis.qaFields;NB.optical.key='';navLens(1);});
   }
   await pose(page,2);
   const r=await page.locator('.nav-rest').boundingBox(),clip={x:Math.ceil(r.x+r.width*.2),y:Math.ceil(r.y+r.height*.2),width:Math.floor(r.width*.6),height:Math.floor(r.height*.6)};
   await page.locator('.nav-red').evaluate(el=>el.style.visibility='hidden');const masked=await page.screenshot({clip});
   await page.locator('.nav-neutral').evaluate(el=>el.style.visibility='hidden');const empty=await page.screenshot({clip});
   assert.ok((await difference(masked,empty)).mean<.1,'No untransformed neutral glyphs remain inside the optical lens');
   await page.evaluate(()=>{document.querySelector('.nav-red').style.visibility='';document.querySelector('.nav-neutral').style.visibility='';const m=document.createElement('span');m.className='qa-floor';m.style.cssText='position:absolute;inset:-40px;z-index:0;pointer-events:none;background:repeating-linear-gradient(0deg,#fff 0 7px,#2467ad 7px 10px,#fff 10px 17px)';document.querySelector('.bottomnav').append(m);});
   const area={x:0,y:775,width,height:125},bent=await page.screenshot({clip:area});
   await page.evaluate(()=>{const s=NB.optical.backdrop.source.style;s.backdropFilter=s.webkitBackdropFilter='brightness(.98)';});
   assert.ok((await difference(bent,await page.screenshot({clip:area}))).strong>100,'The actual backdrop must refract independently of the glyphs');
   await page.evaluate(()=>document.querySelector('.qa-floor').remove());await pose(page,2,0);
   const cdp=await ctx.newCDPSession(page),blobs=[];await cdp.send('Network.enable');cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.startsWith('blob:'))blobs.push(e.request.url);});
   for(let i=0;i<5;i++){
    const r=await page.locator('.bottomnav button').nth(i).boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2,id:1}]});await page.waitForTimeout(70);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>!NB.raf,{},{timeout:6000});
    assert.equal(await page.locator('.bottomnav button.on').getAttribute('data-nav'),['markets','chart','positions','orders','more'][i]);
   }
   assert.equal(blobs.length,0);assert.deepEqual(await page.evaluate(()=>[NB.optical.source.style.filter,getComputedStyle(NB.optical.backdrop.parent).visibility]),['','hidden']);
   await page.evaluate(()=>{document.documentElement.dataset.glass='off';navBind(document.querySelector('.bottomnav'));});
   const boxes=await page.locator('.bottomnav button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,w:r.width};}));
   assert.equal(boxes.length,5);for(let i=0;i<5;i++){assert.ok(boxes[i].w>30);if(i)assert.ok(boxes[i].x>boxes[i-1].x);}
  }
  assert.deepEqual(errors,[]);await ctx.close();
 }
 console.log(JSON.stringify({contexts,poses,fallbackMAE:fallback,issues:0}));
}finally{await browser.close();}
