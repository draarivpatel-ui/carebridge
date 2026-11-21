import { PRESETS, ROLES, NOTES, timeLabel } from './presets.js';
import { planWeek, GAP } from './scheduler.js';
import { assessCheckIn, EMERGENCY_SIGNS, TREND_FIELDS } from './triage.js';
import { checkMedicationPlan, ITEMS, formatTime } from './meds.js';
import { sealCard, openCard } from './crypto-card.js';
import { makeCalendar, makeCSV, createAuditBundle } from './exports.js';
import { renderBinder } from './binder.js';
import { shortcutFor } from './shortcuts.js';

const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const VIEWS = ['week', 'symptoms', 'meds', 'handoff'];
const TITLES = {
  week: 'The care week',
  symptoms: 'The check-in',
  meds: 'The medicine day',
  handoff: 'The handoff sheet',
};
const WHY = {
  [GAP.availability]: 'Nobody is free in this window.',
  [GAP.skill]: 'Whoever is free does not hold the needed skills.',
  [GAP.constraint]: 'Weekly caps or required rest leave no one able to take it.',
};

const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'for') node.htmlFor = value;
    else if (['checked', 'disabled', 'selected', 'readOnly', 'value', 'hidden'].includes(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...kids.flat(Infinity).filter(k => k != null));
  return node;
};

const svg = (tag, attrs = {}, ...kids) => {
  const node = document.createElementNS(SVGNS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, String(value));
  }
  node.append(...kids.flat(Infinity).filter(k => k != null));
  return node;
};

// Caregiver colors arrive as palette names (fern, ochre, rose, teal, sand),
// styled from the stylesheet so no inline style ever touches the DOM.
const dot = color => svg('svg', {
  class: `dot c-${String(color).replace(/[^a-z0-9-]/gi, '')}`,
  viewBox: '0 0 10 10', width: 10, height: 10, 'aria-hidden': 'true',
}, svg('circle', { cx: 5, cy: 5, r: 4 }));

const pad = n => String(n).padStart(2, '0');
const hm = offset => {
  const t = ((offset % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};
const span = mins => {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (m === 0) return `${h} h`;
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
};

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' });
const monthDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

const dayOf = (weekStart, i) => {
  const [y, m, d] = weekStart.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + i));
};
const dayISO = (weekStart, i) => dayOf(weekStart, i).toISOString().slice(0, 10);

const announce = message => {
  const live = $('live-status');
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = message; });
};

const state = {
  index: 0,
  dropped: [],
  view: 'week',
  keys: false,
  imported: null,
  checkins: [],
  meds: [],
  medCtx: { riskWindow: false, lowPlatelets: false, bleedingRisk: false, anticoagulant: false, temperatureAt: null },
  person: null,
  lang: 'en',
  plan: null,
};

const preset = () => PRESETS[state.index];
const byId = id => preset().caregivers.find(c => c.id === id);

function plan() {
  if (!state.plan) {
    state.plan = planWeek(preset().shifts, preset().caregivers, {
      primaryId: preset().primaryId ?? null,
      dropped: state.dropped,
    });
  }
  return state.plan;
}

/* ---------------- view switching ---------------- */

function setView(view, focus = true) {
  if (!VIEWS.includes(view)) return;
  state.view = view;
  for (const name of VIEWS) {
    $(name).hidden = name !== view;
    const button = $(`nav-${name}`);
    if (name === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  document.title = `CareBridge · ${TITLES[view].toLowerCase()}`;
  if (focus) $(`${view}-title`)?.focus();
  announce(`${TITLES[view]} shown.`);
}

/* ---------------- the care week ---------------- */

function renderMetrics() {
  const p = preset();
  const { balanced, baseline, primaryMinutesSaved } = plan();
  const open = balanced.allocation.filter(a => a.caregiverId === null).length;

  const cov = $('coverage').querySelector('dd');
  cov.textContent = '';
  cov.append(`${balanced.covered} of ${p.shifts.length} staffed`);
  if (open) cov.append(' ', el('span', { class: 'open', text: `· ${open} still open` }));
  cov.append(el('span', { class: 'metric-sub', text: `First pass: ${baseline.covered} staffed` }));

  const primary = byId(p.primaryId);
  $('saved').querySelector('dd').textContent = !primary
    ? 'n/a'
    : primaryMinutesSaved > 0
      ? `${span(primaryMinutesSaved)} returned to ${primary.name}`
      : primaryMinutesSaved < 0
        ? `${span(-primaryMinutesSaved)} more for ${primary.name}`
        : `No change for ${primary.name}`;

  $('fairness').querySelector('dd').textContent =
    `${baseline.gini.toFixed(3)} to ${balanced.gini.toFixed(3)}`;
}

function renderWeekGrid() {
  const p = preset();
  const { balanced } = plan();
  const alloc = Object.fromEntries(balanced.allocation.map(a => [a.shiftId, a]));

  $('week-caption').textContent =
    `${monthDayFmt.format(dayOf(p.weekStart, 0))} to ${monthDayFmt.format(dayOf(p.weekStart, 6))} · ${p.zone}`;

  const grid = $('week-grid');
  grid.textContent = '';
  for (let i = 0; i < 7; i++) {
    const date = dayOf(p.weekStart, i);
    const jobs = p.shifts
      .filter(s => Math.floor(s.start / 1440) === i)
      .sort((a, b) => a.start - b.start);
    const list = el('ol', { class: 'jobs' });
    for (const shift of jobs) {
      const a = alloc[shift.id];
      const caregiver = a?.caregiverId ? byId(a.caregiverId) : null;
      const overnight = Math.floor(shift.end / 1440) > i;
      const li = el('li', { class: caregiver ? 'job' : 'job gap' },
        el('span', { class: 'job-time', text: `${hm(shift.start)}-${hm(shift.end)}${overnight ? ' (next day)' : ''}` }),
        el('span', { class: 'job-role', text: ROLES[shift.role]?.en ?? shift.role }));
      if (caregiver) {
        li.append(el('span', { class: 'job-who' }, dot(caregiver.color), caregiver.name));
      } else {
        li.append(el('span', { class: 'job-why', text: WHY[a?.reason] ?? 'Still open.' }));
      }
      list.append(li);
    }
    if (!jobs.length) list.append(el('li', { class: 'job none', text: 'Nothing scheduled' }));
    grid.append(el('section', { class: 'day' },
      el('h2', { class: 'day-head' },
        el('span', { class: 'day-name', text: weekdayFmt.format(date) }),
        el('span', { class: 'day-date', text: monthDayFmt.format(date) })),
      list));
  }
}

function renderCircle() {
  const p = preset();
  const { balanced, baseline } = plan();
  const scale = Math.max(1, ...p.caregivers.map(c =>
    Math.max(baseline.minutes[c.id] ?? 0, balanced.minutes[c.id] ?? 0)));

  const list = $('circle-list');
  list.textContent = '';
  for (const c of p.caregivers) {
    const out = state.dropped.includes(c.id);
    const was = baseline.minutes[c.id] ?? 0;
    const now = balanced.minutes[c.id] ?? 0;
    const width = m => 4 + Math.round((m / scale) * 96);

    const box = el('input', {
      type: 'checkbox',
      id: `drop-${c.id}`,
      checked: out,
      'aria-label': `Simulate ${c.name} sitting out this week`,
    });
    box.addEventListener('change', () => onDrop(c.id, box));

    list.append(el('li', { class: out ? 'circle-person out' : 'circle-person' },
      el('div', { class: 'person-top' },
        dot(c.color),
        el('span', { class: 'name', text: c.name }),
        c.id === p.primaryId ? el('span', { class: 'tag', text: 'primary' }) : null),
      svg('svg', {
        class: 'strokes', viewBox: '0 0 104 16', width: 104, height: 16,
        role: 'img', 'aria-label': `First pass ${span(was)}, balanced ${span(now)}`,
      },
        svg('line', { x1: 2, x2: width(was), y1: 5, y2: 5, class: 'stroke-base' }),
        svg('line', { x1: 2, x2: width(now), y1: 11, y2: 11, class: 'stroke-now' })),
      el('p', { class: 'person-hours', text: `${span(now)} balanced · was ${span(was)}` }),
      el('label', { class: 'drop', for: `drop-${c.id}` }, box, 'Sits out')));
  }
}

function renderWeek() {
  try {
    renderMetrics();
    renderWeekGrid();
    renderCircle();
  } catch {
    $('week-grid').textContent = '';
    $('week-grid').append(el('p', { class: 'quiet', text: 'This scenario could not be planned.' }));
    announce('The week could not be planned.');
  }
  $('reset-week').disabled = state.dropped.length === preset().dropped.length &&
    state.dropped.every(id => preset().dropped.includes(id));
}

function onDrop(id, box) {
  const previous = state.dropped;
  state.dropped = box.checked ? [...previous, id] : previous.filter(x => x !== id);
  state.plan = null;
  try {
    plan();
  } catch {
    state.dropped = previous;
    state.plan = null;
    box.checked = !box.checked;
    announce('That combination cannot be planned; restored.');
    return;
  }
  renderWeek();
  renderHandoff();
  $(`drop-${id}`)?.focus();
  announce(`${byId(id).name} ${box.checked ? 'sits out' : 'is back in'}; plan recomputed.`);
}

/* ---------------- the check-in ---------------- */

function buildSigns() {
  const wrap = $('signs');
  wrap.textContent = '';
  for (const [key, label] of Object.entries(EMERGENCY_SIGNS)) {
    wrap.append(el('label', { class: 'check', for: `sign-${key}` },
      el('input', { type: 'checkbox', id: `sign-${key}`, class: 'sign-box' }), label));
  }
}

function buildTrend() {
  const wrap = $('trend-days');
  wrap.textContent = '';
  for (let d = 0; d < 3; d++) {
    const row = el('div', { class: 'trend-day' }, el('span', { class: 'dow', text: `Day ${d + 1}` }));
    for (const [field, label] of Object.entries(TREND_FIELDS)) {
      const select = el('select', { id: `trend-${d}-${field}`, 'aria-label': `${label}, day ${d + 1}` });
      for (let v = 0; v <= 3; v++) select.append(el('option', { value: v, text: `${v}` }));
      row.append(el('label', {}, select, label));
    }
    wrap.append(row);
  }
}

function syncTrend() {
  const history = preset().history.slice(-3);
  while (history.length < 3) history.unshift({ hydration: 0, nausea: 0, fatigue: 0 });
  history.forEach((row, d) => {
    for (const field of Object.keys(TREND_FIELDS)) {
      const select = $(`trend-${d}-${field}`);
      if (select) select.value = String(row[field] ?? 0);
    }
  });
}

function showResultNote() {
  const box = $('triage-result');
  box.textContent = '';
  box.className = 'triage';
  box.append(el('p', { class: 'quiet', text: 'Run the check-in to see where a reading lands; a severe sign means call first.' }));
}

function syncSymptomForm() {
  const r = preset().reading;
  $('temperature').value = r.value;
  $('unit').value = r.unit;
  $('sustained').value = r.sustainedMinutes;
  $('oral').checked = r.oral !== false;
  $('chemo').checked = preset().medContext.riskWindow;
  $('infection').checked = false;
  for (const box of document.querySelectorAll('.sign-box')) box.checked = false;
  syncTrend();
  showResultNote();
}

const REASON_TEXT = {
  'chemo-fever': 'a reading at the action level during chemotherapy',
  'chemo-infection-signs': 'possible infection signs during chemotherapy',
  'reported-fever': 'a reading at or above the action level',
  'infection-signs': 'reported signs of infection',
};

function reasonText(reason) {
  if (EMERGENCY_SIGNS[reason]) return EMERGENCY_SIGNS[reason].toLowerCase();
  if (TREND_FIELDS[reason]) return `${TREND_FIELDS[reason].toLowerCase()} worsening three days running`;
  return REASON_TEXT[reason] ?? reason;
}

function renderResult(res, reading) {
  const box = $('triage-result');
  box.textContent = '';
  box.className = 'triage';
  let title;
  let body;
  switch (res.level) {
    case 'emergency':
      box.classList.add('emergency');
      title = 'Call emergency services now';
      body = 'Severe signs are checked; this does not wait for a temperature reading. Call 911 in the U.S. or the local emergency number.';
      break;
    case 'urgent-oncology':
      box.classList.add('same-day');
      title = 'Call the oncology team now';
      body = 'Fever-level readings or infection signs during chemotherapy go straight to the care team.';
      break;
    case 'same-day':
      box.classList.add('same-day');
      title = 'Call the care team today';
      body = 'Something in this check-in needs a same-day call.';
      break;
    default:
      title = 'No rule matched; not an all-clear';
      body = 'Nothing in this check-in triggered a rule. Keep watching and call the team if anything changes.';
  }
  box.append(el('h2', { text: title }), el('p', { text: body }));
  if (res.reasons.length) {
    box.append(el('ul', {}, res.reasons.map(r => el('li', { text: reasonText(r) }))));
  }
  if (reading && res.fever) {
    const { celsius, formal, actionThreshold } = res.fever;
    const note = formal === 'single-oral'
      ? 'meets the formal single oral reading threshold in the entered unit'
      : formal === 'sustained-oral'
        ? 'meets the formal one-hour oral threshold in the entered unit'
        : actionThreshold
          ? 'is at the first-reading threshold, but does not meet the formal oral definition'
          : 'is below the first-reading threshold';
    const conversion = reading.unit === 'F' ? ` (about ${celsius.toFixed(4)} °C; compared in °F)` : '';
    box.append(el('p', { class: 'read', text: `A reading of ${reading.value} °${reading.unit}${conversion} ${note}.` }));
  } else if (res.level === 'emergency') {
    box.append(el('p', { text: 'No temperature was needed for this call.' }));
  }
}

function renderLog() {
  const list = $('checkin-log');
  list.textContent = '';
  if (!state.checkins.length) {
    list.append(el('li', { class: 'quiet', text: 'Nothing run yet.' }));
    return;
  }
  for (const entry of state.checkins) {
    const when = entry.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    list.append(el('li', { text: `${when} - ${entry.level.replaceAll('-', ' ')}` }));
  }
}

function onCheckIn(event) {
  event.preventDefault();
  const tempField = $('temperature');
  const sustainedField = $('sustained');
  const reading = tempField.value === '' && !tempField.validity.badInput ? null : {
    value: tempField.valueAsNumber,
    unit: $('unit').value,
    oral: $('oral').checked,
    sustainedMinutes: sustainedField.value === '' && !sustainedField.validity.badInput
      ? 0
      : sustainedField.valueAsNumber,
  };
  const emergency = Object.keys(EMERGENCY_SIGNS).filter(k => $(`sign-${k}`).checked);
  const history = [0, 1, 2].map(d => Object.fromEntries(
    Object.keys(TREND_FIELDS).map(f => [f, Number($(`trend-${d}-${f}`).value)])));
  let res;
  try {
    res = assessCheckIn({
      emergency,
      reading,
      chemo: $('chemo').checked,
      signsOfInfection: $('infection').checked,
      history,
    });
  } catch {
    const box = $('triage-result');
    box.textContent = '';
    box.className = 'triage';
    box.append(el('p', { text: 'Enter a valid temperature, or leave it blank. Sustained time must be a whole number from 0 to 1440.' }));
    return;
  }
  renderResult(res, reading);
  state.checkins.push({ at: new Date(), level: res.level, res, reading, history });
  renderLog();
  announce(`Check-in result: ${res.level.replaceAll('-', ' ')}.`);
}

/* ---------------- the medicine day ---------------- */

function syncMedContext() {
  const c = preset().medContext;
  $('ctx-risk-window').checked = !!c.riskWindow;
  $('ctx-low-platelets').checked = !!c.lowPlatelets;
  $('ctx-bleeding').checked = !!c.bleedingRisk;
  $('ctx-anticoagulant').checked = !!c.anticoagulant;
  $('ctx-temp-toggle').checked = c.temperatureAt != null;
  $('ctx-temp-time').disabled = c.temperatureAt == null;
  $('ctx-temp-time').value = c.temperatureAt != null ? formatTime(c.temperatureAt) : '';
}

function readMedContext() {
  const c = state.medCtx;
  c.riskWindow = $('ctx-risk-window').checked;
  c.lowPlatelets = $('ctx-low-platelets').checked;
  c.bleedingRisk = $('ctx-bleeding').checked;
  c.anticoagulant = $('ctx-anticoagulant').checked;
  const on = $('ctx-temp-toggle').checked;
  $('ctx-temp-time').disabled = !on;
  const t = $('ctx-temp-time').value;
  c.temperatureAt = on && t ? (() => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  })() : null;
}

const FLAG_TEXT = (flag, name) => {
  switch (flag.code) {
    case 'fever-masking': {
      const when = state.medCtx.temperatureAt == null
        ? 'no temperature time is recorded'
        : 'is at or before the recorded temperature check';
      return `${name(flag.indices[0])} (${flag.status}) ${when}; fever medicines can hide a fever during treatment. Tell the care team rather than adjusting anything.`;
    }
    case 'fever-medicine-review':
      return `${name(flag.indices[0])} falls after the temperature check while fever risk is active; ask the care team to confirm it belongs there.`;
    case 'bleeding-risk': {
      const why = flag.onThin ? 'a blood thinner is in the mix' : flag.lowPlatelets ? 'platelets are low' : 'bleeding risk is present';
      return `${name(flag.indices[0])} is an NSAID on a plan where ${why}. Only the care team decides whether it stays.`;
    }
    case 'cyp3a4-grapefruit':
      return 'Grapefruit changes how the body handles imatinib. Flag the pairing for the team; shifting times will not fix it.';
    case 'cyp3a4-wort':
      return "St. John's wort changes how the body handles imatinib. Flag the pairing for the team; shifting times will not fix it.";
    case 'ciprofloxacin-spacing':
      return `A mineral sits ${Math.abs(flag.delta)} minutes from ciprofloxacin, inside the restricted window from the ciprofloxacin tablet label: six hours before to two hours after. The pharmacist or care team should confirm the written times.`;
    case 'levothyroxine-spacing':
      return `A mineral sits ${Math.abs(flag.delta)} minutes from levothyroxine; the label calls for a four-hour gap. The pharmacist or care team should confirm the written times.`;
    default:
      return `Flag ${flag.code}; show it to the care team.`;
  }
};

function renderMeds() {
  readMedContext();
  let result;
  try {
    result = checkMedicationPlan(state.meds, state.medCtx);
  } catch {
    $('med-flags').textContent = '';
    $('med-flags').append(el('p', { class: 'none', text: 'This day is outside the demo limits.' }));
    return;
  }
  const { timeline, flags } = result;
  const flagged = new Set(flags.flatMap(f => f.indices));

  // The 24-hour axis is drawn entirely with SVG attributes.
  const axis = $('med-axis');
  axis.textContent = '';
  const L = 46, R = 600, Y = 34;
  const x = at => L + (at / 1440) * (R - L);
  axis.append(svg('line', { x1: L, x2: R, y1: Y, y2: Y, class: 'axis' }));
  for (const h of [0, 6, 12, 18, 24]) {
    const tx = x(h * 60);
    axis.append(svg('line', { x1: tx, x2: tx, y1: Y, y2: Y + 6, class: 'tick' }));
    axis.append(svg('text', {
      x: h === 0 ? tx : tx - 12, y: Y + 20, class: 'tick-label',
    }, `${pad(h)}:00`));
  }
  if (state.medCtx.temperatureAt != null) {
    const tx = x(state.medCtx.temperatureAt);
    axis.append(svg('line', { x1: tx, x2: tx, y1: 6, y2: Y + 6, class: 'tick temp' }));
    axis.append(svg('text', { x: Math.min(tx + 4, R - 56), y: 14, class: 'temp-label' }, 'temp check'));
  }
  for (const e of timeline) {
    const ex = x(e.at);
    if (flagged.has(e.index)) {
      axis.append(svg('path', { d: `M${ex} 10 l5 6 l-5 6 l-5 -6 z`, class: 'diamond' }));
    }
    axis.append(svg('circle', {
      cx: ex, cy: Y, r: 6,
      class: `mk ${e.status}${flagged.has(e.index) ? ' flagged' : ''}`,
    }, svg('title', {}, `${ITEMS[e.item]} at ${formatTime(e.at)} (${e.status})`)));
  }

  const list = $('med-entries');
  list.textContent = '';
  for (const e of timeline) {
    const li = el('li', { class: flagged.has(e.index) ? 'entry flagged' : 'entry' },
      el('span', { class: 'at', text: formatTime(e.at) }),
      el('span', { class: 'item', text: ITEMS[e.item] }),
      el('span', { class: 'st', text: e.status }));
    if (flagged.has(e.index)) li.append(el('span', { class: 'flagged-tag', text: 'flagged' }));
    li.append(el('button', { type: 'button', class: 'rm', 'data-rm': e.index, text: 'Remove' }));
    list.append(li);
  }

  const box = $('med-flags');
  box.textContent = '';
  if (!flags.length) {
    box.append(el('p', { class: 'none', text: 'No flags on this day; that is not the same as an all-clear.' }));
  } else {
    const name = i => ITEMS[state.meds[i]?.item] ?? 'An entry';
    box.append(el('ul', {}, flags.map(f => el('li', { class: 'flag', text: FLAG_TEXT(f, name) }))));
  }

  const full = state.meds.length >= 36;
  $('med-add').disabled = full;
  $('med-cap-note').hidden = !full;
}

function onAddMed(event) {
  event.preventDefault();
  if (state.meds.length >= 36) return;
  const item = $('med-item').value;
  const t = $('med-at').value;
  if (!Object.hasOwn(ITEMS, item) || !t) return;
  const [h, m] = t.split(':').map(Number);
  state.meds.push({ item, at: h * 60 + m, status: $('med-status').value });
  renderMeds();
  announce(`${ITEMS[item]} added at ${formatTime(h * 60 + m)}.`);
}

/* ---------------- the handoff ---------------- */

function currentCard() {
  if (state.imported) return state.imported;
  const p = preset();
  const { balanced } = plan();
  const person = byId(state.person);
  const tasks = balanced.allocation
    .filter(a => a.caregiverId === state.person)
    .map(a => p.shifts.find(s => s.id === a.shiftId))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
    .map(s => ({
      role: s.role,
      start: timeLabel(p.weekStart, s.start),
      end: timeLabel(p.weekStart, s.end),
    }));
  return {
    v: 1,
    alias: person?.name ?? 'Caregiver',
    zone: p.zone,
    tasks,
    notes: Object.keys(NOTES).sort(),
  };
}

const handoffStatus = msg => { $('handoff-status').textContent = msg; };
let shareRevision = 0;
function clearShare() {
  shareRevision += 1;
  $('handoff-link').value = '';
  $('copy-link').disabled = true;
  handoffStatus('');
}

function renderHandoff() {
  clearShare();
  const select = $('handoff-person');
  select.textContent = '';
  for (const c of preset().caregivers) {
    select.append(el('option', { value: c.id, text: c.name }));
  }
  const imported = !!state.imported;
  select.disabled = imported;
  if (!imported) select.value = state.person ?? '';
  $('handoff-language').value = state.lang;
  $('imported-note').hidden = !imported;
  $('seal-card').disabled = imported;
  $('export-schedule').disabled = imported;
  $('export-symptoms').disabled = imported;
  $('audit-bundle').disabled = imported;
  let card = null;
  try {
    card = currentCard();
  } catch { /* the binder renders its empty state */ }
  $('export-calendar').disabled = !card?.tasks.length;
  renderBinder($('binder'), card, state.lang);
}

async function onSeal() {
  const revision = ++shareRevision;
  let frag;
  try {
    frag = await sealCard(currentCard());
  } catch {
    if (revision !== shareRevision) return;
    handoffStatus('The card could not be sealed.');
    return;
  }
  if (revision !== shareRevision) return;
  const url = new URL(location.pathname, location.origin);
  url.hash = frag;
  $('handoff-link').value = url.href;
  $('copy-link').disabled = false;
  handoffStatus('Sealed. Anyone with the full link can open this card.');
  announce('Share link sealed.');
}

async function onCopy() {
  const input = $('handoff-link');
  if (!input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    handoffStatus('Copied.');
  } catch {
    input.focus();
    input.select();
    handoffStatus('Clipboard is blocked; the link is selected, copy it yourself.');
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onCalendar() {
  try {
    const card = currentCard();
    if (!card.tasks.length) return;
    const counts = new Map();
    const events = card.tasks.map(t => {
      const key = [card.alias, card.zone, t.role, t.start, t.end].join('-').replace(/[^a-zA-Z0-9-]/g, '');
      const occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);
      return {
        id: `${key}-${occurrence}`,
        title: `CareBridge - ${ROLES[t.role]?.en ?? t.role}`,
        start: t.start,
        end: t.end,
        description: `Synthetic demo task for ${card.alias}.`,
      };
    });
    download('carebridge-handoff.ics', makeCalendar(events, { zone: card.zone, stamp: new Date() }), 'text/calendar');
  } catch {
    handoffStatus('The calendar export failed.');
  }
}

function onScheduleCSV() {
  try {
    const p = preset();
    const { balanced } = plan();
    const alloc = Object.fromEntries(balanced.allocation.map(a => [a.shiftId, a]));
    const rows = [['day', 'start', 'end', 'zone', 'task', 'caregiver', 'gap_reason']];
    for (const s of [...p.shifts].sort((a, b) => a.start - b.start)) {
      const a = alloc[s.id];
      rows.push([
        dayISO(p.weekStart, Math.floor(s.start / 1440)),
        timeLabel(p.weekStart, s.start),
        timeLabel(p.weekStart, s.end),
        p.zone,
        ROLES[s.role]?.en ?? s.role,
        a?.caregiverId ? byId(a.caregiverId)?.name ?? a.caregiverId : 'UNCOVERED',
        a && !a.caregiverId ? (WHY[a.reason] ?? a.reason ?? 'Uncovered') : '',
      ]);
    }
    download('carebridge-week.csv', makeCSV(rows), 'text/csv');
  } catch {
    handoffStatus('The schedule export failed.');
  }
}

function onSymptomsCSV() {
  const rows = [['kind', 'recorded', 'level', 'temperature', 'unit', 'oral', 'sustained_minutes', 'hydration', 'nausea', 'fatigue']];
  preset().history.forEach((h, i) => rows.push([
    'history', `day ${i + 1}`, '', '', '', '', '', h.hydration, h.nausea, h.fatigue,
  ]));
  for (const c of state.checkins) {
    rows.push([
      'check-in',
      c.at.toISOString(),
      c.level,
      c.reading?.value ?? '',
      c.reading?.unit ?? '',
      c.reading ? String(c.reading.oral) : '',
      c.reading?.sustainedMinutes ?? '',
      '', '', '',
    ]);
    (c.history ?? []).forEach((h, i) => rows.push([
      `check-in trend day ${i + 1}`,
      c.at.toISOString(),
      '', '', '', '', '',
      h.hydration, h.nausea, h.fatigue,
    ]));
  }
  download('carebridge-symptoms.csv', makeCSV(rows), 'text/csv');
}

async function onAudit() {
  try {
    const { balanced, baseline, visited, primaryMinutesSaved, giniDelta } = plan();
    const bundle = await createAuditBundle({
      generated: new Date().toISOString(),
      scenario: preset().id,
      zone: preset().zone,
      dropped: [...state.dropped],
      coverage: `${balanced.covered}/${preset().shifts.length}`,
      primaryMinutesSaved,
      gini: { before: baseline.gini, after: balanced.gini, delta: giniDelta },
      balancedAllocation: balanced.allocation,
      baselineAllocation: baseline.allocation,
      balancedMinutes: balanced.minutes,
      baselineMinutes: baseline.minutes,
      searchVisited: visited,
    });
    download('carebridge-audit.json', JSON.stringify(bundle, null, 2), 'application/json');
  } catch {
    handoffStatus('The audit bundle failed.');
  }
}

/* ---------------- shared-link import ---------------- */

async function importHash() {
  const hash = location.hash;
  if (!hash || !hash.slice(1).startsWith('handoff=')) return;
  let card = null;
  try {
    card = await openCard(hash);
  } catch {
    card = null;
  }
  if (location.hash !== hash) return;
  state.imported = card;
  // Consume the fragment once the card is settled, so reloading this page
  // needs the original link again.
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* the fragment stays; the page still works */ }
  setView('handoff', false);
  renderHandoff();
  handoffStatus(card
    ? 'Shared card opened; it is read-only.'
    : 'That link could not be opened; it may be invalid or changed.');
  announce(card
    ? 'Shared handoff card opened; it is read-only.'
    : 'That shared link could not be opened.');
}

/* ---------------- boot ---------------- */

function loadPreset(index) {
  const p = PRESETS[index];
  if (!p) return;
  state.index = index;
  state.dropped = [...(p.dropped ?? [])];
  state.meds = p.medEntries.map(e => ({ ...e }));
  state.medCtx = { riskWindow: false, lowPlatelets: false, bleedingRisk: false, anticoagulant: false, temperatureAt: null };
  state.checkins = [];
  state.person = p.primaryId ?? p.caregivers[0]?.id ?? null;
  state.plan = null;
  syncSymptomForm();
  syncMedContext();
  renderWeek();
  renderMeds();
  renderHandoff();
  renderLog();
}

function wire() {
  const scenario = $('scenario');
  for (const p of PRESETS) {
    scenario.append(el('option', { value: p.id, text: p.name }));
  }
  scenario.addEventListener('change', () => {
    const index = PRESETS.findIndex(p => p.id === scenario.value);
    if (index < 0) return;
    loadPreset(index);
    announce(`Scenario changed; ${preset().name}. Controls and the session log were reset.`);
  });

  for (const view of VIEWS) {
    $(`nav-${view}`).addEventListener('click', () => setView(view));
  }
  $('shortcut-toggle').addEventListener('change', e => {
    state.keys = e.target.checked;
    announce(state.keys
      ? 'Shortcut keys on; w, s, m and h switch workbenches.'
      : 'Shortcut keys off.');
  });
  document.addEventListener('keydown', e => {
    const view = shortcutFor(e, state.keys);
    if (view) {
      e.preventDefault();
      setView(view);
    }
  });

  $('reset-week').addEventListener('click', () => {
    state.dropped = [...(preset().dropped ?? [])];
    state.plan = null;
    renderWeek();
    renderHandoff();
    announce('Week reset to the scenario default.');
  });

  $('symptom-form').addEventListener('submit', onCheckIn);

  for (const id of ['ctx-risk-window', 'ctx-low-platelets', 'ctx-bleeding', 'ctx-anticoagulant', 'ctx-temp-toggle', 'ctx-temp-time']) {
    $(id).addEventListener('change', () => {
      renderMeds();
      announce('Context changed; flags recomputed.');
    });
  }
  for (const [key, label] of Object.entries(ITEMS)) {
    $('med-item').append(el('option', { value: key, text: label }));
  }
  $('med-add-form').addEventListener('submit', onAddMed);
  $('med-entries').addEventListener('click', e => {
    const button = e.target.closest('button[data-rm]');
    if (!button) return;
    const index = Number(button.dataset.rm);
    const removed = state.meds[index];
    state.meds.splice(index, 1);
    renderMeds();
    const next = $('med-entries').querySelector('button');
    if (next) next.focus();
    else $('med-item').focus();
    announce(removed ? `${ITEMS[removed.item]} removed.` : 'Entry removed.');
  });

  $('handoff-person').addEventListener('change', e => {
    state.person = e.target.value;
    renderHandoff();
  });
  $('handoff-language').addEventListener('change', e => {
    state.lang = e.target.value;
    renderHandoff();
  });
  $('seal-card').addEventListener('click', onSeal);
  $('copy-link').addEventListener('click', onCopy);
  $('print-binder').addEventListener('click', () => window.print());
  $('export-calendar').addEventListener('click', onCalendar);
  $('export-schedule').addEventListener('click', onScheduleCSV);
  $('export-symptoms').addEventListener('click', onSymptomsCSV);
  $('audit-bundle').addEventListener('click', onAudit);
  $('return-demo').addEventListener('click', () => {
    state.imported = null;
    renderHandoff();
    $('handoff-title')?.focus();
    announce('Back to the live demo.');
  });

  window.addEventListener('hashchange', importHash);
}

/* ---------------- offline status ---------------- */

let offlineReady = false;
function appStatus() {
  $('app-status').textContent =
    `${navigator.onLine ? 'Online' : 'Offline'}${offlineReady ? ' · saved for offline' : ''}`;
}
window.addEventListener('online', appStatus);
window.addEventListener('offline', appStatus);

if ('serviceWorker' in navigator && window.isSecureContext) {
  if (navigator.serviceWorker.controller) offlineReady = true;
  navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { offlineReady = true; appStatus(); })
    .catch(() => { offlineReady = false; appStatus(); });
}

/* ---------------- start ---------------- */

buildSigns();
buildTrend();
wire();
loadPreset(0);
importHash();
appStatus();
