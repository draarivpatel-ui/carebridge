export const ZONES = Object.freeze(['America/Chicago', 'UTC']);

export function parseWall(text) {
  const match = typeof text === 'string' && /^(20\d\d)-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(text);
  if (!match) throw new TypeError('Use a local YYYY-MM-DDTHH:mm between 2000 and 2099.');
  const [, y, m, d, h, min] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, h, min));
  if (date.toISOString().slice(0, 16) !== text) throw new RangeError('This local date or time does not exist.');
  return date.getTime();
}

export function wallLabel(weekStart, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 10080) throw new RangeError('Offset is outside the week.');
  return new Date(parseWall(`${weekStart}T00:00`) + offset * 60000).toISOString().slice(0, 16);
}

const formatters = new Map();

export function wallToUTC(text, zone) {
  const wall = parseWall(text);
  if (!ZONES.includes(zone)) throw new RangeError('Unsupported calendar zone.');
  if (zone === 'UTC') return new Date(wall);
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23',
    }));
  }
  function observed(instant) {
    const p = Object.fromEntries(formatters.get(zone).formatToParts(instant).map(({ type, value }) => [type, value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  // In these supported zones the adjacent days bracket each DST transition, if present.
  const offsets = new Set([-86400000, 0, 86400000].map(day => observed(wall + day) - wall - day));
  const candidates = [...offsets].map(offset => wall - offset).filter(instant => observed(instant) === wall);
  if (candidates.length !== 1) throw new RangeError('This wall time is skipped or ambiguous at a clock change.');
  return new Date(candidates[0]);
}
