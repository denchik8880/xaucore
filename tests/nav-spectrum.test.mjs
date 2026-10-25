import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.env.XAUCORE_NAV_SOURCE || new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = html.indexOf('const NAV_OPTICS ='), end = html.indexOf('function navBind(bar){', start);
assert.ok(start >= 0 && end > start, 'Actual navigation optics section exists');
const context = vm.createContext({ Math, clamp: (v, low, high) => Math.max(low, Math.min(high, v)) });
vm.runInContext(html.slice(start, end) + '\nglobalThis.api={NAV_OPTICS,navSpectrumValues};', context);
const { NAV_OPTICS, navSpectrumValues } = context.api;

const near = (actual, expected, message = `${actual} ≈ ${expected}`) => assert.ok(Math.abs(actual - expected) < 1e-10, message);
const clamp01 = value => Math.max(0, Math.min(1, value));
function matrix(values, rgba, clamp = false) {
  assert.equal(values.length, 20, 'SVG color matrices contain four five-value rows');
  assert.ok(values.every(Number.isFinite), 'Color matrix coefficients are finite');
  return Array.from({ length: 4 }, (_, row) => {
    let value = values[row * 5 + 4];
    for (let channel = 0; channel < 4; channel++) value += values[row * 5 + channel] * rgba[channel];
    return clamp ? clamp01(value) : value;
  });
}
function screen(a, b) {
  return a.map((value, channel) => channel === 3 ? 1 : 1 - (1 - value) * (1 - b[channel]));
}
function spectrum(palette, samples) {
  assert.ok(palette && palette.channels.length === 3);
  const projected = palette.channels.map((values, channel) => matrix(values, [...samples[channel], 1], true));
  const channels = screen(screen(projected[0], projected[1]), projected[2]);
  const delta = matrix(palette.delta, channels, true);
  // Match SVG's final arithmetic composite and clamping, using the unmodified middle sample.
  return [...samples[1].map((value, channel) => clamp01(value + 2 * delta[channel] - 256 / 255)), 1];
}
function nearColor(actual, expected, message) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, channel) => near(value, expected[channel], `${message}, channel ${channel}: ${value} ≈ ${expected[channel]}`));
}

test('spectrum channels measure transmittance through the palette channel with strongest contrast', () => {
  for (const [ink, background, strongest] of [
    [[.91, .05, .1], [1, .98, .96], 1],
    [[.98, .16, .2], [.04, .05, .08], 0],
  ]) {
    const palette = navSpectrumValues(ink, background);
    assert.ok(palette && palette.channels.length === 3);
    for (const transmittance of [0, .25, .5, 1]) {
      const source = [.42, .43, .44];
      source[strongest] = ink[strongest] + transmittance * (background[strongest] - ink[strongest]);
      palette.channels.forEach((values, output) => {
        const expected = [0, 0, 0, 1]; expected[output] = transmittance;
        nearColor(matrix(values, [...source, 1], true), expected, 'Only the selected output channel carries source transmittance');
      });
    }
  }
  assert.equal(navSpectrumValues([.5, .5, .5], [.54, .52, .53]), null, 'Insufficient palette contrast disables spectrum safely');
  assert.ok(navSpectrumValues([.5, .5, .5], [.5625, .5, .5]), 'A usable single-channel contrast enables spectrum');
});

test('equal RGB sample positions preserve the actual source including off-palette badge colors', () => {
  for (const [ink, background] of [
    [[.91, .05, .1], [1, 1, 1]],
    [[.98, .16, .2], [.04, .05, .08]],
  ]) {
    const palette = navSpectrumValues(ink, background);
    for (const source of [ink, background, [.03, .35, .95], [1, 1, 1], [.19, .3, .57], [.6, .6, .6]]) {
      nearColor(spectrum(palette, [source, source, source]), [...source, 1], 'No spectral correction when all three passes see the same source');
    }
  }
});

test('light contact fringes produce cyan and yellow while empty glass retains its background', () => {
  const ink = [.91, .05, .1], background = [1, 1, 1], palette = navSpectrumValues(ink, background);
  nearColor(spectrum(palette, [ink, background, background]), [0, 1, 1, 1], 'An entering low red sample yields cyan');
  nearColor(spectrum(palette, [background, background, ink]), [1, 1, 0, 1], 'An entering low blue sample yields yellow');
  nearColor(spectrum(palette, [background, background, background]), [...background, 1], 'Empty glass receives no global hue');
  nearColor(spectrum(palette, [ink, ink, ink]), [...ink, 1], 'The uniform selected source retains its red accent');
});

test('dark contact fringes stay finite and colored without tinting the background or uniform source', () => {
  const ink = [.98, .16, .2], background = [.04, .05, .08], palette = navSpectrumValues(ink, background);
  const redFringe = spectrum(palette, [ink, background, background]);
  const blueFringe = spectrum(palette, [background, background, ink]);
  for (const output of [redFringe, blueFringe]) {
    assert.ok(output.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.equal(output[3], 1);
    assert.ok(Math.max(...output.slice(0, 3)) - Math.min(...output.slice(0, 3)) > .5, 'Dark themes retain a substantial chromatic fringe');
  }
  assert.ok(redFringe[0] > background[0] + .5 && redFringe[1] <= background[1] && redFringe[2] <= background[2]);
  assert.ok(blueFringe[2] > background[2] + .5 && blueFringe[0] <= background[0] && blueFringe[1] <= background[1]);
  nearColor(spectrum(palette, [background, background, background]), [...background, 1], 'The dark background stays unpainted');
  nearColor(spectrum(palette, [ink, ink, ink]), [...ink, 1], 'The uniform selected source stays intact in dark themes');
});
