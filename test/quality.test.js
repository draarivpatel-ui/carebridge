import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { shortcutFor } from '../src/shortcuts.js';

const root = new URL('../', import.meta.url);
const file = name => readFile(new URL(name, root), 'utf8');

for (const [key, view] of Object.entries({ w: 'week', s: 'symptoms', m: 'meds', h: 'handoff' })) {
  test(`keyboard shortcut ${key} is strictly opt-in`, () => {
    assert.equal(shortcutFor({ key }, false), null);
    assert.equal(shortcutFor({ key }, true), view);
  });
}
for (const condition of ['repeat', 'isComposing', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
  test(`shortcut ignores ${condition}`, () => assert.equal(shortcutFor({ key: 'm', [condition]: true }, true), null));
}
for (const key of ['Enter', ' ', 'ArrowDown', 'x', undefined, 115]) {
  test(`ignores unrelated shortcut key ${key}`, () => assert.equal(shortcutFor({ key }, true), null));
}

test('CSP disables outbound connections, inline code, dynamic eval and forms', async () => {
  const html = await file('index.html');
  const content = /<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i.exec(html)?.[1];
  assert.ok(content);
  for (const directive of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(content.split(';').map(s => s.trim()).includes(directive), directive);
  }
  assert.doesNotMatch(content, /unsafe-inline|unsafe-eval|https?:/i);
  assert.doesNotMatch(html, /<(?:script)(?![^>]+src=)[^>]*>[^<]+/i);
  assert.doesNotMatch(html, /<[^>]+\s(?:on\w+|style)=/i);
});

test('shipped source contains no browser HTML injection sinks', async () => {
  const files = (await readdir(new URL('src/', root))).filter(name => name.endsWith('.js'));
  for (const name of files) {
    const source = await file(`src/${name}`);
    assert.doesNotMatch(source, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval|Function)\s*(?:=|\()/, name);
  }
});

test('published text and source pass explicit dash, vendor-mention and CSS hygiene checks', async () => {
  const src = (await readdir(new URL('src/', root))).filter(name => name.endsWith('.js')).map(name => `src/${name}`);
  for (const name of ['index.html', 'styles.css', 'README.md', 'PRODUCT.md', 'DESIGN.md', 'sw.js', ...src]) {
    const source = await file(name);
    assert.doesNotMatch(source, /[\u2013\u2014]/, name);
    assert.doesNotMatch(source, /scroll-behavior\s*:\s*smooth/i, name);
    assert.doesNotMatch(source, /\b(?:\x41I|\x43hatGPT|\x4fpenAI|\x43laude|\x47emini)\b/, name);
  }
});

test('interactive controls keep AA-visible borders and 44px touch targets', async () => {
  const css = await file('styles.css');
  const channel = value => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance = hex => {
    const n = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert.match(css, /--line-strong:\s*#7f7963/);
  assert.ok(ratio(luminance('#7f7963'), luminance('#fbf7ec')) >= 3);
  assert.match(css, /button\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /input\[type="number"\], input\[type="time"\], input\[type="text"\], select\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.keys\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.check\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.drop\s*\{[^}]*min-height:\s*44px/);
  assert.doesNotMatch(css, /\.drop\s*\{[^}]*min-height:\s*25px/);
});
