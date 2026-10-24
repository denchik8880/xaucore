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
const html = (await fs.readFile(path.join(root, 'public/index.html'), 'utf8')).replaceAll('\r\n', '\n');
const normal = await fs.readFile(path.join(root, 'public/nav-normal-map.png'));
// Logical coordinates include the same neutral-map padding. Keeping these in a small PNG avoids
// vector image work in the live fallback as well as in the prepared path.
const pixels = Buffer.alloc(288 * 232 * 4);
for(let y = 0; y < 232; y++) for(let x = 0; x < 288; x++){
  const p = (y * 288 + x) * 4;
  pixels[p] = Math.round((x + .5) / 288 * 255); pixels[p+1] = Math.round((y + .5) / 232 * 255);
  pixels[p+2] = 128; pixels[p+3] = 255;
}
const coordinates = await sharp(pixels, { raw:{ width:288, height:232, channels:4 } }).png({ compressionLevel:9, adaptiveFiltering:true }).toBuffer();
await fs.writeFile(path.join(root, 'public/nav-contact-coordinates.png'), coordinates);
const start = html.indexOf('const NAV_OPTICS ='), end = html.indexOf('function navBind(bar){', start);
if(start < 0 || end < start) throw new Error('Cannot find the actual navigation optics');
const source = html.slice(start, end).replace('map: "/nav-normal-map.png"', 'map: ' + JSON.stringify('data:image/png;base64,' + normal.toString('base64'))).replace('coordinates: "/nav-contact-coordinates.png"', 'coordinates: ' + JSON.stringify('data:image/png;base64,' + coordinates.toString('base64')));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try{
  const context = await browser.newContext({ viewport: { width: 288, height: 232 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent('<svg><defs></defs></svg><div id="bar" style="width:384px;height:60px"><span class="nr-optics"></span></div>');
  // Build the production graph, without starting the app, accessing accounts, or running a server.
  await page.addScriptTag({ content: `
    const NB={clear:0,opticalEnergy:0,a:0,b:1,lift:0}, LG_LENS=true, LG_UI={refract:1}, DISP={on:true,drops:true,str:50};
    const _lgDefs=document.querySelector('defs'), clamp=(x,a,b)=>Math.max(a,Math.min(b,x)), glassOn=()=>true;
    function lgDefsReady(){} function navBox(){return {left:0,sx:1,sy:1};}
    fetch=async()=>{throw new Error('No pack fetch while generating its source');};
    ${source}
    navOpticsBind(document.getElementById('bar'));
  ` });
  const { template, contactGain, rimStroke, rimBlur } = await page.evaluate(() => {
    const filter = NB.optical.filter.cloneNode(true); let done = false;
    for(const node of [...filter.children]){
      if(done) node.remove(); else if(node.getAttribute('result') === 'normals') done = true;
    }
    return { template: filter.outerHTML, contactGain: NAV_OPTICS.contactGain, rimStroke: NAV_OPTICS.rimStroke, rimBlur: NAV_OPTICS.rimBlur };
  });
  const buffers = [], offsets = [0];
  for(let i = 0; i <= 128; i++){
    const h = 55.8, w = (1 + i / 64) * h;
    await page.setContent(`<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="288" height="232" viewBox="${-w*16/256} ${-h*16/200} ${w*1.125} ${h*1.16}" preserveAspectRatio="none"><defs>${template}</defs><rect width="${w}" height="${h}" filter="url(#xc-nav-optics)"/></svg>`);
    await page.evaluate(({ w, h }) => {
      const filter = document.querySelector('filter'), images = [...filter.querySelectorAll('feImage')];
      const set = (node, values) => { for(const [k,v] of Object.entries(values)) node.setAttribute(k,v); };
      set(filter, { x:-24, y:-24, width:w+48, height:h+48 });
      set(images[0], { x:-w*16/256, y:-h*16/200, width:w*1.125, height:h*1.16 });
      set(images[1], { x:-w*16/256, y:-h*16/200, width:w*1.125, height:h*1.16 });
      filter.querySelector('[result="contactNormals"]').setAttribute('values', navContactValues(w,h).join(' '));
      for(let i = 0; i < 2; i++) set(images[i+2], { x:i?w-1.1*h:-.1*h, y:-.1*h, width:1.2*h, height:1.2*h });
    }, { w, h });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await sharp(await page.screenshot()).removeAlpha().png({ compressionLevel:9, adaptiveFiltering:true }).toBuffer();
    buffers.push(png); offsets.push(offsets.at(-1) + png.length);
  }
  const header = Buffer.from(JSON.stringify({ version:2, min:1, step:1/64, height:55.8, width:288, rows:232,
    contactGain, rimStroke, rimBlur, sourceMap:createHash('sha256').update(normal).digest('hex'), coordinateMap:createHash('sha256').update(coordinates).digest('hex'), offsets }));
  const length = Buffer.alloc(4); length.writeUInt32LE(header.length);
  const output = path.join(root, 'public/nav-optics-fields-v2.bin');
  await fs.writeFile(output, Buffer.concat([length, header, ...buffers]));
  console.log(`Prepared 129 fields: ${output}`);
  await context.close();
}finally{ await browser.close(); }
