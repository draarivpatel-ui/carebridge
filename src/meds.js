export const ITEMS = Object.freeze({
  acetaminophen: 'Acetaminophen',
  ibuprofen: 'Ibuprofen',
  naproxen: 'Naproxen',
  apixaban: 'Apixaban',
  warfarin: 'Warfarin',
  imatinib: 'Imatinib',
  grapefruit: 'Grapefruit',
  wort: "St. John's wort",
  ciprofloxacin: 'Ciprofloxacin tablets',
  levothyroxine: 'Levothyroxine tablets',
  calcium: 'Calcium carbonate',
  iron: 'Ferrous sulfate',
  magnesium: 'Magnesium antacid',
});
const NSAIDS = ['ibuprofen', 'naproxen'];
const ANTIPYRETICS = ['acetaminophen', ...NSAIDS];
const BLOOD_THINNERS = ['apixaban', 'warfarin'];
const MINERALS = ['calcium', 'iron', 'magnesium'];
const inDay = n => Number.isInteger(n) && n >= 0 && n < 1440;

export function formatTime(minute) {
  if (!inDay(minute)) throw new RangeError('Time is outside the day.');
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function checkMedicationPlan(entries, options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Medication context must be an options object.');
  }
  const {
    riskWindow = false, lowPlatelets = false, bleedingRisk = false, anticoagulant = false, temperatureAt = null,
  } = options;
  if (!Array.isArray(entries) || entries.length > 36 || [...entries].some(e =>
    !e || typeof e.item !== 'string' || !Object.hasOwn(ITEMS, e.item) || !inDay(e.at) || !['planned', 'logged'].includes(e.status)) ||
    (temperatureAt != null && !inDay(temperatureAt)) ||
    [riskWindow, lowPlatelets, bleedingRisk, anticoagulant].some(value => typeof value !== 'boolean')) {
    throw new TypeError('Use known demo items, statuses and valid times in one day.');
  }
  const timeline = entries.map((e, index) => ({ item: e.item, at: e.at, status: e.status, index }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
  const flags = [];
  const flag = (code, indices, metadata = {}) => flags.push({ code, indices, ...metadata });
  const onThin = anticoagulant || timeline.some(e => BLOOD_THINNERS.includes(e.item));
  for (const a of timeline) {
    if (riskWindow && ANTIPYRETICS.includes(a.item)) {
      if (temperatureAt == null || a.at <= temperatureAt) flag('fever-masking', [a.index], { status: a.status });
      else flag('fever-medicine-review', [a.index], { status: a.status });
    }
    if (NSAIDS.includes(a.item) && (onThin || lowPlatelets || bleedingRisk)) {
      flag('bleeding-risk', [a.index], { onThin, lowPlatelets, bleedingRisk });
    }
    for (const b of timeline) {
      if (a.item === 'imatinib' && (b.item === 'grapefruit' || b.item === 'wort')) {
        flag(b.item === 'grapefruit' ? 'cyp3a4-grapefruit' : 'cyp3a4-wort', [a.index, b.index]);
      }
      if (!MINERALS.includes(b.item)) continue;
      const delta = b.at - a.at;
      if (a.item === 'ciprofloxacin' && delta > -360 && delta < 120) {
        flag('ciprofloxacin-spacing', [a.index, b.index], { delta, minBefore: 360, minAfter: 120 });
      }
      if (a.item === 'levothyroxine' && Math.abs(delta) < 240) {
        flag('levothyroxine-spacing', [a.index, b.index], { delta, minBefore: 240, minAfter: 240 });
      }
    }
  }
  return { timeline, flags };
}
