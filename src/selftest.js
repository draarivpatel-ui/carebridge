// The in-page proof battery: the same claims the repo test suite checks, run
// live against the shipped modules in the visiting browser. Every entry is a
// real assertion over the real engine, not a canned pass list.

import { checkInteractions, missedDose, refillRunway, CLASSES } from './interactions.js';
import { sha256hex } from './digest.js';
import { makeCSV, canonicalJSON } from './exports.js';
import {
  encodeBookmark, decodeBookmark, signJSON, signedCSV, signedMarkdown, verifySigned,
} from './handoff-brief.js';

const entry = (item, at, status = 'planned') => ({ item, at, status });
const encoder = new TextEncoder();

const SHA_KATS = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
];

function check(name, run) {
  try {
    const detail = run();
    return { name, pass: true, detail: detail ?? 'ok' };
  } catch (error) {
    return { name, pass: false, detail: String(error?.message ?? error) };
  }
}

const need = (condition, message) => { if (!condition) throw new Error(message); };

export function runSelfTests() {
  const keys = Object.keys(CLASSES);
  const pairs = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) pairs.push([keys[i], keys[j]]);
  }

  const tests = [
    check('SHA-256 FIPS 180-4 known answers', () => {
      for (const [input, want] of SHA_KATS) {
        need(sha256hex(input) === want, `digest mismatch for ${JSON.stringify(input.slice(0, 12))}`);
      }
      need(sha256hex('a'.repeat(1000000)) ===
        'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0', 'million-byte vector mismatch');
      return `${SHA_KATS.length + 1} vectors verified`;
    }),

    check('Interaction matrix is symmetric', () => {
      const norm = findings => findings
        .map(({ code, severity, items, between, gap }) =>
          `${code}|${severity}|${[...items].sort().join('+')}|${between}|${Math.abs(gap ?? 0)}`)
        .sort();
      for (const [a, b] of pairs) {
        const ab = norm(checkInteractions([entry(a, 480), entry(b, 700)]).findings);
        const ba = norm(checkInteractions([entry(b, 700), entry(a, 480)]).findings);
        need(JSON.stringify(ab) === JSON.stringify(ba), `asymmetric result for ${a} / ${b}`);
      }
      return `${pairs.length} pairs symmetric`;
    }),

    check('Absorption spacing boundary is exact', () => {
      const codes = (items) => checkInteractions(items).findings.map(f => f.code);
      need(codes([entry('levothyroxine', 600), entry('calcium', 839)]).includes('thyroid-mineral'), 'gap of 239 missed');
      need(!codes([entry('levothyroxine', 600), entry('calcium', 840)]).includes('thyroid-mineral'), 'gap of 240 flagged');
      need(codes([entry('ciprofloxacin', 600), entry('iron', 719)]).includes('quinolone-mineral'), 'gap of 119 missed');
      need(!codes([entry('ciprofloxacin', 600), entry('iron', 720)]).includes('quinolone-mineral'), 'gap of 120 flagged');
      need(codes([entry('iron', 241), entry('ciprofloxacin', 600)]).includes('quinolone-mineral'), 'gap of -359 missed');
      need(!codes([entry('iron', 240), entry('ciprofloxacin', 600)]).includes('quinolone-mineral'), 'gap of -360 flagged');
      return 'four hours means four hours';
    }),

    check('Missed dose never doubles', () => {
      for (let gap = 60; gap <= 1440; gap += 60) {
        for (let now = 0; now <= gap; now += 15) {
          const res = missedDose({ missedAt: 0, nextAt: gap, now });
          need(res.maxDoses === 1, `dose cap broken at gap ${gap} now ${now}`);
          need(res.action === 'take' || res.action === 'skip', `bad action ${res.action}`);
          need((res.elapsed * 2 < res.gap) === (res.action === 'take'), `halfway rule broken at ${now}/${gap}`);
        }
      }
      return 'every interval from one to twenty-four hours checked';
    }),

    check('Missed-dose halfway boundary', () => {
      need(missedDose({ missedAt: 0, nextAt: 120, now: 59 }).action === 'take', '59 of 120 should take');
      need(missedDose({ missedAt: 0, nextAt: 120, now: 60 }).action === 'skip', '60 of 120 should skip');
      need(missedDose({ missedAt: 0, nextAt: 120, now: 61 }).action === 'skip', '61 of 120 should skip');
      return 'boundary falls on the skip side';
    }),

    check('Refill runway never goes negative', () => {
      for (const onHand of [0, 1, 6, 7, 13, 14, 29, 99]) {
        for (const perDay of [1, 2, 3, 6, 24]) {
          const res = refillRunway({ onHand, perDay });
          need(res.days >= 0 && res.wholeDays >= 0, 'negative runway');
          need((res.status === 'critical') === (res.days < 7), 'critical threshold broken');
        }
      }
      return 'forty loadouts non-negative';
    }),

    check('CSV escaping neutralizes formulas', () => {
      const text = makeCSV([['=1+1', 'plain', 'a"b'], ['x', 'tab\tcell', '@cmd']]);
      need(text.includes(`"'=`), 'formula cell not prefixed');
      need(text.includes('""'), 'quote not doubled');
      return 'injection openers prefixed';
    }),

    check('Canonical JSON is order-independent', () => {
      const a = sha256hex(encoder.encode(canonicalJSON({ z: 1, a: [2, { q: 3, b: 4 }] })));
      const b = sha256hex(encoder.encode(canonicalJSON({ a: [2, { b: 4, q: 3 }], z: 1 })));
      need(a === b, 'key order changed the digest');
      return 'sorted-key digest stable';
    }),

    check('Tamper detection: signed JSON', () => {
      const text = JSON.stringify(signJSON({ tasks: ['ride'], who: 'Maya' }));
      const broken = text.replace('ride', 'meal');
      const clean = verifySigned(text);
      const dirty = verifySigned(broken);
      need(clean.ok && clean.format === 'json', 'clean JSON did not verify');
      need(!dirty.ok, 'edited JSON still verified');
      return 'signature held, edit caught';
    }),

    check('Tamper detection: signed CSV', () => {
      const text = signedCSV([['task', 'when'], ['ride', '08:00']]);
      const dirty = text.replace('08:00', '09:00');
      need(verifySigned(text).ok, 'clean CSV did not verify');
      need(!verifySigned(dirty).ok, 'edited CSV still verified');
      return 'row edit caught';
    }),

    check('Tamper detection: signed Markdown', () => {
      const text = signedMarkdown('# Handoff\n\n- clinic ride at 08:00\n');
      const dirty = text.replace('08:00', '18:00');
      need(verifySigned(text).ok, 'clean Markdown did not verify');
      need(!verifySigned(dirty).ok, 'edited Markdown still verified');
      return 'time edit caught';
    }),

    check('Setup bookmark round-trips', () => {
      const state = {
        v: 1, scenario: 'post-chemo', dropped: ['eli'],
        meds: [entry('levothyroxine', 390), entry('iron', 540)],
        medCtx: { riskWindow: true, anticoagulant: false, temperatureAt: 560 },
        refills: [{ item: 'warfarin', onHand: 12, perDay: 2 }],
        person: 'noor', lang: 'es',
      };
      const hash = encodeBookmark(state);
      const back = decodeBookmark(hash);
      need(back.scenario === 'post-chemo' && back.person === 'noor' && back.lang === 'es', 'fields lost');
      need(back.meds.length === 2 && back.medCtx.temperatureAt === 560, 'day state lost');
      need(back.refills[0].onHand === 12, 'refill lost');
      return 'whole setup survives the URL';
    }),
  ];
  return tests;
}
