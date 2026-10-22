import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run only the relevant real functions, with an isolated state and mocked I/O.
// XAUCORE_TEST_SOURCE also allows checking a proposed HTML file before applying it.
const source = fs.readFileSync(process.env.XAUCORE_TEST_SOURCE || new URL('../public/index.html', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Source section exists: ${start}`);
  return source.slice(a, b);
}
const helpers = section('function xcSession(){', 'async function xcApi(');
const sessionFunctions = section('function xcSetSession(res){', '/* ---- lease:');
const applyLive = section('function xcApplyLive(L){', '/* Turn this tab');
const pollLive = section('async function xcPollLive(){', '/* Driver side: publish');
const publishLive = section('function xcStartLivePublish(){', '/* Become the driver:');
const pushState = section('function xcPushState(force){', '/* Reliable save');
const historyFunctions = section('const histServer =', '// the oldest chunk');
const fetchHistory = section('async function histFetch(gen, tf, k){', '// one chunk further back');
const pendingFunctions = section('function modifyPending(id, price, sl, tp){', 'function openOrderModify(id){');
const remoteOps = section('function execRemoteOps(ops){', 'function openPosition(side, volume, opts){');
const plain = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function context(code, overrides = {}) {
  const timeouts = new Map(), intervals = new Map(), canceled = [], storage = new Map();
  let id = 0;
  const ctx = {
    XC: { token: 'A', email: 'a@example.test', sid: 'test-device', _session: 0, follower: false, rev: 0 },
    LS_KEY: 'xc_state_A',
    S: { history: [], candles: {}, account: {}, symbol: { digits: 2 }, pendings: [], ui: {} },
    location: { hostname: 'test.example' },
    localStorage: { setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    setTimeout(fn) { timeouts.set(++id, fn); return id; },
    clearTimeout(n) { canceled.push(n); timeouts.delete(n); },
    setInterval(fn) { intervals.set(++id, fn); return id; },
    clearInterval(n) { canceled.push(n); intervals.delete(n); },
    recalcAccount() {}, render() {}, migrateState() {}, normalizeState() {}, syncBadge() {},
    TF_CAP: {}, modalEl: null, console, encodeURIComponent,
    ...overrides,
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + code, ctx);
  return { ctx, timeouts, intervals, canceled, storage };
}
function switchAccount(ctx, token = 'B') {
  ctx.xcResetSessionWork();
  ctx.XC.token = token;
  ctx.LS_KEY = token ? `xc_state_${token}` : 'xc_state_local';
}

test('live history includes a new trade when both devices already have 500 rows', () => {
  const { ctx } = context(applyLive);
  ctx.S.history = Array.from({ length: 500 }, (_, i) => ({ id: 500 - i, closeTime: 500 - i }));
  ctx.xcApplyLive({ histLen: 500, histTop: [{ id: 501, closeTime: 501 }, ...ctx.S.history.slice(0, 14)] });
  assert.equal(ctx.S.history[0].id, 501);
  assert.equal(ctx.S.history.length, 500);
  assert.equal(ctx.S.history.at(-1).id, 2);
});

test('TP1 and final close of one position remain separate history entries', () => {
  const { ctx } = context(applyLive);
  const partial = { id: 7, closeTime: 1, volume: 0.5, reason: 'TP1', entry: 4700, exit: 4701 };
  const final = { id: 7, closeTime: 2, volume: 0.5, reason: 'TP', entry: 4700, exit: 4702 };
  ctx.S.history = [partial];
  const frame = { histLen: 2, histTop: [final, partial] };
  ctx.xcApplyLive(frame);
  ctx.xcApplyLive(frame);
  assert.deepEqual(plain(ctx.S.history), [final, partial]);
});

test('authoritative empty history clears a previous follower history', () => {
  const { ctx } = context(applyLive);
  ctx.S.history = [{ id: 1 }];
  ctx.xcApplyLive({ histLen: 0, histTop: [] });
  assert.equal(ctx.S.history.length, 0);
});

test('a live forming candle remains current after archived chart history is cached', () => {
  const chartData = section('function chartData(tf){', '/* ---------------- candles');
  const { ctx } = context(applyLive + chartData, {
    histFresh: () => true,
    _histOld: { M1: [{ t: 1, c: 1 }] },
    _histCombo: {},
    TF_CAP: { M1: 1000 },
  });
  ctx.S.candles.M1 = Array.from({ length: 5 }, (_, i) => ({ t: i + 2, c: i + 2 }));
  assert.equal(ctx.chartData('M1').at(-1).c, 6);
  ctx.xcApplyLive({ candles: { M1: [{ t: 4, c: 40 }, { t: 5, c: 50 }, { t: 6, c: 60 }] } });
  assert.equal(ctx.chartData('M1').at(-1).c, 60);
  assert.equal(ctx.chartData('M1').length, 6);
});

for (const token of ['B', null]) {
  test(`late live response cannot apply account A after ${token ? 'switching to B' : 'logout'}`, async () => {
    const request = deferred(), applied = [];
    let renders = 0;
    const { ctx } = context(pollLive, {
      xcApi: () => request.promise,
      xcApplyLive: frame => applied.push(frame),
      render: () => { renders++; },
      xcTakeOver: () => { throw new Error('Stale response must not take over'); },
    });
    ctx.XC.follower = true;
    const polling = ctx.xcPollLive();
    switchAccount(ctx, token);
    ctx.XC.online = false;
    request.resolve({ lease: { mine: false, free: false }, live: { price: 'A' }, rev: 0 });
    await polling;
    assert.equal(applied.length, 0);
    assert.equal(renders, 0);
    assert.equal(ctx.XC.online, false);
  });
}

test('a full-state response arriving during a second await cannot replace the next account', async () => {
  const fullState = deferred();
  let requests = 0;
  const { ctx } = context(pollLive, {
    xcApi: () => ++requests === 1
      ? Promise.resolve({ lease: { mine: false, free: false }, rev: 3 })
      : fullState.promise,
    xcApplyLive() {},
  });
  ctx.XC.follower = true;
  const polling = ctx.xcPollLive();
  await turn();
  switchAccount(ctx);
  const nextState = ctx.S = { account: { owner: 'B' } };
  fullState.resolve({ state: { account: { owner: 'A' } } });
  await polling;
  assert.equal(ctx.S, nextState);
  assert.equal(ctx.XC.rev, 0);
});

test('logout/login with the same token still invalidates prior work and cancels cloud timers', () => {
  const { ctx, timeouts, intervals, canceled } = context(sessionFunctions);
  const old = ctx.xcSession();
  ctx.XC._pushT = ctx.setTimeout(() => {}, 1);
  ctx.XC._pushMax = ctx.setTimeout(() => {}, 1);
  ctx.XC._pollT = ctx.setInterval(() => {}, 1);
  ctx.XC._liveT = ctx.setInterval(() => {}, 1);
  const active = [ctx.XC._pushT, ctx.XC._pushMax, ctx.XC._pollT, ctx.XC._liveT];
  ctx.xcClearSession();
  ctx.xcSetSession({ token: 'A', email: 'a@example.test' });
  assert.equal(ctx.xcSessionCurrent(old), false);
  assert.equal(timeouts.size, 0);
  assert.equal(intervals.size, 0);
  for (const timer of active) assert.ok(canceled.includes(timer));
});

test('history waiting for IndexedDB is never uploaded under the next account token', async () => {
  const localWrite = deferred(), uploads = [], writes = [];
  const { ctx } = context(
    'const histKey = (gen, tf, k) => LS_KEY + "|" + gen + "|" + tf + "|" + k;\n' + historyFunctions,
    {
      histIdb: (mode, key, row) => { writes.push({ key, row }); return localWrite.promise; },
      xcApi: async (...args) => uploads.push(args),
    },
  );
  ctx.histStore('market-A', 'M1', 0, ['A-prices']);
  switchAccount(ctx);
  localWrite.resolve();
  await turn();
  assert.equal(uploads.length, 0);
  assert.deepEqual(writes.map(x => x.key), ['xc_state_A|market-A|M1|0']);
});

test('a history upload already sent as A never marks a row uploaded in B cache', async () => {
  const network = deferred(), writes = [], tokens = [];
  const { ctx } = context(
    'const histKey = (gen, tf, k) => LS_KEY + "|" + gen + "|" + tf + "|" + k;\n' + historyFunctions,
    {
      histIdb: async (mode, key, row) => writes.push({ key, row }),
      xcApi: () => { tokens.push(ctx.XC.token); return network.promise; },
    },
  );
  const sending = ctx.histSend('market-A', 'M1', 0, ['A-prices']);
  switchAccount(ctx);
  network.resolve({ ok: true });
  await sending;
  assert.deepEqual(tokens, ['A']);
  assert.equal(writes.length, 0);
});

test('history can still upload and mark its original namespace during the same session', async () => {
  const writes = [], uploads = [];
  const { ctx } = context(
    'const histKey = (gen, tf, k) => LS_KEY + "|" + gen + "|" + tf + "|" + k;\n' + historyFunctions,
    {
      histIdb: async (mode, key, row) => writes.push({ key, row: plain(row) }),
      xcApi: async (...args) => uploads.push(args),
    },
  );
  ctx.histStore('market-A', 'M1', 0, ['A-prices']);
  await turn();
  assert.equal(uploads.length, 1);
  assert.deepEqual(writes, [
    { key: 'xc_state_A|market-A|M1|0', row: { data: ['A-prices'], up: 0 } },
    { key: 'xc_state_A|market-A|M1|0', row: { data: ['A-prices'], up: 1 } },
  ]);
});

test('late history fetch returns no A data and cannot populate the B cache', async () => {
  const network = deferred(), writes = [];
  const { ctx } = context(
    'const histKey = (gen, tf, k) => LS_KEY + "|" + gen + "|" + tf + "|" + k;\n' + historyFunctions + fetchHistory,
    {
      histIdb: async (mode, key, row) => mode === 'get' ? null : writes.push({ key, row }),
      xcApi: () => network.promise,
    },
  );
  const fetching = ctx.histFetch('market-A', 'M1', 0);
  await turn();
  switchAccount(ctx);
  network.resolve({ data: ['A-prices'] });
  assert.equal(await fetching, null);
  assert.equal(writes.length, 0);
});

test('queued state push for A cannot submit current B state when its old callback runs', () => {
  const requests = [];
  const { ctx, timeouts } = context(pushState, {
    xcApi: (...args) => { requests.push(args); return Promise.resolve({}); },
    statePutBody: () => ({ account: 'B' }),
  });
  ctx.xcPushState(false);
  const queued = [...timeouts.values()];
  switchAccount(ctx);
  for (const callback of queued) callback();
  assert.equal(requests.length, 0);
});

test('late state push response cannot overwrite B lease, revision or in-flight marker', async () => {
  const network = deferred();
  const { ctx } = context(pushState, { xcApi: () => network.promise, statePutBody: () => '{}' });
  ctx.xcPushState(true);
  switchAccount(ctx);
  ctx.XC.rev = 20;
  ctx.XC.lease = { holder: 'B' };
  ctx.XC._inflight = true;
  network.resolve({ rev: 4, lease: { holder: 'A' }, updatedAt: 123 });
  await turn();
  assert.equal(ctx.XC.rev, 20);
  assert.equal(ctx.XC.lease.holder, 'B');
  assert.equal(ctx.XC._inflight, true);
});

test('late live publish cannot execute queued A orders on account B', async () => {
  const network = deferred(), executed = [];
  const { ctx, intervals } = context(publishLive, {
    _loopRunning: true,
    xcApi: () => network.promise,
    xcLiveFrame: () => ({ account: 'A' }),
    execRemoteOps: ops => executed.push(ops),
  });
  ctx.xcStartLivePublish();
  [...intervals.values()][0]();
  switchAccount(ctx);
  network.resolve({ ops: [{ kind: 'open', side: 'buy', volume: 0.01 }] });
  await turn();
  assert.equal(executed.length, 0);
});

test('follower pending modification queues the edit and leaves the mirrored order intact', () => {
  const queued = [];
  const { ctx } = context(pendingFunctions, {
    guardMirror: (kind, payload) => { queued.push({ kind, ...plain(payload) }); return true; },
    guardLock: () => false,
  });
  ctx.XC.follower = true;
  ctx.S.pendings = [{ id: 9, price: 4700, sl: null, tp: null }];
  ctx.modifyPending(9, 4800, 4790, 4810);
  assert.equal(ctx.S.pendings[0].price, 4700);
  assert.deepEqual(queued, [{ kind: 'modifyPending', id: 9, price: 4800, sl: 4790, tp: 4810 }]);
});

test('the driver applies a queued pending edit through the same locked trading path', () => {
  let saves = 0, pushed = 0, locked = false;
  const { ctx } = context(pendingFunctions + remoteOps, {
    guardMirror: () => false,
    guardLock: () => locked,
    roundTo: (value, digits) => Number(value.toFixed(digits)),
    toast() {}, L: x => x,
    save: () => { saves++; },
    xcPushState: () => { pushed++; },
  });
  ctx.S.pendings = [{ id: 9, price: 4700, sl: null, tp: 4900 }];
  ctx.execRemoteOps([{ kind: 'modifyPending', id: 9, price: 4800.125, sl: 4790, tp: null }]);
  assert.deepEqual(plain(ctx.S.pendings[0]), { id: 9, price: 4800.13, sl: 4790, tp: null });
  locked = true;
  ctx.execRemoteOps([{ kind: 'modifyPending', id: 9, price: 4500, sl: null, tp: null }]);
  assert.equal(ctx.S.pendings[0].price, 4800.13);
  assert.equal(saves, 1);
  assert.equal(pushed, 2);
});

function fundsContext(extraCode = '', overrides = {}) {
  const accountFunds = section('function accountFunds(action, amount){', 'function acctFundsModal(kind){');
  const mirror = section('function guardMirror(kind, payload){', '/* Driver side: run the orders');
  const calls = { saved: 0, savedNow: 0, pushed: 0, toasts: [], requests: [] };
  const runtime = context(mirror + accountFunds + remoteOps + extraCode, {
    S: { account: { balance: 10000, initialBalance: 10000 }, _acc: { freeMargin: 500 }, positions: [{ id: 9 }] },
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    roundTo: (value, digits) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits,
    money: String, fmt: String, L: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, n) => args[n]),
    toast: (...args) => calls.toasts.push(args),
    save: () => { calls.saved++; },
    saveNow: () => { calls.savedNow++; },
    xcPushState: () => { calls.pushed++; },
    xcApi: async (...args) => { calls.requests.push(plain(args)); return { queued: true }; },
    ...overrides,
  });
  return { ...runtime, calls };
}

test('follower account funding UI queues a request without a false balance update or success toast', async () => {
  const elements = {
    'af-amt': { value: '1000', addEventListener() {}, focus() {} },
    'af-err': {}, 'af-go': {},
  };
  const ui = section('function acctFundsModal(kind){', 'function screenMarketsList(){');
  const { ctx, calls } = fundsContext(ui, {
    document: { getElementById: id => elements[id] },
    modalEl: { querySelectorAll: () => [] },
    openSheet() {}, closeModal() {},
  });
  ctx.XC.follower = true;
  ctx.acctFundsModal('deposit');
  elements['af-go'].onclick();
  assert.equal(ctx.S.account.balance, 10000);
  assert.equal(calls.saved, 0);
  assert.equal(calls.toasts.some(([style]) => style === 'g'), false);
  await turn();
  assert.equal(calls.requests.length, 1);
  assert.deepEqual(calls.requests[0][2].order, { kind: 'accountFunds', action: 'deposit', amount: 1000 });
  assert.deepEqual(calls.toasts, [['', 'Запрос отправлен — исполняется']]);
});

test('driver revalidates a queued withdrawal against its current free margin', () => {
  const { ctx, calls } = fundsContext();
  ctx.S._acc.freeMargin = 100;
  ctx.execRemoteOps([{ kind: 'accountFunds', action: 'withdraw', amount: 500 }]);
  assert.equal(ctx.S.account.balance, 10000);
  assert.equal(calls.saved, 0);
  ctx.execRemoteOps([{ kind: 'accountFunds', action: 'withdraw', amount: 100 }]);
  assert.equal(ctx.S.account.balance, 9900);
  assert.equal(calls.saved, 1);
});

test('account deposit cap and withdrawal bounds remain enforced through the queue', () => {
  const { ctx, calls } = fundsContext();
  for (const amount of [0, -1, NaN, Infinity, 10000000.01]) {
    assert.equal(ctx.accountFunds('deposit', amount).ok, false);
  }
  assert.equal(ctx.accountFunds('withdraw', 500.01).ok, false);
  assert.equal(ctx.accountFunds('deposit', 10000000).ok, true);
  assert.equal(ctx.S.account.balance, 10010000);
  assert.equal(calls.saved, 1);
});

test('setting an account balance keeps its existing bounds, initial balance and open positions', () => {
  const { ctx, calls } = fundsContext();
  const positions = ctx.S.positions;
  assert.equal(ctx.accountFunds('set', 1e13).ok, true);
  assert.equal(ctx.S.account.balance, 1e12);
  assert.equal(ctx.S.account.initialBalance, 1e12);
  assert.equal(ctx.S.positions, positions);
  assert.equal(ctx.accountFunds('set', -1).ok, true);
  assert.equal(ctx.S.account.balance, 0);
  assert.equal(calls.savedNow, 2);
});

test('queued account balance replacement leaves the mirrored account unchanged until applied', () => {
  const { ctx, calls } = fundsContext();
  ctx.XC.follower = true;
  const result = ctx.accountFunds('set', 15000);
  assert.equal(result.queued, true);
  assert.equal(ctx.S.account.balance, 10000);
  assert.equal(ctx.S.account.initialBalance, 10000);
  assert.equal(calls.savedNow, 0);
  assert.deepEqual(calls.requests[0][2].order, { kind: 'accountFunds', action: 'set', amount: 15000 });
});
