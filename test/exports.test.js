import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJSON, createAuditBundle, makeCalendar, makeCSV, validateCalendar } from '../src/exports.js';
import { parseWall, wallLabel, wallToUTC } from '../src/clock.js';
import { openCard, sealCard } from '../src/crypto-card.js';

const stamp = new Date('2026-01-10T01:02:03.789Z');
const calendar = events => makeCalendar(events, { zone: 'America/Chicago', stamp });
const event = (start = '2026-03-08T01:45', end = '2026-03-08T03:15') =>
  ({ id: 'care-1', start, end, title: 'Ride', description: 'Demo' });

for (const [wall, result] of [
  ['2026-03-08T01:59', '2026-03-08T07:59:00.000Z'], ['2026-03-08T03:00', '2026-03-08T08:00:00.000Z'],
  ['2026-11-01T00:59', '2026-11-01T05:59:00.000Z'], ['2026-11-01T02:00', '2026-11-01T08:00:00.000Z'],
  ['2026-01-01T00:00', '2026-01-01T06:00:00.000Z'], ['2026-07-01T00:00', '2026-07-01T05:00:00.000Z'],
  ['2024-02-29T23:59', '2024-03-01T05:59:00.000Z'],
]) test(`Chicago ${wall} resolves to the verified UTC instant`, () => {
  assert.equal(wallToUTC(wall, 'America/Chicago').toISOString(), result);
  assert.equal(wallToUTC(wall, 'UTC').toISOString(), `${wall}:00.000Z`);
});

for (const wall of ['2026-03-08T02:00', '2026-03-08T02:59', '2026-11-01T01:00', '2026-11-01T01:59']) {
  test(`rejects nonexistent or repeated Chicago wall time ${wall}`, () => {
    assert.throws(() => wallToUTC(wall, 'America/Chicago'), RangeError);
    assert.throws(() => calendar([event(wall)]), RangeError);
  });
}
for (const wall of ['2025-02-29T18:00', '2026-04-31T10:00', '2026-03-08T24:00', '2026-03-08T03:60',
  '2026-3-8T03:15', '2026-03-08T03:15Z', '2026-03-08T03:15\n', '2100-03-08T03:15']) {
  test(`rejects malformed local date ${JSON.stringify(wall)}`, () => assert.throws(() => parseWall(wall)));
}
test('wall labeling rolls into the next date and includes the closing week boundary', () => {
  assert.equal(wallLabel('2026-11-23', 1440), '2026-11-24T00:00');
  assert.equal(wallLabel('2026-11-23', 10080), '2026-11-30T00:00');
  assert.throws(() => wallLabel('2026-11-23', 10081));
});
test('calendar uses zone-anchored UTC across spring and autumn transitions', () => {
  const spring = calendar([event()]);
  assert.match(spring, /DTSTART:20260308T074500Z\r\nDTEND:20260308T081500Z/);
  const autumn = calendar([event('2026-11-01T00:45', '2026-11-01T02:15')]);
  assert.match(autumn, /DTSTART:20261101T054500Z\r\nDTEND:20261101T081500Z/);
  assert.match(spring, /DTSTAMP:20260110T010203Z/);
});
test('calendar escapes injection text, preserves UTF-8 and folds at 75 octets', () => {
  const title = `${'\u00e9\u{1f680}'.repeat(35)},;\r\nBEGIN:VEVENT\\`;
  const text = calendar([{ ...event(), id: 'x'.repeat(80), title }]);
  const unfolded = text.replace(/\r\n /g, '');
  assert.ok(text.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.ok(unfolded.includes(`${'\u00e9\u{1f680}'.repeat(35)}\\,\\;\\nBEGIN:VEVENT\\\\`));
  assert.equal(unfolded.split('\r\n').filter(line => line === 'BEGIN:VEVENT').length, 1);
  assert.ok(validateCalendar(text));
});
test('calendar rejects C1 controls and NEL anywhere in text values', () => {
  for (const bad of ['a\u0080b', 'a\u009fb', 'a\u0085b']) {
    assert.throws(() => calendar([{ ...event(), title: bad }]), TypeError);
  }
  assert.equal(validateCalendar(calendar([event()]).replace('SUMMARY:Ride', 'SUMMARY:Ri\u0085de')), false);
});
test('calendar requires at least one component, distinct UIDs and positive durations', () => {
  assert.throws(() => calendar([]));
  assert.equal(validateCalendar(calendar([event()]).replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r\n/, '')), false);
  assert.throws(() => calendar([event(), event()]));
  assert.throws(() => calendar([event('2026-03-08T04:00')]));
});
for (const [label, mutate] of [
  ['bare LF', s => s.replace(/\r/g, '')], ['no final CRLF', s => s.slice(0, -2)],
  ['injected property', s => s.replace('SUMMARY:Ride', 'SUMMARY:Ride\r\nATTACH:http')],
  ['unsupported escapes', s => s.replace('SUMMARY:Ride', 'SUMMARY:Ri\\xde')],
  ['unescaped comma', s => s.replace('SUMMARY:Ride', 'SUMMARY:Ri,de')],
  ['missing mandatory fields', s => s.replace('DTSTAMP:20260110T010203Z\r\n', '')],
  ['impossible day', s => s.replace('20260308T074500Z', '20260230T074500Z')],
  ['invalid seconds', s => s.replace('20260308T074500Z', '20260308T074561Z')],
  ['nonpositive duration', s => s.replace('20260308T081500Z', '20260308T074500Z')],
  ['line too long', s => s.replace('SUMMARY:Ride', 'SUMMARY:' + 'r'.repeat(76))],
]) test(`validator rejects ${label}`, () => assert.equal(validateCalendar(mutate(calendar([event()]))), false));

for (const value of ['=2+2', '+2+2', '-3', '@SUM(1)', '\tTEXT', '\nTEXT', '\rTEXT', '  =RUN()', '\u200b@cmd',
  '\uFEFF+2', '\uFF1D1', '\uFF20x', '\uFF0B2', '\uFF0D1']) {
  test(`CSV neutralizes formula opener ${JSON.stringify(value)}`, () => assert.equal(makeCSV([[value]]), `"\'${value}"\r\n`));
}
test('CSV preserves typed negative numbers, quoted commas, double quotes and multline data', () => {
  assert.equal(makeCSV([[-3, 'hello, there', 'my "name"', 'two\nlines']]),
    '"-3","hello, there","my ""name""","two\nlines"\r\n');
  assert.equal(makeCSV([]), '');
  assert.throws(() => makeCSV([['a', 'b'], ['a']]), TypeError);
});

for (const [label, input, expected] of [
  ['sorted nested key order', { z: [1, { y: true, b: false }], a: 'A' }, '{"a":"A","z":[1,{"b":false,"y":true}]}'],
  ['lexical integer keys', { 2: 'two', 10: 'ten', z: 0 }, '{"10":"ten","2":"two","z":0}'],
  ['toJSON omission in object', { a: { toJSON: () => undefined }, b: true }, '{"b":true}'],
  ['toJSON omission in array', [{ toJSON: () => undefined }, 1], '[null,1]'],
  ['toJSON omission at root', { toJSON: () => undefined }, undefined],
  ['ECMA root key', { toJSON: k => `key=${k}` }, '"key="'],
  ['ECMA array index key', [{ toJSON: k => `key=${k}` }], '["key=0"]'],
  ['holes and unsupported types', [, undefined, Symbol(), () => undefined], '[null,null,null,null]'],
  ['dates and nonfinite numbers', [stamp, NaN, Infinity, -0], '["2026-01-10T01:02:03.789Z",null,null,0]'],
  ['primitive wrappers', [new String('A'), new Number(4), new Boolean(false)], '["A",4,false]'],
  ['unpaired surrogate', '\ud800', '"\\ud800"'],
  ['symbols ignored as keys', { [Symbol()]: 'hidden', a: true }, '{"a":true}'],
]) test(`canonical JSON: ${label}`, () => assert.equal(canonicalJSON(input), expected));

test('audit digest is over canonical UTF-8 and can be recomputed from returned payload', async () => {
  const input = { z: '\u00e9', n: { toJSON: () => undefined }, a: [3, null] };
  const result = await createAuditBundle(input);
  const knownText = '{"a":[3,null],"z":"\u00e9"}';
  assert.equal(result.sha256, createHash('sha256').update(knownText, 'utf8').digest('hex'));
  assert.equal(result.algorithm, 'SHA-256');
  assert.deepEqual(result.payload, JSON.parse(knownText));
  assert.equal((await createAuditBundle(JSON.parse(knownText))).sha256, result.sha256);
});
test('canonical JSON rejects cycles and BigInt, not shared objects', async () => {
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => canonicalJSON(cycle), TypeError);
  assert.throws(() => canonicalJSON(1n), TypeError);
  assert.throws(() => canonicalJSON(Object(1n)), TypeError);
  assert.throws(() => canonicalJSON(Object.assign(new Number(1), { valueOf: () => 1n })), TypeError);
  const shared = { x: 1 };
  assert.equal(canonicalJSON([shared, shared]), '[{"x":1},{"x":1}]');
  await assert.rejects(() => createAuditBundle(undefined), TypeError);
});

const card = {
  v: 1, alias: 'Maya', zone: 'America/Chicago',
  tasks: [{ role: 'overnight', start: '2026-11-23T22:00', end: '2026-11-24T01:00' }],
  notes: ['confirm', 'backup'],
};
const sealedFixture = await sealCard(card);
test('AES-GCM round trip uses independent 256-bit keys and 96-bit IVs', async () => {
  const first = await sealCard(card);
  const second = await sealCard(card);
  const decode = fragment => fragment.slice(9).split('&k=').map(x => Buffer.from(x, 'base64url'));
  const [packed, key] = decode(first);
  const [packed2, key2] = decode(second);
  assert.equal(key.length, 32);
  assert.notDeepEqual(key, key2);
  assert.notDeepEqual(packed.subarray(0, 12), packed2.subarray(0, 12));
  assert.equal(packed.length, Buffer.byteLength(JSON.stringify(card)) + 12 + 16);
  assert.deepEqual(await openCard(first), card);
  assert.deepEqual(await openCard(second), card);
});
for (const [label, mutate] of [
  ['missing fragment', () => ''], ['missing key', s => s.split('&')[0]], ['duplicated key', s => s + '&k=bad'],
  ['unexpected fragment field', s => s + '&source=other'], ['unexpected newline', s => s + '\n'],
  ['oversize fragment', () => '#handoff=' + 'z'.repeat(5500)], ['not base64url', s => s.replace('#handoff=', '#handoff=%')],
  ['key too short', s => s.slice(0, -1)], ['noncanonical key padding', s => s + '='],
  ['tampered IV', s => s.replace(/#handoff=(.)/, (_, c) => '#handoff=' + (c === 'A' ? 'B' : 'A'))],
  ['tampered cipher', s => `${s.slice(0, 50)}${s[50] === 'A' ? 'B' : 'A'}${s.slice(51)}`],
  ['wrong key', s => `${s.split('&k=')[0]}&k=${Buffer.alloc(32).toString('base64url')}`],
]) test(`handoff fails closed: ${label}`, async () => {
  await assert.rejects(() => openCard(mutate(sealedFixture)), /invalid or has been changed/);
});

for (const [label, replacement] of [
  ['arbitrary alias', { alias: '<img src=x onerror=alert(1)>' }], ['private note', { notes: ['telephone 555'] }],
  ['unmodeled version', { v: 2 }], ['extra fields', { outsideSchema: true }], ['duplicate note', { notes: ['confirm', 'confirm'] }],
  ['bad zone', { zone: 'Mars/Olympus' }], ['unmapped role', { tasks: [{ ...card.tasks[0], role: '__proto__' }] }],
  ['task extra free text', { tasks: [{ ...card.tasks[0], private: 'secret' }] }],
]) test(`card schema rejects ${label}`, async () => assert.rejects(() => sealCard({ ...card, ...replacement })));

test('authentic ciphertext is not enough: unsafe payload schema is independently rejected', async () => {
  const keyBytes = Buffer.alloc(32, 3);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = Buffer.alloc(12, 9);
  const data = Buffer.from(JSON.stringify({ ...card, alias: '<svg onload=alert(1)>' }));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: Buffer.from('CareBridge handoff card v1'),
  }, key, data);
  const payload = Buffer.concat([iv, Buffer.from(ciphertext)]).toString('base64url');
  await assert.rejects(() => openCard(`#handoff=${payload}&k=${keyBytes.toString('base64url')}`), /invalid or has been changed/);
});
