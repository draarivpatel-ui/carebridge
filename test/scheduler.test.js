import test from 'node:test';
import assert from 'node:assert/strict';
import { GAP, gini, planWeek } from '../src/scheduler.js';
import { PRESETS } from '../src/presets.js';

const shift = (id, start, end, skills = []) => ({ id, start, end, skills });
const carer = (id, cap = 500, rest = 0, skills = [], windows = [[0, 500]]) => ({ id, cap, rest, skills, windows });

// Exhaustive oracle assembles complete routes first, then checks each person's shifts in reverse order.
function oracle(jobs, people, dropped) {
  const active = people.filter(p => !dropped.includes(p.id));
  const slots = [...active.map(p => p.id), null];
  let best = { count: -1, inequality: Infinity };
  const route = [];
  function tryRoutes(depth) {
    if (depth < jobs.length) {
      for (const slot of slots) {
        route[depth] = slot;
        tryRoutes(depth + 1);
      }
      return;
    }
    const hours = [];
    for (const person of active) {
      const work = jobs.filter((_, i) => route[i] === person.id).sort((a, b) => b.end - a.end);
      let minutes = 0;
      for (const [i, job] of work.entries()) {
        if (job.skills.some(tag => !person.skills.includes(tag))) return;
        for (let m = job.start; m < job.end; m++) {
          if (!person.windows.some(([a, b]) => m >= a && m < b)) return;
        }
        if (i > 0 && work[i - 1].start - job.end < person.rest) return;
        minutes += job.end - job.start;
      }
      if (minutes > person.cap) return;
      hours.push(minutes);
    }
    const total = hours.reduce((a, b) => a + b, 0);
    const inequality = total ? hours.flatMap(a => hours.map(b => Math.abs(a - b))).reduce((a, b) => a + b, 0) /
      (2 * active.length * total) : 0;
    const count = route.filter(v => v !== null).length;
    if (count > best.count || (count === best.count && inequality < best.inequality)) best = { count, inequality };
  }
  tryRoutes(0);
  return best;
}

for (let seed = 1; seed <= 72; seed++) {
  test(`exact assignment vs exhaustive oracle, seed ${seed}`, () => {
    let state = seed;
    const pick = size => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state >>> 16) % size; };
    const jobs = Array.from({ length: 2 + pick(5) }, (_, i) => {
      const start = pick(8);
      return shift(`s${i}`, start, start + 1 + pick(4), pick(3) === 0 ? ['night'] : []);
    });
    const people = Array.from({ length: 1 + pick(4) }, (_, i) =>
      carer(`p${i}`, pick(11), pick(3), pick(2) ? ['night'] : [], [[pick(3), 6], [6 + pick(2), 9 + pick(3)]]));
    const dropped = pick(4) ? [] : [people.at(-1).id];
    const expected = oracle(jobs, people, dropped);
    const { balanced, baseline } = planWeek(jobs, people, { dropped });
    assert.equal(balanced.covered, expected.count);
    assert.ok(Math.abs(balanced.gini - expected.inequality) < 1e-12);
    assert.ok(balanced.covered >= baseline.covered);
  });
}

for (const preset of PRESETS) {
  test(`${preset.id} is input-order deterministic`, () => {
    const plan = planWeek(preset.shifts, preset.caregivers, preset);
    const reverse = planWeek([...preset.shifts].reverse(), [...preset.caregivers].reverse(), preset);
    assert.deepEqual(plan, reverse);
  });
  for (const c of preset.caregivers) {
    test(`${preset.id} never assigns a dropped ${c.id}`, () => {
      const initial = planWeek(preset.shifts, preset.caregivers, preset);
      const next = planWeek(preset.shifts, preset.caregivers, { ...preset, dropped: [...new Set([...preset.dropped, c.id])] });
      assert.equal(next.balanced.minutes[c.id], 0);
      assert.ok(next.balanced.covered <= initial.balanced.covered);
    });
  }
}

test('crisis fixture attributes every gap to its real cause', () => {
  const p = PRESETS[2];
  const { balanced } = planWeek(p.shifts, p.caregivers, p);
  const reasons = Object.fromEntries(balanced.allocation.filter(a => a.reason).map(a => [a.shiftId, a.reason]));
  assert.deepEqual(reasons, {
    'wed-ride': GAP.constraint,
    'thu-night': GAP.dropout,
    'sat-meal': GAP.dropout,
    'sun-company': GAP.dropout,
  });
});

test('each gap class has an honest diagnosis', () => {
  const people = [
    carer('a', 30, 0, [], [[0, 1000]]),
    carer('b', 10080, 0, ['meal'], [[0, 120]]),
    carer('d', 10080, 0, ['night'], [[0, 4000]]),
  ];
  const jobs = [
    shift('capped', 500, 560),
    shift('sits-out-window', 2000, 2060),
    shift('sits-out-skill', 50, 80, ['night']),
    shift('nobody-skilled', 60, 90, ['drive']),
    shift('nobody-free', 5000, 5060),
  ];
  const reasons = Object.fromEntries(
    planWeek(jobs, people, { dropped: ['d'] }).balanced.allocation.map(a => [a.shiftId, a.reason]));
  assert.deepEqual(reasons, {
    'capped': GAP.constraint,
    'sits-out-window': GAP.dropout,
    'sits-out-skill': GAP.dropout,
    'nobody-skilled': GAP.skill,
    'nobody-free': GAP.availability,
  });
  assert.equal(planWeek(jobs, people).balanced.covered, 3);
});

test('exact solver covers a restricted job that the primary-first baseline blocks', () => {
  const jobs = [shift('flex', 0, 10), shift('night', 1, 5, ['night'])];
  const people = [carer('a', 20, 0, ['night']), carer('b')];
  const { baseline, balanced } = planWeek(jobs, people, { primaryId: 'a' });
  assert.equal(baseline.covered, 1);
  assert.deepEqual(balanced.allocation.map(x => x.caregiverId), ['b', 'a']);
});

for (const [loads, want] of [[[], 0], [[0, 0], 0], [[2, 2, 2], 0], [[0, 8], 0.5],
  [[0, 0, 12], 2 / 3], [[2, 4, 6], 2 / 9], [[Number.MAX_VALUE, Number.MAX_VALUE, 0], 1 / 3]]) {
  test(`Gini coefficient for ${loads.join(',') || 'empty team'}`, () => assert.ok(Math.abs(gini(loads) - want) < 1e-12));
}

for (const [name, jobs, people, options] of [
  ['duplicate jobs', [shift('x', 0, 1), shift('x', 1, 2)], [], {}],
  ['negative start', [shift('x', -1, 1)], [], {}],
  ['fractional duration', [shift('x', 0, 1.01)], [], {}],
  ['zero duration', [shift('x', 1, 1)], [], {}],
  ['outside week', [shift('x', 10080, 10081)], [], {}],
  ['duplicate caregivers', [], [carer('x'), carer('x')], {}],
  ['negative rest', [], [carer('x', 20, -1)], {}],
  ['inverted window', [], [carer('x', 20, 0, [], [[5, 4]])], {}],
  ['unknown dropout', [], [], { dropped: ['x'] }],
  ['unknown primary', [], [], { primaryId: 'x' }],
  ['multiline key', [shift('x\n', 0, 1)], [], {}],
  ['sparse array', Array(1), [], {}],
]) test(`rejects ${name}`, () => assert.throws(() => planWeek(jobs, people, options), TypeError));

test('rest is enforced across midnight and touching availability windows form a union', () => {
  const jobs = [shift('overnight', 1420, 1449), shift('morning', 1459, 1460)];
  const a = carer('a', 30, 10, [], [[1400, 1440], [1440, 1470]]);
  assert.equal(planWeek(jobs, [a]).balanced.covered, 2);
  assert.equal(planWeek(jobs, [{ ...a, rest: 11 }]).balanced.covered, 1);
  assert.equal(planWeek(jobs, [{ ...a, windows: [[1400, 1440], [1441, 1470]] }]).balanced.allocation[0].reason, GAP.availability);
});
