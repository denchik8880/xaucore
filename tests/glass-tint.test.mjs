import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('«Затемнение»: every glass body token is mixed towards the tint, and none with the glass off', () => {
  const defs = [...html.matchAll(/--(nav|sheet|pop|cap|ctl|bar|bg|toast|info)-glass:([^;}\n]*)/g)];
  assert.ok(defs.length >= 36, `${defs.length} definitions`);
  for (const [whole, , value] of defs) assert.match(value, /^color-mix\(in srgb,.*var\(--lg-dim,#000\) calc\(var\(--lgt,0\) \* var\(--lgtm,50%\)\)\)/, whole.slice(0, 80));
  assert.match(html, /:root:not\(\[data-glass="on"\]\)\{--lgtm:0%\}/);
  assert.match(html, /--lgt:0; --lgtm:50%; --lg-dim:#000;/);
});

test('«Затемнение»: kept per theme, read before first paint, 0 when unset or out of range', () => {
  const head = html.match(/function lgSavedTint\(th\)\{[^\n]*\}/)[0];
  const store = { xc_glass_tint_dark: '70', xc_glass_tint_light: '140', xc_glass_tint_aurora: ' ' };
  const ctx = { localStorage: { getItem: k => (k in store ? store[k] : null) }, Number, Math };
  vm.createContext(ctx); vm.runInContext(head + ';globalThis.f=lgSavedTint;', ctx);
  assert.equal(ctx.f('dark'), 70); assert.equal(ctx.f('light'), 0); assert.equal(ctx.f('aurora'), 0); assert.equal(ctx.f('x'), 0);
  assert.match(html, /st\.setProperty\("--lgt",\(lgSavedTint\(th\)\/100\)\.toFixed\(3\)\)/);
  assert.match(html, /applyClarity\(glassClarity\(\)\); applyTint\(glassTint\(\)\);/);
  assert.match(html, /data-lgtint="\$\{th\}"/);
});

test('the glass sheet speaks five languages for its new words', () => {
  for (const key of ['Затемнение', 'Внутренняя тень', 'Прозрачное', 'Тонированное']) {
    const m = html.match(new RegExp('"' + key + '":\\[("[^"]+",?){4}\\]'));
    assert.ok(m, key);
  }
});
