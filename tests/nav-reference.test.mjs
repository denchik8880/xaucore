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
  near(first.left * 111, 4);
  near(first.sx * 111, 165);
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

test('long localizations retain the font floor without enlarging a drop into a neighbouring caption', () => {
  const { a } = harness();
  near(a.NB.track.fontSize, 10.5);
  const track = a.navTrackBuild(385, 60, [100, 75, 75, 75, 80]);
  assert.ok(track.fontSize >= 9 && track.fontSize < 10.5);
  for (let i = 0; i < 5; i++) {
    assert.ok(track.widths[i] <= track.limits[i]);
    const x = track.centres[i] * track.tabW, half = track.widths[i] * track.tabW / 2;
    if(i) assert.ok(x - half >= track.centres[i - 1] * track.tabW + track.captions[i - 1] / 2 + 2.5 - 1e-7);
    if(i < 4) assert.ok(x + half <= track.centres[i + 1] * track.tabW - track.captions[i + 1] / 2 - 2.5 + 1e-7);
  }
});

test('phone capsules clear every neighbouring letter at rest, held and throughout the centred rail pulse', () => {
  const labels = [33.8125, 44.875, 45.5625, 42.203125, 21.53125];
  for(const width of [292, 332, 356, 384, 422, 472]) for(const textScale of [1, 1.25, 1.5]) {
    const { a } = harness({ width, labels: labels.map(v => v * textScale) }), t = a.NB.track;
    for(let selected = 0; selected < 5; selected++) for(const clear of [0, .5, 1]) {
      Object.assign(a.NB, { clear, materialOn: true });
      const box = a.navBox(selected, selected + 1, 0), left = box.left * t.tabW, right = left + box.sx * t.tabW;
      for(let j = 0; j < 5; j++) if(j !== selected) for(const pulse of [1, 1.02, 1.04]) {
        const x = width / 2 + (t.centres[j] * t.tabW - width / 2) * pulse, half = t.captions[j] * pulse / 2;
        assert.ok(j < selected ? left >= x + half + 2.49 : right <= x - half - 2.49, `width ${width}, text ${textScale}, selected ${selected}, neighbour ${j}, pulse ${pulse}`);
      }
    }
  }
});

test('a narrow phone keeps the first reference profile as a low pill instead of a desktop-height balloon', () => {
  const { a } = harness({ width: 332, labels: [33.8125, 44.875, 45.5625, 42.203125, 21.53125] }), t = a.NB.track;
  Object.assign(a.NB, { clear: 1, materialOn: true });
  const first = a.navBox(0, 1, 0), middle = a.navBox(2, 3, 0);
  const height = first.sy * t.baseH, ratio = first.sx * t.tabW / height;
  assert.ok(height < 44 && height >= 39);
  assert.ok(ratio >= 1.8 && ratio <= 2.05);
  assert.ok(first.sx > middle.sx * 1.25, 'The first pill stays wider than the middle profile, as in the reference');
  a.NB.clear = 0;
  let previous = a.navBox(0, 1, 0).sy * t.baseH;
  for(let u = .01; u <= 1; u += .01) {
    const h = a.navBox(u, u + 1, 0).sy * t.baseH;
    assert.ok(Math.abs(h - previous) < .2, 'Height morphs continuously between the mobile profiles');
    previous = h;
  }
});

test('the unified contour preserves the visible matte height and the existing optical endpoint', () => {
  const profiles = [
    { width: 332, height: 60, labels: [33.8125, 44.875, 45.5625, 42.203125, 21.53125] },
    { width: 555, height: 86, labels: [0, 0, 0, 0, 0] },
  ];
  for(const profile of profiles) {
    const { a } = harness(profile), t = a.NB.track;
    for(let selected = 0; selected < 5; selected++) {
      Object.assign(a.NB, { clear: 1, materialOn: true });
      const held = a.navBox(selected, selected + 1, 0).sy * t.baseH;
      near(held, t.heights[selected] * (1 + a.NAV_DROP.activeHeight / a.NAV_DROP.height));
      a.NB.clear = 0;
      const idle = a.navBox(selected, selected + 1, 0).sy * t.baseH;
      near(idle, Math.min(t.heights[selected] * 1.15, t.restH));
      if(profile.width === 332 && selected === 0) assert.ok(idle > 48 && idle < 49, 'The accepted phone matte silhouette includes its former CSS enlargement');
      if(profile.width === 555) near(idle, 78);
    }
  }
});

test('fading the unified height is monotonic on both mobile and reference rails', () => {
  for(const profile of [
    { width: 332, height: 60, labels: [33.8125, 44.875, 45.5625, 42.203125, 21.53125] },
    { width: 555, height: 86, labels: [0, 0, 0, 0, 0] },
  ]) for(const materialOn of [true, false]) {
    const { a } = harness(profile), t = a.NB.track;
    Object.assign(a.NB, { clear: 1, materialOn });
    const held = a.navBox(0, 1, 0).sy * t.baseH;
    a.NB.clear = 0;
    const idle = a.navBox(0, 1, 0).sy * t.baseH, direction = Math.sign(idle - held);
    assert.equal(direction, profile.width === 332 ? 1 : -1, 'Phone fades grow into matte; reference fades contract into matte');
    let previous = held;
    for(let i = 1; i <= 100; i++) {
      a.NB.clear = 1 - i / 100;
      const height = a.navBox(0, 1, 0).sy * t.baseH;
      assert.ok(direction * (height - previous) >= -1e-9, `width ${profile.width}, material ${materialOn}, clear ${a.NB.clear}`);
      assert.ok(height >= Math.min(held, idle) - 1e-9 && height <= Math.max(held, idle) + 1e-9, 'The fade cannot overshoot either accepted silhouette');
      previous = height;
    }
    near(previous, idle);
  }
});

test('the terminal navigation frame uses the same four-decimal height as the optical tail', () => {
  const runtime = harness({ width: 332, labels: [33.8125, 44.875, 45.5625, 42.203125, 21.53125] }), { a, bar } = runtime;
  const write = bar.style.setProperty, writes = [];
  bar.style.setProperty = (name, value) => { if(name === '--sy') writes.push(value); write(name, value); };
  Object.assign(a.NB, { a: 0, b: 1, u: 0, target: 0, clear: 1, materialOn: true, materialTween: null });
  a.navGo(0);
  runtime.frame(116);
  assert.ok(writes.length > 0 && writes.every(value => /^\d+\.\d{4}$/.test(value)), 'A moving frame must not quantize height to three decimals');
  writes.length = 0;
  runtime.frame(329.99);
  const tail = writes.at(-1);
  assert.match(tail, /^\d+\.\d{4}$/);
  writes.length = 0;
  runtime.frame(330);
  assert.equal(a.NB.clear, 0);
  assert.equal(a.NB.raf, 0, 'This is the terminal frame, not another moving sample');
  assert.ok(writes.length > 0);
  assert.ok(writes.every(value => /^\d+\.\d{4}$/.test(value)));
  assert.deepEqual([...new Set(writes)], [tail], 'Stopping the RAF must not write a second, differently rounded height');
  assert.equal(bar.style.getPropertyValue('--sy'), tail);
});

test('a short attack can release and be re-grabbed without jumping either contour endpoint', () => {
  for(const profile of [
    { width: 332, height: 60, labels: [33.8125, 44.875, 45.5625, 42.203125, 21.53125] },
    { width: 555, height: 86, labels: [0, 0, 0, 0, 0] },
  ]) {
    const { a } = harness(profile);
    Object.assign(a.NB, { clear: 0, materialOn: false, materialTween: null });
    const sameContour = (before, after) => {
      for(const key of ['left', 'sx', 'sy']) near(after[key], before[key]);
    };
    a.navMaterialFrame(100, true);
    a.navMaterialFrame(150, true);
    assert.ok(a.NB.clear > 0 && a.NB.clear < 1, 'The finger releases before the attack reaches its full endpoint');
    const attack = a.navBox(2, 3, 0), attackClear = a.NB.clear;
    a.navMaterialFrame(150, false);
    near(a.NB.clear, attackClear);
    sameContour(attack, a.navBox(2, 3, 0));
    a.navMaterialFrame(210, false);
    assert.ok(a.NB.clear > 0 && a.NB.clear < attackClear);
    const fading = a.navBox(2, 3, 0), fadingClear = a.NB.clear;
    a.navMaterialFrame(210, true);
    near(a.NB.clear, fadingClear);
    sameContour(fading, a.navBox(2, 3, 0));
    a.navMaterialFrame(390, true);
    near(a.NB.clear, 1);
    near(a.navBox(2, 3, 0).sy * a.NB.track.baseH,
      a.NB.track.heights[2] * (1 + a.NAV_DROP.activeHeight / a.NAV_DROP.height));
  }
});

test('a thumb tap away from an item centre and small contact jitter still hold and choose that exact item', () => {
  const runtime = harness({ width: 332 }), { a, bar, counters } = runtime, t = a.NB.track;
  const x = 20 + t.centres[0] * t.tabW + 15;
  bar.onpointerdown({ button: 0, pointerType: 'touch', pointerId: 21, clientX: x, clientY: 530 });
  assert.equal(a.NB.drag.u, 0); assert.equal(a.NB.drag.moved, false);
  bar.onpointermove({ pointerId: 21, clientX: x + 4, clientY: 531 });
  assert.equal(a.NB.drag.u, 0); assert.equal(a.NB.drag.moved, false);
  for(let i = 1; i <= 90; i++) runtime.frame(100 + i * 1000 / 120);
  near(a.NB.u, 0, .001);
  bar.onpointerup({ pointerId: 21 });
  assert.equal(a.NB.target, 0); assert.deepEqual(counters.nav, ['markets']);
});

test('deliberate touch dragging preserves the contact offset instead of jumping to the edge of a thumb', () => {
  const { a, bar } = harness(), t = a.NB.track, rect = { left: 20, width: t.width };
  const x = 20 + t.centres[1] * t.tabW + 12;
  bar.onpointerdown({ button: 0, pointerType: 'touch', pointerId: 22, clientX: x, clientY: 530 });
  const pointer = a.navUAt(x, rect);
  bar.onpointermove({ pointerId: 22, clientX: x + 7, clientY: 530 });
  assert.equal(a.NB.drag.moved, true);
  near(a.NB.drag.u, 1 + a.navUAt(x + 7, rect) - pointer);
  assert.ok(a.NB.drag.u < a.navUAt(x + 7, rect));
});

test('a resized screen during touch dragging rebases its contact offset without moving the drop', () => {
  const runtime = harness({ width: 332 }), { a } = runtime, t = a.NB.track;
  const x = 20 + t.centres[1] * t.tabW + 12;
  runtime.bar.onpointerdown({ button: 0, pointerType: 'touch', pointerId: 23, clientX: x, clientY: 530 });
  runtime.bar.onpointermove({ pointerId: 23, clientX: x + 20, clientY: 530 });
  const u = a.NB.drag.u, next = runtime.replaceBar(422);
  near(a.NB.drag.u, u);
  next.onpointermove({ pointerId: 23, clientX: x + 20, clientY: 530 });
  near(a.NB.drag.u, u);
});

test('desktop mouse input retains its continuous pointer position', () => {
  const { a, bar } = harness(), t = a.NB.track, rect = { left: 20, width: t.width };
  const x = 20 + t.centres[0] * t.tabW + 15;
  bar.onpointerdown({ button: 0, pointerType: 'mouse', pointerId: 24, clientX: x, clientY: 530 });
  near(a.NB.drag.u, a.navUAt(x, rect)); assert.equal(a.NB.drag.moved, true);
  bar.onpointermove({ pointerId: 24, clientX: x + 4, clientY: 530 });
  near(a.NB.drag.u, a.navUAt(x + 4, rect));
});

test('a flight may span its two passing items but cannot reach an unrelated third caption', () => {
  const { a } = harness({ width: 332, labels: [33.8125, 44.875, 45.5625, 42.203125, 21.53125] }), t = a.NB.track;
  Object.assign(a.NB, { clear: 1, materialOn: true });
  for(let u = 0; u <= 4; u += .025) {
    const box = a.navBox(u, u + 1, 0), left = box.left * t.tabW, right = left + box.sx * t.tabW;
    for(let j = 0; j < 5; j++) if(j < Math.floor(u) || j > Math.ceil(u)) {
      const x = t.centres[j] * t.tabW, half = t.captions[j] / 2;
      assert.ok(right <= x - half || left >= x + half, `u ${u}, unrelated caption ${j}`);
    }
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
