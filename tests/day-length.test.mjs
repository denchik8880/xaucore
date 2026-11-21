// The 4-hour day (user 2026-11-17: «медленнее, день = 4 часа») and the tick rate that follows the market's hour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const a = source.indexOf('const LS_LEGACY ='), b = source.indexOf('/* =========================================================================\n   UI', a);
assert.ok(a >= 0 && b > a);
const core = source.slice(a, b);

function engine() {
  let seed = 0x5eed1234;
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const ctx = { Math: math, console, window: {}, location: { hostname: 'localhost' }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, XC: { token: null, follower: false }, modalEl: null,
    document: { body: { classList: { toggle() {} } } }, L: m => m, toast() {}, ordTypeName: v => v, closeModal() {}, render() {}, xcPushState() {},
    fetch() { throw new Error('no network'); } };
  vm.createContext(ctx);
  vm.runInContext(core + `
    save = () => {}; saveNow = () => {};
    globalThis.E = { fresh(){ S = DEFAULTS(); seedMarket(); S.simClock = Date.UTC(2026, 10, 17, 3); return S; }, set(v){ S = v; }, S: () => S,
      migrateState, dayDurationMs, daySpeedNow, normalTickRate, HOUR_VOL };`, ctx);
  return ctx.E;
}

test('a new account runs a 4-hour day: 6 game minutes to a real one', () => {
  const E = engine(), S = E.fresh();
  assert.equal(S.market.dayDurationMin, 240);
  assert.equal(E.dayDurationMs(), 240 * 60000);
  assert.equal(E.daySpeedNow(), 6);
});

test('an account on the old 45-minute day moves to 240 once, its running day and regime keeping their share', () => {
  const E = engine(), S = E.fresh();
  S.market.dayDurationMin = 45; delete S.market.dayRev;
  S.day.elapsedMs = 30 * 60000; S.regime.ageMs = 90 * 60000;              // two thirds of a day, two days of a regime
  E.migrateState();
  assert.equal(S.market.dayDurationMin, 240);
  assert.ok(Math.abs(S.day.elapsedMs / E.dayDurationMs() - 30 / 45) < 1e-12, 'the same share of the day');
  assert.ok(Math.abs(S.regime.ageMs / E.dayDurationMs() - 2) < 1e-12, 'the same days of the regime');
  // once: a length the user then sets by hand is kept
  S.market.dayDurationMin = 45; E.migrateState();
  assert.equal(S.market.dayDurationMin, 45);
  // a hand-set length from before is kept too
  const T = E.fresh(); T.market.dayDurationMin = 120; delete T.market.dayRev; E.migrateState();
  assert.equal(T.market.dayDurationMin, 120);
});

test('ticks come as often as the hour is busy: half the set rate in a quiet hour, up to 3× it at the US open (halved 2026-11-21)', () => {
  const E = engine(), S = E.fresh();
  const at = h => { S.simClock = Date.UTC(2026, 10, 17, h, 30); return E.normalTickRate(); };
  const quiet = at(3), europe = at(9), ny = at(14);
  assert.ok(quiet >= 1 && quiet < 1.75, `quiet ${quiet}`);
  assert.ok(europe > quiet && europe < ny, `europe ${europe}`);
  assert.ok(ny > 4.5 && ny <= 6, `new york ${ny}`);
  S.manual.enabled = true;
  assert.equal(at(14), 2, 'manual control keeps exactly the set rate');
});
