import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const early = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].slice(0, 3).map(m => m[1]);
const version = early[1].match(/LG_PRESET_VERSION="([^"]+)"/)[1];
const glassKeys = ['xc_glass_clear_light', 'xc_glass_clear_dark', 'xc_glass_clear_aurora', 'xc_glass_clear', 'xc_lg_ui', 'xc_glass_off', 'xc_disp'];

function storage(initial, failures = {}) {
  const values = new Map(Object.entries(initial)), writes = [];
  return { values, writes, failures,
    getItem(k) { if(failures.read) throw new Error('Storage unavailable'); return values.get(k) ?? null; },
    removeItem(k) { if(failures.write) throw new Error('Storage unavailable'); writes.push(['remove', k]); values.delete(k); },
    setItem(k, v) { if(failures.write) throw new Error('Storage unavailable'); writes.push(['set', k, String(v)]); values.set(k, String(v)); },
  };
}
function boot(saved) {
  const properties = new Map(), meta = new Map();
  const context = { localStorage: saved, document: {
    documentElement: { dataset: {}, style: { setProperty(k, v) { properties.set(k, v); } }, lang: '' },
    querySelector() { return { setAttribute(k, v) { meta.set(k, v); } }; },
  } };
  vm.createContext(context);
  for(const source of early) vm.runInContext(source, context);
  return { context, root: context.document.documentElement, properties, meta };
}
function loadRuntime(context) {
  const source = name => {
    const start = html.indexOf('function ' + name + '('), end = html.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start); return html.slice(start, end + 2);
  };
  const dispersion = html.slice(html.indexOf('const DISP0 ='), html.indexOf('function dispSave()'));
  const ui = html.match(/^const LG_UI = .*;$/m)[0];
  context.lgUiApply = () => {}; context.tiltStart = () => {};
  vm.runInContext(dispersion + '\n' + ui + '\n' + source('lgUiSave') + '\n' + source('lgUiLoad') +
    '\nlgUiLoad();globalThis.loadedUI={...LG_UI};globalThis.loadedDisp={...DISP};', context);
}

test('the reference preset replaces old extreme or corrupt glass settings before first paint and keeps account data', () => {
  const unrelated = { xc_token: 'account-token', xc_theme: 'aurora', xc_lang: 'ru', xc_state: '{"positions":[{"id":"trade-1","lot":0.7}]}', xc_sid: 'session-1' };
  const saved = storage({ ...unrelated, xc_glass_v: '2', xc_glass: 'off',
    xc_glass_clear_light: '100', xc_glass_clear_dark: '0', xc_glass_clear_aurora: '7', xc_glass_clear: '21',
    xc_lg_ui: '{"d":200,"r":-4,"t":true}', xc_glass_off: 'nav refract sheets', xc_disp: '{broken-json',
  });
  const b = boot(saved); loadRuntime(b.context);
  assert.equal(saved.getItem('xc_glass_v'), version); assert.notEqual(version, '2');
  assert.equal(saved.getItem('xc_glass'), 'on');
  for(const key of glassKeys) assert.equal(saved.getItem(key), null, key + ' no longer overrides the shared preset');
  for(const [key, value] of Object.entries(unrelated)) assert.equal(saved.getItem(key), value);
  assert.equal(b.root.dataset.glass, 'on'); assert.equal(b.root.dataset.theme, 'dark'); assert.equal(b.root.dataset.tone, 'aurora');
  assert.equal(b.root.dataset.lgoff, undefined); assert.equal(b.root.lang, 'ru');
  for(const theme of ['light', 'dark', 'aurora']) assert.equal(b.context.lgSavedClarity(theme), 85);
  assert.equal(b.properties.get('--lgk'), b.context.lgq(85).k.toFixed(3));
  assert.deepEqual(JSON.parse(JSON.stringify(b.context.loadedUI)), { depth:1, light:1, shadow:1, refract:1, line:1, dark:1, chroma:false, tilt:false });
  assert.equal(b.context.loadedDisp.on, true); assert.equal(b.context.loadedDisp.str, 50); assert.equal(b.context.loadedDisp.drops, true);
  // Runtime normalization may save the dials; the migration marker itself follows every migration write.
  const marker = saved.writes.findIndex(w => w[1] === 'xc_glass_v');
  assert.equal(marker, glassKeys.length + 1);
});

test('the current preset version preserves later user changes across reloads', () => {
  const edits = { xc_glass_v: version, xc_glass:'off', xc_theme:'dark', xc_glass_clear_light:'23', xc_glass_clear_dark:'77',
    xc_glass_clear_aurora:'49', xc_glass_clear:'16', xc_glass_off:'headers',
    xc_lg_ui:'{"d":1.52,"r":0.74,"l":1.02,"ln":0.88,"dk":0.94,"s":0.9,"t":false}',
    xc_disp:'{"on":true,"str":31,"drops":false}',
  };
  const saved = storage(edits), b = boot(saved);
  assert.equal(saved.writes.length, 0);
  for(const [key, value] of Object.entries(edits)) assert.equal(saved.getItem(key), value);
  assert.equal(b.root.dataset.glass, 'off'); assert.equal(b.root.dataset.lgoff, 'headers');
  assert.equal(b.context.lgSavedClarity('dark'), 77); assert.equal(b.context.lgSavedClarity('aurora'), 49);
  loadRuntime(b.context);
  assert.equal(b.context.loadedUI.refract, .74); assert.equal(b.context.loadedUI.depth, 1.52);
  assert.equal(b.context.loadedDisp.str, 31); assert.equal(b.context.loadedDisp.drops, false);
});

test('unavailable local storage does not stop early initialization or loading the default controls', () => {
  const saved = storage({}, { read: true, write: true });
  const b = boot(saved); loadRuntime(b.context);
  assert.equal(b.root.dataset.glass, 'on'); assert.equal(b.root.lang, 'en');
  assert.equal(b.context.lgSavedClarity('aurora'), 85);
  assert.equal(b.context.loadedUI.refract, 1); assert.equal(b.context.loadedDisp.str, 50);
  assert.equal(saved.writes.length, 0);
});

test('a failed preset write leaves the old marker so the next successful load retries it', () => {
  const saved = storage({ xc_glass_v:'2', xc_glass:'off', xc_glass_clear_aurora:'1' }, { write:true });
  boot(saved); assert.equal(saved.getItem('xc_glass_v'), '2');
  saved.failures.write = false;
  const b = boot(saved);
  assert.equal(saved.getItem('xc_glass_v'), version); assert.equal(b.root.dataset.glass, 'on');
  assert.equal(b.context.lgSavedClarity('aurora'), 85);
  assert.deepEqual(saved.writes.at(-1), ['set', 'xc_glass_v', version]);
});
