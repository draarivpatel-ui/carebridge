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
