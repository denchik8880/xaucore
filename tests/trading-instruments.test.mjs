// One account, three instruments (2026-11-17): positions and orders count on their own instrument's quote and terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const a = source.indexOf('const LS_LEGACY ='), b = source.indexOf('/* =========================================================================\n   UI', a);
const core = source.slice(a, b);
const near = (x, y, e = 1e-6) => assert.ok(Math.abs(x - y) <= e, `${x} ≈ ${y}`);

function engine() {
  let seed = 0x13579bdf;
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const toasts = [];
  const ctx = { Math: math, console, window: {}, location: { hostname: 'localhost' }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, XC: { token: null, follower: false }, modalEl: null,
    document: { body: { classList: { toggle() {} } } }, L: (m, ...v) => m.replace(/\{(\d+)\}/g, (_, n) => v[n]), toast: (c, m) => toasts.push(m), ordTypeName: v => v,
    closeModal() {}, render() {}, xcPushState() {}, fetch() { throw new Error('no network'); } };
  vm.createContext(ctx);
  vm.runInContext(core + `
    save = () => {}; saveNow = () => {};
    globalThis.E = {
      init(){ S = DEFAULTS(); seedMarket(); S.trading.slippageOn = false; S.market.forceOpen = true;
        S.price.bid = 4700; S.price.ask = 4700.22; S.price.mid = 4700.11; S.price.spread = .22; S.simClock = Date.UTC(2026, 10, 17, 12); insTick(); return S; },
      S: () => S, insTick, quoteOf, specOf, marginFor, usedMargin, recalcAccount, openPosition, closePosition, posMetrics, addPending, processPendings,
      processPositionSLTP, checkRollover, stateJSON, INS };`, ctx);
  ctx.E.init();
  return { E: ctx.E, toasts };
}
function setQuote(E, sym, bid, ask) { const q = E.S().ins[sym].price; q.bid = bid; q.ask = ask; q.mid = (bid + ask) / 2; }

test('the account carries EURUSD and Boom 1000 beside gold, and no Crash', () => {
  const { E } = engine(), S = E.S();
  assert.deepEqual(Object.keys(S.ins).sort(), ['BOOM1000', 'EURUSD']);
  assert.ok(S.ins.EURUSD.price.mid > 1 && S.ins.EURUSD.price.mid < 1.3);
  assert.ok(S.ins.BOOM1000.price.mid > 10000);
  assert.equal(E.specOf('XAUUSD'), S.symbol);
  assert.equal(E.specOf('BOOM1000').leverage, 600, 'Boom: the account\'s 1:2000 capped at 1:600');
});

test('EURUSD: fills at its own quote, FxPro\'s commission and tiers, P/L in dollars', () => {
  const { E } = engine(), S = E.S();
  setQuote(E, 'EURUSD', 1.10050, 1.10056);
  const bal = S.account.balance;
  const p = E.openPosition('buy', 2, { sym: 'EURUSD' });
  assert.ok(p, 'opened');
  assert.equal(p.symbol, 'EURUSD'); near(p.entry, 1.10056);
  near(p.openCommission, 2 * 100000 * 1.10056 / 10000 * .35);          // $0.35 per 10K, one side
  near(S.account.balance, bal - p.openCommission);
  E.recalcAccount();
  near(S._acc.margin, 2 * 100000 * 1.10053 / 2000, 1e-6);              // ≤10 lots: the account's 1:2000
  setQuote(E, 'EURUSD', 1.10150, 1.10156);                              // +9.4 pips on the bid
  near(E.posMetrics(p).gross, (1.10150 - 1.10056) * 2 * 100000, 1e-6);  // $188
  E.closePosition(p.id, 'manual');
  const row = S.history[0];
  assert.equal(row.symbol, 'EURUSD'); near(row.exit, 1.10150);
  near(S.account.balance, bal + row.net, 1e-6);
});

test('Boom 1000: lots from 0.20, no commission, margin up to 1:600, trades while gold\'s market is shut', () => {
  const { E, toasts } = engine(), S = E.S();
  setQuote(E, 'BOOM1000', 14885.3322, 14887.0507);
  assert.equal(E.openPosition('buy', .1, { sym: 'BOOM1000' }), null, '0.10 is under the minimum');
  S.market.forceOpen = false; S.simClock = Date.UTC(2026, 10, 21, 12);   // a Saturday: gold is closed
  const p = E.openPosition('sell', .5, { sym: 'BOOM1000' });
  assert.ok(p, 'Boom is open at the weekend: ' + toasts.at(-1));
  near(p.entry, 14885.3322); assert.equal(p.openCommission, 0);
  E.recalcAccount(); near(S._acc.margin, .5 * 14886.19145 / 600, 1e-6);
  setQuote(E, 'BOOM1000', 14900, 14901.7);                              // a spike against the short
  near(E.posMetrics(p).gross, (14885.3322 - 14901.7) * .5, 1e-6);
  assert.equal(E.openPosition('buy', .1, { sym: 'EURUSD' }), null, 'EURUSD follows gold\'s closed market');
});

test('gold is counted exactly as before, and each position against its own quote', () => {
  const { E } = engine(), S = E.S();
  const g = E.openPosition('buy', 1, {});
  assert.equal(g.symbol, 'XAUUSD'); near(g.entry, 4700.22); near(g.openCommission, 6);
  setQuote(E, 'EURUSD', 1.1, 1.10006);
  const e = E.openPosition('sell', 1, { sym: 'EURUSD' });
  E.recalcAccount();
  near(S._acc.margin, 1 * 100 * 4700.11 / 2000 + 1 * 100000 * 1.10003 / 2000, 1e-6);
  // a gold move does not touch the EURUSD position, and the other way round
  S.price.bid = 4710; S.price.ask = 4710.22; S.price.mid = 4710.11;
  near(E.posMetrics(g).gross, (4710 - 4700.22) * 100, 1e-6);
  near(E.posMetrics(e).gross, (1.1 - 1.10006) * 100000, 1e-6);
});

test('SL / TP and pending orders trigger on their own instrument', () => {
  const { E } = engine(), S = E.S();
  setQuote(E, 'EURUSD', 1.1, 1.10006);
  const p = E.openPosition('buy', 1, { sym: 'EURUSD', sl: 1.099, tp: 1.102 });
  const o = E.addPending({ sym: 'BOOM1000', type: 'buy_limit', volume: .2, price: 14800 });
  assert.equal(o.symbol, 'BOOM1000');
  S.price.bid = 1; S.price.ask = 1.2;                                   // gold far below: nothing of the others moves
  E.processPositionSLTP(); E.processPendings();
  assert.ok(S.positions.includes(p)); assert.equal(S.pendings.length, 1);
  S.price.bid = 4700; S.price.ask = 4700.22;
  setQuote(E, 'EURUSD', 1.1021, 1.10216);
  E.processPositionSLTP();
  assert.ok(!S.positions.includes(p)); assert.equal(S.history[0].reason, 'TP');
  setQuote(E, 'BOOM1000', 14798, 14799.7);
  E.processPendings();
  assert.equal(S.pendings.length, 0);
  const filled = S.positions.find(x => x.symbol === 'BOOM1000');
  assert.ok(filled); near(filled.entry, 14800);
});

test('swaps at the roll-over: FxPro\'s points for EURUSD, Deriv\'s % a year for Boom', () => {
  const { E } = engine(), S = E.S();
  setQuote(E, 'EURUSD', 1.1, 1.10006); setQuote(E, 'BOOM1000', 14000, 14001.6);
  const e = E.openPosition('buy', 1, { sym: 'EURUSD' }), bm = E.openPosition('buy', 1, { sym: 'BOOM1000' });
  S.lastSimDay = '2026-11-16'; S.simClock = Date.UTC(2026, 10, 17, 0, 0, 5);   // into a Tuesday
  E.checkRollover();
  near(e.swap, -8.9, 1e-9);
  near(bm.swap, -1 * 14000.8 * .36 / 365, 1e-6);
});

test('the save carries the instruments, their bars and the positions\' symbols', () => {
  const { E } = engine(), S = E.S();
  E.openPosition('buy', 1, { sym: 'EURUSD' });
  const back = JSON.parse(E.stateJSON());
  assert.deepEqual(Object.keys(back.ins).sort(), ['BOOM1000', 'EURUSD']);
  assert.equal(back.ins.EURUSD.candles.M1.length, S.ins.EURUSD.candles.M1.length);
  assert.equal(back.ins.EURUSD.price.mid, S.ins.EURUSD.price.mid);
  assert.equal(back.positions[0].symbol, 'EURUSD');
});
