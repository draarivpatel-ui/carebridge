export { wallLabel as timeLabel } from './clock.js';

export const ROLES = Object.freeze({
  clinic: { en: 'Clinic ride', es: 'Traslado a la cl\u00ednica' },
  meal: { en: 'Meal drop-off', es: 'Entrega de comida' },
  pharmacy: { en: 'Pharmacy pickup', es: 'Recogida en la farmacia' },
  overnight: { en: 'Overnight check-in', es: 'Visita de noche' },
  company: { en: 'Companion visit', es: 'Compa\u00f1\u00eda' },
});

export const NOTES = Object.freeze({
  confirm: { en: 'Confirm the handoff with the next caregiver.', es: 'Confirma el relevo con la siguiente persona cuidadora.' },
  ride: { en: 'Confirm travel timing with the group.', es: 'Confirma la hora del traslado con el grupo.' },
  meal: { en: 'Confirm where to leave the meal.', es: 'Confirma d\u00f3nde dejar la comida.' },
  backup: { en: 'Tell the group early if you need a backup.', es: 'Avisa pronto al grupo si necesitas un reemplazo.' },
});

const t = (day, hour, minute = 0) => day * 1440 + hour * 60 + minute;
const w = (day, from, to) => [t(day, from), t(day, to)];
const job = (id, role, day, from, to, ...skills) =>
  ({ id, role, start: t(day, from), end: t(day, to), skills });
const person = (id, name, color, capHours, restHours, skills, windows) =>
  ({ id, name, color, cap: capHours * 60, rest: restHours * 60, skills, windows });
const med = (item, hour, minute, status = 'planned') => ({ item, at: t(0, hour, minute), status });
const day = (hydration, nausea, fatigue) => ({ hydration, nausea, fatigue });
const medContext = (patch = {}) =>
  ({ riskWindow: false, lowPlatelets: false, bleedingRisk: false, anticoagulant: false, temperatureAt: null, ...patch });
const zone = 'America/Chicago';

export const PRESETS = [
  {
    id: 'post-chemo', name: 'Post-chemo week', weekStart: '2026-11-23', zone,
    primaryId: 'maya', dropped: [],
    caregivers: [
      person('maya', 'Maya', 'fern', 28, 1, ['drive', 'meal', 'pharmacy', 'night', 'company'], [[0, 10080]]),
      person('eli', 'Eli', 'ochre', 10, 1, ['drive', 'pharmacy'], [w(0, 7, 13), w(2, 12, 18), w(4, 8, 15)]),
      person('rosa', 'Rosa', 'rose', 9, 1, ['meal', 'company'], [w(0, 14, 20), w(2, 14, 20), w(3, 9, 15), w(6, 10, 18)]),
      person('noor', 'Noor', 'teal', 12, 3, ['night', 'company'], [w(1, 20, 29), w(3, 20, 31), w(5, 17, 23)]),
      person('sam', 'Sam', 'sand', 8, 2, ['meal', 'company', 'pharmacy'], [w(1, 11, 19), w(3, 10, 15), w(5, 10, 19), w(6, 9, 16)]),
    ],
    shifts: [
      job('mon-ride', 'clinic', 0, 8, 11, 'drive'), job('mon-meal', 'meal', 0, 17, 18, 'meal'),
      job('tue-company', 'company', 1, 13, 16, 'company'), job('tue-night', 'overnight', 1, 22, 27, 'night'),
      job('wed-pickup', 'pharmacy', 2, 14, 16, 'pharmacy'), job('wed-meal', 'meal', 2, 17, 18, 'meal'),
      job('thu-company', 'company', 3, 10, 13, 'company'), job('thu-night', 'overnight', 3, 22, 28, 'night'),
      job('fri-ride', 'clinic', 4, 9, 12, 'drive'), job('sat-meal', 'meal', 5, 12, 13, 'meal'),
      job('sat-company', 'company', 5, 17, 19, 'company'), job('sun-company', 'company', 6, 11, 14, 'company'),
    ],
    reading: { value: 100.4, unit: 'F', oral: true, sustainedMinutes: 0 },
    history: [day(0, 1, 1), day(1, 1, 1), day(2, 1, 2)],
    medEntries: [med('ciprofloxacin', 7, 30), med('calcium', 8, 15), med('acetaminophen', 9, 0, 'logged')],
    medContext: medContext({ riskWindow: true, temperatureAt: 9 * 60 + 20 }),
  },
  {
    id: 'post-surgery', name: 'Post-surgery recovery', weekStart: '2026-11-23', zone,
    primaryId: 'lena', dropped: [],
    caregivers: [
      person('lena', 'Lena', 'fern', 22, 2, ['drive', 'meal', 'pharmacy', 'company'], [[0, 10080]]),
      person('mateo', 'Mateo', 'ochre', 10, 2, ['drive', 'pharmacy'], [w(0, 8, 16), w(3, 9, 14), w(5, 10, 17)]),
      person('imani', 'Imani', 'rose', 8, 1, ['meal', 'company'], [w(1, 9, 16), w(2, 13, 19), w(4, 13, 19), w(6, 9, 17)]),
      person('jo', 'Jo', 'teal', 7, 4, ['night', 'company'], [w(1, 19, 27), w(4, 19, 27)]),
    ],
    shifts: [
      job('mon-ride', 'clinic', 0, 10, 13, 'drive'), job('tue-company', 'company', 1, 11, 14, 'company'),
      job('tue-night', 'overnight', 1, 22, 25, 'night'), job('wed-meal', 'meal', 2, 16, 17, 'meal'),
      job('thu-pickup', 'pharmacy', 3, 10, 12, 'pharmacy'), job('fri-meal', 'meal', 4, 15, 16, 'meal'),
      job('fri-night', 'overnight', 4, 22, 25, 'night'), job('sat-ride', 'clinic', 5, 11, 14, 'drive'),
      job('sun-company', 'company', 6, 11, 14, 'company'),
    ],
    reading: { value: 37.3, unit: 'C', oral: true, sustainedMinutes: 0 },
    history: [day(0, 0, 1), day(1, 1, 1), day(2, 1, 1)],
    medEntries: [med('levothyroxine', 6, 30), med('iron', 9, 0), med('apixaban', 8, 0),
      med('ibuprofen', 14, 30), med('apixaban', 20, 0)],
    medContext: medContext({ anticoagulant: true, bleedingRisk: true }),
  },
  {
    id: 'understaffed', name: 'Understaffed crisis week', weekStart: '2026-11-23', zone,
    primaryId: 'jay', dropped: ['ana'],
    caregivers: [
      person('jay', 'Jay', 'fern', 10, 3, ['drive', 'meal', 'pharmacy'], [w(0, 8, 16), w(2, 7, 17), w(4, 7, 16)]),
      person('ana', 'Ana', 'rose', 16, 2, ['night', 'company', 'meal'], [[0, 10080]]),
      person('beck', 'Beck', 'ochre', 7, 1, ['company', 'meal'], [w(0, 8, 13), w(1, 11, 19), w(2, 7, 12), w(4, 8, 13)]),
      person('kit', 'Kit', 'teal', 3, 2, ['drive'], [w(0, 8, 12), w(4, 8, 12), w(5, 11, 14)]),
    ],
    shifts: [
      job('mon-ride', 'clinic', 0, 8, 11, 'drive'), job('mon-pickup', 'pharmacy', 0, 10, 12, 'pharmacy'),
      job('tue-company', 'company', 1, 11, 14, 'company'), job('tue-meal', 'meal', 1, 17, 18, 'meal'),
      job('wed-ride', 'clinic', 2, 8, 12, 'drive'), job('wed-pickup', 'pharmacy', 2, 13, 15, 'pharmacy'),
      job('thu-night', 'overnight', 3, 22, 26, 'night'), job('fri-ride', 'clinic', 4, 8, 12, 'drive'),
      job('fri-company', 'company', 4, 10, 13, 'company'), job('sat-meal', 'meal', 5, 12, 13, 'meal'),
      job('sun-company', 'company', 6, 11, 14, 'company'),
    ],
    reading: { value: 38.3, unit: 'C', oral: true, sustainedMinutes: 0 },
    history: [day(1, 1, 1), day(2, 1, 2), day(3, 1, 3)],
    medEntries: [med('imatinib', 8, 0), med('grapefruit', 10, 0), med('wort', 15, 30), med('naproxen', 19, 0)],
    medContext: medContext({ riskWindow: true, lowPlatelets: true }),
  },
];

export const CAREGIVER_ALIASES = Object.freeze([...new Set(PRESETS.flatMap(p => p.caregivers.map(c => c.name)))]);
