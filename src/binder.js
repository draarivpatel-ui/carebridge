import { ROLES, NOTES } from './presets.js';

const TEXT = Object.freeze({
  en: Object.freeze({
    sheet: 'CareBridge handoff',
    preparedFor: 'Prepared for',
    zone: 'All times shown for',
    day: 'Day',
    time: 'Time',
    task: 'Task',
    notes: 'Notes for the week',
    empty: 'No tasks on this card.',
    warning: 'Synthetic demo card; fictional names, times and notes only.',
  }),
  es: Object.freeze({
    sheet: 'Hoja de entrega de CareBridge',
    preparedFor: 'Preparada para',
    zone: 'Todos los horarios para',
    day: 'Día',
    time: 'Hora',
    task: 'Tarea',
    notes: 'Notas para la semana',
    empty: 'Esta tarjeta no tiene tareas.',
    warning: 'Tarjeta sintética de demostración; nombres, horarios y notas ficticios.',
  }),
});

const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...kids.flat(Infinity).filter(k => k != null));
  return node;
};

// A card task's start/end arrive as 'YYYY-MM-DDTHH:mm' local wall times in the
// card's zone. The date is formatted from the calendar day itself (a fixed UTC
// instant), never from the viewer's own timezone.
const dayLabel = (iso, lang) => {
  const fmt = new Intl.DateTimeFormat(lang === 'es' ? 'es' : 'en', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(`${iso}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return 'n/a';
  return fmt.format(date);
};

const roleText = (role, lang) => ROLES[role]?.[lang] ?? ROLES[role]?.en ?? role;
const noteText = (key, lang) => NOTES[key]?.[lang] ?? NOTES[key]?.en ?? null;

export function renderBinder(root, card, language = 'en') {
  const lang = language === 'es' ? 'es' : 'en';
  const t = TEXT[lang];
  root.lang = lang;
  root.textContent = '';
  if (!card || !Array.isArray(card.tasks)) {
    root.append(el('p', { class: 'binder-empty', text: t.empty }));
    return;
  }
  const sheet = el('article', { class: 'binder-sheet' });
  sheet.append(el('header', { class: 'binder-head' },
    el('h2', { class: 'binder-title', text: t.sheet }),
    el('p', { class: 'binder-for', text: `${t.preparedFor} ${card.alias ?? 'n/a'}` }),
    el('p', { class: 'binder-zone', text: `${t.zone}: ${card.zone ?? 'n/a'}` })));

  const tasks = [...card.tasks].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (!tasks.length) {
    sheet.append(el('p', { class: 'binder-empty', text: t.empty }));
  } else {
    const body = el('tbody');
    for (const task of tasks) {
      const [date = '', start = ''] = String(task.start).split('T');
      const [endDate, end = ''] = String(task.end).split('T');
      const day = date ? dayLabel(date, lang) : 'n/a';
      const range = end ? `${start} - ${end}` : start;
      body.append(el('tr', { class: 'binder-row' },
        el('td', {
          class: 'binder-day',
          text: date && endDate && endDate !== date ? `${day} / ${dayLabel(endDate, lang)}` : day,
        }),
        el('td', { class: 'binder-time', text: range }),
        el('td', { class: 'binder-task', text: roleText(task.role, lang) })));
    }
    sheet.append(el('table', { class: 'binder-tasks' },
      el('thead', {},
        el('tr', {},
          el('th', { scope: 'col', text: t.day }),
          el('th', { scope: 'col', text: t.time }),
          el('th', { scope: 'col', text: t.task }))),
      body));
  }

  const notes = (card.notes ?? []).map(key => noteText(key, lang)).filter(Boolean);
  if (notes.length) {
    sheet.append(el('h3', { class: 'binder-notes-head', text: t.notes }),
      el('ul', { class: 'binder-notes' },
        notes.map(text => el('li', { text }))));
  }
  sheet.append(el('p', { class: 'binder-warning', role: 'note', text: t.warning }));
  root.append(sheet);
}
