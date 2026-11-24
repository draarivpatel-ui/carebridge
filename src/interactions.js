// Deterministic pairwise safety checks for the demo day: drug-class pairs with
// severity tiers, absorption-spacing windows, a missed-dose catch-up rule that
// never doubles a dose, and a refill runway. Worked educational examples over a
// small catalog, never a clinical interaction database.

import { ITEMS } from './meds.js';

const inDay = n => Number.isInteger(n) && n >= 0 && n < 1440;

export const CLASSES = Object.freeze({
  acetaminophen: ['analgesic', 'antipyretic'],
  ibuprofen: ['nsaid', 'analgesic', 'antipyretic'],
  naproxen: ['nsaid', 'analgesic', 'antipyretic'],
  aspirin: ['nsaid', 'antiplatelet', 'analgesic', 'antipyretic'],
  apixaban: ['anticoagulant'],
  warfarin: ['anticoagulant'],
  clopidogrel: ['antiplatelet'],
  lisinopril: ['ace-inhibitor', 'raas'],
  losartan: ['arb', 'raas'],
  spironolactone: ['k-sparing-diuretic'],
  furosemide: ['loop-diuretic'],
  potassium: ['potassium-supplement'],
  metoprolol: ['beta-blocker'],
  levothyroxine: ['thyroid'],
  ciprofloxacin: ['fluoroquinolone'],
  calcium: ['mineral'],
  iron: ['mineral'],
  magnesium: ['mineral'],
  imatinib: ['kinase-inhibitor'],
  grapefruit: ['food'],
  wort: ['herbal'],
  lorazepam: ['benzodiazepine', 'sedative'],
  zolpidem: ['hypnotic', 'sedative'],
  diphenhydramine: ['antihistamine', 'anticholinergic', 'sedative'],
  oxycodone: ['opioid', 'sedative'],
});

const has = (item, cls) => (CLASSES[item] ?? []).includes(cls);
const hasAny = (item, clss) => clss.some(cls => has(item, cls));

// Classes where two different items on the same day count as duplicate therapy.
const DUPLICATE_CLASSES = [
  'nsaid', 'antiplatelet', 'ace-inhibitor', 'arb', 'beta-blocker', 'loop-diuretic',
  'k-sparing-diuretic', 'benzodiazepine', 'hypnotic', 'opioid', 'antihistamine',
  'thyroid', 'fluoroquinolone', 'potassium-supplement',
];

export const SEVERITY = Object.freeze({ high: 'high', moderate: 'moderate', spacing: 'spacing' });
const RANK = { high: 0, moderate: 1, spacing: 2 };

// Rules are evaluated in order; the first match wins for each unordered pair, so
// a pair reports the single most important concern and check(A,B) == check(B,A).
// `when(a, b)` is evaluated in both directions; spacing rules return the drug on
// the left so the signed gap is mineral minus drug.
const RULES = [
  {
    code: 'anticoagulant-antiplatelet', severity: 'high',
    when: (a, b) => has(a, 'anticoagulant') && has(b, 'antiplatelet'),
    label: 'Blood thinner plus antiplatelet',
    detail: (a, b) => `${a} and ${b} both thin the blood in different ways; together they raise bleeding risk. Keep the pairing on the care team's radar.`,
  },
  {
    code: 'anticoagulant-nsaid', severity: 'high',
    when: (a, b) => has(a, 'anticoagulant') && has(b, 'nsaid'),
    label: 'Blood thinner plus NSAID',
    detail: (a, b) => `${a} with an NSAID like ${b} is a classic bleeding-risk pairing. Only the care team decides whether the NSAID stays.`,
  },
  {
    code: 'anticoagulant-stack', severity: 'high',
    when: (a, b) => a !== b && has(a, 'anticoagulant') && has(b, 'anticoagulant'),
    label: 'Two blood thinners on one day',
    detail: (a, b) => `${a} and ${b} are both anticoagulants. Two on the same day is almost never intentional; confirm the written plan with the team.`,
  },
  {
    code: 'opioid-sedative', severity: 'high',
    when: (a, b) => has(a, 'opioid') && has(b, 'sedative'),
    label: 'Opioid plus sedative',
    detail: (a, b) => `${a} with ${b} can slow breathing and deepen sedation, and raises fall risk. This pairing always deserves the care team's attention.`,
  },
  {
    code: 'raas-ksparing', severity: 'high',
    when: (a, b) => has(a, 'raas') && has(b, 'k-sparing-diuretic'),
    label: 'ACE inhibitor or ARB plus potassium-sparing diuretic',
    detail: (a, b) => `${a} and ${b} both push potassium up; together they can cause hyperkalemia. Labs and the prescriber's plan own this one.`,
  },
  {
    code: 'raas-nsaid', severity: 'moderate',
    when: (a, b) => hasAny(a, ['raas', 'loop-diuretic']) && has(b, 'nsaid'),
    label: 'NSAID with a blood pressure or water pill',
    detail: (a, b) => `${b} can blunt ${a} and stress the kidneys. Worth a mention to the care team rather than a silent fix.`,
  },
  {
    code: 'potassium-retention', severity: 'moderate',
    when: (a, b) => hasAny(a, ['raas', 'k-sparing-diuretic']) && has(b, 'potassium-supplement'),
    label: 'Potassium on top of a potassium-raising medicine',
    detail: (a, b) => `${a} already raises potassium; adding ${b} stacks the effect. The prescriber's lab plan decides.`,
  },
  {
    code: 'sedative-overlap', severity: 'moderate',
    when: (a, b) => a !== b && has(a, 'sedative') && has(b, 'sedative'),
    label: 'Two sedating medicines',
    detail: (a, b) => `${a} and ${b} both sedate; together they add up on falls and confusion, especially at night.`,
  },
  {
    code: 'raas-duplicate', severity: 'moderate',
    when: (a, b) => (has(a, 'ace-inhibitor') && has(b, 'arb')) || (has(a, 'arb') && has(b, 'ace-inhibitor')),
    label: 'Double blood-pressure blockade',
    detail: (a, b) => `${a} and ${b} block the same pathway twice. Usually one or the other, never a quiet duplication.`,
  },
  {
    code: 'cyp3a4-grapefruit', severity: 'moderate',
    when: (a, b) => a === 'imatinib' && b === 'grapefruit',
    label: 'Grapefruit with imatinib',
    detail: () => 'Grapefruit changes how the body handles imatinib. Shifting times does not fix it; flag the pairing for the team.',
  },
  {
    code: 'cyp3a4-wort', severity: 'moderate',
    when: (a, b) => a === 'imatinib' && b === 'wort',
    label: "St. John's wort with imatinib",
    detail: () => "St. John's wort changes how the body handles imatinib. Shifting times does not fix it; flag the pairing for the team.",
  },
  {
    code: 'duplicate-therapy', severity: 'moderate',
    when: (a, b) => a !== b && DUPLICATE_CLASSES.some(cls => has(a, cls) && has(b, cls)),
    label: 'Duplicate therapy class',
    detail: (a, b) => `${a} and ${b} sit in the same therapeutic class. Doubling a class is rarely intentional; ask the team to confirm.`,
  },
  {
    code: 'thyroid-mineral', severity: 'spacing',
    directional: true,
    when: (a, b) => a === 'levothyroxine' && has(b, 'mineral'),
    window: ([drug, mineral]) => Math.abs(mineral - drug) < 240,
    label: 'Levothyroxine too close to a mineral',
    detail: (a, b, gap) => `${b} sits ${Math.abs(gap)} minutes from ${a}; the label calls for a four-hour gap. The pharmacist or care team should confirm the written times.`,
  },
  {
    code: 'quinolone-mineral', severity: 'spacing',
    directional: true,
    when: (a, b) => a === 'ciprofloxacin' && has(b, 'mineral'),
    window: ([drug, mineral]) => mineral - drug > -360 && mineral - drug < 120,
    label: 'Ciprofloxacin inside the mineral window',
    detail: (a, b, gap) => `${b} sits ${Math.abs(gap)} minutes from ${a}, inside the restricted window on the ciprofloxacin tablet label: six hours before to two hours after. The pharmacist or care team should confirm the written times.`,
  },
];

function validate(entries) {
  if (!Array.isArray(entries) || entries.length > 36 || [...entries].some(e =>
    !e || typeof e.item !== 'string' || !Object.hasOwn(CLASSES, e.item) ||
    !inDay(e.at) || !['planned', 'logged'].includes(e.status))) {
    throw new TypeError('Use known demo items, statuses and valid times in one day.');
  }
}

export function checkInteractions(entries) {
  validate(entries);
  const timeline = entries.map((e, index) => ({ item: e.item, at: e.at, status: e.status, index }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const findings = [];
  for (let i = 0; i < timeline.length; i++) {
    for (let j = i + 1; j < timeline.length; j++) {
      const x = timeline[i];
      const y = timeline[j];
      if (x.item === y.item) continue;
      for (const rule of RULES) {
        let pair = null;
        if (rule.directional) {
          if (rule.when(x.item, y.item)) pair = [x, y];
          else if (rule.when(y.item, x.item)) pair = [y, x];
          if (pair && !rule.window(pair.map(e => e.at))) pair = null;
        } else if (rule.when(x.item, y.item) || rule.when(y.item, x.item)) {
          pair = [x, y];
        }
        if (!pair) continue;
        const [first, second] = pair;
        const nameOf = e => ITEMS[e.item] ?? e.item;
        const gap = second.at - first.at;
        findings.push({
          code: rule.code,
          severity: rule.severity,
          items: rule.directional || first.item <= second.item
            ? [first.item, second.item]
            : [second.item, first.item],
          indices: rule.directional || first.item <= second.item
            ? [first.index, second.index]
            : [second.index, first.index],
          between: [Math.min(first.at, second.at), Math.max(first.at, second.at)],
          ...(rule.directional ? { gap } : {}),
          label: rule.label,
          detail: rule.detail(nameOf(first), nameOf(second), gap),
        });
        break;
      }
    }
  }
  findings.sort((a, b) =>
    (RANK[a.severity] - RANK[b.severity]) ||
    (Math.min(...a.indices) - Math.min(...b.indices)) ||
    (Math.max(...a.indices) - Math.max(...b.indices)) ||
    (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { findings, entries: timeline.length };
}

/* ---------------- missed-dose catch-up ---------------- */

const intOK = n => Number.isInteger(n) && n >= 0;

// The classic halfway rule: take the missed dose when less than half the
// interval has elapsed; otherwise wait for the next scheduled time. The answer
// is always a single dose; doubling to catch up is never suggested.
export function missedDose({ missedAt, nextAt, now } = {}) {
  if (!intOK(missedAt) || !intOK(nextAt) || !intOK(now)) {
    throw new TypeError('Missed-dose times must be whole minutes.');
  }
  if (nextAt <= missedAt || nextAt - missedAt > 1440) {
    throw new RangeError('The next dose must follow the missed one inside one day.');
  }
  if (now < missedAt) {
    throw new RangeError('A dose cannot be remembered before it was due.');
  }
  const elapsed = now - missedAt;
  const gap = nextAt - missedAt;
  const take = elapsed * 2 < gap;
  return {
    action: take ? 'take' : 'skip',
    elapsed,
    gap,
    halfway: missedAt + gap / 2,
    toNext: Math.max(0, nextAt - now),
    maxDoses: 1,
    label: take ? 'Take the missed dose now' : 'Skip the missed dose',
    detail: take
      ? 'Less than half the interval has passed, so the missed dose can be taken; the next dose stays on schedule. Never take two doses to catch up.'
      : now >= nextAt
        ? 'The next scheduled dose time has already passed. Do not take the missed dose; resume the written schedule. Never take two doses to catch up.'
        : 'Half or more of the interval has passed, so the missed dose is skipped; wait for the next scheduled time. Never take two doses to catch up.',
  };
}

/* ---------------- refill runway ---------------- */

export function refillRunway({ onHand, perDay } = {}) {
  if (!Number.isInteger(onHand) || onHand < 0 || onHand > 99999 ||
      !Number.isInteger(perDay) || perDay < 1 || perDay > 24) {
    throw new TypeError('Refill needs whole pills on hand (0 or more) and 1 to 24 doses a day.');
  }
  const days = onHand / perDay;
  return {
    onHand,
    perDay,
    days,
    wholeDays: Math.floor(days),
    critical: days < 7,
    status: days < 7 ? 'critical' : days < 14 ? 'watch' : 'ok',
  };
}

/* ---------------- handoff checkpoints ---------------- */

const WEEK_MINUTES = 7 * 1440;

// The minute-of-day marks where this week's plan most often changes hands:
// shift starts and ends, counted across the week and kept to the busiest few.
export function handoffCheckpoints(shifts, cap = 6) {
  if (!Array.isArray(shifts) || [...shifts].some(s =>
    !s || !Number.isInteger(s.start) || !Number.isInteger(s.end) ||
    s.start < 0 || s.end <= s.start || s.end > WEEK_MINUTES)) {
    throw new TypeError('Checkpoints need week-valid shift intervals.');
  }
  if (!Number.isInteger(cap) || cap < 1 || cap > 12) throw new RangeError('Checkpoint cap is 1 to 12.');
  const counts = new Map();
  for (const s of shifts) {
    for (const mark of [s.start, s.end]) {
      const minute = mark % 1440;
      counts.set(minute, (counts.get(minute) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
    .slice(0, cap)
    .map(([minute, count]) => ({ minute, count }))
    .sort((a, b) => a.minute - b.minute);
}
