import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkInteractions, missedDose, refillRunway, handoffCheckpoints, CLASSES,
} from '../src/interactions.js';
import { ITEMS } from '../src/meds.js';

const e = (item, at, status = 'planned') => ({ item, at, status });
const codes = entries => checkInteractions(entries).findings.map(f => f.code);
const only = entries => checkInteractions(entries).findings[0];

// Every catalog key must resolve to a display name, and vice versa.
test('catalog classes and item names cover the same set', () => {
  assert.deepEqual(Object.keys(CLASSES).sort(), Object.keys(ITEMS).sort());
});

for (const [a, b, code, severity, ta = 300, tb = 720] of [
  ['warfarin', 'ibuprofen', 'anticoagulant-nsaid', 'high'],
  ['apixaban', 'naproxen', 'anticoagulant-nsaid', 'high'],
  ['warfarin', 'aspirin', 'anticoagulant-antiplatelet', 'high'],
  ['apixaban', 'clopidogrel', 'anticoagulant-antiplatelet', 'high'],
  ['apixaban', 'warfarin', 'anticoagulant-stack', 'high'],
  ['oxycodone', 'lorazepam', 'opioid-sedative', 'high'],
  ['oxycodone', 'zolpidem', 'opioid-sedative', 'high'],
  ['oxycodone', 'diphenhydramine', 'opioid-sedative', 'high'],
  ['lisinopril', 'spironolactone', 'raas-ksparing', 'high'],
  ['losartan', 'spironolactone', 'raas-ksparing', 'high'],
  ['lisinopril', 'potassium', 'potassium-retention', 'moderate'],
  ['losartan', 'potassium', 'potassium-retention', 'moderate'],
  ['spironolactone', 'potassium', 'potassium-retention', 'moderate'],
  ['lisinopril', 'ibuprofen', 'raas-nsaid', 'moderate'],
  ['losartan', 'naproxen', 'raas-nsaid', 'moderate'],
  ['furosemide', 'ibuprofen', 'raas-nsaid', 'moderate'],
  ['lorazepam', 'zolpidem', 'sedative-overlap', 'moderate'],
  ['diphenhydramine', 'zolpidem', 'sedative-overlap', 'moderate'],
  ['lorazepam', 'diphenhydramine', 'sedative-overlap', 'moderate'],
  ['lisinopril', 'losartan', 'raas-duplicate', 'moderate'],
  ['imatinib', 'grapefruit', 'cyp3a4-grapefruit', 'moderate'],
  ['imatinib', 'wort', 'cyp3a4-wort', 'moderate'],
  ['ibuprofen', 'naproxen', 'duplicate-therapy', 'moderate'],
  ['aspirin', 'ibuprofen', 'duplicate-therapy', 'moderate'],
  ['aspirin', 'clopidogrel', 'duplicate-therapy', 'moderate'],
  ['levothyroxine', 'calcium', 'thyroid-mineral', 'spacing', 300, 400],
  ['levothyroxine', 'iron', 'thyroid-mineral', 'spacing', 300, 400],
  ['levothyroxine', 'magnesium', 'thyroid-mineral', 'spacing', 300, 400],
  ['ciprofloxacin', 'calcium', 'quinolone-mineral', 'spacing', 300, 400],
  ['ciprofloxacin', 'iron', 'quinolone-mineral', 'spacing', 300, 400],
  ['ciprofloxacin', 'magnesium', 'quinolone-mineral', 'spacing', 300, 400],
]) {
  test(`${a} + ${b} reports ${code} at ${severity}`, () => {
    const f = only([e(a, ta), e(b, tb)]);
    assert.equal(f.code, code);
    assert.equal(f.severity, severity);
    assert.deepEqual([...f.items].sort(), [a, b].sort());
    assert.ok(f.label.length > 8 && f.detail.length > 30);
    assert.ok(f.between[0] <= f.between[1]);
  });
}

for (const [a, b] of [
  ['acetaminophen', 'ibuprofen'], ['acetaminophen', 'warfarin'], ['acetaminophen', 'oxycodone'],
  ['metoprolol', 'lisinopril'], ['metoprolol', 'furosemide'], ['metoprolol', 'clopidogrel'],
  ['calcium', 'iron'], ['calcium', 'magnesium'], ['grapefruit', 'wort'], ['imatinib', 'calcium'],
  ['levothyroxine', 'warfarin'], ['zolpidem', 'lisinopril'], ['ciprofloxacin', 'levothyroxine'],
  ['clopidogrel', 'metoprolol'], ['losartan', 'furosemide'], ['warfarin', 'potassium'],
]) {
  test(`${a} + ${b} raises no finding`, () => {
    assert.deepEqual(codes([e(a, 300), e(b, 720)]), []);
  });
}

// Absorption spacing windows are exact at their edges.
for (const mineral of ['calcium', 'iron', 'magnesium']) {
  for (const delta of [-241, -240, -239, -1, 0, 1, 239, 240, 241]) {
    test(`levothyroxine/${mineral} gap ${delta} flags exactly inside four hours`, () => {
      const flagged = codes([e('levothyroxine', 700), e(mineral, 700 + delta)]).includes('thyroid-mineral');
      assert.equal(flagged, Math.abs(delta) < 240);
    });
  }
  for (const delta of [-361, -360, -359, -1, 0, 119, 120, 121]) {
    test(`ciprofloxacin/${mineral} signed gap ${delta} honors the label window`, () => {
      const flagged = codes([e('ciprofloxacin', 700), e(mineral, 700 + delta)]).includes('quinolone-mineral');
      assert.equal(flagged, delta > -360 && delta < 120);
    });
  }
}

// Full pairwise symmetry: check(A,B) and check(B,A) must agree for every
// unordered catalog pair, at several dose-time layouts.
const items = Object.keys(CLASSES);
const normalize = findings => findings
  .map(f => `${f.code}|${f.severity}|${[...f.items].sort().join('+')}|${f.between.join(',')}`)
  .sort();
for (const [ta, tb] of [[480, 700], [0, 1439], [720, 720]]) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [a, b] = [items[i], items[j]];
      test(`symmetric check ${a} x ${b} at ${ta}/${tb}`, () => {
        const ab = normalize(checkInteractions([e(a, ta), e(b, tb)]).findings);
        const ba = normalize(checkInteractions([e(b, tb), e(a, ta)]).findings);
        assert.deepEqual(ab, ba);
      });
    }
  }
}

test('repeated doses of one item are not self-interactions', () => {
  assert.deepEqual(codes([e('warfarin', 480), e('warfarin', 1200)]), []);
  assert.deepEqual(codes([e('ibuprofen', 480), e('ibuprofen', 720)]), []);
});

test('one finding per unordered pair even when several rules could apply', () => {
  assert.equal(checkInteractions([e('oxycodone', 300), e('lorazepam', 720)]).findings.length, 1);
  assert.equal(checkInteractions([e('warfarin', 300), e('aspirin', 720)]).findings.length, 1);
});

test('findings sort by severity then schedule position', () => {
  const entries = [
    e('levothyroxine', 390), e('calcium', 500),
    e('warfarin', 600), e('ibuprofen', 660),
    e('lorazepam', 700), e('zolpidem', 710),
  ];
  const severities = checkInteractions(entries).findings.map(f => f.severity);
  assert.deepEqual(severities, ['high', 'moderate', 'spacing']);
});

test('indices point back to the input entries and between is chronological', () => {
  const entries = [e('ibuprofen', 660), e('warfarin', 600)];
  const f = only(entries);
  assert.deepEqual([...f.indices].sort(), [0, 1]);
  assert.deepEqual([...f.items].sort(), ['ibuprofen', 'warfarin']);
  assert.deepEqual(f.between, [600, 660]);
  assert.equal(f.detail.includes(ITEMS.warfarin), true);
  assert.equal(f.detail.includes(ITEMS.ibuprofen), true);
});

for (const [item, at, status] of [
  ['made-up', 20, 'planned'], ['calcium', -1, 'planned'], ['calcium', 1440, 'planned'],
  ['calcium', 1.5, 'planned'], ['calcium', '20', 'logged'], ['calcium', 0, 'done'],
  ['__proto__', 0, 'planned'], [null, 0, 'planned'],
]) {
  test(`rejects interaction entry ${item}/${at}/${status}`, () =>
    assert.throws(() => checkInteractions([{ item, at, status }])));
}
test('rejects a non-array day and an oversized day', () => {
  assert.throws(() => checkInteractions('x'), TypeError);
  assert.throws(() => checkInteractions(null), TypeError);
  assert.throws(() => checkInteractions(Array.from({ length: 37 }, (_, i) => e('calcium', i))), TypeError);
});

/* ---------------- missed-dose catch-up ---------------- */

for (const [missed, next, now, want] of [
  [480, 1200, 780, 'take'], [480, 1200, 839, 'take'], [480, 1200, 840, 'skip'],
  [480, 1200, 900, 'skip'], [480, 1200, 1200, 'skip'], [480, 1200, 1300, 'skip'],
  [0, 120, 59, 'take'], [0, 120, 60, 'skip'], [0, 120, 61, 'skip'],
  [0, 121, 60, 'take'], [0, 121, 61, 'skip'],
  [480, 1200, 480, 'take'], [0, 1440, 719, 'take'], [0, 1440, 720, 'skip'],
]) {
  test(`missed ${missed}, next ${next}, remembered ${now}: ${want}`, () => {
    const res = missedDose({ missedAt: missed, nextAt: next, now });
    assert.equal(res.action, want);
    assert.equal(res.maxDoses, 1);
    assert.equal(res.elapsed, now - missed);
    assert.equal(res.gap, next - missed);
    assert.equal(res.halfway, missed + (next - missed) / 2);
    assert.equal(res.toNext, Math.max(0, next - now));
    assert.match(res.detail, /never take two doses/i);
  });
}

test('a remembered time after the next dose does not point backward in time', () => {
  const res = missedDose({ missedAt: 480, nextAt: 1200, now: 1300 });
  assert.equal(res.action, 'skip');
  assert.equal(res.toNext, 0);
  assert.match(res.detail, /already passed/i);
  assert.match(res.detail, /resume the written schedule/i);
  assert.doesNotMatch(res.detail, /wait for the next scheduled time/i);
});

for (let gap = 60; gap <= 1440; gap += 60) {
  test(`never-double-dose invariant across a ${gap}-minute interval`, () => {
    for (let now = 0; now <= gap + 30; now += 15) {
      const res = missedDose({ missedAt: 0, nextAt: gap, now });
      assert.equal(res.maxDoses, 1);
      assert.ok(res.action === 'take' || res.action === 'skip');
      assert.equal(res.action === 'take', res.elapsed * 2 < res.gap);
    }
  });
}

for (const [label, args] of [
  ['next before missed', { missedAt: 600, nextAt: 600, now: 700 }],
  ['gap over a day', { missedAt: 0, nextAt: 1441, now: 10 }],
  ['remembered before due', { missedAt: 600, nextAt: 900, now: 599 }],
  ['fractional minute', { missedAt: 0.5, nextAt: 900, now: 700 }],
  ['string time', { missedAt: '600', nextAt: 900, now: 700 }],
  ['negative time', { missedAt: -1, nextAt: 900, now: 700 }],
  ['missing fields', {}],
]) test(`missed-dose rejects ${label}`, () => assert.throws(() => missedDose(args)));

/* ---------------- refill runway ---------------- */

for (const [onHand, perDay, status, critical] of [
  [0, 1, 'critical', true], [6, 1, 'critical', true], [13, 2, 'critical', true],
  [1, 3, 'critical', true], [6, 2, 'critical', true],
  [7, 1, 'watch', false], [13, 1, 'watch', false], [27, 2, 'watch', false],
  [14, 1, 'ok', false], [28, 2, 'ok', false], [99, 3, 'ok', false], [99999, 24, 'ok', false],
]) {
  test(`refill ${onHand} on hand at ${perDay}/day lands ${status}`, () => {
    const res = refillRunway({ onHand, perDay });
    assert.equal(res.status, status);
    assert.equal(res.critical, critical);
    assert.equal(res.days, onHand / perDay);
    assert.equal(res.wholeDays, Math.floor(onHand / perDay));
    assert.ok(res.days >= 0 && res.wholeDays >= 0);
  });
}

test('refill runway stays non-negative across a loadout sweep', () => {
  for (const onHand of [0, 1, 6, 7, 13, 14, 29, 99, 1000]) {
    for (const perDay of [1, 2, 3, 6, 12, 24]) {
      const res = refillRunway({ onHand, perDay });
      assert.ok(res.days >= 0 && res.wholeDays >= 0);
      assert.equal(res.status === 'critical', res.days < 7);
      assert.equal(res.status === 'watch', res.days >= 7 && res.days < 14);
      assert.equal(res.status === 'ok', res.days >= 14);
    }
  }
});

for (const [label, args] of [
  ['negative pills', { onHand: -1, perDay: 1 }],
  ['fractional pills', { onHand: 1.5, perDay: 1 }],
  ['text pills', { onHand: '7', perDay: 1 }],
  ['zero doses a day', { onHand: 7, perDay: 0 }],
  ['negative doses a day', { onHand: 7, perDay: -2 }],
  ['fractional doses a day', { onHand: 7, perDay: 1.5 }],
  ['over a day of doses', { onHand: 7, perDay: 25 }],
  ['too many pills', { onHand: 100000, perDay: 1 }],
  ['missing fields', {}],
]) test(`refill rejects ${label}`, () => assert.throws(() => refillRunway(args)));

/* ---------------- handoff checkpoints ---------------- */

test('checkpoints count every shift boundary and wrap at midnight', () => {
  const shifts = [
    { start: 480, end: 660 }, { start: 660, end: 840 },
    { start: 1440, end: 1500 }, { start: 1980, end: 2280 },
  ];
  const cps = handoffCheckpoints(shifts, 6);
  assert.deepEqual(cps.map(c => c.minute), [0, 60, 480, 540, 660, 840]);
  assert.equal(cps.find(c => c.minute === 660).count, 2);
  assert.equal(cps.find(c => c.minute === 840).count, 2);
});

test('checkpoints are capped, tie-break by minute, and reject bad shifts', () => {
  const shifts = [{ start: 60, end: 120 }, { start: 180, end: 240 }, { start: 300, end: 360 }];
  assert.equal(handoffCheckpoints(shifts, 2).length, 2);
  assert.deepEqual(handoffCheckpoints(shifts).map(c => c.minute), [60, 120, 180, 240, 300, 360]);
  assert.throws(() => handoffCheckpoints([{ start: 5, end: 5 }]));
  assert.throws(() => handoffCheckpoints([{ start: 0, end: 10081 }]));
  assert.throws(() => handoffCheckpoints('x'));
  assert.throws(() => handoffCheckpoints([], 0));
  assert.throws(() => handoffCheckpoints([], 13));
});
