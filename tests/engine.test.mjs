import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Engine source section exists: ${start}`);
  return source.slice(a, b);
}
const core = section('const LS_LEGACY =', '/* =========================================================================\n   UI');
const wallet = section('function walletLog(type, amount, note){', 'function walletAmountModal(kind){');
const newsTests = section('function runNewsTests(n){', '/* =========================================================================\n   CLOUD SYNC');
const plain = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≈ ${expected}`);

function engineHarness() {
  let seed = 0x623cabef;
  const math = Object.create(Math);
  math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const effects = { writes: 0, requests: 0 };
  const ctx = {
    Math: math, console, window: {}, location: { hostname: 'localhost' },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1,
    localStorage: { getItem: () => null, setItem: () => { effects.writes++; }, removeItem() {} },
    XC: { token: null, follower: false }, modalEl: null,
    document: { body: { classList: { toggle() {} } } },
    L: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, n) => args[n]),
    toast() {}, ordTypeName: value => value, closeModal() {}, render() {},
    xcPushState() { effects.requests++; },
    // An unexpected network call is a test failure; no real account is ever used.
    fetch() { throw new Error('Network access is forbidden in engine tests'); },
  };
  vm.createContext(ctx);
  vm.runInContext(core + wallet + newsTests + `
    save = () => {}; saveNow = () => {};
    globalThis.engine = {
      init(){
        S = DEFAULTS(); seedMarket();
        S.trading.slippageOn = false; S.market.forceOpen = true;
        S.price.bid = 4700; S.price.ask = 4700.22; S.price.mid = 4700.11; S.price.spread = .22;
        S.simClock = Date.UTC(2026, 9, 22, 12);
        return S;
      },
      state(){ return S; },
      fixedSlippage(value){ slippage = () => value; },
      openPosition, closePosition, modifyPosition, closePartial, processPositionSLTP,
      addPending, cancelPending, processPendings, checkStopOut, checkRollover,
      recalcAccount, commissionFor, posMetrics, walletDeposit, walletWithdraw, walletTransfer,
      runNewsTests, runDayTests, stateJSON, histEncode, histDecode
    };`, ctx);
  ctx.engine.init();
  return { engine: ctx.engine, effects };
}

test('BUY/SELL round trips reconcile spread, both commissions, balance and history', () => {
  const { engine: e } = engineHarness(), s = e.state(), balance = s.account.balance;
  const buy = e.openPosition('buy', 1, {}), sell = e.openPosition('sell', 0.5, {});
  near(buy.entry, 4700.22); near(sell.entry, 4700);
  e.closePosition(buy.id, 'manual'); e.closePosition(sell.id, 'manual');
  near(s.account.balance, balance + s.history.reduce((sum, row) => sum + row.net, 0));
  near(s.history.reduce((sum, row) => sum + row.commission, 0), 18);
  assert.equal(s.positions.length, 0);
});

test('invalid lot, SL/TP and insufficient margin reject without charging the account', () => {
  const { engine: e } = engineHarness(), s = e.state();
  for (const lot of [0, -1, 0.001, 30.01, NaN]) assert.equal(e.openPosition('buy', lot, {}), null);
  assert.equal(e.openPosition('buy', 0.01, { sl: 4701 }), null);
  assert.equal(e.openPosition('buy', 0.01, { tp: 4699 }), null);
  s.account.balance = 0.1;
  assert.equal(e.openPosition('buy', 30, {}), null);
  assert.equal(s.positions.length, 0);
  near(s.account.balance, 0.1);
});

test('relative SL/TP use the actual slipped fill, and range protection rejects an adverse fill', () => {
  const { engine: e } = engineHarness();
  e.fixedSlippage(0.05);
  const buy = e.openPosition('buy', 0.1, { slPips: 100, tpPips: 200 });
  near(buy.entry, 4700.27); near(buy.sl, 4699.27); near(buy.tp, 4702.27);
  const sell = e.openPosition('sell', 0.1, { slPips: 100, tpPips: 200 });
  near(sell.entry, 4699.95); near(sell.sl, 4700.95); near(sell.tp, 4697.95);
  const balance = e.state().account.balance;
  assert.equal(e.openPosition('buy', 0.1, { range: 1, ref: 4700.22 }), null);
  near(e.state().account.balance, balance);
});

test('TP1 then TP2 preserve original volume, commission and final account reconciliation', () => {
  const { engine: e } = engineHarness(), s = e.state(), balance = s.account.balance;
  const position = e.openPosition('buy', 1, { tp1: { price: 4701, volume: 0.4 }, tp: 4702, sl: 4690 });
  s.price.bid = 4701; s.price.ask = 4701.22; e.processPositionSLTP();
  near(position.volume, 0.6); near(s.history[0].volume, 0.4);
  assert.equal(s.history[0].reason, 'TP1');
  s.price.bid = 4702; s.price.ask = 4702.22; e.processPositionSLTP();
  assert.equal(s.positions.length, 0); assert.equal(s.history.length, 2);
  near(s.history.reduce((sum, row) => sum + row.volume, 0), 1);
  near(s.history.reduce((sum, row) => sum + row.commission, 0), 12);
  near(s.account.balance, balance + s.history.reduce((sum, row) => sum + row.net, 0));
});

test('BUY stops use bid, SELL stops use ask, and an invalid modification preserves the position', () => {
  const { engine: e } = engineHarness();
  let s = e.state();
  const buy = e.openPosition('buy', 0.1, { sl: 4699 });
  e.modifyPosition(buy.id, 4700.05, null);
  near(buy.sl, 4699); assert.equal(s.positions.length, 1);
  s.price.bid = 4699; s.price.ask = 4699.22; e.processPositionSLTP();
  assert.equal(s.history[0].reason, 'SL');
  s = e.init(); e.openPosition('sell', 0.1, { sl: 4701 });
  s.price.bid = 4700.78; s.price.ask = 4701; e.processPositionSLTP();
  assert.equal(s.history[0].reason, 'SL'); assert.equal(s.positions.length, 0);
});

test('limits, double stop triggers and armed stop-limit orders fill at their expected prices', () => {
  const { engine: e } = engineHarness(), s = e.state();
  e.addPending({ type: 'buy_limit', volume: 0.1, price: 4699 });
  e.processPendings(); assert.equal(s.positions.length, 0);
  s.price.ask = 4698.8; s.price.bid = 4698.58; e.processPendings();
  near(s.positions[0].entry, 4699); assert.equal(s.pendings.length, 0);
  e.addPending({ type: 'sell_stop', volume: 0.1, price: 4698, trig: 'dtrade' });
  s.price.bid = 4697.8; s.price.ask = 4698.02;
  e.processPendings(); e.processPendings(); assert.equal(s.pendings.length, 1);
  s.simClock++; e.processPendings();
  assert.equal(s.pendings.length, 0); near(s.positions[1].entry, 4697.8);
  const order = e.addPending({ type: 'buy_stop_limit', volume: 0.1, price: 4701, lim: 10 });
  s.price.ask = 4702; s.price.bid = 4701.78; e.processPendings();
  assert.equal(order.armed, true); assert.equal(s.pendings.length, 1);
  s.price.ask = 4701.05; s.price.bid = 4700.83; e.processPendings();
  assert.equal(s.pendings.length, 0); near(s.positions[2].entry, 4701.05);
});

test('pending execution rejected for margin neither opens a position nor charges commission', () => {
  const { engine: e } = engineHarness(), s = e.state();
  s.account.balance = 1;
  e.addPending({ type: 'buy_limit', volume: 30, price: 4701 }); e.processPendings();
  assert.equal(s.pendings.length, 0); assert.equal(s.positions.length, 0);
  near(s.account.balance, 1);
});

test('stop-out closes a losing position that breaches the margin threshold', () => {
  const { engine: e } = engineHarness(), s = e.state();
  s.account.balance = 100; e.openPosition('buy', 0.1, {});
  s.price.bid = 4680; s.price.ask = 4680.22; s.price.mid = 4680.11; e.checkStopOut();
  assert.equal(s.positions.length, 0); assert.equal(s.history[0].reason, 'Stop Out');
});

test('rollover applies the configured Wednesday triple swap once, then the next day normally', () => {
  const { engine: e } = engineHarness(), s = e.state();
  const buy = e.openPosition('buy', 0.1, {}), sell = e.openPosition('sell', 0.1, {});
  s.lastSimDay = '2026-10-20'; s.simClock = Date.UTC(2026, 9, 21);
  e.checkRollover(); near(buy.swap, -7.5); near(sell.swap, 1.5);
  e.checkRollover(); near(buy.swap, -7.5); near(sell.swap, 1.5);
  s.simClock = Date.UTC(2026, 9, 22); e.checkRollover();
  near(buy.swap, -10); near(sell.swap, 2);
});

test('wallet arithmetic rejects invalid amounts, overdrafts and the unfinished transfer without a debit', () => {
  const { engine: e } = engineHarness(), s = e.state(), balance = s.wallet.balance;
  e.walletDeposit(123.45); e.walletWithdraw(23.45);
  near(s.wallet.balance, balance + 100); assert.equal(s.wallet.ledger.length, 2);
  for (const amount of [0, -1, NaN, Infinity]) assert.equal(e.walletDeposit(amount).ok, false);
  assert.equal(e.walletWithdraw(s.wallet.balance + 1).ok, false);
  assert.equal(e.walletTransfer('recipient', 1).pending, true);
  near(s.wallet.balance, balance + 100);
});

test('optimized state serialization retains the same trade/history data as native JSON', () => {
  const { engine: e } = engineHarness(), s = e.state();
  e.openPosition('buy', 0.1, {}); e.closePosition(1, 'manual');
  assert.deepEqual(JSON.parse(e.stateJSON()), plain(s));
});

test('history encoding round trip preserves shifted OHLCV bars', () => {
  const { engine: e } = engineHarness();
  const bars = [
    { t: 120, o: 4700, h: 4701, l: 4699, c: 4700.5, v: 12 },
    { t: 180, o: 4700.5, h: 4702, l: 4700, c: 4701.6, v: 14 },
  ];
  assert.deepEqual(plain(e.histDecode(e.histEncode(bars, 60, 60), 60)), bars);
});

test('100 seeded news scenarios and 300 market days stay finite and restore the live state', () => {
  const { engine: e, effects } = engineHarness();
  e.openPosition('buy', 0.02, {});
  const snapshot = JSON.stringify(e.state());
  const news = e.runNewsTests(20);
  assert.equal(Object.keys(news).length, 5);
  for (const result of Object.values(news)) {
    assert.equal(result.n, 20); assert.equal(result.up + result.down, 20);
    assert.ok(Number.isFinite(result.meanRange) && result.meanRange > 0);
  }
  assert.equal(JSON.stringify(e.state()), snapshot);
  const days = e.runDayTests(300);
  assert.equal(days.n, 300);
  for (const key of ['meanRange', 'medianRange', 'minRange', 'maxRange', 'priceStart', 'priceEnd', 'priceMin', 'priceMax']) {
    assert.ok(Number.isFinite(days[key]) && days[key] > 0, key);
  }
  assert.equal(JSON.stringify(e.state()), snapshot);
  assert.equal(effects.writes, 0); assert.equal(effects.requests, 0);
});
