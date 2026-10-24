import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.env.XAUCORE_NAV_SOURCE || new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const start = html.indexOf('const NAV_OPTICS ='), end = html.indexOf('function navBind(bar){', start);
assert.ok(start >= 0 && end > start, 'Actual navigation optics section exists');
const context = vm.createContext({ Math, clamp: (v, low, high) => Math.max(low, Math.min(high, v)) });
vm.runInContext(html.slice(start, end) + '\nglobalThis.api={NAV_OPTICS,navContactValues,navSpectrumValues};', context);
const { NAV_OPTICS, navContactValues, navSpectrumValues } = context.api;

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

test('contact coordinates recover a small outward source sample from either capsule edge', t => {
  near(NAV_OPTICS.contactGain, .0057);
  const width = 114, height = 55.8, center = [width / 2, height / 2];
  let largestOutward = 0;
  for (const y of [18, center[1], 45]) {
    const radius = height / 2, inset = radius - Math.sqrt(radius ** 2 - (y - radius) ** 2);
    for (const side of [-1, 1]) {
      const x = side < 0 ? inset : width - inset;
      // This is the documented coordinate image at the actual left/right capsule intersection.
      const capX = side < 0 ? radius : width - radius;
      const input = [.5 + (x - capX) / (height * NAV_OPTICS.contactSpan), .5 + (y - radius) / (height * NAV_OPTICS.contactSpan), .27, 1];
      const normal = matrix(navContactValues(width, height, side), input);
      near(normal[2], .27); near(normal[3], 1);
      assert.ok(normal.slice(0, 2).every(value => value > 0 && value < 1), 'The contact coordinate matrix does not clip');
      for (const energy of [0, 1]) for (const clear of [.25, 1]) for (const refraction of [.5, 1.5]) {
        const bend = clear * (NAV_OPTICS.bend + NAV_OPTICS.motion * energy) * refraction;
        const magnify = 1 + clear * (.14 + .025 * energy) * refraction;
        for (const [axis, position] of [x, y].entries()) {
          const displacement = bend * (normal[axis] - .5);
          near(displacement, bend * .0057 * (position - center[axis]), 'Contact displacement follows the logical coordinate in local pixels');
          const source = center[axis] + (position + displacement - center[axis]) / magnify;
          const outward = Math.sign(position - center[axis]) * (source - position);
          assert.ok(outward >= -1e-10 && outward <= 1, `The inverse source reaches the incoming glyph by at most one local pixel (${outward})`);
          largestOutward = Math.max(largestOutward, outward);
          if (axis === 0) assert.ok(side * (source - x) > 0, 'Both side arcs sample beyond their first contact');
        }
      }
    }
  }
  t.diagnostic(`Maximum outward source reach ${largestOutward.toFixed(6)} local px across both caps, three heights and eight optical states`);
});

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


test('contact field coefficients stay identical between prepared and live paths while the contour fades', () => {
  for (const ratio of [1, 1.5, 2, 2.7, 3]) for (const side of [-1, 1]) {
    const prepared = navContactValues(55.8 * ratio, 55.8, side);
    for (const height of [52, 54.4186, 55.8, 56.4186, 58]) {
      const live = navContactValues(height * ratio, height, side);
      for (let i = 0; i < 20; i++) near(live[i], prepared[i], 'Prepared/live contact maps agree at the same aspect ratio');
    }
  }
});
