import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256hex, sha256bytes } from '../src/digest.js';
import { canonicalJSON, makeCSV } from '../src/exports.js';
import {
  signJSON, signedJSONText, signedCSV, signedMarkdown, verifySigned,
  encodeBookmark, decodeBookmark, validateBookmark,
} from '../src/handoff-brief.js';
import { runSelfTests } from '../src/selftest.js';

const entry = (item, at, status = 'planned') => ({ item, at, status });
const enc = new TextEncoder();
const nodeDigest = text => createHash('sha256').update(enc.encode(text)).digest('hex');

/* ---------------- SHA-256 known answers ---------------- */

for (const [input, want] of [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['a'.repeat(1000000),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
]) {
  test(`FIPS 180-4 vector ${input.length}-byte input`, () => {
    assert.equal(sha256hex(input), want);
    assert.equal(sha256bytes(input).length, 32);
  });
}

for (const text of [
  'handoff brief with unicode: café, 温度, emoji 🩺',
  '{"nested": {"json": [1, 2, {"key": "value"}]}}',
  '\r\n line breaks and\ttabs',
  'x'.repeat(65537),
]) {
  test(`digest matches node:crypto for ${JSON.stringify(text.slice(0, 24))}`, () => {
    assert.equal(sha256hex(text), nodeDigest(text));
    assert.equal(sha256hex(enc.encode(text)), nodeDigest(text));
  });
}

test('digest rejects non-text non-bytes input', () => {
  for (const bad of [42, null, undefined, {}, []]) {
    assert.throws(() => sha256hex(bad), TypeError);
  }
});

/* ---------------- signed JSON ---------------- */

test('signJSON digest equals node crypto over canonical text', () => {
  const payload = { b: [3, 1], a: { z: 'x', y: 2 } };
  const signed = signJSON(payload);
  assert.equal(signed.algorithm, 'SHA-256');
  assert.equal(signed.sha256, nodeDigest(canonicalJSON(payload)));
  assert.deepEqual(signed.payload, JSON.parse(canonicalJSON(payload)));
});

test('signJSON is order-independent', () => {
  assert.equal(signJSON({ z: 1, a: [2, { q: 3, b: 4 }] }).sha256,
    signJSON({ a: [2, { b: 4, q: 3 }], z: 1 }).sha256);
});

test('signJSON rejects unserializable payloads', () => {
  assert.throws(() => signJSON(undefined), TypeError);
  assert.throws(() => signJSON({ big: 10n }), TypeError);
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  assert.throws(() => signJSON(cyclic), TypeError);
});

test('signedJSONText verifies and round-trips', () => {
  const payload = { tasks: [{ start: '08:00', role: 'ride' }], who: 'Maya' };
  const text = signedJSONText(payload);
  assert.ok(text.endsWith('\n'));
  const res = verifySigned(text);
  assert.equal(res.ok, true);
  assert.equal(res.format, 'json');
  assert.equal(res.expected, nodeDigest(canonicalJSON(payload)));
  assert.equal(res.digest, res.expected);
  assert.deepEqual(JSON.parse(text).payload, JSON.parse(canonicalJSON(payload)));
});

for (const [label, mutate] of [
  ['payload edit', t => t.replace('ride', 'meal')],
  ['sha swap', t => t.replace(/[a-f0-9]{64}/, 'a'.repeat(64))],
  ['algorithm change', t => t.replace('SHA-256', 'SHA-1')],
  ['key rename', t => t.replace('"payload"', '"load"')],
  ['truncation', t => t.slice(0, t.length - 12)],
]) {
  test(`tampered signed JSON (${label}) fails verification`, () => {
    const res = verifySigned(mutate(signedJSONText({ a: 'ride', n: 1 })));
    assert.equal(res.format, 'json');
    assert.equal(res.ok, false);
  });
}

/* ---------------- signed CSV ---------------- */

const CSV_ROWS = [
  ['section', 'field', 'value', 'extra'],
  ['task', '08:00', '09:00', 'clinic ride'],
  ['med', 'Warfarin', '18:00', 'planned'],
];

test('signed CSV verifies and carries a padded signature row', () => {
  const text = signedCSV(CSV_ROWS);
  const res = verifySigned(text);
  assert.equal(res.ok, true);
  assert.equal(res.format, 'csv');
  assert.equal(res.expected, nodeDigest(makeCSV(CSV_ROWS)));
  const tail = text.trimEnd().split('\r\n').at(-1);
  assert.ok(tail.startsWith('"carebridge-sha256","'));
  assert.equal(tail.split(',').length, CSV_ROWS[0].length);
});

for (const [label, mutate] of [
  ['cell edit', t => t.replace('08:00', '18:00')],
  ['row drop', t => { const lines = t.split('\r\n'); lines.splice(2, 1); return lines.join('\r\n'); }],
  ['row swap', t => { const l = t.split('\r\n'); [l[1], l[2]] = [l[2], l[1]]; return l.join('\r\n'); }],
  ['hex tamper', t => t.replace(/[a-f0-9]{64}/, '0'.repeat(64))],
]) {
  test(`tampered signed CSV (${label}) fails verification`, () => {
    const res = verifySigned(mutate(signedCSV(CSV_ROWS)));
    assert.equal(res.ok, false);
  });
}

test('signed CSV stays injection-safe and verifiable', () => {
  const text = signedCSV([['note', '=HYPERLINK("x")'], ['person', '+cmd'], ['other', '@ref']]);
  assert.ok(text.includes(`"'=HYPERLINK`));
  const res = verifySigned(text);
  assert.equal(res.ok, true);
});

test('single-row signed CSV verifies', () => {
  const text = signedCSV([['only', 'row']]);
  assert.equal(verifySigned(text).ok, true);
});

test('CSV signature row pads to the body column count', () => {
  const five = signedCSV([['a', 'b', 'c', 'd', 'e'], ['1', '2', '3', '4', '5']]);
  const tail = five.trimEnd().split('\r\n').at(-1);
  assert.equal(tail.split(',').length, 5);
  assert.equal(verifySigned(five).ok, true);
  const one = signedCSV([['solo']]);
  assert.equal(verifySigned(one).ok, true);
});

/* ---------------- signed Markdown ---------------- */

const MD_BODY = '# Handoff\n\n- clinic ride 08:00\n- warfarin 18:00';

test('signed Markdown verifies and ends with the digest line', () => {
  const text = signedMarkdown(MD_BODY);
  assert.ok(text.endsWith('\n'));
  assert.match(text, /\n\nsha256: [a-f0-9]{64}\n$/);
  const res = verifySigned(text);
  assert.equal(res.ok, true);
  assert.equal(res.format, 'markdown');
  assert.equal(res.expected, nodeDigest(MD_BODY));
});

for (const [label, mutate] of [
  ['body edit', t => t.replace('08:00', '18:00')],
  ['hex edit', t => t.replace(/[a-f0-9]{64}/, 'f'.repeat(64))],
  ['removed tail', t => t.replace(/\n\nsha256: [a-f0-9]{64}\n$/, '')],
  ['extra line after tail', t => t + 'sneaky\n'],
]) {
  test(`tampered signed Markdown (${label}) fails verification`, () => {
    assert.equal(verifySigned(mutate(signedMarkdown(MD_BODY))).ok, false);
  });
}

for (const [label, body] of [
  ['empty', ''], ['too long', 'x'.repeat(40001)],
  ['already tailed', `${MD_BODY}\n\nsha256: ${'0'.repeat(64)}\n`],
  ['non-string', 42], ['null', null],
]) {
  test(`signedMarkdown rejects ${label} body`, () => assert.throws(() => signedMarkdown(body), TypeError));
}

test('signed Markdown survives unicode bodies', () => {
  const text = signedMarkdown('# Turno\n\n- medicación a las 8 🩺');
  assert.equal(verifySigned(text).ok, true);
});

/* ---------------- verifySigned edges ---------------- */

for (const [label, input] of [
  ['plain text', 'just a note'],
  ['empty', ''],
  ['number', 42],
  ['null', null],
  ['object', { a: 1 }],
  ['oversize', 'x'.repeat(200001)],
  ['json-shaped junk', '{not json'],
]) {
  test(`verifySigned(${label}) returns not-ok without throwing`, () => {
    const res = verifySigned(input);
    assert.equal(res.ok, false);
    assert.equal(res.digest, null);
  });
}

/* ---------------- setup bookmarks ---------------- */

const BM = {
  v: 1, scenario: 'post-chemo', dropped: ['eli'],
  meds: [entry('levothyroxine', 390), entry('iron', 540, 'logged')],
  medCtx: { riskWindow: true, anticoagulant: false, temperatureAt: 560 },
  refills: [{ item: 'warfarin', onHand: 12, perDay: 2 }],
  person: 'noor', lang: 'es',
};

test('bookmark encodes to #care= and round-trips every field', () => {
  const hash = encodeBookmark(BM);
  assert.match(hash, /^#care=[A-Za-z0-9_-]+$/);
  const back = decodeBookmark(hash);
  assert.deepEqual(back, {
    v: 1, scenario: 'post-chemo', dropped: ['eli'],
    meds: [entry('levothyroxine', 390), entry('iron', 540, 'logged')],
    medCtx: {
      riskWindow: true, lowPlatelets: false, bleedingRisk: false,
      anticoagulant: false, temperatureAt: 560,
    },
    refills: [{ item: 'warfarin', onHand: 12, perDay: 2 }],
    person: 'noor', lang: 'es',
  });
});

test('minimal bookmark defaults are applied', () => {
  const back = decodeBookmark(encodeBookmark({ v: 1, scenario: 'post-chemo' }));
  assert.deepEqual(back.dropped, []);
  assert.deepEqual(back.meds, []);
  assert.deepEqual(back.refills, []);
  assert.equal(back.lang, 'en');
  assert.equal(back.person, null);
  assert.equal(back.medCtx.temperatureAt, null);
});

test('bookmark encoding is canonical', () => {
  const a = encodeBookmark(BM);
  const b = encodeBookmark({ ...BM, meds: [...BM.meds].reverse() });
  assert.notEqual(a, b);
  assert.equal(encodeBookmark(BM), a);
});

for (const [label, hash] of [
  ['wrong prefix', '#handoff=AAAAAAAABBBB'],
  ['non-canonical base64', '#care=' + 'A'.repeat(20) + '='],
  ['tampered char', ''],
  ['oversize', '#care=' + 'A'.repeat(6301)],
  ['too short', '#care=QUJD'],
]) {
  test(`decodeBookmark rejects ${label}`, () => {
    let target = hash;
    if (label === 'tampered char') {
      const good = encodeBookmark(BM);
      const i = good.length - 5;
      target = good.slice(0, i) + (good[i] === 'A' ? 'B' : 'A') + good.slice(i + 1);
    }
    assert.throws(() => decodeBookmark(target), TypeError);
  });
}

for (const [label, mutate] of [
  ['unknown scenario', b => ({ ...b, scenario: 'mars' })],
  ['v field', b => ({ ...b, v: 2 })],
  ['stranger dropped', b => ({ ...b, dropped: ['maya', 'stranger'] })],
  ['too many dropped', b => ({ ...b, dropped: ['eli', 'maya', 'noor', 'a', 'b', 'c', 'd'] })],
  ['bad med item', b => ({ ...b, meds: [entry('not-a-med', 100)] })],
  ['med at 1440', b => ({ ...b, meds: [entry('iron', 1440)] })],
  ['med bad status', b => ({ ...b, meds: [entry('iron', 100, 'done')] })],
  ['too many meds', b => ({ ...b, meds: Array.from({ length: 37 }, (_, i) => entry('iron', i)) })],
  ['refill perDay 0', b => ({ ...b, refills: [{ item: 'iron', onHand: 5, perDay: 0 }] })],
  ['refill onHand negative', b => ({ ...b, refills: [{ item: 'iron', onHand: -1, perDay: 1 }] })],
  ['refill perDay fraction', b => ({ ...b, refills: [{ item: 'iron', onHand: 5, perDay: 1.5 }] })],
  ['ctx nonboolean', b => ({ ...b, medCtx: { riskWindow: 'yes' } })],
  ['ctx boolean primitive', b => ({ ...b, medCtx: true })],
  ['ctx array', b => ({ ...b, medCtx: [] })],
  ['ctx string primitive', b => ({ ...b, medCtx: 'riskWindow' })],
  ['ctx temp out of day', b => ({ ...b, medCtx: { temperatureAt: 1440 } })],
  ['person not a caregiver', b => ({ ...b, person: 'ghost' })],
  ['lang unsupported', b => ({ ...b, lang: 'fr' })],
]) {
  test(`validateBookmark rejects ${label}`, () => {
    const bm = mutate(structuredClone(BM));
    assert.throws(() => validateBookmark(bm), TypeError);
    assert.throws(() => encodeBookmark(bm));
  });
}

/* ---------------- the live self-test battery itself ---------------- */

test('runSelfTests returns a named battery where every check passes', () => {
  const tests = runSelfTests();
  assert.ok(tests.length >= 10, `expected at least 10 self-tests, got ${tests.length}`);
  const names = tests.map(t => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of tests) {
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.detail, 'string');
    assert.equal(t.pass, true, `self-test "${t.name}" failed: ${t.detail}`);
  }
});
