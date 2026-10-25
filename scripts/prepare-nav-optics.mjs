// Optional asset-generation tools: playwright, sharp, and installed Chrome. No production dependency.
// XAUCORE_TOOL_ROOT may point at a tooling package.json directory containing those modules.
// Run from any directory: node scripts/prepare-nav-optics.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(process.env.XAUCORE_TOOL_ROOT || root, 'package.json'));
const { chromium } = require('playwright'), sharp = require('sharp');
const htmlPath = path.join(root, 'public/index.html');
let html = (await fs.readFile(htmlPath, 'utf8')).replaceAll('\r\n', '\n');
const config = html.slice(html.indexOf('const NAV_OPTICS ='), html.indexOf('let _navMapReady'));
const read = key => {
  const value = Number(config.match(new RegExp('\\b' + key + ': ([\\d.]+)'))?.[1]);
  if(!Number.isFinite(value)) throw new Error('Missing navigation calibration: ' + key);
  return value;
};
const calibration = Object.fromEntries(['contactGain','contactSlope','contactSpan','contactTau','contactBand','contactLead','verticalTop','verticalBottom','verticalStart','verticalEnd','rimBlur'].map(key => [key, read(key)]));
const outputPadding=read('padding');
const packetName=config.match(/\bfields: "\/([^"/]+\.bin)"/)?.[1];
if(packetName!=='nav-optics-fields-v7.bin')throw new Error('Expected the clear-orb v7 field configuration');
const { contactSlope, contactSpan, contactTau, contactBand, contactLead, verticalTop, verticalBottom, verticalStart, verticalEnd } = calibration;
if(contactSpan <= 0 || contactTau <= 0 || contactLead < 0 || contactBand <= contactLead || verticalEnd <= verticalStart || calibration.rimBlur !== 0) throw new Error('Invalid navigation surface calibration');
const clamp01 = value => Math.max(0, Math.min(1, value));
const smootherstep = value => { const t = clamp01(value); return t*t*t*(t*(t*6-15)+10); };
const encode = value => Math.round(clamp01(value) * 255);
const verticalGain = y => verticalTop + (verticalBottom - verticalTop) * smootherstep((y - verticalStart) / (verticalEnd - verticalStart));
// Continue the inward vertical field past the visible lip instead of letting its outer return to
// neutral reverse the final rows of a caption. The smooth clamp has unit/zero slope at its ends.
const sampleY = y => {
  if(y < .1){ const u = clamp01((.1-y)/.08); return .1 - .08*(u-u*u/2); }
  if(y > .9){ const u = clamp01((y-.9)/.08); return .9 + .08*(u-u*u/2); }
  return y;
};
const original = await fs.readFile(path.join(root, 'public/nav-normal-map.png'));
const decoded = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
const { width, height, channels } = decoded.info;
if(width !== 288 || height !== 232 || channels !== 4) throw new Error('Unexpected original navigation field');
const normalPixels = Buffer.from(decoded.data);
for(let y = 0; y < height; y++){
  const yn = (y-16+.5)/200, py = 16 + sampleY(yn)*200 - .5;
  const y0 = Math.max(0, Math.min(height-1, Math.floor(py))), y1 = Math.min(height-1,y0+1), fy = py-Math.floor(py), gain = verticalGain(yn);
  for(let x = 0; x < width; x++){
    const g = (decoded.data[(y0*width+x)*4+1]*(1-fy) + decoded.data[(y1*width+x)*4+1]*fy)/255;
    normalPixels[(y*width+x)*4+1] = encode(.5+(g-.5)*gain);
  }
}
const png = (pixels,w,h) => sharp(pixels,{ raw:{ width:w,height:h,channels:4 } }).png({ compressionLevel:9,adaptiveFiltering:true }).toBuffer();
const normal = await png(normalPixels,width,height);
const coordinatesPixels = Buffer.alloc(256*256*4), rimPixels = [Buffer.alloc(256*256*4),Buffer.alloc(256*256*4)];
const referenceHeight = 55.8, tau = contactTau/referenceHeight*100, band = contactBand/referenceHeight*100, lead = contactLead/referenceHeight*100;
const surfaceRadius = rho => { const d = Math.max(50-rho,0); return 50 + contactSlope*(Math.min(d,lead)+tau*(1-Math.exp(-Math.max(d-lead,0)/tau))); };
for(let y = 0; y < 256; y++) for(let x = 0; x < 256; x++){
  const dx = (x+.5)/256*120-60, dy = (y+.5)/256*120-60, yn = (dy+50)/100;
  const rho = Math.hypot(dx,dy), reflected = rho ? surfaceRadius(rho)/rho : 0;
  const dySample = sampleY(yn)*100-50, rhoSample = Math.hypot(dx,dySample), reflectedG = rhoSample ? surfaceRadius(rhoSample)/rhoSample : 0;
  const p = (y*256+x)*4;
  coordinatesPixels[p] = encode(.5+dx*reflected/(contactSpan*100));
  coordinatesPixels[p+1] = encode(.5+dySample*reflectedG/(contactSpan*100)*verticalGain(yn));
  coordinatesPixels[p+2] = 128; coordinatesPixels[p+3] = 255;
  // Match both value and first derivative at the inner join. The angular taper also makes the
  // contact correction disappear smoothly where a circular end meets the straight top/bottom.
  const alpha = encode((1-smootherstep((50-rho-lead)/(band-lead)))*smootherstep((rho ? Math.abs(dx)/rho : 0)/.25));
  for(let i = 0; i < 2; i++){
    const mask = rimPixels[i]; mask[p] = mask[p+1] = mask[p+2] = 255;
    mask[p+3] = (i ? dx>0 : dx<0) ? alpha : 0;
  }
}
const coordinates = await png(coordinatesPixels,256,256), generatedRims = await Promise.all(rimPixels.map(pixels => png(pixels,256,256)));
// This variant shares the proven cap masks. Refuse a silent mask-calibration change: any future
// changed mask needs its own versioned asset rather than overwriting an already published input.
const rims=await Promise.all(['left','right'].map(side=>fs.readFile(path.join(root,`public/nav-contact-rim-${side}.png`))));
for(let i=0;i<2;i++)if(!generatedRims[i].equals(rims[i]))throw new Error('Shared navigation rim calibration changed; version its asset first');
await fs.writeFile(path.join(root,'public/nav-normal-map-clear.png'),normal);
await fs.writeFile(path.join(root,'public/nav-contact-clear.png'),coordinates);
// Reread immediately before this one narrow HTML edit: other work may have changed unrelated source
// while the immutable PNGs were built. Frame updates never rewrite these embedded URLs.
html = (await fs.readFile(htmlPath,'utf8')).replaceAll('\r\n','\n');
const start = html.indexOf('const NAV_OPTICS ='), end = html.indexOf('function navBind(bar){',start);
if(start < 0 || end < start) throw new Error('Cannot find the actual navigation optics');
const dataURL = bytes => 'data:image/png;base64,' + bytes.toString('base64');
const source = html.slice(start,end)
  .replace(/\bmap: "[^"]*"/,'map: '+JSON.stringify(dataURL(normal)))
  .replace(/\bcoordinates: "[^"]*"/,'coordinates: '+JSON.stringify(dataURL(coordinates)))
  .replace(/\brims: \[[^\]]*\]/,'rims: '+JSON.stringify(rims.map(dataURL)));
if(!source.includes(JSON.stringify(dataURL(rims[1])))) throw new Error('Cannot update the navigation contact masks');
html = html.slice(0,start)+source+html.slice(end);
await fs.writeFile(htmlPath,html);
const browser = await chromium.launch({ channel:'chrome',headless:true });
try{
  const context = await browser.newContext({ viewport:{ width:288,height:232 },deviceScaleFactor:1 });
  const page = await context.newPage();
  await page.setContent('<svg><defs></defs></svg><div id="bar" style="width:384px;height:60px"><span class="nr-optics"></span></div>');
  // Build the real production graph without starting the application or accessing any account.
  await page.addScriptTag({ content:`
    const NB={clear:0,opticalEnergy:0,a:0,b:1,lift:0}, LG_LENS=true, LG_UI={refract:1}, LGQ={r:2.155}, DISP={on:true,drops:true,str:50};
    const _lgDefs=document.querySelector('defs'), clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), glassOn=()=>true;
    function lgDefsReady(){} function navBox(){return {left:0,sx:1,sy:1};}
    fetch=async()=>{throw new Error('No pack fetch while generating its source');};
    ${source}
    navOpticsBind(document.getElementById('bar'));
  ` });
  const template = await page.evaluate(async () => {
    await Promise.all([NAV_OPTICS.map,NAV_OPTICS.coordinates,...NAV_OPTICS.rims].map(async src => { const image=new Image();image.src=src;await image.decode(); }));
    const filter = NB.optical.filter.cloneNode(true); let done = false;
    for(const node of [...filter.children]){ if(done) node.remove(); else if(node.getAttribute('result')==='normals') done=true; }
    return filter.outerHTML;
  });
  const buffers = [], offsets = [0];
  for(let i = 0; i <= 128; i++){
    const h = referenceHeight, w = (1+i/64)*h;
    await page.setContent(`<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="288" height="232" viewBox="${-w*16/256} ${-h*16/200} ${w*1.125} ${h*1.16}" preserveAspectRatio="none"><defs>${template}</defs><rect width="${w}" height="${h}" filter="url(#xc-nav-optics)"/></svg>`);
    await page.evaluate(({w,h,padding}) => {
      const filter=document.querySelector('filter'),images=[...filter.querySelectorAll('feImage')];
      const set=(node,values)=>{for(const[k,v]of Object.entries(values))node.setAttribute(k,v);};
      set(filter,{x:-padding,y:-padding,width:w+padding*2,height:h+padding*2});
      set(images[0],{x:-w*16/256,y:-h*16/200,width:w*1.125,height:h*1.16});
      for(let i=0;i<2;i++){
        const region={x:i?w-1.1*h:-.1*h,y:-.1*h,width:1.2*h,height:1.2*h};
        set(images[i+1],region);set(images[i+3],region);
        filter.querySelector(`[result="${i?'right':'left'}ContactNormals"]`).setAttribute('values',navContactValues(w,h,i?1:-1).join(' '));
      }
    },{w,h,padding:outputPadding});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const captured = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const pixels = Buffer.from(captured.data), stride=captured.info.width*3;
    // Rasterizing an feImage exactly at the SVG viewport edge can mix its last texel with the
    // screenshot background. Extrude only the outer 3px of the existing 16px padding; the visible
    // capsule and all first-contact samples retain their actual production-filter pixels.
    for(let y=0;y<captured.info.height;y++)for(let x=0;x<captured.info.width;x++){
      const xx=Math.max(3,Math.min(captured.info.width-4,x)),yy=Math.max(3,Math.min(captured.info.height-4,y));
      if(xx!==x||yy!==y)captured.data.copy(pixels,y*stride+x*3,yy*stride+xx*3,yy*stride+xx*3+3);
    }
    const field = await sharp(pixels,{raw:captured.info}).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();
    buffers.push(field);offsets.push(offsets.at(-1)+field.length);
  }
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const header=Buffer.from(JSON.stringify({version:7,min:1,step:1/64,height:referenceHeight,width:288,rows:232,...calibration,
    sourceOriginal:hash(original),sourceMap:hash(normal),coordinateMap:hash(coordinates),rimMaps:rims.map(hash),offsets}));
  const length=Buffer.alloc(4);length.writeUInt32LE(header.length);
  const output=path.join(root,'public',packetName);
  await fs.writeFile(output,Buffer.concat([length,header,...buffers]));
  console.log(`Prepared 129 fields: ${output}`);
  await context.close();
}finally{await browser.close();}
