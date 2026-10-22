import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Execute the real rendering functions with a small DOM/timer model. No browser,
// credentials, DB, network, saved settings, or production data are involved.
const html = fs.readFileSync(process.env.XAUCORE_GLASS_SOURCE || new URL("../public/index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function source(name, optional = false) {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) {
    if (name === "lgDmScale") {
      const old = html.match(/^const lgDmScale = .*;$/m);
      if (old) return old[0] + "\nthis.lgDmScale = lgDmScale;";
    }
    if (optional) return "";
    throw new Error("Missing actual function " + name);
  }
  const end = html.indexOf("\n}", start);
  assert.ok(end > start, "function has an outer closing brace: " + name);
  return html.slice(start, end + 2);
}

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.isConnected = true;
    this.classList = { contains: () => false };
    this.style = { backdropFilter: "", removeProperty(name) { if (name === "backdrop-filter") this.backdropFilter = ""; } };
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  appendChild(el) { this.children.push(el); return el; }
  matches() { return false; }
}

function engine({ actualFilters = false } = {}) {
  const timers = new Map();
  let timerId = 0;
  const features = { refract: true };
  const ctx = {
    Math, JSON, console, LG_LENS: true,
    document: { documentElement: { dataset: {} }, createElementNS: (_, tag) => new Element(tag) },
    glassOn: name => features[name] !== false, lgFeat: () => "headers",
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    LGQ: { b: 1, r: 1, ch: 0 }, LG_UI: { refract: 1, chroma: false },
    _lgEls: new Set(), _lgRain: new Set(), _lgPanels: new Set(),
    _rainRaf: 0, _rainLvl: 1, _rainMove: true,
    DISP: { top: false, on: true, str: 50 }, DISP_BD: 2.2,
    DISP_SPEC: [[1, 0, .05], [.9, .6, 0], [.15, 1, .2], [0, .55, 1], [.6, 0, .9]],
    DISP_LV: [0, 1, .6, .3],
    _lgIds: new Set(), _lgMaps: new Map(), _lgDms: [], _lgDefs: new Element("defs"),
    dispPlace: el => el.place || "tabs", dispWants: () => ctx.DISP.on,
    dispDropSp: () => 0,
    lgFilterId: (...args) => "plain-" + args.join("-"),
    lgDispFilter: (w, h, sc, rad, rm, edge, k) => "rainbow-" + [w, h, sc, rad, rm, edge, k].join("-"),
    lgMotionMap: () => "data:image/png;base64,MAP",
    NB: { clear: 0 }, navLens() {},
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id)
  };
  vm.createContext(ctx);
  vm.runInContext([
    source("dispMotion"), source("lgDmScale"), source("lgScaleAll"),
    source("lgRainApply"), source("lgRainUnbind", true), source("lgRainBind"),
    source("lgGlass"), source("lgPrune"), source("rainAll"),
    actualFilters ? source("lgDispFilter") : ""
  ].join("\n"), ctx);
  return {
    ctx, timers, features,
    flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); }
  };
}

test("turning refraction off cancels and invalidates an already queued dispersion callback", () => {
  const e = engine(), el = new Element();
  e.ctx.lgGlass(el, 320, 58);
  const queued = [...e.timers.values()][0];
  assert.ok(queued);
  e.features.refract = false;
  e.ctx.lgGlass(el, 320, 58);
  assert.equal(e.timers.size, 0);
  queued(); // A callback dispatched before cancellation must also be harmless.
  assert.equal(el.style.backdropFilter, "");
  assert.equal(el._lgMove, null);
  assert.equal(e.ctx._lgRain.has(el), false);
});

test("unchanged bindings retain both pending work and ready motion filters", () => {
  const e = engine(), el = new Element();
  e.ctx.lgGlass(el, 320, 58);
  const timer = el._dispT;
  for (let i = 0; i < 10; i++) e.ctx.lgGlass(el, 320, 58);
  assert.equal(el._dispT, timer);
  assert.equal(e.timers.size, 1);
  e.flush();
  const ready = el._dispF, move = el._lgMove;
  for (let i = 0; i < 10; i++) e.ctx.lgGlass(el, 320, 58);
  assert.equal(el._dispF, ready);
  assert.equal(el._lgMove, move);
  assert.equal(e.timers.size, 0);
});

test("old binding callbacks cannot replace a newer geometry, including a return to the old key", () => {
  const e = engine(), el = new Element();
  e.ctx.lgGlass(el, 320, 58);
  const old = [...e.timers.values()][0];
  e.ctx.lgGlass(el, 340, 58);
  e.ctx.lgGlass(el, 320, 58);
  old();
  assert.equal(el._lgMove, null);
  assert.equal(e.timers.size, 1);
  e.flush();
  assert.ok(el._lgMove);
});

test("fixed glass and disconnected elements release all delayed dispersion work", () => {
  const e = engine(), el = new Element();
  e.ctx.lgGlass(el, 320, 58);
  const old = [...e.timers.values()][0];
  e.ctx.lgGlass(el, 320, 58, 10, 1, false, true);
  old();
  assert.equal(e.timers.size, 0);
  assert.equal(e.ctx._lgRain.has(el), false);
  assert.equal(el._lgMove, null);
  e.ctx.lgGlass(el, 320, 58);
  el.isConnected = false;
  e.ctx.lgPrune();
  assert.equal(e.timers.size, 0);
  assert.equal(e.ctx._lgEls.has(el), false);
  assert.equal(e.ctx._lgRain.has(el), false);
});

test("a new resting material immediately resynchronizes the retained motion filter", () => {
  const e = engine(), el = new Element();
  e.ctx.lgGlass(el, 320, 58);
  e.flush();
  const ready = el._dispF;
  // A press changes the glow graph, while its rounded lens strength can stay the same.
  el.classList.contains = name => name === "pressing";
  e.ctx.lgGlass(el, 320, 58);
  assert.equal(el._dispF, ready);
  assert.equal(el.style.backdropFilter, ready[1]);
  assert.equal(e.timers.size, 0);
});

test("strength changes reuse six spectral graphs and preserve every original pass scale", () => {
  const e = engine({ actualFilters: true });
  let comparisons = 0;
  for (let strength = 0; strength <= 100; strength++) for (const refract of [0, .5, 1, 1.5]) {
    e.ctx.DISP.str = strength;
    e.ctx.LG_UI.refract = refract;
    for (const place of ["tabs", "head"]) for (const k of [1, .6, .3]) e.ctx.lgDispFilter(320, 58, 10, undefined, 9, "b", k, place);
    e.ctx.lgScaleAll();
    for (const filter of e.ctx._lgDefs.children) {
      const passes = filter.children.filter(node => node.tagName === "feDisplacementMap");
      const head = filter.getAttribute("id").endsWith("ph");
      const level = +filter.getAttribute("id").match(/k([.\d]+)p/)[1];
      assert.equal(filter.children.length, 16);
      assert.equal(passes.length, 5);
      passes.forEach((dm, index) => {
        // Frozen pre-optimization formula: five wavelengths, head at 60%, same rounding.
        const c = (index - 2) / 2, f = strength / 50, h = head ? .6 : 1;
        const expected = (10 * (1 + level * (Math.min(4.5, 2.2 * f) * h + c * .6 * f * h)) * Math.min(1.5, refract)).toFixed(1);
        assert.equal(dm.getAttribute("scale"), expected);
        comparisons++;
      });
    }
  }
  assert.equal(comparisons, 12120);
  assert.equal(e.ctx._lgIds.size, 6);
  assert.equal(e.ctx._lgDms.length, 30);
});

test("more than 120 visible chart levels finish fading without restarting the draw loop", () => {
  const start = html.indexOf("  const FADE = 14;", html.indexOf("function drawChart("));
  const code = html.slice(start, html.indexOf("  const pillX =", start));
  assert.ok(code.includes("pAnim"));
  const pAnim = new Map(Array.from({ length: 20 }, (_, i) => ["old" + i, { g: 0, t: 0, al: .5 }]));
  let draws = 0, marks, last;
  for (let frame = 0; frame < 40; frame++) {
    marks = Array.from({ length: 121 }, (_, i) => ({ key: "p" + i, ly: 100 }));
    last = { marks, pAnim, pNow: 1000 + frame * (1000 / 120), pGen: frame + 1, EASE_DT: 34, padT: 8, H: 640, padB: 21, pSettling: false, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), chartDraw: () => draws++, Math };
    vm.createContext(last);
    vm.runInContext(code, last);
  }
  assert.equal(pAnim.size, 121);
  assert.ok(marks.every(mark => mark.a === 1));
  assert.equal(last.pSettling, false);
  assert.ok(draws < 40);
});

test("subtab clip geometry is read before any frame style writes", () => {
  const calls = [], red = { style: {} };
  const bar = {
    _sw0: 80, _sh: 30,
    querySelector: () => red,
    get clientHeight() { calls.push("read-height"); return 42; },
    get clientWidth() { calls.push("read-width"); return 320; },
    style: { setProperty: name => calls.push("write-" + name) }
  };
  const ctx = { SB: { wRest: 80, tl: 0, tr: 80, l: 30, r: 110 }, WATER: 1, Math };
  vm.createContext(ctx);
  vm.runInContext(source("subApply"), ctx);
  ctx.subApply(bar);
  assert.deepEqual(calls.slice(0, 2), ["read-height", "read-width"]);
  assert.equal(red.style.clipPath, "inset(6.00px 210.00px 6.00px 30.00px round 15.00px)");
});
