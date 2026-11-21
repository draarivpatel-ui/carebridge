import { wallToUTC, ZONES } from './clock.js';

const encoder = new TextEncoder();
const forbiddenText = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u;
const escapeText = value => {
  if (typeof value !== 'string' || forbiddenText.test(value) || !value.isWellFormed()) {
    throw new TypeError('Invalid calendar text.');
  }
  return value.replaceAll('\\', '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/[;,]/g, '\\$&');
};
const stampText = date => date.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
const idOK = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id) && id.trim() === id;

function fold(line) {
  let count = 0;
  let output = '';
  for (const ch of line) {
    const width = encoder.encode(ch).length;
    if (count + width > 75) {
      output += '\r\n ';
      count = 1;
    }
    output += ch;
    count += width;
  }
  return output;
}

export function makeCalendar(events, { zone, stamp = new Date() } = {}) {
  if (!Array.isArray(events) || !events.length || events.length > 18 || !ZONES.includes(zone) || !(stamp instanceof Date) ||
      !Number.isFinite(stamp.getTime()) || stamp.getUTCFullYear() < 2000 || stamp.getUTCFullYear() > 2099) {
    throw new TypeError('Invalid calendar options.');
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CareBridge//Synthetic Week//EN', 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    if (!idOK(event?.id)) throw new TypeError('Invalid calendar event ID.');
    const start = wallToUTC(event.start, zone);
    const end = wallToUTC(event.end, zone);
    if (end <= start) throw new RangeError('Shift end must follow its start.');
    lines.push('BEGIN:VEVENT', `UID:${event.id}@carebridge.invalid`, `DTSTAMP:${stampText(stamp)}`,
      `DTSTART:${stampText(start)}`, `DTEND:${stampText(end)}`, `SUMMARY:${escapeText(event.title)}`,
      `DESCRIPTION:${escapeText(event.description ?? '')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const result = lines.map(fold).join('\r\n') + '\r\n';
  if (!validateCalendar(result)) throw new TypeError('Calendar failed structural validation.');
  return result;
}

function calendarInstant(s) {
  const m = /^(20\d\d)(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(s);
  if (!m || +m[6] > 59) return false;
  try {
    wallToUTC(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, 'UTC');
    return true;
  } catch { return false; }
}

// Validate the emitted RFC 5545 subset, not general third-party calendars.
export function validateCalendar(text) {
  if (typeof text !== 'string' || text.length > 100000 || !text.endsWith('\r\n') || !text.isWellFormed() ||
      forbiddenText.test(text) || /(?:^|\r\n)[ \t](?=\r\n)/.test(text)) return false;
  const physical = text.slice(0, -2).split('\r\n');
  if (physical.some(line => !line.length || /[\r\n]/.test(line) || encoder.encode(line).length > 75)) return false;
  const lines = text.slice(0, -2).replace(/\r\n[ \t]/g, '').split('\r\n');
  const header = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CareBridge//Synthetic Week//EN', 'CALSCALE:GREGORIAN'];
  if (lines.length < 13 || !header.every((value, i) => lines[i] === value) || lines.at(-1) !== 'END:VCALENDAR' ||
      (lines.length - 5) % 8 !== 0) return false;
  const uids = new Set();
  const textValue = /^(?:[^\\;,\r\n\t]|[\t]|\\[\\;,nN])*$/u;
  for (let i = 4; i < lines.length - 1; i += 8) {
    const [start, uid, stamp, from, to, summary, detail, end] = lines.slice(i, i + 8);
    if (start !== 'BEGIN:VEVENT' || end !== 'END:VEVENT' ||
        !/^UID:[a-zA-Z0-9-]{1,80}@carebridge\.invalid$/.test(uid) || uids.has(uid) ||
        !stamp.startsWith('DTSTAMP:') || !calendarInstant(stamp.slice(8)) ||
        !from.startsWith('DTSTART:') || !calendarInstant(from.slice(8)) ||
        !to.startsWith('DTEND:') || !calendarInstant(to.slice(6)) || from.slice(8) >= to.slice(6) ||
        !summary.startsWith('SUMMARY:') || !textValue.test(summary.slice(8)) ||
        !detail.startsWith('DESCRIPTION:') || !textValue.test(detail.slice(12))) return false;
    uids.add(uid);
  }
  return true;
}

export function makeCSV(rows) {
  if (!Array.isArray(rows) || ![...rows].every(Array.isArray)) throw new TypeError('CSV requires rows.');
  if (!rows.length) return '';
  const columnCount = rows[0].length;
  if (!columnCount || rows.some(row => row.length !== columnCount)) throw new TypeError('CSV needs a consistent column count.');
  return rows.map(row => Array.from(row, item => {
    let text = String(item ?? '');
    // Protect text cells even when spreadsheets strip leading whitespace or format controls.
    if (typeof item !== 'number' && (/^[\s\p{Cf}\p{Cc}]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}

const unboxers = [
  [Number.prototype.valueOf, value => +value],
  [String.prototype.valueOf, String],
  [Boolean.prototype.valueOf, (_, primitive) => primitive],
  [BigInt.prototype.valueOf, (_, primitive) => primitive],
];

export function canonicalJSON(input) {
  const active = new Set();
  function stringify(holder, key) {
    let value = holder[key];
    if (value !== null && (typeof value === 'object' || typeof value === 'function' || typeof value === 'bigint')) {
      const toJSON = value.toJSON;
      if (typeof toJSON === 'function') value = Reflect.apply(toJSON, value, [key]);
    }
    if (value !== null && typeof value === 'object') {
      for (const [valueOf, coerce] of unboxers) {
        let primitive;
        try { primitive = Reflect.apply(valueOf, value, []); }
        catch { continue; }
        value = coerce(value, primitive);
        break;
      }
    }
    if (typeof value === 'bigint') throw new TypeError('BigInt cannot be serialized to JSON.');
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (active.has(value)) throw new TypeError('Circular structure cannot be serialized to JSON.');
    active.add(value);
    let result;
    if (Array.isArray(value)) {
      const items = [];
      const length = value.length;
      for (let i = 0; i < length; i++) items.push(stringify(value, String(i)) ?? 'null');
      result = `[${items.join(',')}]`;
    } else {
      const props = [];
      for (const k of Object.keys(value).sort()) {
        const serialized = stringify(value, k);
        if (serialized !== undefined) props.push(`${JSON.stringify(k)}:${serialized}`);
      }
      result = `{${props.join(',')}}`;
    }
    active.delete(value);
    return result;
  }
  return stringify({ '': input }, '');
}

export async function createAuditBundle(input) {
  const text = canonicalJSON(input);
  if (text === undefined) throw new TypeError('Audit bundle requires a JSON value.');
  if (!globalThis.crypto?.subtle) throw new Error('Audit export requires HTTPS or localhost.');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text)));
  const sha256 = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { algorithm: 'SHA-256', sha256, payload: JSON.parse(text) };
}
