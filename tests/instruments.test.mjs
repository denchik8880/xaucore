// The other instruments (EURUSD as FxPro, Boom/Crash 1000 as Deriv): their generators, candles and trading maths.
// The module is extracted from public/index.html between its markers and run on its own, with Math.random
// forbidden: it must never draw from gold's random numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `section exists: ${start}`);
  return source.slice(a, b);
}
const lineOf = start => { const a = source.indexOf(start); assert.ok(a >= 0, start); return source.slice(a, source.indexOf('\n', a)); };
const code = [lineOf('const TF = {'), lineOf('const TF_ORDER = ['), lineOf('function roundTo('), lineOf('const clamp = '),
  section('/* ======== OTHER INSTRUMENTS', '/* ======== END OTHER INSTRUMENTS')].join('\n');

function load() {
  const math = Object.create(Math);
  math.random = () => { throw new Error('the instruments must not use Math.random'); };
  const ctx = { Math: math, Date, performance: { now: () => 0 }, console };
  vm.createContext(ctx);
  vm.runInContext(code + `
    globalThis.api = { INS, INS_ORDER, INS_CAP, TF, TF_ORDER, FX_HOUR, insDrift, insRand, insGauss, insSpikeMove, insNewState,
      insHistory, insStepTo, insAdvance, insShift, insMargin, insCommission, insSwap };`, ctx);
  return ctx.api;
}
const A = load();
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0) + 1234567;         // not on any bar's boundary
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(sa * sb); };
function checkBars(bars, sec, label) {
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    assert.ok(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c), `${label} bar ${i} OHLC`);
    assert.equal(b.t % sec, 0, `${label} bar ${i} aligned`);
    if (i) {
      assert.ok(b.t > bars[i - 1].t, `${label} bar ${i} in order`);
      assert.equal(b.o, bars[i - 1].c, `${label} bar ${i} opens at the last close`);
    }
  }
}

test('the specifications are the brokers\': FxPro EURUSD, Deriv Boom/Crash 1000', () => {
  const E = A.INS.EURUSD, B = A.INS.BOOM1000, C = A.INS.CRASH1000;
  assert.equal(E.digits, 5); assert.equal(E.contractSize, 100000); assert.equal(E.minLot, .01); assert.equal(E.lotStep, .01);
  assert.equal(E.start, 1.1005);
  assert.equal(B.digits, 4); assert.equal(B.start, 14886); assert.equal(B.contractSize, 1); assert.equal(B.minLot, .2); assert.equal(B.every, 1000); assert.equal(B.dir, 1);
  assert.equal(C.dir, -1); assert.equal(C.minLot, .2);
  assert.equal(JSON.stringify(A.INS_ORDER), JSON.stringify(['EURUSD', 'BOOM1000', 'CRASH1000']));
  const ms = A.FX_HOUR.reduce((s, f) => s + f * f, 0) / 24;
  assert.ok(Math.abs(ms - 1) < .03, `FX hours keep the daily volatility (mean square ${ms})`);
});

test('margin, commission and swaps are counted as FxPro and Deriv count them', () => {
  const E = A.INS.EURUSD, B = A.INS.BOOM1000;
  // 1 lot at 1.1005 and 1:500: 100 000 × 1.1005 / 500
  assert.ok(Math.abs(A.insMargin(E, 1, 1.1005, 500, 0) - 220.1) < 1e-9);
  // FxPro tiers: 30 lots at an account 1:2000 → 25 lots at 1:2000 (the first bands are looser), 5 at 1:1000
  const m30 = A.insMargin(E, 30, 1.1, 2000, 0), one = 110000;
  assert.ok(Math.abs(m30 - (25 * one / 2000 + 5 * one / 1000)) < 1e-6, `tiered ${m30}`);
  // a tier tightens what is added on top of what is open
  assert.ok(Math.abs(A.insMargin(E, 5, 1.1, 2000, 25) - 5 * one / 1000) < 1e-6);
  // an account looser than every tier (1:10000) still gets 1:2000 between 10 and 25 lots
  assert.ok(Math.abs(A.insMargin(E, 15, 1.1, 10000, 10) - 15 * one / 2000) < 1e-6);
  // Deriv: lots × price / leverage, never looser than 1:600
  assert.ok(Math.abs(A.insMargin(B, 1, 12000, 2000, 0) - 20) < 1e-9);
  assert.ok(Math.abs(A.insMargin(B, 1, 12000, 400, 0) - 30) < 1e-9);
  // FxPro: $0.35 per 10K traded a side → 1 lot of EURUSD at 1.1005 = $3.85; Deriv: none
  assert.ok(Math.abs(A.insCommission(E, 1, 1.1005) - 3.85175) < 1e-9);
  assert.equal(A.insCommission(B, 1, 12000), 0);
  // swaps: FxPro -8.9 / +1.9 points a lot (1 point = $1 on a lot); Deriv -36 % a year on the notional
  assert.ok(Math.abs(A.insSwap(E, 'buy', 1, 1.1) + 8.9) < 1e-9);
  assert.ok(Math.abs(A.insSwap(E, 'sell', 2, 1.1) - 3.8) < 1e-9);
  assert.ok(Math.abs(A.insSwap(B, 'buy', 1, 12000) + 12000 * .36 / 365) < 1e-9);
});

test('Boom and Crash spike on 1 tick in 1000, the right way, and the drift pays them back', () => {
  for (const sym of ['BOOM1000', 'CRASH1000']) {
    const spec = A.INS[sym], st = { seed: 12345 };
    let ticks = 0, spikes = 0, net = 0, quiet = [], up = 0, moves = 0;
    for (let i = 0; i < 200000; i++) {
      const m = 14, mv = A.insSpikeMove(st, spec, m);
      ticks += m; spikes += mv.spikes; net += mv.net;
      if (mv.spikes === 0) quiet.push(mv.net / m);
      if (mv.spikes) assert.ok(spec.dir > 0 ? mv.hi >= spec.spikeMin - 1 : mv.lo <= -spec.spikeMin + 1, `${sym} spike direction`);
    }
    const rate = spikes / ticks;
    assert.ok(rate > .00092 && rate < .00108, `${sym} spike rate ${rate}`);
    const drift = mean(quiet);
    assert.ok(Math.abs(drift + spec.dir * A.insDrift(spec)) < .002, `${sym} drift between spikes ${drift}`);
    // per tick the expected move is ~0: the spikes and the drift balance
    assert.ok(Math.abs(net / ticks) < .004, `${sym} mean move a tick ${net / ticks}`);
    // between spikes ~9 ticks in 10 go the drift's way (Deriv's staircase)
    for (let i = 0; i < 20000; i++) { const mv = A.insSpikeMove(st, spec, 1); if (!mv.spikes) { moves++; if (mv.net * spec.dir > 0) up++; } }
    assert.ok(up / moves < .15, `${sym} ticks against the drift ${up / moves}`);
  }
});

test('the history: every timeframe full, consistent, ending on the price, and the same path cut different ways', () => {
  for (const sym of A.INS_ORDER) {
    const st = A.insNewState(sym, T0, 777);
    for (const tf of A.TF_ORDER) {
      const bars = st.candles[tf];
      assert.equal(bars.length, A.INS_CAP[tf], `${sym} ${tf} count`);
      checkBars(bars, A.TF[tf], `${sym} ${tf}`);
      assert.equal(bars[bars.length - 1].c, Math.round(st.price.mid * 10 ** A.INS[sym].digits) / 10 ** A.INS[sym].digits, `${sym} ${tf} ends on the price`);
      assert.equal(bars[bars.length - 1].t, Math.floor(T0 / 1000 / A.TF[tf]) * A.TF[tf], `${sym} ${tf} last bar is now`);
    }
    // the newest hour's H1 bar is exactly its M1 bars
    const h1 = st.candles.H1.at(-1), m1 = st.candles.M1.filter(b => b.t >= h1.t);
    assert.equal(h1.o, m1[0].o); assert.equal(h1.c, m1.at(-1).c);
    assert.equal(h1.h, Math.max(...m1.map(b => b.h))); assert.equal(h1.l, Math.min(...m1.map(b => b.l)));
  }
  // the same seed, the same history
  assert.equal(JSON.stringify(A.insNewState('EURUSD', T0, 5).candles), JSON.stringify(A.insNewState('EURUSD', T0, 5).candles));
});

test('EURUSD: ~0.48 % a day (60-100 pips of range), +0.42 with gold, sub-pip spreads, no range it is held in', () => {
  const st = A.insNewState('EURUSD', T0, 99);
  let gold = 4600, t = T0, goldSeed = { seed: 4242 };
  const DT = 14, days = 120, perDay = 86400 / DT;
  const dayRet = [], rg = [], re = [], ranges = [], spreads = [];
  let dayOpen = st.price.mid, hi = dayOpen, lo = dayOpen;
  for (let d = 0; d < days; d++) {
    for (let k = 0; k < perDay; k++) {
      const g0 = gold, e0 = st.price.mid;
      gold *= 1 + .015 * Math.sqrt(DT / 86400) * A.insGauss(goldSeed);
      t += DT * 1000;
      A.insStepTo(st, t, { mid: gold, news: false, closed: false });
      rg.push(gold / g0 - 1); re.push(st.price.mid / e0 - 1);
      hi = Math.max(hi, st.price.mid); lo = Math.min(lo, st.price.mid);
      if (k % 97 === 0) spreads.push(st.price.ask - st.price.bid);
    }
    dayRet.push(st.price.mid / dayOpen - 1); ranges.push((hi - lo) / .0001);
    dayOpen = hi = lo = st.price.mid;
  }
  const vol = sd(dayRet), c = corr(rg.slice(5000), re.slice(5000)), range = mean(ranges), sp = mean(spreads) / .0001;
  assert.ok(vol > .0036 && vol < .0062, `daily volatility ${vol}`);
  assert.ok(range > 55 && range < 105, `daily range ${range} pips`);
  assert.ok(c > .34 && c < .5, `correlation with gold ${c}`);
  assert.ok(sp > .3 && sp < .9, `average spread ${sp} pips`);
  for (const tf of A.TF_ORDER) checkBars(st.candles[tf], A.TF[tf], `EURUSD live ${tf}`);
  // a release: the move with gold is stronger and the spread wider
  const s2 = A.insNewState('EURUSD', T0, 3); let g = 4600, tt = T0; const a = [], b = [];
  for (let k = 0; k < 3000; k++) { const g0 = g, e0 = s2.price.mid; g *= 1 + .004 * A.insGauss(goldSeed); tt += 2000;
    A.insStepTo(s2, tt, { mid: g, news: true, closed: false }); a.push(g / g0 - 1); b.push(s2.price.mid / e0 - 1); }
  assert.ok(corr(a, b) > .55, `release correlation ${corr(a, b)}`);
  assert.ok(s2.price.ask - s2.price.bid > .00009, 'release spread is wide');
});

test('Boom/Crash spread is a share of the price, ~1.72 at 14 886 as on the cTrader screenshot', () => {
  const box = {};
  A.insAdvance(box, T0, { mid: 4600, news: false, closed: false });
  A.insAdvance(box, T0 + 60e3, { mid: 4600, news: false, closed: false });
  const p = box.BOOM1000.price, sp = p.ask - p.bid;
  assert.ok(Math.abs(sp - p.mid * .000115) < .0002, `spread ${sp}`);
  assert.ok(sp > 1.6 && sp < 1.85, `spread ${sp} near 1.72`);
  assert.equal(String(p.bid).split('.')[1]?.length <= 4, true, 'four decimals');
});

test('EURUSD stands still while the market is closed; spike indices trade 24/7', () => {
  const box = {};
  A.insAdvance(box, T0, { mid: 4600, news: false, closed: false });
  const e = box.EURUSD.price.mid, b = box.BOOM1000.price.mid, n = box.EURUSD.candles.M1.length;
  A.insAdvance(box, T0 + 3600e3, { mid: 4650, news: false, closed: true });
  assert.equal(box.EURUSD.price.mid, e); assert.equal(box.EURUSD.candles.M1.length, n);
  assert.notEqual(box.BOOM1000.price.mid, b);
});

test('live candles: no missing minute, a long jump filled minute by minute, days away rebuilt, whole-day shifts carried', () => {
  const box = {};
  let t = T0;
  A.insAdvance(box, t, { mid: 4600, news: false, closed: false });
  for (let i = 0; i < 2000; i++) { t += 7000; A.insAdvance(box, t, { mid: 4600, news: false, closed: false }); }
  t += 5 * 3600e3;                                                             // the clock jumps 5 hours
  A.insAdvance(box, t, { mid: 4600, news: false, closed: false });
  for (const sym of A.INS_ORDER) {
    const m1 = box[sym].candles.M1;
    for (const tf of A.TF_ORDER) checkBars(box[sym].candles[tf], A.TF[tf], `${sym} ${tf}`);
    for (let i = 1; i < m1.length; i++) assert.equal(m1[i].t - m1[i - 1].t, 60, `${sym} M1 continuous at ${i}`);
    assert.equal(m1.length, A.INS_CAP.M1);
  }
  // a Boom spike shows in its bar's high
  const boom = box.BOOM1000;
  assert.ok(boom.spikes > 0, 'spikes happened');
  const tall = boom.candles.M1.some(b => b.h - Math.max(b.o, b.c) > 2 || b.c - b.o > 2);
  assert.ok(tall, 'a spike is on the M1 chart');
  // four days away: the history is rebuilt up to now, the price carries on
  const p = box.CRASH1000.price.mid;
  t += 4 * 86400e3; A.insAdvance(box, t, { mid: 4600, news: false, closed: false });
  assert.equal(box.CRASH1000.candles.M1.at(-1).t, Math.floor(t / 60000) * 60);
  assert.ok(Math.abs(box.CRASH1000.candles.D1[0].t - (Math.floor(t / 86400e3) - 119) * 86400) < 1);
  assert.ok(box.CRASH1000.price.mid === p);
  // shiftSimTime's whole days move the instruments too
  const before = box.EURUSD.candles.H1.at(-1).t, st0 = box.EURUSD.t;
  A.insShift(box, -2 * 86400e3);
  assert.equal(box.EURUSD.candles.H1.at(-1).t, before - 2 * 86400); assert.equal(box.EURUSD.t, st0 - 2 * 86400e3);
});

test('a first history is cheap enough for a phone', () => {
  // timed as the page runs it (a vm context's global lookups are many times slower than a page's)
  const B = new Function(code + ';return { INS_ORDER, insNewState };')();
  for (const sym of B.INS_ORDER) B.insNewState(sym, T0, 2);              // warm up
  const t0 = performance.now();
  for (const sym of B.INS_ORDER) B.insNewState(sym, T0, 1);
  const ms = performance.now() - t0;
  assert.ok(ms < 60, `three histories in ${ms.toFixed(1)} ms`);
});
