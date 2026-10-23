import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.env.XAUCORE_NAV_SOURCE || new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Actual navigation section exists: ${start}`);
  return html.slice(a, b);
}
const core = section('const NAV_TABS =', 'let _navCard =');
const fit = section('function navFit(bar){', '// VANTA\'s prepared normal field');
const bind = section('function navBind(bar){', '// a finger lifted outside everything');
const markup = section('function bottomNav(){', '/* =========================================================================\n   Event binding');
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ width = 385, height = 60, labels = [34, 42, 43, 38, 17] } = {}) {
  const raf = new Map(), counters = { layout: 0, ranges: 0, cards: 0, nav: [] };
  let now = 100, nextRaf = 0, currentBar;
  function style() {
    const values = new Map();
    return { setProperty: (k, v) => values.set(k, v), getPropertyValue: k => values.get(k) || '', removeProperty: k => values.delete(k), values };
  }
  function classes() {
    const values = new Set();
    return { add: k => values.add(k), remove: k => values.delete(k), toggle: (k, on) => on ? values.add(k) : values.delete(k), contains: k => values.has(k) };
  }
  const ctx = {
    Math, performance: { now: () => now }, LANG: 'ru', WATER: 1,
    S: { ui: { tab: 'chart', marketOpen: false }, positions: [], pendings: [] },
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    glassOn: () => true, L: value => value,
    requestAnimationFrame: fn => { raf.set(++nextRaf, fn); return nextRaf; },
    MO: { dt0: 1 / 120, P: { leadDrag: { k: 518.4, z: 0.62 }, trailDrag: { k: 300, z: 0.65 } },
      sp: (v, x, to, p, dt) => v + (-p.k * (x - to) - 2 * Math.sqrt(p.k) * p.z * v) * dt },
    nav: tab => { counters.nav.push(tab); ctx.S.ui.tab = tab; },
    navLens() {}, navOpticsBind() {}, lgGlass() {},
    openNavCard: () => { counters.cards++; },
    document: {
      fonts: { status: 'loaded' },
      querySelector: selector => selector === '.bottomnav' ? currentBar : null,
      createRange() {
        let selected;
        return { selectNodeContents: text => { selected = text; }, getBoundingClientRect() {
          counters.ranges++;
          return { width: selected.width * (1 + ctx.api.NB.rail * 0.70) };
        } };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(core + fit + bind + markup + '\nglobalThis.api={NB,NAV_DROP,navTrackBuild,navTrackAt,navUAt,navSlotStyle,navAccentWeight,navAccentWrite,navBox,navEndW,navGo,navEase,navMaterialFrame,navRailFrame,navRailValues,navBubFrame,navBind,navFit,bottomNav};', ctx);
  function makeBar(w = width, h = height) {
    const lens = { style: style(), classList: classes(), _idle: true };
    const bub = { style: style(), classList: classes() };
    const buttons = labels.map((value, i) => ({ childNodes: [{ nodeType: 3, textContent: `Label ${i}`, width: value }], style: style() }));
    const accent = labels.map(() => ({ style: style() }));
    return {
      isConnected: true, style: style(), classList: classes(), captures: [],
      get clientWidth() { counters.layout++; return w; },
      get clientHeight() { counters.layout++; return h; },
      getBoundingClientRect() { counters.layout++; return { left: 20, width: w, height: h, top: 500 }; },
      setPointerCapture(id) { this.captures.push(id); },
      querySelector: selector => selector === '.nav-lens' ? lens : selector === '.nav-bub' ? bub : null,
      querySelectorAll: selector => selector === 'button[data-nav]' ? buttons : selector === '.nav-red .nb' ? accent : [],
    };
  }
  currentBar = makeBar();
  const a = ctx.api;
  Object.assign(a.NB, { a: 1, b: 2, u: 1, target: 1 });
  a.navBind(currentBar);
  return {
    ctx, a, counters, raf, get bar() { return currentBar; },
    setNow(value) { now = value; },
    frame(value) { now = value; raf.clear(); a.navBubFrame(value); },
    replaceBar(w = width, h = height) { currentBar = makeBar(w, h); a.navBind(currentBar); return currentBar; },
  };
}

test('resting profiles reproduce all five reference centres and distinct capsule widths', () => {
  const { a } = harness({ width: 555, height: 86, labels: [0, 0, 0, 0, 0] });
  const centres = [86.5, 196.5, 287.5, 378.5, 478.5], widths = [156, 118, 118, 118, 136];
  for (let i = 0; i < 5; i++) {
    const box = a.navBox(i, i + 1, 0);
    near((box.left + box.sx / 2) * 111, centres[i]);
    near(box.sx * 111, widths[i]);
    near(box.sy * 77, 78);
  }
});

test('held middle capsules add the measured width and height without turning the end tabs into circles', () => {
  const { a } = harness({ width: 555, height: 86, labels: [0, 0, 0, 0, 0] });
  a.NB.clear = 1;
  for (let i = 1; i <= 3; i++) {
    const box = a.navBox(i, i + 1, 0);
    near(box.sx * 111, 160);
    near(box.sy * 77, 80);
  }
  const first = a.navBox(0, 1, 0);
  near(first.left, 0);
  near(first.sx * 111, 185.5);
  assert.ok(first.sx * 111 > first.sy * 77 * 2);
});

test('all phone sizes, overdrag and stretched transitions keep a finite contour inside the rail', () => {
  for (const width of [280, 320, 360, 385, 430, 500]) {
    const { a } = harness({ width, labels: [0, 0, 0, 0, 0] });
    for (const clear of [0, 0.3, 1]) for (const u of [-0.2, 0, 0.4, 1.5, 2, 3.6, 4, 4.2]) for (const span of [0.4, 1, 1.25, 2, 8]) {
      a.NB.clear = clear;
      const box = a.navBox(u + 0.5 - span / 2, u + 0.5 + span / 2, 0);
      assert.ok(Object.values(box).every(Number.isFinite));
      assert.ok(box.left >= -1e-9);
      assert.ok(box.sx > 0);
      assert.ok(box.left + box.sx <= 5 + 1e-9);
      assert.ok(box.sy * 51 <= 80 / 86 * 60 + 0.6 + 1e-9);
    }
  }
});

test('long localizations use the content guard and only reduce the font within its allowed floor', () => {
  const { a } = harness();
  near(a.NB.track.fontSize, 10.5);
  const track = a.navTrackBuild(385, 60, [100, 75, 75, 75, 80]);
  assert.ok(track.fontSize >= 9 && track.fontSize < 10.5);
  for (let i = 0; i < 5; i++) {
    assert.ok(track.widths[i] * track.tabW >= 1.35 * track.restH - 1e-7);
    assert.ok(track.widths[i] * track.tabW >= [100, 75, 75, 75, 80][i] * track.fontSize / 10.5 + 39 - 1e-7);
  }
});

test('piecewise pointer inverse picks exact centres and midpoints after the rail has swelled', () => {
  const { a } = harness(), track = a.NB.track;
  const rect = { left: 20, width: 385 };
  for (const rail of [0, 0.012, 0.026]) {
    a.NB.rail = rail;
    const screen = local => rect.left + rect.width / 2 + (local - track.width / 2) * (1 + rail * 0.70);
    for (let i = 0; i < 5; i++) near(a.navUAt(screen(track.centres[i] * track.tabW), rect), i);
    for (let i = 0; i < 4; i++) near(a.navUAt(screen((track.centres[i] + track.centres[i + 1]) / 2 * track.tabW), rect), i + 0.5);
    assert.ok(a.navUAt(-1000, rect) >= -0.2);
    assert.ok(a.navUAt(2000, rect) <= 4.2);
  }
});

test('ordinary and accent rows receive exactly the same five centre styles', () => {
  const { a } = harness();
  const markup = a.bottomNav();
  const plainStyles = [...markup.matchAll(/<button data-nav="[^"]+" class="[^"]*" style="([^"]+)"/g)].map(match => match[1]);
  const accentStyles = [...markup.matchAll(/<span class="nb" style="([^"]+)"/g)].map(match => match[1]);
  assert.equal(plainStyles.length, 5); assert.equal(accentStyles.length, 5);
  assert.deepEqual(plainStyles, accentStyles.map(value => value.split(';--na:')[0]));
});

test('a held current tab releases directly into the 230 ms fade with no empty flight', () => {
  const { a, setNow } = harness();
  Object.assign(a.NB, { clear: 1, materialOn: true, materialTween: null });
  a.navGo(1);
  assert.equal(a.NB.tw, null);
  assert.equal(a.NB.materialTween.to, 0);
  assert.equal(a.NB.materialTween.ms, 230);
  setNow(330); a.navMaterialFrame(330, false);
  near(a.NB.clear, 0); assert.equal(a.NB.materialTween, null);
});

test('a settled wide capsule leaves every neighbouring caption and icon without a selected tint', () => {
  const { a, bar } = harness();
  const items = bar.querySelectorAll('.nav-red .nb');
  for(let selected = 0; selected < 5; selected++) {
    a.navAccentWrite(bar, selected);
    assert.deepEqual(items.map(item => +item.style.getPropertyValue('--na')), Array.from({ length: 5 }, (_, i) => +(i === selected)));
    Object.assign(a.NB, { u: selected, target: selected, a: selected, b: selected + 1 });
    const weights = [...a.bottomNav().matchAll(/;--na:([\d.]+)/g)].map(match => +match[1]);
    assert.deepEqual(weights, Array.from({ length: 5 }, (_, i) => +(i === selected)), 'A rebuilt bar has the correct tint before its first frame');
  }
});

test('selected tint travels continuously between two neighbouring items and repeated frames do not rewrite it', () => {
  const { a, bar } = harness();
  const items = bar.querySelectorAll('.nav-red .nb');
  a.navAccentWrite(bar, 1.25);
  assert.deepEqual(items.map(item => +item.style.getPropertyValue('--na')), [0, .75, .25, 0, 0]);
  let writes = 0;
  for(const item of items) {
    const original = item.style.setProperty;
    item.style.setProperty = (...args) => { writes++; original(...args); };
  }
  a.navAccentWrite(bar, 1.25);
  assert.equal(writes, 0);
  a.navAccentWrite(bar, 2);
  assert.deepEqual(items.map(item => +item.style.getPropertyValue('--na')), [0, 0, 1, 0, 0]);
});

test('appearance starts at the initiating event and an adjacent flight takes 200 ms plus its tail', () => {
  const { a } = harness();
  a.navGo(2);
  assert.equal(a.NB.materialTween.t0, 100);
  assert.equal(a.NB.materialTween.ms, 180);
  near(Math.min(a.NB.tw.da, a.NB.tw.db), 200);
  near(a.NB.tw.end, 220);
  a.navMaterialFrame(116, true);
  assert.ok(a.NB.clear > 0); // The first display frame retains the event's elapsed 16 ms.
  a.navMaterialFrame(280, true); near(a.NB.clear, 1);
});

test('a fresh pointer press seeds the rail pulse without restarting it on immediate release', () => {
  const { a, bar, setNow } = harness();
  bar.onpointerdown({ button: 0, pointerId: 1, clientX: 300, clientY: 500 });
  assert.equal(a.NB.pulseAt, 100);
  setNow(150); bar.onpointerup({ pointerId: 1 });
  assert.equal(a.NB.pulseAt, 100);
  setNow(300); a.navGo(0);
  assert.equal(a.NB.pulseAt, 300);
});

test('retargeting an in-flight capsule preserves both edge positions', () => {
  const { a, frame } = harness();
  a.navGo(4); frame(100); frame(180);
  const before = { a: a.NB.a, b: a.NB.b };
  a.navGo(0);
  near(a.NB.a, before.a); near(a.NB.b, before.b);
  near(a.NB.tw.a0, before.a); near(a.NB.tw.b0, before.b);
  assert.equal(a.NB.target, 0);
});

test('pointer cancel returns to the selected tab and the upward middle gesture still opens its card', () => {
  const { a, bar, counters } = harness();
  bar.onpointerdown({ button: 0, pointerId: 1, clientX: 300, clientY: 500 });
  Object.assign(a.NB, { a: 2.6, b: 3.6 });
  bar.onpointercancel({ pointerId: 1 });
  assert.equal(a.NB.drag, null); assert.equal(a.NB.target, 1); assert.equal(counters.nav.length, 0);
  bar.onpointerdown({ button: 0, pointerId: 2, clientX: 212.5, clientY: 500 });
  bar.onpointermove({ pointerId: 2, clientX: 212.5, clientY: 460 });
  assert.equal(a.NB.drag, null); assert.equal(counters.cards, 1);
});

test('a screen rebuilt mid-gesture keeps its pointer and refreshes the cached rectangle', () => {
  const runtime = harness(), { a } = runtime;
  runtime.bar.onpointerdown({ button: 0, pointerId: 7, clientX: 220, clientY: 500 });
  const next = runtime.replaceBar();
  assert.equal(a.NB.drag.id, 7);
  assert.ok(next.captures.includes(7));
  assert.equal(a.NB.drag.rect.width, 385);
  next.onpointerup({ pointerId: 7 });
  assert.equal(a.NB.drag, null);
});

test('gesture frames reuse the frozen track and do not read layout or label ranges', () => {
  const runtime = harness(), { a, counters } = runtime;
  const track = a.NB.track;
  a.navGo(4);
  const reads = { layout: counters.layout, ranges: counters.ranges };
  for (let i = 0; i <= 180; i++) runtime.frame(100 + i * (1000 / 120));
  assert.equal(a.NB.track, track);
  assert.deepEqual({ layout: counters.layout, ranges: counters.ranges }, reads);
  assert.equal(a.NB.clear, 0);
  assert.equal(a.NB.tw, null);
});

test('light, dark and Aurora use the same trajectory geometry', () => {
  const { a, ctx } = harness();
  a.NB.clear = 0.8;
  ctx.WATER = 1;
  const normal = plain(a.navBox(0.65, 1.9, 0));
  ctx.WATER = 1.35;
  assert.deepEqual(plain(a.navBox(0.65, 1.9, 0)), normal);
});

test('the optical landing follows the measured fast decay and its contour contracts ahead of the tail', () => {
  const { a } = harness({ width: 555, height: 86, labels: [0, 0, 0, 0, 0] });
  Object.assign(a.NB, { clear: 1, materialOn: true, materialTween: null });
  a.navMaterialFrame(100, false);
  // Reference: roughly 76%, 64%, 32%, 22%, 8% after the peak, sampled at 30 fps.
  const measured = [[33, .76], [66, .64], [100, .32], [133, .22], [166, .08]];
  for (const [time, opacity] of measured) {
    a.navMaterialFrame(100 + time, false);
    near(a.NB.clear, opacity, .14);
  }
  a.NB.clear = .5;
  const box = a.navBox(2, 3, 0);
  assert.ok(box.sx * 111 < 118 + 42 * .5, 'The outline returns before the remaining half-strength optics');
});

test('the entire rail gives one centred 3% pulse and settles while its held lens stays clear', () => {
  const { a, setNow } = harness();
  Object.assign(a.NB, { pulseAt: 100, clear: 1, materialOn: true });
  let maximum = 1;
  for (let i = 1; i <= 60; i++) {
    setNow(100 + i * 1000 / 120); a.navRailFrame(1 / 120);
    const values = a.navRailValues(), sx = +values['--nrsx'], sy = +values['--nrsy'];
    near(sx, sy); assert.equal(values['--nry'], '0px');
    maximum = Math.max(maximum, sx);
    if (i >= 36) near(sx, 1, .001);
  }
  assert.ok(maximum > 1.025 && maximum < 1.04);
  assert.equal(a.NB.clear, 1);
});
