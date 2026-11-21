import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const chromePath = process.env.CHROME_BIN ?? (process.platform === 'darwin' ?
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const capture = process.argv.includes('--capture');
const captures = new Map();
const { server, origin } = await serve(0, '/carebridge/');
const profile = await mkdtemp(fileURLToPath(new URL('../.chrome-', import.meta.url)));
const chrome = spawn(chromePath, [
  '--headless=new', '--mute-audio', '--no-first-run', '--disable-extensions', '--disable-background-networking',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let chromeFailure;
chrome.on('error', error => { chromeFailure = error; });
let connection;

async function until(check, description, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await pause(35);
  }
  throw new Error(`Timed out: ${description}`);
}

try {
  const port = await until(async () => {
    if (chromeFailure) throw chromeFailure;
    if (chrome.exitCode !== null) throw new Error('Headless Chrome exited early.');
    try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
    catch { return false; }
  }, 'Chrome startup');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  connection = new WebSocket(targets.find(p => p.type === 'page').webSocketDebuggerUrl);
  await Promise.race([once(connection, 'open'), pause(6000, false, { ref: false }).then(() => { throw new Error('CDP connection timeout'); })]);
  const events = [];
  const messages = new Map();
  let serial = 0;
  connection.addEventListener('message', e => {
    const packet = JSON.parse(e.data);
    if (packet.id) {
      const waiter = messages.get(packet.id);
      if (!waiter) return;
      messages.delete(packet.id);
      if (packet.error) waiter.reject(new Error(packet.error.message));
      else waiter.resolve(packet.result);
    } else events.push(packet);
  });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      messages.set(++serial, { resolve, reject });
      connection.send(JSON.stringify({ method, id: serial, params }));
    });
  }
  const js = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const text = selector => js(`${q(selector)}?.textContent ?? ''`);
  const visible = selector => js(`Boolean(${q(selector)}?.getClientRects().length)`);
  async function click(selector) {
    const point = await js(`(() => {
      const el = ${q(selector)}; if (!el) return null;
      el.scrollIntoView({block:'center', inline:'center'});
      const rect = el.getBoundingClientRect(); const x = rect.x + rect.width/2, y = rect.y + rect.height/2;
      const hit = document.elementFromPoint(x, y);
      return el === hit || el.contains(hit) || hit?.closest('label')?.control === el ? { x, y } : null;
    })()`);
    assert.ok(point, `Real pointer must be able to hit ${selector}`);
    for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]]) {
      await call('Input.dispatchMouseEvent', { type, ...point, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1 });
    }
  }
  const choose = (selector, value) => js(`(() => {
    const el = ${q(selector)}; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', {bubbles: true})); return el.value;
  })()`);
  const setInput = (selector, value) => js(`(() => {
    const el = ${q(selector)}; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  async function key(letter) {
    const key = letter.toLowerCase();
    const code = `Key${letter.toUpperCase()}`;
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  }
  async function navigate(url) {
    const first = events.length;
    const result = await call('Page.navigate', { url });
    assert.equal(result.errorText, undefined);
    if (result.loaderId) {
      await until(() => events.slice(first).some(e => e.method === 'Page.loadEventFired'), 'document load');
    }
  }
  async function size(width, height, mobile) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    if (mobile) await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  }
  async function noOverflow() {
    assert.equal(await js('document.documentElement.scrollWidth <= window.innerWidth'), true);
  }
  async function screenshot(name) {
    if (!capture) return;
    await js('window.scrollTo(0, 0)');
    await pause(350);
    const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    captures.set(name, Buffer.from(result.data, 'base64'));
  }
  function printPageCount(data) {
    return (Buffer.from(data, 'base64').toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
  }

  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await call(`${domain}.enable`);
  await call('Browser.setDownloadBehavior', { behavior: 'deny' });
  await size(1280, 800, false);
  const header = await fetch(origin);
  assert.match(header.headers.get('content-security-policy'), /connect-src 'none'.*frame-ancestors 'none'/);
  assert.equal(header.headers.get('referrer-policy'), 'no-referrer');
  await navigate(origin);
  await until(async () => /^12 of 12 staffed/.test(await text('#coverage dd')), 'initial exact schedule');
  await until(() => js('Boolean(navigator.serviceWorker.controller)'), 'local shell installed');
  await noOverflow();
  assert.equal(await js("document.querySelectorAll('[id]').length === new Set([...document.querySelectorAll('[id]')].map(e => e.id)).size"), true);
  assert.equal(await js("[...document.querySelectorAll('h1')].filter(h => h.getClientRects().length).length"), 1);
  await screenshot('desktop');
  assert.equal(await js(`${q('#shortcut-toggle')}.checked`), false);
  await key('m');
  assert.ok(await visible('#week'));
  await click('#shortcut-toggle');
  await js('document.activeElement.blur()');
  await key('s');
  assert.ok(await visible('#symptoms'));
  await js(`${q('#temperature')}.focus()`);
  await key('m');
  assert.ok(await visible('#symptoms'));
  await click('#nav-week');

  await click('#drop-noor');
  const lastFocused = await js("document.activeElement?.id || document.activeElement?.control?.id");
  assert.equal(lastFocused, 'drop-noor');
  await click('#drop-noor');
  await choose('#scenario', 'understaffed');
  assert.match(await text('#coverage dd'), /^7 of 11 staffed/);
  await click('#drop-ana');
  assert.match(await text('#coverage dd'), /^10 of 11 staffed/);
  await choose('#scenario', 'post-chemo');

  await click('#nav-symptoms');
  assert.ok(await visible('#symptoms'));
  assert.match(await text('#triage-result'), /call|oncology/i);
  await choose('#unit', 'C');
  await setInput('#temperature', '38.26');
  await setInput('#sustained', '0');
  const submit = '#symptom-form button[type=submit]';
  await click(submit);
  assert.match(await text('#triage-result'), /oncology/i);
  assert.match(await text('#triage-result'), /38\.26/);
  assert.doesNotMatch(await text('#triage-result'), /(?:meets|match(?:es|ed)?) (?:the )?single[- ]oral/i);
  await click('#sign-confusion');
  await setInput('#sustained', '-1');
  await click(submit);
  assert.match(await text('#triage-result'), /emergency services now/i);
  assert.match(await text('#triage-result'), /confusion/i);
  assert.doesNotMatch(await text('#triage-result'), /\[object HTML/);
  await js('document.querySelector("#temperature").focus()');
  await key('m');
  assert.ok(await visible('#symptoms'));
  await click('#nav-meds');
  assert.match((await text('#med-timeline')) + (await text('#med-entries')), /acetaminophen/i);
  assert.match(await text('#med-flags'), /mask|ciprofloxacin/i);
  await choose('#med-item', 'iron');
  await setInput('#med-at', '09:00');
  await click('#med-add');
  assert.match(await text('#med-entries'), /ferrous sulfate/i);
  await click('#med-entries button[data-rm="3"]');
  assert.doesNotMatch(await text('#med-entries'), /ferrous sulfate/i);

  await click('#nav-handoff');
  assert.ok(await visible('#handoff'));
  await js(`(() => {
    const collect = []; window.__exports = collect;
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { collect.push({type:blob.type, content:blob.text()}); return make(blob); };
  })()`);
  for (const id of ['#export-calendar', '#export-schedule', '#export-symptoms', '#audit-bundle']) await click(id);
  const downloads = await until(async () => {
    const items = await js(`Promise.all(window.__exports.map(async e => ({type:e.type, content:await e.content})))`);
    return items.length === 4 ? items : false;
  }, 'four actual download actions');
  assert.match(downloads[0].content, /^BEGIN:VCALENDAR\r\n/);
  assert.match(downloads[1].content, /clinic|caregiver/i);
  assert.match(downloads[2].content, /oncology|temperature/i);
  assert.match(JSON.parse(downloads[3].content).sha256, /^[a-f0-9]{64}$/);
  assert.equal(await choose('#handoff-language', 'en'), 'en');
  assert.equal(await js(`${q('#binder')}.lang`), 'en');
  await call('Emulation.setEmulatedMedia', { media: 'print' });
  assert.ok(await visible('#binder'));
  assert.equal(await visible('#nav-week'), false);
  assert.equal(printPageCount((await call('Page.printToPDF', { preferCSSPageSize: true })).data), 1);
  await call('Emulation.setEmulatedMedia', { media: 'screen' });
  await choose('#handoff-language', 'es');
  await choose('#handoff-person', 'noor');
  assert.equal(await js(`${q('#binder')}.lang`), 'es');
  assert.match(await text('#binder'), /cuidad|traslado|entrega|relevo/i);
  assert.doesNotMatch(await text('#binder'), /\[object HTML/);
  assert.match(await text('#binder'), /Noor/);
  assert.match(await text('#binder'), /22:00 - 0[34]:00/);
  await call('Emulation.setEmulatedMedia', { media: 'print' });
  assert.equal(printPageCount((await call('Page.printToPDF', { preferCSSPageSize: true })).data), 1);
  await call('Emulation.setEmulatedMedia', { media: 'screen' });
  await screenshot('handoff');
  await click('#seal-card');
  const link = await until(() => js(`${q('#handoff-link')}.value`), 'encrypted handoff URL');
  assert.ok(link.startsWith(`${origin}#handoff=`));
  await navigate(link);
  await until(() => js('location.hash === ""'), 'card fragment removed from history');
  assert.match(await text('#handoff-status'), /opened|loaded|read.only|received|imported/i);
  assert.ok(await visible('#binder'));
  const tampered = link.replace(/#handoff=(.)/, (_, char) => `#handoff=${char === 'A' ? 'B' : 'A'}`);
  await navigate(tampered);
  await until(async () => /invalid|changed/i.test(await text('#handoff-status')), 'authenticated tamper rejected');
  await navigate(`${origin}#handoff=<svg%20onload=alert(1)>&k=invalid`);
  await until(() => js('location.hash === ""'), 'malformed handoff fragment rejected and cleared');
  assert.match(await text('#handoff-status'), /invalid|changed/i);
  assert.equal(await js('document.querySelectorAll("[onload],[onerror]").length'), 0);

  await size(390, 844, true);
  await call('Page.reload', { ignoreCache: false });
  await until(() => visible('#scenario'), 'mobile load');
  await noOverflow();
  assert.equal(await js("new Set([...document.querySelectorAll('.nav-group button')].map(button => button.getBoundingClientRect().top)).size"), 1);
  if (process.argv.includes('--mobile-proof')) await screenshot('.mobile-check');
  for (const [button, panel] of [['symptoms', 'symptoms'], ['meds', 'meds'], ['handoff', 'handoff']]) {
    await click(`#nav-${button}`);
    assert.ok(await visible(`#${panel}`));
    await noOverflow();
  }
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const first = events.length;
  await call('Page.reload', { ignoreCache: false });
  await until(() => events.slice(first).some(e => e.method === 'Page.loadEventFired'), 'offline reload');
  await until(() => visible('#scenario'), 'offline week');
  assert.match(await text('#coverage dd'), /^12 of 12 staffed/);
  await noOverflow();

  const pageErrors = events.filter(e => e.method === 'Runtime.exceptionThrown');
  const consoleErrors = events.filter(e => (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
    (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
  const external = events.filter(e => e.method === 'Network.requestWillBeSent' &&
    !e.params.request.url.startsWith(origin) && !/^(?:about:|data:|blob:)/.test(e.params.request.url));
  const dialogs = events.filter(e => e.method === 'Page.javascriptDialogOpening');
  assert.deepEqual({ pageErrors, consoleErrors, external, dialogs }, { pageErrors: [], consoleErrors: [], external: [], dialogs: [] });
  for (const [name, image] of captures) await writeFile(new URL(`../docs/${name}.png`, import.meta.url), image);
  console.log('Chrome: desktop 1280x800, mobile 390x844, no overflow; native pointer paths; EN and ES 1-page print; handoff import and tamper rejection; cold offline reload; 0 console/page errors; 0 external requests.');
} finally {
  connection?.close();
  if (chrome.pid && chrome.exitCode === null) {
    const exited = once(chrome, 'exit');
    chrome.kill('SIGTERM');
    const graceful = await Promise.race([exited.then(() => true), pause(2000).then(() => false)]);
    if (!graceful) { chrome.kill('SIGKILL'); await exited; }
  }
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
