import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inflateSync } from 'node:zlib';

const html = fs.readFileSync(process.env.XAUCORE_NAV_SOURCE || new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = html.indexOf('const NAV_OPTICS ='), end = html.indexOf('function navBind(bar){', start);
assert.ok(start >= 0 && end > start, 'Actual navigation optics section exists');

// Decode the committed field without browser/image packages or generated fixture files.
function normalMap(png = fs.readFileSync(new URL('../public/nav-core-v9.png', import.meta.url))) {
  let width, height, channels;
  const chunks = [];
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p), kind = png.toString('ascii', p + 4, p + 8), data = png.subarray(p + 8, p + 8 + n);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8); assert.ok([2, 6].includes(data[9])); assert.equal(data[12], 0);
      channels = data[9] === 2 ? 3 : 4;
    }
    if (kind === 'IDAT') chunks.push(data);
    p += n + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
    return x <= y && x <= z ? a : y <= z ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const kind = encoded[y * (stride + 1)]; assert.ok(kind <= 4);
    for (let x = 0; x < stride; x++) {
      const p = y * stride + x, a = x >= channels ? pixels[p - channels] : 0;
      const b = y ? pixels[p - stride] : 0, c = y && x >= channels ? pixels[p - stride - channels] : 0;
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][kind];
      pixels[p] = (encoded[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, pixels, channels, at(x, y) {
    const p = (Math.round(y) * width + Math.round(x)) * channels;
    return [pixels[p] / 255, pixels[p + 1] / 255, pixels[p + 2] / 255, channels === 4 ? pixels[p + 3] / 255 : 1];
  } };
}
const field = normalMap();

function optics({loadInputs=true}={}) {
  const counts = { created: 0, appended: 0, attributes: 0, images: [] };
  class Element {
    constructor(tag) { this.tag = tag; this.attrs = new Map(); this.children = []; this.isConnected = true; this.style = { filter: '', setProperty() {} }; }
    setAttribute(k, v) { counts.attributes++; this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    appendChild(node) { counts.appended++; this.children.push(node); return node; }
    querySelectorAll(tag) { return this.children.filter(n => n.tag === tag); }
    querySelector(tag) { const result = tag.match(/^\[result="([^"]+)"\]$/); return result ? this.children.find(n => n.getAttribute('result') === result[1]) || null : this.querySelectorAll(tag)[0] || null; }
  }
  const defs = new Element('defs'), source = new Element('source'), box = { left: 1.2, sx: 114 / 76.8, sy: 55.8 / 51 };
  const bar = new Element('bar'); bar.clientWidth = 384; bar.clientHeight = 60;
  bar.querySelector = selector => selector === '.nr-optics' ? source : null;
  const ctx = {
    Math, LG_LENS: true, LG_UI: { refract: 1 }, LGQ: { r: 2.155 }, DISP: { on: true, drops: true, str: 50 },
    NB: { clear: 1, opticalEnergy: 1, a: 1, b: 2, lift: 0, optical: null },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), glassOn: () => true,
    navBox: () => box, lgDefsReady() {}, _lgDefs: defs,
    Image: class { constructor() { counts.images.push(this); } },
    document: {
      getElementById: id => defs.children.find(n => n.getAttribute('id') === id) || null,
      createElementNS: (_, tag) => { counts.created++; return new Element(tag); },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end) + '\nglobalThis.api={navOpticsBind,navLens,navFieldsPrepare,navFieldAt,NAV_OPTICS,getFields:()=>_navFields};', ctx);
  ctx.api.navOpticsBind(bar);
  assert.equal(counts.images.length, 6); if(loadInputs)for (const image of counts.images) image.onload();
  return { ...ctx.api, ctx, counts, defs, bar, source, box, filter: ctx.NB.optical.filter };
}
function applyMatrix(node, rgba) {
  const values = node.getAttribute('values').trim().split(/\s+/).map(Number);
  assert.equal(values.length, 20);
  return Array.from({ length: 4 }, (_, row) => values.slice(row * 5, row * 5 + 4).reduce((n, v, i) => n + v * rgba[i], values[row * 5 + 4]));
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} ≈ ${b}`);

const packBytes = fs.readFileSync(new URL('../public/nav-optics-fields-v9.bin', import.meta.url));
const packBase=4+packBytes.readUInt32LE(0),packMeta=JSON.parse(packBytes.toString('utf8',4,packBase));
const prepared=index=>normalMap(packBytes.subarray(packBase+packMeta.offsets[index],packBase+packMeta.offsets[index+1]));
const mix=(a,b,t)=>a+(b-a)*t;
const sample=(map,u,v)=>{
  const x=16+u*256-.5,y=16+v*200-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
  const a=map.at(x0,y0),b=map.at(x0+1,y0),c=map.at(x0,y0+1),d=map.at(x0+1,y0+1);
  return a.map((value,i)=>mix(mix(value,b[i],fx),mix(c[i],d[i],fx),fy));
};

test('the complete six live inputs decode before live displacement starts',()=>{
  const h=optics({loadInputs:false});assert.equal(h.source.style.filter,'');
  for(const image of h.counts.images.slice(0,-1))image.onload();h.navLens(1);assert.equal(h.source.style.filter,'');
  h.counts.images.at(-1).onload();assert.equal(h.source.style.filter,'url(#xc-nav-optics)');
});

test('all live carriers, fallback orb and background normals are embedded with their committed pixels',()=>{
  const h=optics();
  for(const[key,file]of[['map','nav-core-v9.png'],['coordinates','nav-cap-v9.png'],['circle','nav-circle-v9.png'],['background','nav-background-v9.png'],['rims','nav-half-left-v9.png'],['rims','nav-half-right-v9.png']]){
    const url=key==='rims'?h.NAV_OPTICS.rims[file.includes('left')?0:1]:h.NAV_OPTICS[key];
    assert.ok(url.startsWith('data:image/png;base64,'));assert.deepEqual(Buffer.from(url.split(',')[1],'base64'),fs.readFileSync(new URL('../public/'+file,import.meta.url)));
  }
});

test('transparent glyphs use three wavelength samples and restore only their sampled RGBA coverage',()=>{
  const h=optics(),byResult=name=>h.filter.querySelector('[result="'+name+'"]');
  assert.equal(h.ctx.NB.optical.dms.length,3);
  h.ctx.NB.optical.dms.forEach((dm,i)=>{assert.equal(dm.getAttribute('in'),'SourceGraphic');assert.equal(dm.getAttribute('result'),'inkSample'+i);});
  const coverage=byResult('inkCoverage');assert.equal(coverage.children.length,3);
  assert.equal(byResult('navigationEmpty').getAttribute('in2'),'inkCoverage');
  const output=byResult('navigationRGBA');assert.equal(output.getAttribute('in'),'navigationColour');assert.equal(output.getAttribute('in2'),'navigationEmpty');assert.equal(output.getAttribute('k3'),'-1');
  assert.ok(!html.includes('nr-viewport')&&!html.includes('nr-bg'),'No opaque clone or rail clipping hides the refracted page');
  assert.ok(html.includes('.nav-neutral{display:block;position:absolute;inset:0;z-index:2'));
  assert.ok(html.includes('<span class="nav-neutral"><span class="nav-panel">'),'The hole wraps the row outside its rail pulse transform');
  assert.ok(html.includes('background:transparent}\n:root[data-glass="on"]:not([data-lgoff~="nav"]) .nav-red .nb'));
});

test('the live field combines complementary half planes without the former overlapping cap seam',()=>{
  const h=optics();assert.equal(h.filter.querySelectorAll('feGaussianBlur').length,0);
  for(const[name,input]of[['leftCore','rawNormals'],['rightCore','leftMixed']]){
    const node=h.filter.querySelector('[result="'+name+'"]');assert.equal(node.getAttribute('in'),input);assert.equal(node.getAttribute('operator'),'out');
  }
  const masks=h.NAV_OPTICS.rims.map(url=>normalMap(Buffer.from(url.split(',')[1],'base64')));
  for(const y of[0,21,128,234,255])for(const x of[0,127,128,255]){
    assert.equal(masks[0].at(x,y)[3]+masks[1].at(x,y)[3],1);
  }
});

test('all cached fields are opaque, neutral in the magnifier core and symmetric at either contact',t=>{
  assert.equal(packMeta.version,9);assert.equal(packMeta.offsets.length,130);assert.equal(packMeta.offsets.at(-1),packBytes.length-packBase);
  let min=Infinity,max=0;
  for(let i=0;i<129;i++){
    const map=prepared(i),ratio=1+i/64;assert.equal(map.width,288);assert.equal(map.height,232);
    for(const[u,v]of[[.5,.5],[.5,.4],[.5,.6]]){const p=sample(map,u,v);assert.ok(Math.abs(p[0]-.5)<.004&&Math.abs(p[1]-.5)<.004);assert.equal(p[3],1);}
    for(const v of[.25,.5,.75]){
      const r=packMeta.corner,dy=Math.max(r-v,v-(1-r),0),inset=r-Math.sqrt(r*r-dy*dy);
      const left=sample(map,inset/ratio,v),right=sample(map,1-inset/ratio,v);
      assert.ok(Math.abs(left[0]+right[0]-1)<.006);assert.ok(Math.abs(left[1]-right[1])<.004);
      for(const[side,u,p]of[[-1,inset/ratio,left],[1,1-inset/ratio,right]]){
        const x=u*ratio*55.8,source=ratio*55.8/2+(x+27*(p[0]-.5)-ratio*55.8/2)/1.14;
        const reach=side*(source-x);min=Math.min(min,reach);max=Math.max(max,reach);assert.ok(reach>-.25&&reach<.6,'Contact captures the first entering fragment without a delayed inner strip');
      }
    }
  }
  t.diagnostic(`Boundary source reach ${min.toFixed(3)}..${max.toFixed(3)}px`);
});

test('tab-centre captions retain the accepted refraction while sidewalls change',()=>{
  const oldBytes=fs.readFileSync(new URL('../public/nav-optics-fields-v8.bin',import.meta.url)),base=4+oldBytes.readUInt32LE(0),meta=JSON.parse(oldBytes.toString('utf8',4,base));
  for(const i of[0,16,32,64,96,128]){
    const old=normalMap(oldBytes.subarray(base+meta.offsets[i],base+meta.offsets[i+1])),current=prepared(i);
    for(let y=1;y<199;y++)for(const x of[128,142,144,146,160])for(const channel of[0,1])assert.ok(Math.abs(old.at(x,y+16)[channel]-current.at(x,y+16)[channel])<=1/255,'Centre glyphs cannot acquire the new sidewall compression');
  }
});

test('entering icons expand through a broad sidewall band and rise inside its shoulder',t=>{
  let minimum=Infinity,smallestLift=Infinity;
  for(const i of[0,32,64,112]){
    const map=prepared(i),h=55.8,w=(1+i/64)*h,r=.4*h,y=.3*h,dy=y-r,inset=r-Math.sqrt(r*r-dy*dy);
    const inverse=(x,y)=>{const p=sample(map,x/w,y/h);return[w/2+(x+27*(p[0]-.5)-w/2)/1.14,h/2+(y+27*(p[1]-.5)-h/2)/1.14];};
    for(const side of[-1,1]){
      const edge=side<0?inset:w-inset,x0=edge-side*1,x1=edge-side*6,a=inverse(x0,y),b=inverse(x1,y),zoom=Math.abs((x1-x0)/(b[0]-a[0]));
      minimum=Math.min(minimum,zoom);assert.ok(zoom>1.35&&zoom<2.2,'Five pixels inside contact must still magnify, instead of collapsing after the first pixel');
      const cx=side<0?r:w-r,vx=side*Math.sqrt((.8*r)**2-dy*dy),x=cx+vx,p=sample(map,x/w,y/h);
      const K=(p[0]-.5-(.2893333333333333*(cx-w/2)/h))/(.2893333333333333*vx/h);
      const baseG=.5+.2893333333333333*((r-h/2)+dy*K)/h;
      const lift=27*(p[1]-baseG)/1.14;smallestLift=Math.min(smallestLift,lift);
      assert.ok(lift>1.5,'The captured upper shoulder must rise, rather than bow down into the icon');
    }
  }
  t.diagnostic(`Broad-band magnification at least ${minimum.toFixed(3)}x; shoulder lift at least ${smallestLift.toFixed(3)}px`);
});

test('the field keeps bounded source derivatives across both medial joins',t=>{
  let maximum=0;
  for(const i of[0,32,64,128]){
    const map=prepared(i),ratio=1+i/64,h=55.8,w=ratio*h,r=packMeta.corner*h;
    const inv=(x,y)=>{const p=sample(map,x/w,y/h);return[(x+27*(p[0]-.5))/1.14,(y+27*(p[1]-.5))/1.14];};
    for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
      const cx=Math.max(r,Math.min(w-r,x)),cy=Math.max(r,Math.min(h-r,y));if(Math.hypot(x-cx,y-cy)>r-1)continue;
      const a=inv(x-.5,y),b=inv(x+.5,y),c=inv(x,y-.5),d=inv(x,y+.5);
      for(let axis=0;axis<2;axis++)maximum=Math.max(maximum,Math.abs(b[axis]-a[axis]),Math.abs(d[axis]-c[axis]));
    }
  }
  assert.ok(maximum<4,`No former 8–10px source jump: ${maximum}`);t.diagnostic(`Maximum inverse gradient ${maximum.toFixed(3)}`);
});

test('frames reuse graph nodes, disable idle effects and preserve all saved refraction settings',()=>{
  const h=optics(),nodes=[...h.filter.children],created=h.counts.created;
  for(let i=0;i<300;i++){h.box.left=1.2+i/300;h.ctx.NB.opticalEnergy=(i%100)/100;h.navLens((i%99+1)/100);}
  h.navOpticsBind(h.bar);assert.deepEqual(h.filter.children,nodes);assert.equal(h.counts.created,created);assert.equal(h.counts.images.length,6);
  const scales=()=>h.ctx.NB.optical.dms.map(n=>+n.getAttribute('scale'));
  h.navLens(1);let a=scales();assert.ok(a[0]<a[1]&&a[1]<a[2]);h.ctx.DISP.on=false;h.navLens(1);assert.equal(new Set(scales()).size,1);
  h.ctx.LG_UI.refract=0;h.navLens(1);assert.equal(h.source.style.filter,'');h.ctx.LG_UI.refract=1;h.navLens(1);assert.equal(h.source.style.filter,'url(#xc-nav-optics)');
  h.navLens(0);assert.equal(h.source.style.filter,'');
});

test('the complete phone contour retains sampled content inside the bounded filter region at maximum settings',t=>{
  const ctx={NB:{railWidth:384,clear:1,opticalEnergy:0},Math,clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('const NAV_DROP ='),html.indexOf('function navEase('))+'\nglobalThis.api={navTrackBuild,navBox};',ctx);
  ctx.NB.track=ctx.api.navTrackBuild(384,64);
  const maps=new Map(),strength=1.5*2.65/2.155,cal=optics().NAV_OPTICS;let maximum=0;
  for(const clear of[.25,.5,.75,1])for(const energy of[0,.2,.4,.6,.75,1])for(let u=0;u<=4;u+=.25){
    Object.assign(ctx.NB,{clear,opticalEnergy:energy});const box=ctx.api.navBox(u,u+1,0),h=55*box.sy,w=76.8*box.sx,ratio=Math.max(1,w/h),index=Math.round((ratio-1)*64);
    assert.ok(index>=0&&index<=128);if(!maps.has(index))maps.set(index,prepared(index));const map=maps.get(index),corner=.5-.1*clear,r=corner*h;
    const bend=clear*(cal.bend+cal.motion*energy)*strength*h/55.8*(1+cal.dispersion*2);
    for(let y=1;y<199;y+=2)for(let x=1;x<255;x+=2){
      const px=(x+.5)/256*w,py=(y+.5)/200*h,cx=Math.max(r,Math.min(w-r,px)),cy=Math.max(r,Math.min(h-r,py));
      if(Math.hypot(px-cx,py-cy)>r)continue;
      const p=map.at(x+16,y+16);maximum=Math.max(maximum,Math.abs(p[0]-.5)*bend*Math.min(1,w/h),Math.abs(p[1]-.5)*bend);
    }
  }
  assert.ok(maximum+1<cal.padding,`Sample offset ${maximum} plus antialiasing fits ${cal.padding}px`);t.diagnostic(`Maximum visible sample offset ${maximum.toFixed(3)}px`);
});

function fieldLoader(h, { bytes = packBytes, status = true, rejectDecode = false } = {}) {
  const stats = { fetched: 0, active: 0, maximumActive: 0, decoded: 0, urls: [], revoked: [], preloadModes: [] };
  h.ctx.Blob = Blob; h.ctx.TextDecoder = TextDecoder;
  h.ctx.URL = {
    createObjectURL: () => { const url = `blob:nav-test-${stats.urls.length}`; stats.urls.push(url); return url; },
    revokeObjectURL: url => stats.revoked.push(url),
  };
  h.ctx.fetch = async (url, options) => {
    assert.equal(url, h.NAV_OPTICS.fields); assert.equal(options.cache, 'no-cache'); stats.fetched++;
    return { ok: status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  h.ctx.Image = class {
    async decode() {
      stats.preloadModes.push(this.crossOrigin ?? null);
      stats.active++; stats.maximumActive = Math.max(stats.maximumActive, stats.active);
      await Promise.resolve(); stats.active--; stats.decoded++;
      if (rejectDecode && this.src === 'blob:nav-test-0') throw new Error('decode failed');
    }
  };
  return stats;
}

test('one bounded preparation replaces the mask graph for frames, without changing the RGB strengths', async () => {
  const h = optics(), stats = fieldLoader(h), scales = h.ctx.NB.optical.dms.map(n => n.getAttribute('scale'));
  const loading = h.navFieldsPrepare(); assert.equal(h.navFieldsPrepare(), loading);
  const fields = await loading; assert.ok(fields); assert.equal(stats.fetched, 1);
  assert.equal(stats.decoded, 129); assert.equal(stats.maximumActive, 4); assert.equal(stats.revoked.length, 0);
  assert.deepEqual(stats.preloadModes, Array(129).fill(null), 'Prepared PNGs use feImage\'s default fetch mode, so animation reuses the same loaded resources');
  assert.deepEqual(h.ctx.NB.optical.dms.map(n => n.getAttribute('scale')), scales);
  assert.equal(h.ctx.NB.optical.safeNormals.getAttribute('in'), 'preparedNormals');
  assert.ok(h.ctx.NB.optical.dms.every(n => n.getAttribute('in2') === 'edgeSafeNormals'));
  for (const name of ['x', 'y', 'width', 'height']) assert.equal(h.ctx.NB.optical.prepared.getAttribute(name), h.ctx.NB.optical.image.getAttribute(name), 'The prepared field keeps the same padded sampling rectangle');
  const pad=Math.min(h.NAV_OPTICS.padding,Math.ceil(+h.ctx.NB.optical.dms[2].getAttribute("scale")/2+1));
  near(+h.filter.getAttribute('width'), 114 + pad*2);
  near(+h.filter.getAttribute('height'), 55.8 + pad*2);
  assert.equal(h.navFieldAt(55.8, 55.8), stats.urls[0]); assert.equal(h.navFieldAt(167.4, 55.8), stats.urls[128]);
  assert.equal(h.navFieldAt(200, 55.8), null); assert.equal(h.navFieldAt(20, 55.8), stats.urls[0]);
  assert.equal(h.navFieldAt(168,84),stats.urls[64],'Tall orbs reuse the same normalized prepared field');
  const rawImage = h.ctx.NB.optical.image, rims = h.ctx.NB.optical.rims;
  const frozen = [rawImage, ...rims].map(n => [...n.attrs]), created = h.counts.created;
  for (let i = 0; i < 300; i++) { h.box.left = 1 + i / 100; h.box.sx = (90 + i % 60) / 76.8; h.navLens(1); }
  assert.deepEqual([rawImage, ...rims].map(n => [...n.attrs]), frozen, 'No animated mask/image geometry on the prepared path');
  assert.equal(stats.urls.length, 129); assert.equal(stats.decoded, 129); assert.equal(h.counts.created, created);
  h.box.sy=84/51;h.box.sx=168/76.8;h.navLens(1);
  assert.equal(h.ctx.NB.optical.safeNormals.getAttribute('in'),'preparedNormals');
  h.ctx.NB.optical.dms.forEach((dm,i)=>assert.ok(Math.abs(+dm.getAttribute('scale')-Number(scales[i])*84/55.8)<.002,'Refraction scales with orb height without decoding another map'));
  h.box.sx = 4; h.navLens(1);
  assert.equal(h.ctx.NB.optical.safeNormals.getAttribute('in'), 'normals', 'Uncached shapes retain the accepted live field');
  h.box.sx = 1.5; h.navLens(1);
  assert.equal(h.ctx.NB.optical.safeNormals.getAttribute('in'), 'preparedNormals');
  h.navOpticsBind(h.bar); await h.navFieldsPrepare(); assert.equal(stats.fetched, 1);
});

test('a missing or corrupt pack preserves live refraction and does not retry every binding', async () => {
  for (const options of [{ status: false }, { bytes: Buffer.from([1, 2]) }, { bytes: Buffer.alloc(16, 255) }]) {
    const h = optics(), stats = fieldLoader(h, options);
    assert.equal(await h.navFieldsPrepare(), null); assert.equal(h.getFields(), null);
    assert.equal(h.ctx.NB.optical.safeNormals.getAttribute('in'), 'normals');
    h.navOpticsBind(h.bar); await h.navFieldsPrepare(); assert.equal(stats.fetched, 1); assert.equal(stats.urls.length, 0);
  }
});

test('failed preparation waits for the other decoders before releasing every created URL', async () => {
  const h = optics(), stats = fieldLoader(h, { rejectDecode: true });
  assert.equal(await h.navFieldsPrepare(), null); assert.equal(stats.active, 0); assert.equal(h.getFields(), null);
  assert.deepEqual(stats.revoked.toSorted(), stats.urls.toSorted()); assert.ok(stats.urls.length <= 4);
});

// Exercise the actual frame entry point: unchanged clarity retains calibration, and setting endpoints
// must visibly remove/reapply the complete effect rather than only moving the settings knob.
test('navigation responds to the saved refraction dial and theme clarity without changing its contour', () => {
  const h = optics(), geometry = {...h.box};
  h.ctx.LG_UI.refract = .74; h.navLens(1);
  const middle = () => +h.ctx.NB.optical.dms[1].getAttribute('scale');
  near(middle(), Number((.74*(27+h.NAV_OPTICS.motion)).toFixed(4)));
  const sample=()=>applyMatrix(h.ctx.NB.optical.safeNormals,[.65,.65,.5,1]).slice(0,2).map(v=>(v-.5)*middle());
  const normal=sample();h.ctx.LG_UI.refract=1.11;h.navLens(1);const strong=sample();
  strong.forEach((value,i)=>assert.ok(Math.abs(value-normal[i]*1.5)<.0001,'The dial scales refraction on both axes, without silently clamping the vertical response'));h.ctx.LG_UI.refract=.74;h.navLens(1);
  h.ctx.LGQ.r = 0; h.navLens(1);
  assert.equal(h.source.style.filter, '');
  h.ctx.LGQ.r = 2.65; h.navLens(1);
  assert.equal(h.source.style.filter, 'url(#xc-nav-optics)');
  assert.ok(Math.abs(middle() - .74*(27+h.NAV_OPTICS.motion)*2.65/2.155) < .001);
  h.ctx.LG_UI.refract = 0; h.navLens(1); assert.equal(h.source.style.filter, '');
  h.ctx.LG_UI.refract = 1.5; h.navLens(1); assert.ok(middle() > 57);
  assert.deepEqual(h.box, geometry, 'Optical settings do not alter the accepted contour');
});
