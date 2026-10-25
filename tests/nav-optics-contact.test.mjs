import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inflateSync } from 'node:zlib';

const html = fs.readFileSync(process.env.XAUCORE_NAV_SOURCE || new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = html.indexOf('const NAV_OPTICS ='), end = html.indexOf('function navBind(bar){', start);
assert.ok(start >= 0 && end > start, 'Actual navigation optics section exists');

// Decode the committed field without browser/image packages or generated fixture files.
function normalMap(png = fs.readFileSync(new URL('../public/nav-normal-map.png', import.meta.url))) {
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

function optics() {
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
  assert.equal(counts.images.length, 2); for (const image of counts.images) image.onload();
  return { ...ctx.api, ctx, counts, defs, bar, source, box, filter: ctx.NB.optical.filter };
}
function applyMatrix(node, rgba) {
  const values = node.getAttribute('values').trim().split(/\s+/).map(Number);
  assert.equal(values.length, 20);
  return Array.from({ length: 4 }, (_, row) => values.slice(row * 5, row * 5 + 4).reduce((n, v, i) => n + v * rgba[i], values[row * 5 + 4]));
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} ≈ ${b}`);

test('the loaded page contains the complete live lens inputs, independent of further network requests', () => {
  const h = optics();
  for(const [key,file] of [['map','nav-normal-map.png'],['coordinates','nav-contact-surface-v2.png']]){
    const url = h.NAV_OPTICS[key];
    assert.ok(url.startsWith('data:image/png;base64,'), 'A missing network image cannot silently disable the only live fallback');
    const embedded = Buffer.from(url.slice(url.indexOf(',')+1), 'base64');
    assert.deepEqual(embedded, fs.readFileSync(new URL('../public/'+file,import.meta.url)), 'Embedded and prepared inputs use the same committed pixels');
  }
});

test('both cap surfaces retain three RGB samples from the complete original source', () => {
  const h = optics(), images = h.filter.querySelectorAll('feImage');
  for (const [i, correction] of h.ctx.NB.optical.contact.entries()) {
    assert.equal(images[i+1].getAttribute('href'), h.NAV_OPTICS.coordinates);
    assert.equal(correction.getAttribute('in'), (i ? 'right' : 'left') + 'Coordinates');
    const topLeft = applyMatrix(correction, [.1,.2,.5,1]), bottomRight = applyMatrix(correction, [.9,.8,.5,1]);
    assert.ok(topLeft[0] < bottomRight[0] && topLeft[1] < bottomRight[1]);
    for (const n of [topLeft,bottomRight]) { near(n[2],.5); near(n[3],1); }
  }
  const passes = h.filter.querySelectorAll('feDisplacementMap'); assert.equal(passes.length, 3);
  const safe = h.ctx.NB.optical.safeNormals;
  assert.equal(safe.getAttribute('in'), 'normals');
  assert.deepEqual(safe.getAttribute('values').split(' ').map(Number), [1,0,0,0,0,0,.3,0,0,.35,0,0,1,0,0,0,0,0,1,0]);
  h.ctx.LG_UI.refract = 1.5; h.navLens(1);
  const strong = safe.getAttribute('values').split(' ').map(Number);
  assert.equal(strong[0], 1, 'First-contact horizontal bending keeps the full selected strength');
  assert.equal(strong[6], .2, 'Vertical bending is bounded before content reaches the capsule edge');
  for (const dm of passes) {
    assert.equal(dm.getAttribute('in'), 'SourceGraphic'); assert.equal(dm.getAttribute('in2'), 'edgeSafeNormals');
    assert.equal(dm.getAttribute('xChannelSelector'), 'R'); assert.equal(dm.getAttribute('yChannelSelector'), 'G');
  }
  for (const image of images) assert.equal(image.getAttribute('crossorigin'), 'anonymous');
});

test('the original field remains the core while separate circular caps supply curved contact', () => {
  const h = optics(), byResult = name => h.filter.children.find(n => n.getAttribute('result') === name);
  const core = byResult('originalCore'), mixed = byResult('normals');
  assert.equal(core.getAttribute('in'), 'rawNormals'); assert.equal(core.getAttribute('in2'), 'rimMask');
  assert.equal(core.getAttribute('operator'), 'out');
  assert.equal(mixed.getAttribute('in'), 'contactRim'); assert.equal(mixed.getAttribute('in2'), 'originalCore');
  assert.equal(mixed.getAttribute('operator'), 'arithmetic');
  assert.equal(+mixed.getAttribute('k2'), 1); assert.equal(+mixed.getAttribute('k3'), 1);
  for (const side of ['left', 'right']) {
    const mask = byResult(side+'Mask'), contact = byResult(side+'Contact');
    assert.equal(mask.tag, 'feGaussianBlur'); assert.equal(mask.getAttribute('in'), side+'Rim');
    assert.equal(+mask.getAttribute('stdDeviation'), h.NAV_OPTICS.rimBlur);
    assert.equal(contact.getAttribute('in'), side+'ContactNormals'); assert.equal(contact.getAttribute('in2'), side+'Mask');
    assert.equal(contact.getAttribute('operator'), 'in');
  }
  const images = h.filter.querySelectorAll('feImage'); assert.equal(images.length, 6);
  for (const [i, image] of images.slice(3, 5).entries()) {
    const href = image.getAttribute('href'); assert.ok(href.startsWith('data:image/svg+xml,'));
    const svg = decodeURIComponent(href.slice(href.indexOf(',') + 1));
    assert.ok(svg.includes(`stroke-width="${h.NAV_OPTICS.rimStroke}"`));
    assert.ok(svg.includes(i ? 'M60 10 A50 50 0 0 1 60 110' : 'M60 10 A50 50 0 0 0 60 110'));
    assert.doesNotMatch(svg, /href=|<use|<foreignObject|<script|<image|<rect/);
    const x = 76.8 * h.box.left, w = 76.8 * h.box.sx, height = 51 * h.box.sy;
    assert.ok(Math.abs(+image.getAttribute('width') - 1.2 * height) < .001);
    assert.ok(Math.abs(+image.getAttribute('x') - (x + (i ? w - 1.1 * height : -.1 * height))) < .001);
  }
});

test('opaque source padding covers displaced samples while the existing outer capsule supplies the clip', t => {
  const rules = [...html.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = suffix => {
    const item = rules.find(m => m[1].trim().endsWith(suffix)); assert.ok(item, `CSS rule exists: ${suffix}`);
    return Object.fromEntries(item[2].split(';').filter(s => s.includes(':')).map(s => { const i = s.indexOf(':'); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }));
  };
  const h = optics(), pad = rule('.nav-red .nr-optics::after'), outer = rule(' .nav-red'), source = rule('.nav-red .nr-optics');
  assert.equal(pad.inset, `-${h.NAV_OPTICS.sourcePadding}px`); assert.equal(pad.background, 'var(--nav-hole)');
  assert.equal(pad.position, 'absolute'); assert.equal(pad['z-index'], '-1'); assert.equal(pad['pointer-events'], 'none');
  for (const color of html.matchAll(/--nav-hole\s*:\s*([^;}]+)/g)) assert.match(color[1].trim(), /^#[\da-f]{3}(?:[\da-f]{3})?$/i, 'Theme backing remains opaque');
  assert.ok(outer['clip-path'].includes('var(--u,0)') && outer['clip-path'].includes('var(--sx,1)') && outer['clip-path'].includes('var(--sy,1)'));
  assert.equal(source['clip-path'], undefined); assert.notEqual(source.overflow, 'hidden');
  assert.ok(html.includes('<span class="nr-optics"><span class="nr-in">'), 'The complete source is nested inside the outer clip');
  h.ctx.LG_UI.refract = 1.5; h.ctx.LGQ.r = 2.65; h.ctx.DISP.str = 100; h.navLens(1);
  const maximumScale = Math.max(...h.filter.querySelectorAll('feDisplacementMap').map(n => +n.getAttribute('scale')));
  // Both encoded displacement channels are clamped to [0,1]. This conservative bound covers every
  // prepared ratio and the live coordinate field, including the largest slider values.
  assert.ok(maximumScale * .5 < h.NAV_OPTICS.sourcePadding);
  t.diagnostic(`Maximum possible sample displacement ${(maximumScale * .5).toFixed(3)}px within ${h.NAV_OPTICS.sourcePadding}px backing; output padding stays ${h.NAV_OPTICS.padding}px`);
});

test('animation and rebinding reuse the same side images, normal correction and three RGB passes', () => {
  const h = optics(), nodes = [...h.filter.children], created = h.counts.created, appended = h.counts.appended;
  const hrefs = h.filter.querySelectorAll('feImage').map(n => n.getAttribute('href'));
  for (let i = 0; i < 300; i++) {
    h.box.left = 1.2 + i / 300; h.ctx.NB.opticalEnergy = (i % 100) / 100; h.navLens((i % 99 + 1) / 100);
  }
  h.navOpticsBind(h.bar);
  assert.equal(h.ctx.NB.optical.filter, h.filter); assert.equal(h.counts.images.length, 2);
  assert.deepEqual(h.filter.children, nodes); assert.equal(h.counts.created, created); assert.equal(h.counts.appended, appended);
  assert.deepEqual(h.filter.querySelectorAll('feImage').map(n => n.getAttribute('href')), hrefs);
  h.navLens(1); const writes = h.counts.attributes; h.navLens(1); assert.equal(h.counts.attributes, writes, 'Unchanged frame does not rewrite the graph');
  const passes = h.filter.querySelectorAll('feDisplacementMap'), scales = () => passes.map(n => +n.getAttribute('scale'));
  const split = scales(); assert.ok(split[0] < split[1] && split[1] < split[2]);
  h.ctx.DISP.on = false; h.navLens(1); assert.equal(new Set(scales()).size, 1);
  h.ctx.LG_UI.refract = 0; h.navLens(1); assert.equal(h.source.style.filter, '');
  h.ctx.LG_UI.refract = 1; h.navLens(1); assert.equal(h.source.style.filter, 'url(#xc-nav-optics)');
  h.navLens(0); assert.equal(h.source.style.filter, ''); assert.equal(h.counts.created, created);
});

const packBytes = fs.readFileSync(new URL('../public/nav-optics-fields-v4.bin', import.meta.url));
const packBase = 4 + packBytes.readUInt32LE(0);
const packMeta = JSON.parse(packBytes.toString('utf8', 4, packBase));

test('prepared fields retain the original core and sample icons and captions at the first cap contact', () => {
  assert.equal(packMeta.version, 4); assert.equal(packMeta.min, 1); assert.equal(packMeta.step, 1 / 64);
  assert.equal(packMeta.contactSlope, 2.25); assert.equal(packMeta.contactSpan, 1.6);
  assert.equal(packMeta.offsets.length, 130); assert.equal(packMeta.offsets[0], 0);
  assert.equal(packMeta.offsets.at(-1), packBytes.length - packBase);
  let maximumVerticalError = 0;
  for (let i = 0; i < 129; i++) {
    const begin = packMeta.offsets[i], end = packMeta.offsets[i + 1]; assert.ok(end > begin);
    const prepared = normalMap(packBytes.subarray(packBase + begin, packBase + end));
    assert.equal(prepared.width, 288); assert.equal(prepared.height, 232);
    for (let y = 2; y < 198; y += 3) for (let x = 2; x < 254; x += 3) {
      const normal = prepared.at(x + 16, y + 16), raw = field.at(x + 16, y + 16);
      const height = packMeta.height, width = (packMeta.min + i * packMeta.step) * height;
      const lx = (x + .5) / 256 * width, ly = (y + .5) / 200 * height, r = height / 2;
      const onLeft = lx < r + 6 && Math.abs(Math.hypot(lx-r,ly-r)-r) < 6;
      const onRight = lx > width-r-6 && Math.abs(Math.hypot(lx-(width-r),ly-r)-r) < 6;
      if (!onLeft && !onRight) {
        maximumVerticalError = Math.max(maximumVerticalError, Math.abs(normal[1] - raw[1]));
        assert.ok(Math.abs(normal[0] - raw[0]) <= 1 / 255 + 1e-10, 'Horizontal core stays original');
      }
      assert.ok(Math.abs(normal[2] - raw[2]) <= 1 / 255 + 1e-10); assert.equal(normal[3], 1);
    }
    assert.ok(prepared.at(17, 116)[0] < .5, 'The left side samples its incoming letter');
    assert.ok(prepared.at(270, 116)[0] > .5, 'The right side samples its incoming letter');
    assert.ok(Math.abs(prepared.at(144, 116)[0] - .5) < .004, 'The middle stays neutral');
    for (const [x, y] of [[0, 0], [144, 0], [144, 231], [0, 116], [287, 116]]) {
      const rgba = prepared.at(x, y); assert.equal(rgba[3], 1);
      assert.ok(rgba.slice(0, 3).every(v => Math.abs(v - .5) < .06), 'The padded border stays opaque and near neutral, preventing an RGB seam');
    }
  }
  assert.ok(maximumVerticalError <= 1 / 255 + 1e-10, `Vertical field error ${maximumVerticalError}`);
});

// Decode the shipped prepared pixels, rather than assuming that an ideal correction is visible
// through its full mask. These icon heights were missing from the earlier caption-only regression.
test('the shipped field reaches the first intersected icon row and caption on both caps', t => {
  let minimum = Infinity, maximum = -Infinity;
  for (const index of [16, 40, 64, 88, 112, 128]) {
    const map = normalMap(packBytes.subarray(packBase + packMeta.offsets[index], packBase + packMeta.offsets[index + 1]));
    const h = packMeta.height, w = (packMeta.min + index * packMeta.step) * h, r = h / 2;
    const sample = (x, y) => {
      const ix = 16 + x / w * 256 - .5, iy = 16 + y / h * 200 - .5;
      const x0 = Math.floor(ix), y0 = Math.floor(iy), dx = ix-x0, dy = iy-y0;
      const a = map.at(x0,y0), b = map.at(x0+1,y0), c = map.at(x0,y0+1), d = map.at(x0+1,y0+1);
      return a.map((v,i) => (v*(1-dx)+b[i]*dx)*(1-dy)+(c[i]*(1-dx)+d[i]*dx)*dy);
    };
    for (const y of [18, r, 45]) for (const side of [-1, 1]) {
      const inset = r-Math.sqrt(r*r-(y-r)**2), x = side < 0 ? inset : w-inset, normal = sample(x,y);
      const sourceX = w/2 + (x+31*(normal[0]-.5)-w/2)/1.165;
      const reach = side*(sourceX-x); minimum = Math.min(minimum,reach); maximum = Math.max(maximum,reach);
      assert.ok(reach > -.15 && reach < 1.5, `Prepared cap samples its incoming row: ratio ${w/h}, y ${y}, side ${side}, reach ${reach}`);
    }
  }
  t.diagnostic(`Prepared inverse source reach ${minimum.toFixed(4)}..${maximum.toFixed(4)} local px at icon/caption cap contacts`);
});

test('the shipped cap pixels magnify the first captured fragment instead of cancelling its refraction', t => {
  const index = 64, map = normalMap(packBytes.subarray(packBase + packMeta.offsets[index], packBase + packMeta.offsets[index + 1]));
  const h = packMeta.height, w = 2 * h, r = h / 2;
  const normalX = (x,y) => {
    const px = 16+x/w*256-.5, py = 16+y/h*200-.5, ix = Math.floor(px), iy = Math.floor(py), fx = px-ix, fy = py-iy;
    return (map.at(ix,iy)[0]*(1-fx)+map.at(ix+1,iy)[0]*fx)*(1-fy)
      + (map.at(ix,iy+1)[0]*(1-fx)+map.at(ix+1,iy+1)[0]*fx)*fy;
  };
  let minimum = Infinity;
  for(const y of [18,r,45]) for(const side of [-1,1]){
    const inset = r-Math.sqrt(r*r-(y-r)**2), edge = side < 0 ? inset : w-inset;
    const inverse = x => w/2 + (x+27*.74*(normalX(x,y)-.5)-w/2)/(1+.14*.74);
    const x0 = edge-side*.25, x1 = edge-side*1.75;
    const magnification = Math.abs((x1-x0)/(inverse(x1)-inverse(x0)));
    minimum = Math.min(minimum,magnification);
    assert.ok(magnification > 1.3 && magnification < 2, `The first captured 1.5px must already bend at saved 74%: y=${y}, side=${side}, magnification=${magnification}`);
  }
  t.diagnostic(`Minimum first-fragment magnification at 74%: ${minimum.toFixed(3)}x`);
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
  near(+h.filter.getAttribute('width'), 114 + 48);
  near(+h.filter.getAttribute('height'), 55.8 + 48);
  assert.equal(h.navFieldAt(55.8, 55.8), stats.urls[0]); assert.equal(h.navFieldAt(167.4, 55.8), stats.urls[128]);
  assert.equal(h.navFieldAt(200, 55.8), null); assert.equal(h.navFieldAt(20, 55.8), null);
  const rawImage = h.ctx.NB.optical.image, rims = h.ctx.NB.optical.rims;
  const frozen = [rawImage, ...rims].map(n => [...n.attrs]), created = h.counts.created;
  for (let i = 0; i < 300; i++) { h.box.left = 1 + i / 100; h.box.sx = (90 + i % 60) / 76.8; h.navLens(1); }
  assert.deepEqual([rawImage, ...rims].map(n => [...n.attrs]), frozen, 'No animated mask/image geometry on the prepared path');
  assert.equal(stats.urls.length, 129); assert.equal(stats.decoded, 129); assert.equal(h.counts.created, created);
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
  near(middle(), 22.94);
  h.ctx.LGQ.r = 0; h.navLens(1);
  assert.equal(h.source.style.filter, '');
  h.ctx.LGQ.r = 2.65; h.navLens(1);
  assert.equal(h.source.style.filter, 'url(#xc-nav-optics)');
  assert.ok(Math.abs(middle() - 22.94 * 2.65 / 2.155) < .001);
  h.ctx.LG_UI.refract = 0; h.navLens(1); assert.equal(h.source.style.filter, '');
  h.ctx.LG_UI.refract = 1.5; h.navLens(1); assert.ok(middle() > 57);
  assert.deepEqual(h.box, geometry, 'Optical settings do not alter the accepted contour');
});
