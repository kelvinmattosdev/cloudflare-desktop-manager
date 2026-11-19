const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTheme, saveTheme } = require('../src/theme.cjs');

test('theme starts with system, persists all three choices, and rejects invalid input', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbodesk-theme-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'ui-theme');
  assert.equal(loadTheme(file), 'system');
  for (const theme of ['dark', 'light', 'system']) {
    assert.equal(saveTheme(file, theme), theme);
    assert.equal(loadTheme(file), theme);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  }
  assert.throws(() => saveTheme(file, '../dark'), /Tema inválido/);
  fs.writeFileSync(file, 'unexpected');
  assert.equal(loadTheme(file), 'system');
});

function luminance(hex) {
  const color = hex.length === 4 ? [...hex.slice(1)].map(n => n + n).join('') : hex.slice(1);
  assert.match(color, /^[\da-f]{6}$/i);
  const channels = color.match(/../g).map(value => parseInt(value, 16) / 255)
    .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test('light and dark text, actions, focus rings and fields meet contrast targets', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');
  const palettes = [...css.matchAll(/:root\s*\{([^}]+)\}/g)].map(([, body]) =>
    Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[\da-f]+);/gi)].map(([, key, value]) => [key, value])));
  assert.equal(palettes.length, 2);
  const pairs = [
    ['ink', ['canvas', 'surface', 'raised', 'soft', 'quiet', 'hover'], 4.5],
    ['muted', ['canvas', 'surface', 'raised', 'soft', 'quiet', 'accent-wash'], 4.5],
    ['accent', ['canvas', 'surface', 'quiet', 'soft', 'accent-wash'], 4.5],
    ['on-action', ['action', 'action-hover'], 4.5],
    ['on-danger', ['danger-action', 'danger-hover'], 4.5],
    ['info-ink', ['accent-wash'], 4.5],
    ['positive', ['positive-wash', 'surface'], 4.5],
    ['danger', ['surface', 'soft', 'danger-wash'], 4.5],
    ['proxy', ['surface', 'soft', 'proxy-fill'], 3],
    ['control', ['canvas', 'surface', 'quiet', 'raised', 'soft'], 3],
    ['accent', ['raised', 'hover'], 3],
    ['action', ['surface', 'raised'], 3],
    ['danger-action', ['surface', 'raised'], 3]
  ];
  for (const [i, palette] of palettes.entries()) {
    for (const [ink, backgrounds, required] of pairs) {
      for (const background of backgrounds) {
        const values = [ink, background].map(key => luminance(palette[key])).sort((a, b) => b - a);
        const ratio = (values[0] + 0.05) / (values[1] + 0.05);
        assert.ok(ratio >= required, `${i ? 'escuro' : 'claro'}: ${ink}/${background} ${ratio.toFixed(2)} < ${required}`);
      }
    }
  }
});
