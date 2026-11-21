export const EMERGENCY_SIGNS = Object.freeze({
  breathing: 'Severe trouble breathing',
  chest: 'Chest pain',
  bleeding: 'Uncontrolled bleeding',
  confusion: 'New confusion',
});
export const TREND_FIELDS = Object.freeze({
  hydration: 'Trouble drinking',
  nausea: 'Nausea',
  fatigue: 'Fatigue',
});
export const FEVER_CUTOFFS = Object.freeze({
  C: Object.freeze({ action: 38, single: 38.3 }),
  F: Object.freeze({ action: 100.4, single: 101 }),
});

export function toCelsius(value, unit) {
  if (!Number.isFinite(value) || typeof unit !== 'string' || !Object.hasOwn(FEVER_CUTOFFS, unit)) {
    throw new TypeError('Invalid temperature or unit.');
  }
  return unit === 'F' ? (value - 32) * 5 / 9 : value;
}

export function feverDefinition({ value, unit, oral = true, sustainedMinutes = 0 }) {
  const celsius = toCelsius(value, unit);
  if (celsius < 25 || celsius > 50 || !Number.isInteger(sustainedMinutes) ||
      sustainedMinutes < 0 || sustainedMinutes > 1440 || typeof oral !== 'boolean') {
    throw new RangeError('Invalid reading, method or sustained time.');
  }
  const cutoffs = FEVER_CUTOFFS[unit];
  // Compare the entered reading directly to published unit thresholds, not a rounded conversion.
  const formal = oral && value >= cutoffs.single ? 'single-oral' :
    oral && value >= cutoffs.action && sustainedMinutes >= 60 ? 'sustained-oral' : null;
  return { celsius, formal, actionThreshold: value >= cutoffs.action };
}

export function worseningTrends(history) {
  if (!Array.isArray(history) || history.length > 7 ||
      [...history].some(row => !row || Object.keys(TREND_FIELDS).some(field =>
        !Number.isInteger(row[field]) || row[field] < 0 || row[field] > 3))) {
    throw new TypeError('Trend needs up to seven daily severity reports (0 to 3).');
  }
  const last = history.slice(-3);
  return last.length !== 3 ? [] : Object.keys(TREND_FIELDS).filter(key =>
    last[0][key] < last[1][key] && last[1][key] < last[2][key]);
}

export function assessCheckIn(context = {}) {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('Unknown check-in context or emergency symptom.');
  }
  const {
    emergency = [], reading = null, chemo = false, signsOfInfection = false, history = [],
  } = context;
  if (!Array.isArray(emergency) || [...emergency].some(key => typeof key !== 'string' || !Object.hasOwn(EMERGENCY_SIGNS, key)) ||
      typeof chemo !== 'boolean' || typeof signsOfInfection !== 'boolean') {
    throw new TypeError('Unknown check-in context or emergency symptom.');
  }
  let fever = null;
  if (reading != null) {
    try {
      fever = feverDefinition(reading);
    } catch (error) {
      if (!signsOfInfection && !emergency.length) throw error;
    }
  }
  if (emergency.length) return { level: 'emergency', reasons: [...new Set(emergency)], fever };
  const trend = worseningTrends(history);
  if (chemo && (fever?.actionThreshold || signsOfInfection)) return {
    level: 'urgent-oncology', reasons: [
      ...(fever?.actionThreshold ? ['chemo-fever'] : []),
      ...(signsOfInfection ? ['chemo-infection-signs'] : []),
      ...trend,
    ], fever,
  };
  if (fever?.actionThreshold || signsOfInfection || trend.length) return {
    level: 'same-day', reasons: [
      ...(fever?.actionThreshold ? ['reported-fever'] : []), ...(signsOfInfection ? ['infection-signs'] : []), ...trend,
    ], fever,
  };
  return { level: 'not-ruled-out', reasons: [], fever };
}
