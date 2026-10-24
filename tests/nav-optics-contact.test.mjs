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
    querySelector(tag) { return this.querySelectorAll(tag)[0] || null; }
  }
  const defs = new Element('defs'), source = new Element('source'), box = { left: 1.2, sx: 114 / 76.8, sy: 55.8 / 51 };
  const bar = new Element('bar'); bar.clientWidth = 384; bar.clientHeight = 60;
  bar.querySelector = selector => selector === '.nr-optics' ? source : null;
  const ctx = {
    Math, LG_LENS: true, LG_UI: { refract: 1 }, DISP: { on: true, drops: true, str: 50 },
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
  assert.equal(counts.images.length, 1); counts.images[0].onload();
  return { ...ctx.api, ctx, counts, defs, bar, source, box, filter: ctx.NB.optical.filter };
}
function applyMatrix(node, rgba) {
  const values = node.getAttribute('values').trim().split(/\s+/).map(Number);
  assert.equal(values.length, 20);
  return Array.from({ length: 4 }, (_, row) => values.slice(row * 5, row * 5 + 4).reduce((n, v, i) => n + v * rgba[i], values[row * 5 + 4]));
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} ≈ ${b}`);

test('side contact samples the incoming letter immediately while retaining the vertical normal field', t => {
  const h = optics(), image = h.filter.querySelector('feImage');
  const correction = h.filter.querySelectorAll('feColorMatrix').find(n => n.getAttribute('in') === image.getAttribute('result'));
  assert.ok(correction, 'Raw normals pass through the contact correction');
  const passes = h.filter.querySelectorAll('feDisplacementMap'); assert.equal(passes.length, 3);
  for (const dm of passes) {
    assert.equal(dm.getAttribute('in'), 'SourceGraphic');
    assert.equal(dm.getAttribute('in2'), 'normals');
    assert.equal(dm.getAttribute('xChannelSelector'), 'R'); assert.equal(dm.getAttribute('yChannelSelector'), 'G');
  }
  assert.ok(h.filter.children.indexOf(correction) < h.filter.children.indexOf(passes[0]));
  let minimumR = Infinity, maximumR = -Infinity;
  for (let p = 0; p < field.pixels.length; p += field.channels) {
    const raw = [field.pixels[p] / 255, field.pixels[p + 1] / 255, field.pixels[p + 2] / 255, field.channels === 4 ? field.pixels[p + 3] / 255 : 1];
    const corrected = applyMatrix(correction, raw);
    assert.ok(corrected[0] > 0 && corrected[0] < 1, 'The actual map never clips R at the SVG matrix clamp');
    minimumR = Math.min(minimumR, corrected[0]); maximumR = Math.max(maximumR, corrected[0]);
    for (const channel of [1, 2, 3]) near(corrected[channel], raw[channel]);
  }
  near(applyMatrix(correction, [.5, .5, .5, 1])[0], .5);
  let coreError = 0;
  for (const dx of [-16, 0, 16]) for (const dy of [-16, 0, 16]) {
    coreError = Math.max(coreError, Math.abs(applyMatrix(correction, field.at(field.width / 2 + dx, field.height / 2 + dy))[0] - .5));
  }
  assert.ok(coreError < .004, 'The neutral core stays neutral to the PNG quantization tolerance');
  // Sample the actual lower caption arc, not a synthetic positive/negative vector.
  const width = 114, height = 55.8, y = 45, r = height / 2;
  const inset = r - Math.sqrt(r * r - (y - r) ** 2), magnify = 1.165;
  const inwardGaps = [];
  for (const side of [-1, 1]) {
    const x = side < 0 ? inset : width - inset;
    const raw = field.at(16 + x / width * 256, 16 + y / height * 200), corrected = applyMatrix(correction, raw);
    for (const dm of passes) {
      const scale = Number(dm.getAttribute('scale')), oldDx = scale * (raw[0] - .5), dx = scale * (corrected[0] - .5);
      assert.ok(side * oldDx < 0 && side * dx > 0, 'Source sampling reaches outside the incoming side');
      near(scale * (corrected[1] - .5), scale * (raw[1] - .5));
      const oldGap = ((magnify - 1) * (width / 2 - x) + oldDx) / magnify;
      const gap = ((magnify - 1) * (width / 2 - x) + dx) / magnify;
      // Positive means sampling inside the edge, leaving an incoming letter behind the white patch.
      // A few pixels outward pick up that letter immediately; an unbounded pull would fold distant text.
      const inwardGap = -side * gap; inwardGaps.push(inwardGap);
      assert.ok(-side * oldGap > 10, 'The uncorrected field reproduces the delayed contact');
      assert.ok(inwardGap <= 0 && inwardGap >= -5, 'All RGB passes reach the incoming letter without excessive outward pull');
    }
  }
  t.diagnostic(`Signed inward contact gap ${Math.min(...inwardGaps).toFixed(4)}..${Math.max(...inwardGaps).toFixed(4)} local px; corrected R ${minimumR.toFixed(6)}..${maximumR.toFixed(6)}; core error ${coreError.toFixed(6)}`);
});

test('the original field feeds the lens core and only image-masked side arcs receive the contact correction', () => {
  const h = optics(), byResult = name => h.filter.children.find(n => n.getAttribute('result') === name);
  const correction = byResult('contactNormals'), mask = byResult('rimMask');
  const core = byResult('originalCore'), contact = byResult('contactRim'), mixed = byResult('normals');
  assert.equal(correction.getAttribute('in'), 'rawNormals');
  for (const [node, input, op] of [[core, 'rawNormals', 'out'], [contact, 'contactNormals', 'in']]) {
    assert.equal(node.getAttribute('in'), input); assert.equal(node.getAttribute('in2'), 'rimMask');
    assert.equal(node.getAttribute('operator'), op);
  }
  assert.equal(mixed.tag, 'feComposite'); assert.equal(mixed.getAttribute('operator'), 'arithmetic');
  assert.equal(mixed.getAttribute('in'), 'contactRim'); assert.equal(mixed.getAttribute('in2'), 'originalCore');
  assert.equal(+mixed.getAttribute('k2'), 1); assert.equal(+mixed.getAttribute('k3'), 1);
  assert.equal(mask.tag, 'feGaussianBlur'); assert.equal(mask.getAttribute('in'), 'rimShape');
  assert.equal(+mask.getAttribute('stdDeviation'), h.NAV_OPTICS.rimBlur);
  const shape = byResult('rimShape'); assert.equal(shape.tag, 'feMerge');
  assert.deepEqual(shape.children.map(n => n.getAttribute('in')), ['leftRim', 'rightRim']);
  const images = h.filter.querySelectorAll('feImage'); assert.equal(images.length, 4);
  for (const [i, image] of images.slice(1, 3).entries()) {
    const href = image.getAttribute('href'); assert.ok(href.startsWith('data:image/svg+xml,'));
    const svg = decodeURIComponent(href.slice(href.indexOf(',') + 1));
    assert.match(svg, /viewBox="0 0 120 120"/); assert.ok(svg.includes(`stroke-width="${h.NAV_OPTICS.rimStroke}"`));
    assert.ok(svg.includes(i ? 'M95.7071 25 A50 50 0 0 1 95.7071 95' : 'M24.2929 25 A50 50 0 0 0 24.2929 95'));
    assert.doesNotMatch(svg, /href=|<use|<foreignObject|<script|<image/);
    const x = 76.8 * h.box.left, w = 76.8 * h.box.sx, height = 51 * h.box.sy;
    assert.ok(Math.abs(+image.getAttribute('width') - 1.2 * height) < .001);
    assert.ok(Math.abs(+image.getAttribute('x') - (x + (i ? w - 1.1 * height : -.1 * height))) < .001);
    // The partial arcs stay on the sides: no correction band across the top or bottom captions.
    const top = +image.getAttribute('y') + (25 - h.NAV_OPTICS.rimStroke / 2) / 120 * 1.2 * height;
    assert.ok(top > (60 - height) / 2 + .09 * height);
  }
  // Complementary masks plus arithmetic addition preserve all raw channels when mask alpha is zero,
  // and preserve G/B/A at every feathered value. In particular, no global horizontal reversal remains.
  for (const [x, y] of [[40, 70], [120, 185], [248, 70]]) {
    const raw = field.at(x, y), corrected = applyMatrix(correction, raw);
    for (const alpha of [0, .1, .5, 1]) {
      const normal = raw.map((v, c) => v * (1 - alpha) + corrected[c] * alpha);
      for (const c of [1, 2, 3]) near(normal[c], raw[c]);
      if (!alpha) assert.deepEqual(normal, raw);
    }
  }
});

test('opaque source padding covers displaced samples while the existing outer capsule supplies the clip', t => {
  const rules = [...html.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rule = suffix => {
    const item = rules.find(m => m[1].trim().endsWith(suffix)); assert.ok(item, `CSS rule exists: ${suffix}`);
    return Object.fromEntries(item[2].split(';').filter(s => s.includes(':')).map(s => { const i = s.indexOf(':'); return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }));
  };
  const h = optics(), pad = rule('.nav-red .nr-optics::after'), outer = rule(' .nav-red'), source = rule('.nav-red .nr-optics');
  assert.equal(pad.inset, `-${h.NAV_OPTICS.padding}px`); assert.equal(pad.background, 'var(--nav-hole)');
  assert.equal(pad.position, 'absolute'); assert.equal(pad['z-index'], '-1'); assert.equal(pad['pointer-events'], 'none');
  for (const color of html.matchAll(/--nav-hole\s*:\s*([^;}]+)/g)) assert.match(color[1].trim(), /^#[\da-f]{3}(?:[\da-f]{3})?$/i, 'Theme backing remains opaque');
  assert.ok(outer['clip-path'].includes('var(--u,0)') && outer['clip-path'].includes('var(--sx,1)') && outer['clip-path'].includes('var(--sy,1)'));
  assert.equal(source['clip-path'], undefined); assert.notEqual(source.overflow, 'hidden');
  assert.ok(html.includes('<span class="nr-optics"><span class="nr-in">'), 'The complete source is nested inside the outer clip');
  h.ctx.LG_UI.refract = 1.5; h.ctx.DISP.str = 100; h.navLens(1);
  const maximumScale = Math.max(...h.filter.querySelectorAll('feDisplacementMap').map(n => +n.getAttribute('scale')));
  const image = h.filter.querySelector('feImage');
  const correction = h.filter.querySelectorAll('feColorMatrix').find(n => n.getAttribute('in') === image.getAttribute('result'));
  let maximumDeviation = 0;
  for (let p = 0; p < field.pixels.length; p += field.channels) {
    const corrected = applyMatrix(correction, [field.pixels[p] / 255, field.pixels[p + 1] / 255, field.pixels[p + 2] / 255, field.channels === 4 ? field.pixels[p + 3] / 255 : 1]);
    for (const c of [0, 1]) maximumDeviation = Math.max(maximumDeviation, Math.abs(corrected[c] - .5));
  }
  assert.ok(maximumScale * maximumDeviation < h.NAV_OPTICS.padding, 'Backing reaches every sample even at maximum refraction/dispersion');
  t.diagnostic(`Maximum corrected sample displacement ${(maximumScale * maximumDeviation).toFixed(4)} local px within ${h.NAV_OPTICS.padding}px opaque padding`);
});

test('animation and rebinding reuse the same side images, normal correction and three RGB passes', () => {
  const h = optics(), nodes = [...h.filter.children], created = h.counts.created, appended = h.counts.appended;
  const hrefs = h.filter.querySelectorAll('feImage').map(n => n.getAttribute('href'));
  for (let i = 0; i < 300; i++) {
    h.box.left = 1.2 + i / 300; h.ctx.NB.opticalEnergy = (i % 100) / 100; h.navLens((i % 99 + 1) / 100);
  }
  h.navOpticsBind(h.bar);
  assert.equal(h.ctx.NB.optical.filter, h.filter); assert.equal(h.counts.images.length, 1);
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

const packBytes = fs.readFileSync(new URL('../public/nav-optics-fields-v1.bin', import.meta.url));
const packBase = 4 + packBytes.readUInt32LE(0);
const packMeta = JSON.parse(packBytes.toString('utf8', 4, packBase));

test('the prepared fields retain the real vertical map and first-contact direction throughout the aspect range', () => {
  assert.equal(packMeta.version, 1); assert.equal(packMeta.min, 1); assert.equal(packMeta.step, 1 / 64);
  assert.equal(packMeta.offsets.length, 130); assert.equal(packMeta.offsets[0], 0);
  assert.equal(packMeta.offsets.at(-1), packBytes.length - packBase);
  let maximumVerticalError = 0;
  for (let i = 0; i < 129; i++) {
    const begin = packMeta.offsets[i], end = packMeta.offsets[i + 1]; assert.ok(end > begin);
    const prepared = normalMap(packBytes.subarray(packBase + begin, packBase + end));
    assert.equal(prepared.width, 288); assert.equal(prepared.height, 232);
    for (let y = 2; y < 198; y += 3) for (let x = 2; x < 254; x += 3) {
      const normal = prepared.at(x + 16, y + 16), raw = field.at(x + 16, y + 16);
      maximumVerticalError = Math.max(maximumVerticalError, Math.abs(normal[1] - raw[1]));
      assert.ok(Math.abs(normal[2] - raw[2]) <= 1 / 255 + 1e-10); assert.equal(normal[3], 1);
    }
    assert.ok(prepared.at(17, 116)[0] < .5, 'The left side samples its incoming letter');
    assert.ok(prepared.at(270, 116)[0] > .5, 'The right side samples its incoming letter');
    assert.ok(Math.abs(prepared.at(144, 116)[0] - .5) < .004, 'The middle stays neutral');
    for (const [x, y] of [[0, 0], [144, 0], [144, 231], [0, 116], [287, 116]]) {
      const rgba = prepared.at(x, y); assert.equal(rgba[3], 1);
      assert.ok(rgba.slice(0, 3).every(v => Math.abs(v - .5) < .01), 'The padded border stays opaque/neutral, preventing an RGB seam');
    }
  }
  assert.ok(maximumVerticalError <= 1 / 255 + 1e-10, `Vertical field error ${maximumVerticalError}`);
});

function fieldLoader(h, { bytes = packBytes, status = true, rejectDecode = false } = {}) {
  const stats = { fetched: 0, active: 0, maximumActive: 0, decoded: 0, urls: [], revoked: [] };
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
  assert.deepEqual(h.ctx.NB.optical.dms.map(n => n.getAttribute('scale')), scales);
  assert.ok(h.ctx.NB.optical.dms.every(n => n.getAttribute('in2') === 'preparedNormals'));
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
  assert.ok(h.ctx.NB.optical.dms.every(n => n.getAttribute('in2') === 'normals'), 'Uncached shapes retain the accepted live field');
  h.box.sx = 1.5; h.navLens(1);
  assert.ok(h.ctx.NB.optical.dms.every(n => n.getAttribute('in2') === 'preparedNormals'));
  h.navOpticsBind(h.bar); await h.navFieldsPrepare(); assert.equal(stats.fetched, 1);
});

test('a missing or corrupt pack preserves live refraction and does not retry every binding', async () => {
  for (const options of [{ status: false }, { bytes: Buffer.from([1, 2]) }, { bytes: Buffer.alloc(16, 255) }]) {
    const h = optics(), stats = fieldLoader(h, options);
    assert.equal(await h.navFieldsPrepare(), null); assert.equal(h.getFields(), null);
    assert.ok(h.ctx.NB.optical.dms.every(n => n.getAttribute('in2') === 'normals'));
    h.navOpticsBind(h.bar); await h.navFieldsPrepare(); assert.equal(stats.fetched, 1); assert.equal(stats.urls.length, 0);
  }
});

test('failed preparation waits for the other decoders before releasing every created URL', async () => {
  const h = optics(), stats = fieldLoader(h, { rejectDecode: true });
  assert.equal(await h.navFieldsPrepare(), null); assert.equal(stats.active, 0); assert.equal(h.getFields(), null);
  assert.deepEqual(stats.revoked.toSorted(), stats.urls.toSorted()); assert.ok(stats.urls.length <= 4);
});
