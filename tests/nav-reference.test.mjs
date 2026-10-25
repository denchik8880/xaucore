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

function harness({ width = 384, height = 64, labels = [34, 42, 43, 38, 17], viewport = width + 16 } = {}) {
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
    MO: { dt0: 1 / 120, P: { leadDrag: { k: 518.4, z: 0.62 }, trailDrag: { k: 300, z: 0.65 } },
      sp: (v, x, to, p, dt) => v + (-p.k * (x - to) - 2 * Math.sqrt(p.k) * p.z * v) * dt },
    nav: tab => { counters.nav.push(tab); ctx.S.ui.tab = tab; },
    navLens() {}, navOpticsBind() {}, lgGlass() {},
    openNavCard: () => { counters.cards++; },
    document: {
      documentElement: { style: style(), get clientWidth() { return ctx.window.innerWidth; } },
      fonts: { status: 'loaded' },
      querySelector: selector => selector === '.bottomnav' ? currentBar : null,
      createRange() {
        let selected;
        return { selectNodeContents: text => { selected = text; }, getBoundingClientRect() {
          counters.ranges++;
          const scale = +ctx.document.documentElement.style.getPropertyValue('--nav-scale') || 1;
          return { width: selected.width * scale * (1 + ctx.api.NB.rail * 0.70) };
        } };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(core + fit + bind + markup + '\nglobalThis.api={NB,NAV_DROP,navTrackBuild,navTrackAt,navUAt,navSlotStyle,navBox,navEndW,navGo,navEase,navMaterialFrame,navRailFrame,navRailValues,navBubFrame,navBind,navFit,bottomNav};', ctx);
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
      return rect.left + rect.width / 2 + (a.navTrackAt(u).centre * t.tabW - t.width / 2) * (rect.width / t.width) * (1 + a.NB.rail * .70) + offset;
    },
    frame(value) { now = value; raf.clear(); a.navBubFrame(value); },
    replaceBar(w = width, h = height) { currentBar = makeBar(w, h); a.navBind(currentBar); return currentBar; },
  };
}

test('resting profiles use the new uniform five-slot rail and fitted matte capsules', () => {
  const { a } = harness({ width: 555, height: 94, labels: [0, 0, 0, 0, 0] });
  const centres = [55.5, 166.5, 277.5, 388.5, 499.5], widths = [105, 120, 120, 120, 105];
  for (let i = 0; i < 5; i++) {
    const box = a.navBox(i, i + 1, 0);
    near((box.left + box.sx / 2) * 111, centres[i]);
    near(box.sx * 111, widths[i]); near(box.sy * 85, 80);
  }
});

test('a held lens rises into the measured compact orb without trimming either end cap', () => {
  const { a } = harness({ width: 555, height: 94, labels: [0, 0, 0, 0, 0] });
  Object.assign(a.NB, { clear: 1, opticalEnergy: 0 });
  const widths=[139,125,125,125,114], heights=[116,124,124,124,119];
  for(let i=0;i<5;i++){
    const box=a.navBox(i,i+1,0), w=box.sx*111, h=box.sy*85;
    near(w,widths[i]);near(h,heights[i]);assert.ok(w/h>.95);
    if(i>0&&i<4)assert.ok(w/h<1.02,'A held middle lens is almost circular');
  }
  const first=a.navBox(0,1,0),last=a.navBox(4,5,0);
  near(first.left*111,-14);near(first.sx*111,139);
  near((last.left+last.sx)*111,556.5);near(last.sx*111,114);
});

test('speed stretches the compact orb and squashes its height independently of the control-edge span', () => {
  const { a } = harness({ width:555,height:94,labels:[0,0,0,0,0] });
  Object.assign(a.NB,{clear:1,opticalEnergy:0});const held=a.navBox(2,3,0);
  a.NB.opticalEnergy=.75;const moving=a.navBox(2,3,0);
  near(moving.sx*111,200);near(moving.sy*85,90);
  assert.ok(moving.sx>held.sx&&moving.sy<held.sy);
  assert.deepEqual(plain(a.navBox(1.5,3.5,0)),plain(moving),'Temporary control-edge separation does not add a second width stretch');
  a.NB.opticalEnergy=.3;const q=Math.pow(.3/.75,1.5),mid=a.navBox(2,3,0);
  near(mid.sx*111,125+75*q);near(mid.sy*85,124-34*Math.sqrt(q));
});

test('swelling near an end cannot feed the constrained silhouette centre back into motion energy', () => {
  const runtime=harness(),{a}=runtime,t=a.NB.track;
  const logical=a.navTrackAt(0).centre*t.tabW;
  Object.assign(a.NB,{a:0,b:1,u:0,target:0,drag:{u:0},clear:1,materialOn:true,materialTween:null,opticalEnergy:.75,_pm:logical,t:100});
  const before=a.navBox(0,1,0);assert.ok((before.left+before.sx/2)*t.tabW>logical+1);
  runtime.frame(100+1000/120);
  near(a.NB.opticalEnergy,.75*Math.exp(-(1/120)/.06));
  near(a.NB._pm,logical);
});

test('profile interpolation stays continuous through hold, movement and the shared fade', () => {
  const { a }=harness({width:555,height:94,labels:[0,0,0,0,0]});
  for(const clear of [0,.2,.7,1])for(const energy of [0,.3,.75]){
    Object.assign(a.NB,{clear,opticalEnergy:energy});
    for(const u of [0,.25,.5,.75,1,1.5,2,2.5,3,3.25,3.5,3.75,4]){
      const box=x=>a.navBox(x,x+1,0),before=box(u-1e-7),after=box(u+1e-7);
      for(const key of ['left','sx','sy'])assert.ok(Math.abs(before[key]-after[key])<.0001);
    }
  }
});

test('phone sizes and overdrag preserve a finite round contour within the bounded shoulder overflow', () => {
  for(const width of [280,320,360,385,430,500]){
    const {a}=harness({width,labels:[0,0,0,0,0]}),t=a.NB.track,overflow=14/94*t.height;
    for(const clear of [0,.3,1])for(const energy of [0,.3,.75])for(const u of [-.2,0,.4,1.5,2,3.6,4,4.2])for(const span of [.4,1,1.25,2,8]){
      Object.assign(a.NB,{clear,opticalEnergy:energy});
      const box=a.navBox(u+.5-span/2,u+.5+span/2,0),w=box.sx*t.tabW,h=box.sy*t.baseH;
      assert.ok(Object.values(box).every(Number.isFinite));assert.ok(w/h>.94&&h>0);
      assert.ok(box.left*t.tabW>=-overflow-1e-8);
      assert.ok((box.left+box.sx)*t.tabW<=t.width+overflow+1e-8);
      assert.ok(h<=124/94*t.height+1e-8);
    }
  }
});

test('long localizations retain the new font floor and uniform anchors without enlarging the active orb', () => {
  const {a}=harness();near(a.NB.track.fontSize,10.5);
  const normal=a.navTrackBuild(384,64,PREVIEW_LABELS),long=a.navTrackBuild(384,64,[100,75,75,75,80]);
  assert.ok(long.fontSize>=9&&long.fontSize<10.5);assert.deepEqual(plain(long.centres),plain(normal.centres));
  for(let i=0;i<5;i++)assert.ok(Number.isFinite(long.widths[i])&&long.widths[i]>=normal.widths[i]);
  a.NB.clear=1;a.NB.track=normal;const before=plain(a.navBox(1,2,0));a.NB.track=long;
  assert.deepEqual(plain(a.navBox(1,2,0)),before,'The pressed target is independent of caption fitting');
});

test('responsive screens uniformly scale the complete 384 by 64 composition', () => {
  const runtime=harness({labels:PREVIEW_LABELS}),{a,ctx,counters,bar}=runtime,track=a.NB.track;
  const baseline=[];
  for(const clear of [0,1])for(let selected=0;selected<5;selected++){
    Object.assign(a.NB,{clear,materialOn:true});baseline.push({clear,selected,box:plain(a.navBox(selected,selected+1,0))});
  }
  const ranges=counters.ranges;
  for(const viewport of [308,360,412,450,528,960]){
    runtime.setViewport(viewport);a.navFit(bar);
    const scale=+ctx.document.documentElement.style.getPropertyValue('--nav-scale'),rect=bar.getBoundingClientRect();
    near(scale,Math.min(viewport-16,500)/384,.00000051);near(rect.width,Math.min(viewport-16,500),.0002);
    near(rect.height/64,rect.width/384);assert.equal(a.NB.track,track);
    near(track.width,384);near(track.height,64);near(track.fontSize,10.5);assert.equal(bar.style.getPropertyValue('--nav-is'),'30px');
    for(const sample of baseline){Object.assign(a.NB,{clear:sample.clear,materialOn:true});assert.deepEqual(plain(a.navBox(sample.selected,sample.selected+1,0)),sample.box);}
  }
  assert.equal(counters.ranges,ranges,'Viewport scaling needs no repeated caption measurement');
});

test('the authoritative phone composition has evenly spaced tabs and the new matte height', () => {
  const {a,bar}=harness({labels:PREVIEW_LABELS}),t=a.NB.track;
  near(bar.getBoundingClientRect().width,384);
  for(let i=0;i<5;i++){
    const box=a.navBox(i,i+1,0);near((box.left+box.sx/2)*t.tabW,38.4+i*76.8);
    near(box.sx*t.tabW,(i===0||i===4?105:120)*64/94);near(box.sy*t.baseH,80*64/94);
  }
});

test('all active height endpoints and the complete fade share one contour envelope', () => {
  for(const profile of [{viewport:360,labels:PREVIEW_LABELS},{width:555,height:94,labels:[0,0,0,0,0]}]){
    const {a}=harness(profile),t=a.NB.track;
    for(let selected=0;selected<5;selected++)for(const materialOn of [true,false]){
      Object.assign(a.NB,{clear:1,materialOn,opticalEnergy:0});const held=a.navBox(selected,selected+1,0);
      near(held.sy*t.baseH,a.NAV_DROP.activeHeights[selected]/94*t.height);
      a.NB.clear=0;const idle=a.navBox(selected,selected+1,0);near(idle.sy*t.baseH,t.restH);
      for(let i=0;i<=100;i++){
        const clear=i/100;a.NB.clear=clear;const box=a.navBox(selected,selected+1,0);
        near(box.sy,idle.sy+(held.sy-idle.sy)*clear);
        near(box.sx,idle.sx+(held.sx-idle.sx)*clear);
      }
    }
  }
});

test('the terminal navigation frame uses the same four-decimal height as the optical tail', () => {
  const runtime = harness({ viewport: 360, labels: PREVIEW_LABELS }), { a, bar } = runtime;
  const write = bar.style.setProperty, writes = [];
  bar.style.setProperty = (name, value) => { if(name === '--sy') writes.push(value); write(name, value); };
  Object.assign(a.NB, { a: 0, b: 1, u: 0, target: 0, clear: 1, materialOn: true, materialTween: null });
  a.navGo(0);
  runtime.frame(116);
  assert.ok(writes.length > 0 && writes.every(value => /^\d+\.\d{4}$/.test(value)), 'A moving frame must not quantize height to three decimals');
  writes.length = 0;
  runtime.frame(299.99);
  const tail = writes.at(-1);
  assert.match(tail, /^\d+\.\d{4}$/);
  writes.length = 0;
  runtime.frame(300);
  assert.equal(a.NB.clear, 0);
  assert.equal(a.NB.raf, 0, 'This is the terminal frame, not another moving sample');
  assert.ok(writes.length > 0);
  assert.ok(writes.every(value => /^\d+\.\d{4}$/.test(value)));
  assert.deepEqual([...new Set(writes)], [tail], 'Stopping the RAF must not write a second, differently rounded height');
  assert.equal(bar.style.getPropertyValue('--sy'), tail);
});

test('a short attack can release and be re-grabbed without jumping either contour endpoint', () => {
  for(const profile of [
    { viewport: 360, labels: PREVIEW_LABELS },
    { width: 555, height: 94, labels: [0, 0, 0, 0, 0] },
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
    a.navMaterialFrame(410, true);
    near(a.NB.clear, 1);
    near(a.navBox(2, 3, 0).sy * a.NB.track.baseH,
      a.NAV_DROP.activeHeights[2] / a.NAV_DROP.referenceH * a.NB.track.height);
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

test('the active flight keeps its compact held target and derives stretching from speed', () => {
  const { a } = harness({ labels: PREVIEW_LABELS }), t = a.NB.track;
  Object.assign(a.NB, { clear: 1, materialOn: true, opticalEnergy: 0 });
  const centred = a.navBox(1.5, 2.5, 0);
  near(centred.sx * t.tabW, 125*64/94);
  near(centred.sy * t.baseH, 124*64/94);
  const stretched = a.navBox(1.25, 2.75, 0);
  assert.deepEqual(plain(stretched),plain(centred));
  a.NB.opticalEnergy=.75;const fast=a.navBox(1.5,2.5,0);
  near(fast.sx*t.tabW,200*64/94);near(fast.sy*t.baseH,90*64/94);
  near(fast.left+fast.sx/2,centred.left+centred.sx/2);
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

test('a held current tab releases directly into the 200 ms fade with no empty flight', () => {
  const { a, setNow } = harness();
  Object.assign(a.NB, { clear: 1, materialOn: true, materialTween: null });
  a.navGo(1);
  assert.equal(a.NB.tw, null);
  assert.equal(a.NB.materialTween.to, 0);
  assert.equal(a.NB.materialTween.ms, 200);
  setNow(300); a.navMaterialFrame(300, false);
  near(a.NB.clear, 0); assert.equal(a.NB.materialTween, null);
});

test('every optical letter and icon has the theme accent, with colour restricted by the existing outer clip', () => {
  const { a } = harness();
  const css = html.slice(html.indexOf('<style'), html.indexOf('</style>'));
  assert.match(css, /\.nav-red \.nb\{[^}]*color:var\(--nav-on\)/);
  assert.match(css, /\.nav-red \.nb>\.ic\{color:inherit\}/);
  assert.match(css, /\.bottomnav button\.on\{color:var\(--ink\)\}/);
  assert.match(css, /\.bottomnav button>\.ic\{color:var\(--nav-ic\)\}/);
  assert.match(css, /\.nav-red\{[^}]*clip-path:[^}]*var\(--u,0\)[^}]*var\(--sx,1\)/);
  for(let selected = 0; selected < 5; selected++) {
    Object.assign(a.NB, { u: selected, target: selected, a: selected, b: selected + 1 });
    const opticalItems = [...a.bottomNav().matchAll(/<span class="nb" style="([^"]*)"/g)];
    assert.equal(opticalItems.length, 5);
    for(const [, style] of opticalItems) assert.doesNotMatch(style, /--na:|\bcolor:|opacity:/, 'The outer capsule clips the full accent copy, including neighbouring letters');
  }
});

test('holding, travelling and fading need no per-tab colour writes or colour handover at arrival', () => {
  const runtime = harness(), { a, bar } = runtime;
  const items = bar.querySelectorAll('.nav-red .nb');
  let writes = 0;
  for(const item of items) {
    const original = item.style.setProperty;
    item.style.setProperty = (...args) => { writes++; original(...args); };
  }
  Object.assign(a.NB, { clear: 1, materialOn: true, drag: { u: 1, moved: false } });
  runtime.frame(110);
  a.NB.drag = null; runtime.setNow(120); a.navGo(3);
  for(let i = 1; i <= 150; i++) runtime.frame(120 + i * 1000 / 120);
  assert.equal(a.NB.clear, 0);
  assert.equal(a.NB.tw, null);
  assert.equal(a.NB.raf, 0);
  assert.equal(writes, 0);
});

test('appearance starts at the initiating event and an adjacent flight takes 200 ms plus its tail', () => {
  const { a } = harness();
  a.navGo(2);
  assert.equal(a.NB.materialTween.t0, 100);
  assert.equal(a.NB.materialTween.ms, 200);
  near(Math.min(a.NB.tw.da, a.NB.tw.db), 200);
  near(a.NB.tw.end, 220);
  a.navMaterialFrame(116, true);
  assert.ok(a.NB.clear > 0); // The first display frame retains the event's elapsed 16 ms.
  a.navMaterialFrame(300, true); near(a.NB.clear, 1);
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
  near(a.NB.drag.rect.width, 384);
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

test('the 200 ms landing keeps the contour coupled to the same optical decay', () => {
  const { a } = harness({ width: 555, height: 94, labels: [0, 0, 0, 0, 0] });
  Object.assign(a.NB, { clear: 1, materialOn: true, materialTween: null, opticalEnergy:0 });
  a.navMaterialFrame(100, false);
  for (const time of [0,33,66,100,133,166,200]) {
    a.navMaterialFrame(100 + time, false);
    const clear=(1-time/200)**2;near(a.NB.clear,clear);
    const box=a.navBox(2,3,0);near(box.sx*111,120+(125-120)*clear);near(box.sy*85,80+(124-80)*clear);
  }
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
