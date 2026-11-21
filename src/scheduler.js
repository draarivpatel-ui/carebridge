const WEEK = 7 * 1440;
export const GAP = Object.freeze({
  availability: 'uncovered-no-available-caregiver',
  skill: 'uncovered-missing-skill',
  dropout: 'uncovered-only-sitting-out-caregiver',
  constraint: 'uncovered-cap-or-rest-limit',
});

const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const idOK = id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id) && id.trim() === id;
const minutesOK = n => Number.isInteger(n) && n >= 0 && n <= WEEK;
const validWindow = (start, end) => minutesOK(start) && minutesOK(end) && end > start;
const tagsOK = tags => Array.isArray(tags) && tags.length <= 16 && [...tags].every(idOK);

function combine(windows) {
  const merged = [];
  for (const [start, end] of [...windows].sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && previous[1] >= start) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function validate(shifts, caregivers, primaryId, dropped) {
  if (!Array.isArray(shifts) || shifts.length > 18 || !Array.isArray(caregivers) ||
      caregivers.length > 6 || !Array.isArray(dropped)) throw new RangeError('Schedule size or shape is outside the demo limits.');
  if (new Set(shifts.map(s => s?.id)).size !== shifts.length ||
      [...shifts].some(s => !idOK(s?.id) || !validWindow(s.start, s.end) || !tagsOK(s.skills))) {
    throw new TypeError('Each shift needs a unique ID, a valid week interval and skill tags.');
  }
  if (new Set(caregivers.map(c => c?.id)).size !== caregivers.length ||
      [...caregivers].some(c => !idOK(c?.id) || !tagsOK(c.skills) || !minutesOK(c.cap) || !minutesOK(c.rest) ||
        !Array.isArray(c.windows) || c.windows.length > 32 ||
        [...c.windows].some(w => !Array.isArray(w) || w.length !== 2 || !validWindow(...w)))) {
    throw new TypeError('Each caregiver needs a unique ID, cap, rest interval, skill tags and availability.');
  }
  const ids = new Set(caregivers.map(c => c.id));
  if ((primaryId != null && !ids.has(primaryId)) || [...dropped].some(id => !ids.has(id))) {
    throw new TypeError('Primary or unavailable caregiver is unknown.');
  }
}

function gapSum(loads) {
  let gap = 0;
  for (let i = 0; i < loads.length; i++) {
    for (let j = i + 1; j < loads.length; j++) gap += Math.abs(loads[i] - loads[j]);
  }
  return gap;
}

export function gini(loads) {
  if (!Array.isArray(loads) || [...loads].some(n => !Number.isFinite(n) || n < 0)) throw new TypeError('Invalid workloads.');
  const scale = loads.reduce((max, n) => Math.max(max, n), 0);
  if (!scale) return 0;
  const scaled = loads.map(n => n / scale);
  return gapSum(scaled) / (scaled.length * scaled.reduce((sum, n) => sum + n, 0));
}

export function planWeek(shifts, caregivers, { primaryId = null, dropped = [] } = {}) {
  validate(shifts, caregivers, primaryId, dropped);
  const team = caregivers.filter(c => !dropped.includes(c.id))
    .sort((a, b) => order(a.id, b.id)).map(c => ({ ...c, windows: combine(c.windows) }));
  const inactive = caregivers.filter(c => dropped.includes(c.id))
    .map(c => ({ ...c, windows: combine(c.windows) }));
  const jobs = [...shifts].sort((a, b) => a.start - b.start || order(a.id, b.id)).map(shift => {
    const covering = person => person.windows.some(([start, end]) => start <= shift.start && end >= shift.end);
    const qualified = person => shift.skills.every(skill => person.skills.includes(skill));
    const available = team.flatMap((c, i) => covering(c) ? [i] : []);
    const skilled = available.filter(i => qualified(team[i]));
    const open = inactive.some(covering);
    const out = inactive.some(person =>
      covering(person) && qualified(person) && person.cap >= shift.end - shift.start);
    return { ...shift, available, skilled, open, out, length: shift.end - shift.start };
  });
  const ceiling = Array(jobs.length + 1).fill(0);
  for (let j = jobs.length - 1; j >= 0; j--) {
    ceiling[j] = ceiling[j + 1] + Number(jobs[j].skilled.some(i => jobs[j].length <= team[i].cap));
  }
  const loads = team.map(() => 0);
  const last = team.map(() => -WEEK);
  const route = jobs.map(() => -1);
  const fits = (i, job) => loads[i] + job.length <= team[i].cap && last[i] + team[i].rest <= job.start;
  const rank = (a, b) => Number(team[b].id === primaryId) - Number(team[a].id === primaryId) || a - b;
  const summarize = choices => {
    const minutes = Object.fromEntries(caregivers.map(c => [c.id, 0]));
    const allocation = jobs.map((s, j) => {
      const caregiverId = team[choices[j]]?.id ?? null;
      if (caregiverId !== null) minutes[caregiverId] += s.length;
      return {
        shiftId: s.id,
        caregiverId,
        reason: caregiverId !== null ? null
          : !s.available.length ? (s.out ? GAP.dropout : s.open ? GAP.skill : GAP.availability)
          : !s.skilled.length ? (s.out ? GAP.dropout : GAP.skill)
          : GAP.constraint,
      };
    });
    return {
      allocation, minutes,
      covered: allocation.filter(item => item.caregiverId !== null).length,
      gini: gini(team.map(c => minutes[c.id])),
    };
  };

  const greedy = jobs.map(job => {
    const i = [...job.skilled].sort(rank).find(k => fits(k, job));
    if (i === undefined) return -1;
    loads[i] += job.length;
    last[i] = job.end;
    return i;
  });
  loads.fill(0);
  last.fill(-WEEK);

  let best = null;
  let visited = 0;
  const seen = jobs.map(() => new Set());
  function search(j, covered, total) {
    if (best && covered + ceiling[j] < best.covered) return;
    if (++visited > 350_000) throw new RangeError('This scenario exceeds the exact search budget. No partial result was returned.');
    if (j === jobs.length) {
      const gap = gapSum(loads);
      // Team size is constant. Compare integer fractions without rounding even if coverage ties have different hours.
      if (!best || covered > best.covered || (covered === best.covered && gap * best.total < best.gap * total)) {
        best = { covered, total: total || 1, gap, route: [...route] };
      }
      return;
    }
    const job = jobs[j];
    // Equivalent rest-ready times can be collapsed once they fall before the next shift.
    const key = `${covered}|${loads.join(',')}|${last.map((end, i) => Math.max(job.start, end + team[i].rest)).join(',')}`;
    if (seen[j].has(key)) return;
    seen[j].add(key);
    for (const i of job.skilled) {
      if (!fits(i, job)) continue;
      const prior = last[i];
      loads[i] += job.length;
      last[i] = job.end;
      route[j] = i;
      search(j + 1, covered + 1, total + job.length);
      last[i] = prior;
      loads[i] -= job.length;
    }
    route[j] = -1;
    search(j + 1, covered, total);
  }
  search(0, 0, 0);
  const balanced = summarize(best.route);
  const baseline = summarize(greedy);
  return {
    balanced, baseline, visited,
    primaryMinutesSaved: primaryId == null ? 0 : baseline.minutes[primaryId] - balanced.minutes[primaryId],
    giniDelta: baseline.gini - balanced.gini,
  };
}
