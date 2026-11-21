import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCheckIn, EMERGENCY_SIGNS, feverDefinition, toCelsius, worseningTrends } from '../src/triage.js';
import { checkMedicationPlan, formatTime } from '../src/meds.js';

const r = (value, unit, sustainedMinutes = 0, oral = true) => ({ value, unit, sustainedMinutes, oral });
for (const [value, unit, minutes, oral, formal, action] of [
  [100.39, 'F', 60, true, null, false], [100.4, 'F', 0, true, null, true],
  [100.4, 'F', 59, true, null, true], [100.4, 'F', 60, true, 'sustained-oral', true],
  [100.41, 'F', 61, true, 'sustained-oral', true], [100.99, 'F', 0, true, null, true],
  [100.99, 'F', 60, true, 'sustained-oral', true], [101, 'F', 0, true, 'single-oral', true],
  [101.01, 'F', 60, true, 'single-oral', true], [101, 'F', 60, false, null, true],
  [37.99, 'C', 60, true, null, false], [38, 'C', 0, true, null, true],
  [38, 'C', 59, true, null, true], [38, 'C', 60, true, 'sustained-oral', true],
  [38.26, 'C', 0, true, null, true], [38.299999, 'C', 0, true, null, true],
  [38.3, 'C', 0, true, 'single-oral', true], [38.3, 'C', 60, false, null, true],
  [38.30001, 'C', 60, true, 'single-oral', true], [40, 'C', 0, false, null, true],
]) {
  test(`${value} ${unit}, ${minutes} min, oral ${oral}, distinguishes definition and immediate call`, () => {
    const reading = r(value, unit, minutes, oral);
    const result = feverDefinition(reading);
    assert.equal(result.formal, formal);
    assert.equal(result.actionThreshold, action);
    assert.equal(result.celsius, unit === 'C' ? value : (value - 32) * 5 / 9);
    assert.equal(assessCheckIn({ reading, chemo: true }).level, action ? 'urgent-oncology' : 'not-ruled-out');
  });
}

for (const sign of Object.keys(EMERGENCY_SIGNS)) {
  test(`${sign} bypasses even unusable temperature entry`, () => {
    assert.deepEqual(assessCheckIn({ emergency: [sign, sign], chemo: true, reading: r('invalid', 'K') }),
      { level: 'emergency', reasons: [sign], fever: null });
  });
}

for (const [label, result] of [
  ['chemo infection sign without fever', () => assessCheckIn({ chemo: true, signsOfInfection: true }).level],
  ['chemo with measured fever', () => assessCheckIn({ chemo: true, reading: r(38, 'C') }).level],
]) test(label, () => assert.equal(result(), 'urgent-oncology'));

for (const value of [NaN, Infinity, -Infinity, '38', null, undefined]) {
  test(`never coerces temperature ${value}`, () => assert.throws(() => toCelsius(value, 'C'), TypeError));
}
for (const [name, reading] of [
  ['unknown units', r(38, 'K')], ['boxed unit', r(38, ['C'])], ['invalid oral flag', r(38, 'C', 60, 1)],
  ['minutes below zero', r(38, 'C', -1)], ['minutes not integer', r(38, 'C', 59.9)],
  ['minutes beyond one day', r(38, 'C', 1441)], ['implausibly hot', r(51, 'C')], ['implausibly cold', r(24, 'C')],
]) test(`rejects ${name}`, () => assert.throws(() => feverDefinition(reading)));

const trend = (h, n, f) => ({ hydration: h, nausea: n, fatigue: f });
for (const [name, history, expected] of [
  ['strict increase', [trend(0, 0, 1), trend(1, 1, 1), trend(2, 2, 2)], ['hydration', 'nausea']],
  ['all increase', [trend(0, 0, 0), trend(1, 2, 1), trend(2, 3, 2)], ['hydration', 'nausea', 'fatigue']],
  ['latest three only', [trend(0, 0, 0), trend(0, 0, 0), trend(1, 0, 0), trend(2, 0, 0)], ['hydration']],
  ['no early decision', [trend(0, 0, 0), trend(3, 3, 3)], []],
  ['plateaus and reversals', [trend(0, 3, 0), trend(1, 2, 2), trend(1, 3, 0)], []],
]) test(`daily history: ${name}`, () => {
  assert.deepEqual(worseningTrends(history), expected);
  assert.equal(assessCheckIn({ history }).level, expected.length ? 'same-day' : 'not-ruled-out');
});

test('rejects unknown emergency signs and out-of-range daily ratings', () => {
  assert.throws(() => assessCheckIn({ emergency: ['__proto__'] }));
  assert.throws(() => worseningTrends([trend(4, 0, 0)]));
});

test('a malformed temperature does not suppress a reported infection sign', () => {
  const reading = r(37, 'C', -1);
  assert.deepEqual(assessCheckIn({ reading, chemo: true, signsOfInfection: true }),
    { level: 'urgent-oncology', reasons: ['chemo-infection-signs'], fever: null });
  assert.deepEqual(assessCheckIn({ reading, signsOfInfection: true }),
    { level: 'same-day', reasons: ['infection-signs'], fever: null });
});

const m = (item, at, status = 'planned') => ({ item, at, status });
const flags = (items, context) => checkMedicationPlan(items, context).flags.map(flag => flag.code);
for (const item of ['acetaminophen', 'ibuprofen', 'naproxen']) {
  for (const [label, riskWindow, temperatureAt, expected] of [
    ['before a reading', true, 301, ['fever-masking']], ['no reading documented', true, null, ['fever-masking']],
    ['same minute uncertain', true, 300, ['fever-masking']], ['after the reading', true, 299, ['fever-medicine-review']],
    ['outside risk window', false, null, []],
  ]) test(`${item}: ${label}`, () => assert.deepEqual(flags([m(item, 300, 'logged')], { riskWindow, temperatureAt }), expected));
}
for (const item of ['ibuprofen', 'naproxen']) {
  for (const [label, items, context] of [
    ['current bleeding risk', [], { bleedingRisk: true }], ['platelet risk', [], { lowPlatelets: true }],
    ['declared anticoagulant', [], { anticoagulant: true }], ['apixaban', [m('apixaban', 1200)], {}],
    ['warfarin', [m('warfarin', 0, 'logged')], {}],
  ]) test(`${item} + ${label} flags regardless of hours apart`, () =>
    assert.deepEqual(flags([m(item, 400), ...items], context), ['bleeding-risk']));
}
for (const [item, code] of [['grapefruit', 'cyp3a4-grapefruit'], ['wort', 'cyp3a4-wort']]) {
  test(`imatinib + ${item} flags even many hours apart`, () =>
    assert.deepEqual(flags([m(item, 0), m('imatinib', 1439)]), [code]));
  test(`${item} alone never manufactures a CYP3A4 interaction`, () => assert.deepEqual(flags([m(item, 0)]), []));
}
for (const mineral of ['calcium', 'iron', 'magnesium']) {
  for (const [drug, name, delta, flag] of [
    ['ciprofloxacin', 'ciprofloxacin-spacing', -360, false], ['ciprofloxacin', 'ciprofloxacin-spacing', -359, true],
    ['ciprofloxacin', 'ciprofloxacin-spacing', 119, true], ['ciprofloxacin', 'ciprofloxacin-spacing', 120, false],
    ['levothyroxine', 'levothyroxine-spacing', -240, false], ['levothyroxine', 'levothyroxine-spacing', -239, true],
    ['levothyroxine', 'levothyroxine-spacing', 239, true], ['levothyroxine', 'levothyroxine-spacing', 240, false],
  ]) test(`${drug} and ${mineral}, signed gap ${delta} minutes`, () =>
    assert.deepEqual(flags([m(mineral, 600 + delta), m(drug, 600)]), flag ? [name] : []));
}
test('flags can coexist, strictly preserve row identity and sort timeline', () => {
  const items = [m('naproxen', 540, 'logged'), m('calcium', 535), m('ciprofloxacin', 530), m('apixaban', 900)];
  const report = checkMedicationPlan(items, { riskWindow: true });
  assert.deepEqual(report.timeline.map(e => e.index), [2, 1, 0, 3]);
  assert.deepEqual(report.flags.map(e => e.indices), [[2, 1], [0], [0]]);
  assert.equal(report.flags[1].status, 'logged');
  assert.equal(items[0].at, 540);
});

for (const [item, at, status] of [['made-up', 20, 'planned'], ['calcium', -1, 'planned'], ['calcium', 1440, 'planned'],
  ['calcium', 1.5, 'planned'], ['calcium', '20', 'logged'], ['calcium', 0, 'done'], ['__proto__', 0, 'planned']]) {
  test(`rejects medication entry ${item}/${at}/${status}`, () => assert.throws(() => flags([m(item, at, status)])));
}

test('medication time display handles both ends of the day', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(1439), '23:59');
  assert.throws(() => formatTime(1440), RangeError);
});
