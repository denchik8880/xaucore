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
const fit = section('function navFit(bar){', 'const NAV_OPTICS =');
const bind = section('function navBind(bar){', '// a finger lifted outside everything');
const markup = section('function bottomNav(){', '/* =========================================================================\n   Event binding');
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const plain = value => JSON.parse(JSON.stringify(value));
const PREVIEW_LABELS = [33.8125, 44.875, 45.5625, 42.203125, 21.53125];

function harness({ width = 384, height = 64, labels = [34, 42, 43, 55, 50], viewport = width + 16, dataset } = {}) {
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
    window: { innerWidth: viewport },
    S: { ui: { tab: 'chart', marketOpen: false }, positions: [], pendings: [] },
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    glassOn: () => true, L: value => value,
    requestAnimationFrame: fn => { raf.set(++nextRaf, fn); return nextRaf; },
    setTimeout: fn => { fn(); return 0; },
    MO: { dt0: 1 / 120, P: { leadDrag: { k: 518.4, z: 0.62 }, trailDrag: { k: 300, z: 0.65 } },
      sp: (v, x, to, p, dt) => v + (-p.k * (x - to) - 2 * Math.sqrt(p.k) * p.z * v) * dt,
      steps: dt => Math.max(1, Math.ceil(dt * 240 - 1e-6)) },
    nav: tab => { counters.nav.push(tab); ctx.S.ui.tab = tab; },
    navLens() {}, navOpticsBind() {}, lgGlass() {}, navLoss: () => false,
    openNavCard: () => { counters.cards++; },
    document: {
      documentElement: { style: style(), dataset, get clientWidth() { return ctx.window.innerWidth; } },
      fonts: { status: 'loaded' },
      querySelector: selector => selector === '.bottomnav' ? currentBar : null,
      createRange() {
        let selected;
        return { selectNodeContents: text => { selected = text; }, getBoundingClientRect() {
          counters.ranges++;
          const scale = +ctx.document.documentElement.style.getPropertyValue('--nav-scale') || 1;
          return { width: selected.width * scale * (1 + ctx.api.NB.rail) };
        } };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(core + fit + bind + markup + '\nglobalThis.api={NB,NAV_DROP,NAV_MO,NAV_LIFT,navCorner,navOval,navEndness,navTrackBuild,navTrackAt,navUAt,navSlotStyle,navBox,navEndW,navGo,navPulse,navRailFrame,navRailValues,navBubFrame,navBind,navFit,bottomNav};', ctx);
  function makeBar(w = width, h = height) {
    const lens = { style: style(), classList: classes(), _idle: true };
    const bub = { style: style(), classList: classes() };
    const buttons = labels.map((value, i) => ({ childNodes: [{ nodeType: 3, textContent: `Label ${i}`, width: value }], style: style() }));
    const accent = labels.map(() => ({ style: style() }));
    return {
      isConnected: true, style: style(), classList: classes(), captures: [],
      get clientWidth() { counters.layout++; return w; },
      get clientHeight() { counters.layout++; return h; },
      getBoundingClientRect() {
        counters.layout++;
        const scale = +ctx.document.documentElement.style.getPropertyValue('--nav-scale') || 1;
        // The whole bar scales around its bottom centre. Its rail pulse is on
        // the child rows/surfaces, so it affects text ranges but not this rect.
        return { left: (ctx.window.innerWidth - w * scale) / 2, width: w * scale, height: h * scale, top: 500 + h - h * scale };
      },
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
    setViewport(value) { ctx.window.innerWidth = value; },
    point(u, offset = 0) {
      const rect = currentBar.getBoundingClientRect(), t = a.NB.track;
      return rect.left + rect.width / 2 + (a.navTrackAt(u).centre * t.tabW - t.width / 2) * (rect.width / t.width) * (1 + a.NB.rail) + offset;
    },
    frame(value) { now = value; raf.clear(); a.navBubFrame(value); },
    replaceBar(w = width, h = height) { currentBar = makeBar(w, h); a.navBind(currentBar); return currentBar; },
  };
}

// ---- the measured model (2026-11-15 reference: cTrader on iOS 26, 60 fps) ----
// Runs a tap from tab `from` to tab `to`, frames at 120 Hz from t = 100 ms, and returns per-frame samples.
function hop(runtime, from, to, ms = 1300, options = {}) {
  const { a } = runtime, t = a.NB.track;
  Object.assign(a.NB, { a: from, b: from + 1, u: from, target: from, va: 0, vb: 0, infl: 0, it: 0, vs: 0, clear: 0, cs: 0, t: 0, _pm: null, pulseAt: 0, tapAt: 0, homeAt: 0 });
  runtime.setNow(100); a.navGo(to);
  const rest = a.navBox(to, to + 1), samples = [];
  for (let i = 1; i * 1000 / 120 <= ms; i++) {
    const time = i * 1000 / 120;
    runtime.frame(100 + time);
    const box = a.navBox(a.NB.a, a.NB.b);
    samples.push({ time, u: a.NB.u, a: a.NB.a, b: a.NB.b, left: box.left, w: box.sx * t.tabW, h: box.sy * t.baseH, clear: a.NB.clear, cs: a.NB.cs, raf: a.NB.raf, rail: a.NB.rail });
    if (options.until && options.until(a)) break;
  }
  return { samples, rest: { w: rest.sx * t.tabW, h: rest.sy * t.baseH }, at: ms => samples.reduce((best, s) => Math.abs(s.time - ms) < Math.abs(best.time - ms) ? s : best) };
}

test('resting profiles use the uniform five-slot rail and fitted matte capsules', () => {
  const { a } = harness({ width: 555, height: 94, labels: [0, 0, 0, 0, 0] });
  const centres = [55.5, 166.5, 277.5, 388.5, 499.5], widths = [105, 120, 120, 120, 105];
  for (let i = 0; i < 5; i++) {
    const box = a.navBox(i, i + 1);
    near((box.left + box.sx / 2) * 111, centres[i]);
    near(box.sx * 111, widths[i]); near(box.sy * 85, 80);
  }
});

test('a hop follows the measured edge springs: the edge in front leads, the centre lands without overshoot', () => {
  const runtime = harness({ labels: PREVIEW_LABELS }), { samples, at } = hop(runtime, 2, 1);
  const progress = s => 2 - s.u;
  // the reference's centre (fraction of the hop): .26 at 50 ms, .49 at 83, .80 at 150, .91 at 200
  for (const [ms, expected] of [[50, .26], [83, .49], [150, .80], [200, .91]]) near(progress(at(ms)), expected, .07);
  const early = at(50);
  assert.ok(2 - early.a > 3 - early.b + .05, 'The leading (left) edge is ahead of the trailing one');
  assert.ok(samples.every(s => progress(s) <= 1.01), 'The centre barely passes its tab (the tail lands a hair late)');
  const last = samples.at(-1);
  near(last.a, 1); near(last.b, 2);
});

test('a hop stretches the drop about a quarter, and it gathers up again on arrival', () => {
  const runtime = harness({ labels: PREVIEW_LABELS }), { samples, rest, at } = hop(runtime, 2, 1);
  const widest = Math.max(...samples.map(s => s.w)) / rest.w;
  assert.ok(widest > 1.15 && widest < 1.4, `widest ${widest}`);
  assert.ok(at(250).w / rest.w < 1.06);
  near(samples.at(-1).w, rest.w, 1e-6);
});

test('the drop swells taller on landing, not in flight, and settles back to its pill', () => {
  const runtime = harness({ labels: PREVIEW_LABELS }), { samples, rest } = hop(runtime, 2, 1);
  const inFlight = samples.filter(s => s.time <= 80).map(s => s.h / rest.h);
  assert.ok(Math.max(...inFlight) < 1.08, 'Fast, the air goes into its length');
  const peak = samples.reduce((best, s) => s.h > best.h ? s : best);
  near(peak.h / rest.h, 1 + 0.28, .03);
  assert.ok(peak.time > 150 && peak.time < 300, `peak at ${peak.time} ms`);
  near(samples.at(-1).h, rest.h, 1e-6);
});

test('on an end tab the landing drop is pressed into the bar end as a long capsule, not a ball', () => {
  for (const [from, to] of [[1, 0], [3, 4]]) {
    const runtime = harness({ labels: PREVIEW_LABELS }), { a } = runtime, t = a.NB.track, scale = t.height / 94;
    const { samples, rest } = hop(runtime, from, to);
    const room = t.height - 2 * a.NAV_MO.endGap * scale;
    const near_end = samples.filter(s => to === 0 ? s.u <= .25 : s.u >= 3.75);
    assert.ok(near_end.length && near_end.every(s => s.h <= room + 1e-6), 'At the end it never rises past the bar');
    const landing = samples.filter(s => s.time > 120 && s.time < 320);
    const tallest = landing.reduce((best, s) => s.h > best.h ? s : best);
    assert.ok(tallest.h > room - 1 && tallest.w > rest.w * 1.08, `long and full height: ${tallest.w}x${tallest.h} vs ${rest.w}x${rest.h}`);
    // pressed into the wall: the outer end reaches the bar's end
    Object.assign(a.NB, { a: to, b: to + 1, u: to, it: 1, vs: 0 });
    const box = a.navBox(to, to + 1), outer = to === 0 ? box.left * t.tabW : t.width - (box.left + box.sx) * t.tabW;
    assert.ok(outer <= -a.NAV_MO.endPush * scale + 1e-6 && outer >= -14 * scale - 1e-6, `outer end ${outer}`);
    near(samples.at(-1).w, rest.w, 1e-6); near(samples.at(-1).h, rest.h, 1e-6);
  }
});

test('leaving an end tab the drop comes off the wall at once and fills the bar in flight, as the reference (Котирування → Чарт)', () => {
  for (const [from, to] of [[0, 1], [4, 3]]) {
    const runtime = harness({ labels: PREVIEW_LABELS }), { a } = runtime, T = a.NB.track;
    const { samples, at } = hop(runtime, from, to);
    const ratio = ms => at(ms).h / T.height;
    // the reference, as a share of the bar: 0.88 at rest, ~0.93 at 100 ms, ~0.96 at 133, ~0.98 at 200, ~0.92 landing
    assert.ok(ratio(67) > .9, `lifted at 67 ms: ${ratio(67)}`);
    assert.ok(ratio(133) > .94, `filling the bar at 133 ms: ${ratio(133)}`);
    const room = (T.height - 2 * a.NAV_MO.endGap * T.height / a.NAV_DROP.referenceH) / T.height;
    assert.ok(Math.max(...samples.map(s => s.h)) / T.height <= room + 1e-9, 'no higher than the bar');
    // nothing pulls it back to the wall: its centre only ever moves towards the new tab
    const centre = s => s.left + s.w / T.tabW / 2;                    // the box's centre, after the wall's pull
    for (let i = 1; i < samples.length && samples[i].time < 250; i++) assert.ok((centre(samples[i]) - centre(samples[i - 1])) * (to - from) >= -1e-9, `moves on at ${samples[i].time}`);
    near(a.navOval(1), 1, 1e-9);   // a capsule clear or not since 2026-11-22 (a tap draws the drag's shape)
  }
});

test('a long jump lands blown up too, and its stretch gives out softly', () => {
  const runtime = harness({ labels: PREVIEW_LABELS }), { a } = runtime, t = a.NB.track;
  const { samples, rest } = hop(runtime, 0, 3);
  const stretch = Math.max(...samples.map(s => s.w - rest.w)) / t.tabW;
  assert.ok(stretch > .35 && stretch < .7, `stretch ${stretch} tabs`);
  const peak = Math.max(...samples.map(s => s.h)) / rest.h;
  assert.ok(peak > 1.2, `landing swell ${peak}`);
});

test('the glass clears at once and greys back in two speeds, then the frames stop', () => {
  const runtime = harness({ labels: PREVIEW_LABELS }), { bar } = runtime, { samples, at } = hop(runtime, 2, 1);
  assert.ok(at(33).clear > .4 && at(33).cs > .4);
  assert.ok(at(150).clear > .9);
  const later = at(330);
  assert.ok(later.cs > later.clear + .1, 'The grey pill fills back in slower than the bend goes');
  const end = samples.at(-1);
  assert.equal(end.clear, 0); assert.equal(end.cs, 0); assert.equal(end.raf, 0);
  assert.equal(bar.style.getPropertyValue('--ng'), '0'); assert.equal(bar.style.getPropertyValue('--ngs'), '0');
});

test('the terminal frame writes the exact resting box once and stops', () => {
  const runtime = harness({ viewport: 360, labels: PREVIEW_LABELS }), { a, bar } = runtime;
  const writes = [], write = bar.style.setProperty;
  bar.style.setProperty = (name, value) => { if (name === '--sy' || name === '--sx') writes.push([name, value]); write(name, value); };
  hop(runtime, 1, 3);
  assert.equal(a.NB.raf, 0);
  assert.ok(writes.every(([, value]) => /^\d+\.\d{4}$/.test(value)));
  const rest = a.navBox(3, 4);
  assert.equal(bar.style.getPropertyValue('--sx'), rest.sx.toFixed(4));
  assert.equal(bar.style.getPropertyValue('--sy'), rest.sy.toFixed(4));
});

test('the bar breathes once per press: +2 % in ~100 ms, back by 200 ms, a shallow dip, then nothing', () => {
  const { a, setNow } = harness();
  let max = 0, min = 0, at200 = null;
  for (let ms = 0; ms <= 400; ms += 1) {
    const v = a.navPulse(ms); max = Math.max(max, v); min = Math.min(min, v);
    if (ms === 200) at200 = v;
  }
  near(max, .02, 1e-4); near(a.navPulse(100), .02, 1e-4);
  near(at200, 0, 1e-9); assert.ok(min < -.001 && min >= -.0016);
  assert.equal(a.navPulse(390), 0);
  a.NB.pulseAt = 100; setNow(200); a.navRailFrame(200);
  near(+a.navRailValues()['--nrsx'], 1.02, 1e-4); near(+a.navRailValues()['--nrsy'], 1.02, 1e-4);
  assert.equal(a.navRailValues()['--nrl'], undefined, 'Its white never darkens: no veil over the bar in any theme');
  a.navRailFrame(100 + 381); assert.equal(a.NB.pulseAt, 0); assert.equal(a.NB.rail, 0);
});

test('a press seeds the breath; its own release and a mid-breath tap do not restart it', () => {
  const { a, bar, setNow } = harness();
  bar.onpointerdown({ button: 0, pointerId: 1, clientX: 300, clientY: 500 });
  assert.equal(a.NB.pulseAt, 100); assert.equal(a.NB.tapAt, 100);
  setNow(150); bar.onpointerup({ pointerId: 1 });
  assert.equal(a.NB.pulseAt, 100); assert.equal(a.NB.tapAt, 100, 'The release ends the press that began at pointerdown');
  setNow(180); a.navGo(0);
  assert.equal(a.NB.pulseAt, 100, 'Half way up the breath is not restarted');
  setNow(400); a.navGo(2);
  assert.equal(a.NB.pulseAt, 400);
});

test('retargeting in flight keeps both edges where they are and moves them on continuously', () => {
  const runtime = harness(), { a } = runtime;
  hop(runtime, 1, 4, 80);
  const before = { a: a.NB.a, b: a.NB.b };
  runtime.setNow(190); a.navGo(0);
  near(a.NB.a, before.a); near(a.NB.b, before.b);
  runtime.frame(190 + 1000 / 120);
  // one 120 Hz frame at the ~20 tabs/s it was flying: momentum, not a jump
  assert.ok(Math.abs(a.NB.a - before.a) < .25 && Math.abs(a.NB.b - before.b) < .25);
  for (let i = 2; i < 150; i++) runtime.frame(190 + i * 1000 / 120);
  near(a.NB.a, 0); near(a.NB.b, 1); assert.equal(a.NB.target, 0);
});

test('a held lens is tall when the finger is slow and long and low when it is fast', () => {
  const { a } = harness({ labels: PREVIEW_LABELS }), t = a.NB.track;
  Object.assign(a.NB, { infl: 1, it: 1, vs: 0 });
  near(a.navBox(2, 3).sy * t.baseH, t.restH * 1.28);
  a.NB.vs = 8;
  assert.ok(a.navBox(2, 3).sy * t.baseH < t.restH * 1.04);
  Object.assign(a.NB, { infl: 0, it: 0, vs: 0 });
  near(a.navBox(2, 3).sy * t.baseH, t.restH);
});

test('phone sizes, overdrag and every inflation keep a finite round contour within the bounded shoulder overflow', () => {
  for (const width of [280, 320, 360, 385, 430, 500]) {
    const { a } = harness({ width, labels: [0, 0, 0, 0, 0] }), t = a.NB.track, overflow = 14 / 94 * t.height;
    for (const it of [0, .5, 1]) for (const vs of [0, 2, 8]) for (const u of [-.2, 0, .4, 1.5, 2, 3.6, 4, 4.2]) for (const span of [.4, 1, 1.25, 2, 8]) {
      Object.assign(a.NB, { it, vs });
      const box = a.navBox(u + .5 - span / 2, u + .5 + span / 2), w = box.sx * t.tabW, h = box.sy * t.baseH;
      assert.ok(Object.values(box).every(Number.isFinite)); assert.ok(h > 0 && w / h > .7);
      assert.ok(box.left * t.tabW >= -overflow - 1e-8);
      assert.ok((box.left + box.sx) * t.tabW <= t.width + overflow + 1e-8);
      assert.ok(h <= t.restH * 1.28 + 1e-8);
    }
  }
});

test('long localizations retain the font floor and the uniform anchors', () => {
  const { a } = harness(); near(a.NB.track.fontSize, 10.5);
  const normal = a.navTrackBuild(384, 64, PREVIEW_LABELS), long = a.navTrackBuild(384, 64, [100, 75, 75, 75, 80]);
  assert.ok(long.fontSize >= 9 && long.fontSize < 10.5); assert.deepEqual(plain(long.centres), plain(normal.centres));
  for (let i = 0; i < 5; i++) assert.ok(Number.isFinite(long.widths[i]) && long.widths[i] >= normal.widths[i]);
});

test('responsive screens uniformly scale the complete 384 by 64 composition', () => {
  const runtime = harness({ labels: PREVIEW_LABELS }), { a, ctx, counters, bar } = runtime, track = a.NB.track;
  const baseline = [];
  for (const it of [0, 1]) for (let selected = 0; selected < 5; selected++) {
    Object.assign(a.NB, { it, vs: 0 }); baseline.push({ it, selected, box: plain(a.navBox(selected, selected + 1)) });
  }
  const ranges = counters.ranges;
  for (const viewport of [308, 360, 412, 450, 528, 960]) {
    runtime.setViewport(viewport); a.navFit(bar);
    const scale = +ctx.document.documentElement.style.getPropertyValue('--nav-scale'), rect = bar.getBoundingClientRect();
    near(scale, Math.min(viewport - 16, 500) / 384, .00000051); near(rect.width, Math.min(viewport - 16, 500), .0002);
    near(rect.height / 64, rect.width / 384); assert.equal(a.NB.track, track);
    near(track.width, 384); near(track.height, 64); near(track.fontSize, 10.5); assert.equal(bar.style.getPropertyValue('--nav-is'), '30px');
    for (const sample of baseline) { Object.assign(a.NB, { it: sample.it, vs: 0 }); assert.deepEqual(plain(a.navBox(sample.selected, sample.selected + 1)), sample.box); }
  }
  assert.equal(counters.ranges, ranges, 'Viewport scaling needs no repeated caption measurement');
});

test('holding, travelling and fading need no per-tab colour writes or colour handover at arrival', () => {
  const runtime = harness(), { a, bar } = runtime;
  const items = bar.querySelectorAll('.nav-red .nb');
  let writes = 0;
  for (const item of items) {
    const original = item.style.setProperty;
    item.style.setProperty = (...args) => { writes++; original(...args); };
  }
  Object.assign(a.NB, { drag: { u: 1, moved: false } });
  runtime.frame(110);
  a.NB.drag = null; runtime.setNow(120); a.navGo(3);
  for (let i = 1; i <= 150; i++) runtime.frame(120 + i * 1000 / 120);
  assert.equal(a.NB.clear, 0);
  assert.equal(a.NB.raf, 0);
  assert.equal(writes, 0);
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
  assert.equal(a.NB.raf, 0);
});

test('light, dark and Aurora use the same trajectory geometry', () => {
  const { a, ctx } = harness();
  Object.assign(a.NB, { it: .8, vs: 1 });
  ctx.WATER = 1;
  const normal = plain(a.navBox(0.65, 1.9));
  ctx.WATER = 1.35;
  assert.deepEqual(plain(a.navBox(0.65, 1.9)), normal);
});

test('the authoritative phone composition has evenly spaced tabs and the new matte height', () => {
  const {a,bar}=harness({labels:PREVIEW_LABELS}),t=a.NB.track;
  near(bar.getBoundingClientRect().width,384);
  for(let i=0;i<5;i++){
    const box=a.navBox(i,i+1,0);near((box.left+box.sx/2)*t.tabW,38.4+i*76.8);
    near(box.sx*t.tabW,(i===0||i===4?105:120)*64/94);near(box.sy*t.baseH,80*64/94);
  }
});

test('a thumb tap away from an item centre and small contact jitter still hold and choose that exact item', () => {
  const runtime = harness({ viewport: 360 }), { a, bar, counters } = runtime;
  const x = runtime.point(0, 15);
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
  const runtime = harness({ viewport: 360 }), { a, bar } = runtime, rect = bar.getBoundingClientRect();
  const x = runtime.point(1, 12);
  bar.onpointerdown({ button: 0, pointerType: 'touch', pointerId: 22, clientX: x, clientY: 530 });
  const pointer = a.navUAt(x, rect);
  bar.onpointermove({ pointerId: 22, clientX: x + 7, clientY: 530 });
  assert.equal(a.NB.drag.moved, true);
  near(a.NB.drag.u, 1 + a.navUAt(x + 7, rect) - pointer);
  assert.ok(a.NB.drag.u < a.navUAt(x + 7, rect));
});

test('a resized screen during touch dragging rebases its contact offset without moving the drop', () => {
  const runtime = harness({ viewport: 360 }), { a } = runtime;
  const x = runtime.point(1, 12);
  runtime.bar.onpointerdown({ button: 0, pointerType: 'touch', pointerId: 23, clientX: x, clientY: 530 });
  runtime.bar.onpointermove({ pointerId: 23, clientX: x + 20, clientY: 530 });
  const u = a.NB.drag.u;
  runtime.setViewport(450);
  const next = runtime.replaceBar();
  near(a.NB.drag.u, u);
  next.onpointermove({ pointerId: 23, clientX: x + 20, clientY: 530 });
  near(a.NB.drag.u, u);
});

test('desktop mouse input retains its continuous pointer position', () => {
  const runtime = harness({ viewport: 960 }), { a, bar } = runtime, rect = bar.getBoundingClientRect();
  const x = runtime.point(0, 15);
  bar.onpointerdown({ button: 0, pointerType: 'mouse', pointerId: 24, clientX: x, clientY: 530 });
  near(a.NB.drag.u, a.navUAt(x, rect)); assert.equal(a.NB.drag.moved, true);
  bar.onpointermove({ pointerId: 24, clientX: x + 4, clientY: 530 });
  near(a.NB.drag.u, a.navUAt(x + 4, rect));
});

test('piecewise pointer inverse cancels both whole-bar scale and the independent centred rail pulse', () => {
  const runtime = harness(), { a } = runtime, track = a.NB.track;
  for(const viewport of [308, 360, 412, 528, 960]) for (const rail of [0, 0.012, 0.026]) {
    runtime.setViewport(viewport); a.navFit(runtime.bar); a.NB.rail = rail;
    const rect = runtime.bar.getBoundingClientRect();
    for (let i = 0; i < 5; i++) near(a.navUAt(runtime.point(i), rect), i);
    for (let i = 0; i < 4; i++) near(a.navUAt(runtime.point(i + .5), rect), i + 0.5);
    assert.ok(a.navUAt(-1000, rect) >= -0.2);
    assert.ok(a.navUAt(2000, rect) <= 4.2);
  }
});

test('caption measurement removes whole-bar scale and an existing rail pulse before rebuilding a track', () => {
  const baseline = plain(harness({ labels: PREVIEW_LABELS }).a.NB.track);
  for(const viewport of [308, 360, 528, 960]) for(const rail of [0, .012, .026]) {
    const runtime = harness({ viewport, labels: PREVIEW_LABELS }), { a, ctx } = runtime;
    a.NB.rail = rail; a.NB.track = null;
    a.navFit(runtime.bar);
    const track = plain(a.NB.track);
    delete track.key; const expected = { ...baseline }; delete expected.key;
    for(const key of ['width', 'height', 'tabW', 'baseH', 'restH', 'fontSize']) near(track[key], expected[key]);
    for(let i = 0; i < 5; i++) { near(track.centres[i], expected.centres[i]); near(track.widths[i], expected.widths[i]); }
    assert.ok(+ctx.document.documentElement.style.getPropertyValue('--nav-scale') > 0);
  }
});

test('ordinary and accent rows receive exactly the same five centre styles', () => {
  const { a } = harness();
  const markup = a.bottomNav();
  const plainStyles = [...markup.matchAll(/<button data-nav="[^"]+" class="[^"]*" style="([^"]+)"/g)].map(match => match[1]);
  const accentStyles = [...markup.matchAll(/<span class="nb" style="([^"]+)"/g)].map(match => match[1]);
  assert.equal(plainStyles.length, 5); assert.equal(accentStyles.length, 5);
  assert.deepEqual(plainStyles, accentStyles);
});

test('every optical letter and icon has the theme accent, with colour restricted by the existing outer clip', () => {
  const { a } = harness();
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  assert.match(css, /\.nav-red \.nb\{[^}]*color:var\(--nav-on\)/);
  assert.match(css, /\.nav-red \.nb>\.ic\{color:inherit\}/);
  assert.match(css, /\.bottomnav button\.on\{color:var\(--nav-item\)\}/);
  assert.match(css, /\.bottomnav button>\.ic\{color:var\(--nav-item\)\}/);
  assert.match(css, /\.bottomnav\{--nav-item:#000\}/, 'The other tabs are black, as on the reference');
  assert.match(css, /\.nav-red\{[^}]*clip-path:[^}]*var\(--u,0\)[^}]*var\(--sx,1\)/);
  for(let selected = 0; selected < 5; selected++) {
    Object.assign(a.NB, { u: selected, target: selected, a: selected, b: selected + 1 });
    const opticalItems = [...a.bottomNav().matchAll(/<span class="nb" style="([^"]*)"/g)];
    assert.equal(opticalItems.length, 5);
    for(const [, style] of opticalItems) assert.doesNotMatch(style, /--na:|\bcolor:|opacity:/, 'The outer capsule clips the full accent copy, including neighbouring letters');
  }
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
  near(a.NB.drag.rect.width, 384);
  next.onpointerup({ pointerId: 7 });
  assert.equal(a.NB.drag, null);
});

// ---- THE LIGHT BAR, REFITTED TO THE USER'S v3 VIDEO (2026-11-18). Without a data-theme (above) the harness runs
// NAV_MO - the dark and Aurora bars' motion, unchanged; a light document (dataset without theme) runs NAV_MO_LIGHT. ----
const LIGHT = { labels: PREVIEW_LABELS, dataset: {} };

test('light: the edge in front overshoots its mark by ~18 % and comes back, the one behind never passes its own', () => {
  for (const [from, to] of [[1, 2], [2, 1]]) {
    const runtime = harness(LIGHT), { samples } = hop(runtime, from, to);
    const lead = s => to > from ? s.b - (from + 1) : from - s.a, trail = s => to > from ? s.a - from : (from + 1) - s.b;
    const over = Math.max(...samples.map(lead));
    assert.ok(over > 1.12 && over < 1.25, `lead ${over}`);
    const peak = samples.find(s => lead(s) === over);
    assert.ok(peak.time > 120 && peak.time < 260, `lead peaks at ${peak.time} ms`);
    assert.ok(Math.max(...samples.map(trail)) <= 1.005, 'the trailing edge lands without passing');
    near(samples.at(-1).a, to); near(samples.at(-1).b, to + 1);
  }
});

test('light: the clear lens is ~7 % taller than its pill in flight as landed, and never reaches the bar’s outline', () => {
  const runtime = harness(LIGHT), { a } = runtime, t = a.NB.track, { samples, rest } = hop(runtime, 1, 2);
  const tall = Math.max(...samples.map(s => s.h)) / rest.h;
  assert.ok(tall > 1.05 && tall < 1.085, `swell ${tall}`);
  assert.ok(samples.filter(s => s.time > 60 && s.time < 120).every(s => s.h / rest.h > 1.03), 'already taller in flight');
  assert.ok(Math.max(...samples.map(s => s.h)) < t.height - 4, 'inside the bar');
  near(samples.at(-1).h, rest.h, 1e-6);
});

test('the clear lens is a capsule in every theme, tapped as dragged (user 2026-11-22: a tap drew a pointed oval)', () => {
  for (const dataset of [{}, { theme: 'dark' }, { theme: 'dark', tone: 'aurora' }]) {
    const { a } = harness({ labels: PREVIEW_LABELS, dataset });
    Object.assign(a.NB, { a: 1, b: 2, u: 1, target: 1 });
    near(a.navOval(1), 1, 1e-9); near(a.navOval(0), 1, 1e-9);
  }
});

test('light: a long caption has a third of the bar to spare each side, an end pill keeps the bar’s gap', () => {
  const labels = [34, 42, 43, 55, 70], { a } = harness({ labels, dataset: {} }), t = a.NB.track, gap = (t.height - t.restH) / 2;
  near(t.widths[1] * t.tabW, Math.max(120 * 64 / 94, 42 * t.fontSize / 10.5 + .67 * 64));
  // 2026-11-22 (20.png): the chosen end tab's caption is wholly in its pill, also at its foot where the round end curves in;
  // too long for its slot, the pill keeps the bar's gap and grows inward, the tab with it, 3 px clear of the next caption
  const R = t.restH / 2, fs = t.fontSize, dy = (33 + fs) / 2 - .12 * fs, inset = R - Math.sqrt(R * R - dy * dy);
  const c4 = t.centres[4] * t.tabW, half = 70 * fs / 10.5 / 2;
  assert.ok(t.widths[4] * t.tabW / 2 - half >= inset + 1.5 * Math.min(384 / 555, 64 / 94) - 1e-6, 'the caption inside the round end');
  near(c4 + t.widths[4] * t.tabW / 2, t.width - gap, 1e-6);
  assert.ok(c4 - half - (t.centres[3] * t.tabW + 55 * fs / 10.5 / 2) >= 3 - 1e-6, 'clear of the next caption');
  assert.ok(fs >= 8.5);
  const last = a.navBox(4, 5);
  assert.ok((last.left + last.sx) * t.tabW <= t.width - gap + 1e-6, 'the end pill stays inside the bar');
  // five tabs (2026-11-21): the end slot is narrower than the resting pill's minimum, so the bar's end caps it
  const room = 2 * (t.width - t.centres[4] * t.tabW - gap);
  assert.ok(last.sx * t.tabW >= Math.min(105 * 64 / 94, room) - 1e-6);
});

test('no resting pill reaches a neighbour, and each holds its whole caption (22.png; the five languages as measured)', () => {
  const LANGS = { ru: [33.8, 44.9, 45.6, 63.8, 57.1], en: [41.4, 34, 46.7, 57.3, 41.9], uk: [32, 41.2, 38.8, 60.2, 77.4], fr: [44.2, 58.7, 46.7, 63.8, 58.1], tr: [46.4, 44, 59.1, 54.3, 36.3] };
  for (const [lang, labels] of Object.entries(LANGS)) for (const [w, h] of [[384, 64]]) {
    const { a } = harness({ labels, dataset: {} }), t = a.navTrackBuild(w, h, labels), fs = t.fontSize, f = fs / 10.5;
    const R = t.restH / 2, dy = (33 + fs) / 2 - .12 * fs, inset = R - Math.sqrt(R * R - dy * dy);
    assert.ok(fs >= 8.5, lang + ' type ' + fs);
    for (let i = 0; i < 5; i++) {
      const c = t.centres[i] * t.tabW, half = t.widths[i] * t.tabW / 2;
      assert.ok(half - labels[i] * f / 2 >= inset - 1e-6, `${lang} ${w}: tab ${i}'s caption inside its pill`);
      for (const j of [i - 1, i + 1]) if (j >= 0 && j < 5) {
        const cj = t.centres[j] * t.tabW, reachJ = Math.max(labels[j] * f / 2, 15);
        assert.ok(Math.abs(cj - c) - half - reachJ >= 3 - 1e-6, `${lang} ${w}: tab ${i}'s pill clear of tab ${j}`);
      }
    }
  }
});

test('light: landing on an end tab the lens lies flush with the bar’s end, never out past it', () => {
  for (const [from, to] of [[1, 0], [3, 4]]) {
    const runtime = harness(LIGHT), { a } = runtime, t = a.NB.track, scale = t.height / 94, { samples } = hop(runtime, from, to);
    const out = Math.max(...samples.map(s => to === 0 ? -s.left * t.tabW : (s.left * t.tabW + s.w) - t.width));
    assert.ok(out <= 2 * scale + 1e-6, `out past the end by ${out}`);
    assert.ok(out >= -1, 'pressed against it');
  }
});

// ---- 2026-11-21: the drag lift (w1), the dark bar (w3, 13.png) ----
test('a sliding finger lifts the drop into a capsule as tall as the bar and 1.18 tabs long; let go, it lands as before', () => {
  const runtime = harness({ labels: PREVIEW_LABELS, dataset: {} }), { a } = runtime, t = a.NB.track, scale = t.height / 94;
  const room = t.height - 2 * a.NAV_MO.endGap * scale;
  Object.assign(a.NB, { dl: 1, clear: 1, infl: 1, it: 1, vs: 0, drag: null });
  const box = a.navBox(1, 2);
  assert.ok(box.sx >= a.NAV_LIFT.w - 1e-9, `lifted length ${box.sx} tabs`);
  near(box.sy * t.baseH, room, 1e-6);
  near(a.navOval(1), 1, 1e-9);                                   // a capsule, not the landing oval
  Object.assign(a.NB, { dl: 0, clear: 0, infl: 0, it: 0, a: 1, b: 2, u: 1, target: 1 });
  a.NB.drag = { id: 1, u: 1.5, start: 1, pointerU: 1, moved: true, slid: true, t0: 100, rect: runtime.bar.getBoundingClientRect() };
  for (let i = 1; i <= 30; i++) runtime.frame(100 + i * 1000 / 120);
  assert.ok(a.NB.dl > .95, `lifted: ${a.NB.dl}`);
  a.NB.drag = null;
  for (let i = 31; i <= 400; i++) runtime.frame(100 + i * 1000 / 120);
  assert.equal(a.NB.dl, 0);
});

test('dark and Aurora run the light bar 1:1 - its pill, its lens, its hop, its breath (user 2026-11-21: «в точности 1 в 1»)', () => {
  const runs = [{}, { theme: 'dark' }, { theme: 'dark', tone: 'aurora' }].map(dataset => {
    const runtime = harness({ labels: PREVIEW_LABELS, dataset }), t = runtime.a.NB.track, { samples, rest } = hop(runtime, 1, 2);
    Object.assign(runtime.a.NB, { clear: 1, infl: 1, it: 1, vs: 0, dl: 1 });
    return { restH: t.restH, widths: t.widths, rest, samples: samples.map(s => [s.time, s.a, s.b, s.h]), lifted: plain(runtime.a.navBox(1, 2)), pulse: runtime.a.navPulse(140) };
  });
  for (const r of runs.slice(1)) assert.deepEqual(plain(r), plain(runs[0]));
  near(runs[0].restH, 80 / 94 * 64, 1e-9);
});
