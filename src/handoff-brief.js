// Signed handoff briefs: every export carries a SHA-256 digest made in plain
// JavaScript, and a brief can be replayed in the page to prove it was not
// changed. JSON signs its canonical serialization; CSV and Markdown sign the
// exact bytes of the body so any one-character edit breaks the check.

import { canonicalJSON, makeCSV } from './exports.js';
import { sha256hex } from './digest.js';
import { PRESETS } from './presets.js';
import { CLASSES } from './interactions.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const HEX = /^[a-f0-9]{64}$/;

export function signJSON(payload) {
  const text = canonicalJSON(payload);
  if (text === undefined) throw new TypeError('The brief needs a JSON value.');
  return { algorithm: 'SHA-256', sha256: sha256hex(encoder.encode(text)), payload: JSON.parse(text) };
}

export function signedJSONText(payload) {
  return JSON.stringify(signJSON(payload), null, 2) + '\n';
}

const SIG_MARK = 'carebridge-sha256';

export function signedCSV(rows) {
  const body = makeCSV(rows);
  const digest = sha256hex(encoder.encode(body));
  const columns = rows[0]?.length ?? 1;
  const sig = [SIG_MARK, digest, ...Array.from({ length: Math.max(0, columns - 2) }, () => '')];
  return body + makeCSV([sig]);
}

const MD_TAIL = /\n\nsha256: ([a-f0-9]{64})\n$/;
const CSV_TAIL = /"carebridge-sha256","([a-f0-9]{64})"(?:,"")*\r\n$/;

export function signedMarkdown(body) {
  if (typeof body !== 'string' || !body.length || body.length > 40000 ||
      !body.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body) ||
      /\n\nsha256: [a-f0-9]{64}\n?$/.test(body)) {
    throw new TypeError('Invalid Markdown body.');
  }
  return `${body}\n\nsha256: ${sha256hex(encoder.encode(body))}\n`;
}

// Replay a signed brief. Returns the detected format, whether the digest
// matches, and the digests compared; it never throws on malformed input.
export function verifySigned(text) {
  const none = { ok: false, format: 'unknown', digest: null, expected: null };
  if (typeof text !== 'string' || !text.isWellFormed() || text.length > 200000) return none;
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed.startsWith('{')) {
    let bundle;
    try { bundle = JSON.parse(trimmed); } catch { return { ...none, format: 'json' }; }
    if (!bundle || bundle.algorithm !== 'SHA-256' || !HEX.test(bundle.sha256 ?? '') ||
        !Object.hasOwn(bundle, 'payload')) {
      return { ...none, format: 'json' };
    }
    let canonical;
    try { canonical = canonicalJSON(bundle.payload); } catch { return { ...none, format: 'json' }; }
    const digest = sha256hex(encoder.encode(canonical));
    return { ok: digest === bundle.sha256, format: 'json', digest, expected: bundle.sha256 };
  }
  const md = MD_TAIL.exec(text);
  if (md) {
    const body = text.slice(0, md.index);
    const digest = sha256hex(encoder.encode(body));
    return { ok: digest === md[1], format: 'markdown', digest, expected: md[1] };
  }
  const csv = CSV_TAIL.exec(text);
  if (csv) {
    const body = text.slice(0, csv.index);
    if (!body.endsWith('\r\n')) return { ...none, format: 'csv' };
    const digest = sha256hex(encoder.encode(body));
    return { ok: digest === csv[1], format: 'csv', digest, expected: csv[1] };
  }
  return none;
}

/* ---------------- setup bookmarks (#care=) ---------------- */

const MAX_MEDS = 36;
const MAX_REFILLS = 12;
const LANGS = ['en', 'es'];

const encodeBytes = bytes =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

function decodeBytes(text) {
  const raw = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  const value = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (encodeBytes(value) !== text) throw new TypeError('Non-canonical bookmark encoding.');
  return value;
}

const inDay = n => Number.isInteger(n) && n >= 0 && n < 1440;

export function validateBookmark(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.v !== 1 ||
      typeof input.scenario !== 'string') {
    throw new TypeError('Not a valid setup bookmark.');
  }
  const preset = PRESETS.find(p => p.id === input.scenario);
  if (!preset) throw new TypeError('Unknown scenario in bookmark.');
  const ids = new Set(preset.caregivers.map(c => c.id));
  const dropped = input.dropped ?? [];
  const meds = input.meds ?? [];
  const refills = input.refills ?? [];
  const ctx = input.medCtx ?? {};
  if (!Array.isArray(dropped) || dropped.length > 6 ||
      [...dropped].some(id => typeof id !== 'string' || !ids.has(id)) ||
      !Array.isArray(meds) || meds.length > MAX_MEDS ||
      [...meds].some(e => !e || typeof e.item !== 'string' || !Object.hasOwn(CLASSES, e.item) ||
        !inDay(e.at) || !['planned', 'logged'].includes(e.status)) ||
      !Array.isArray(refills) || refills.length > MAX_REFILLS ||
      [...refills].some(r => !r || typeof r.item !== 'string' || !Object.hasOwn(CLASSES, r.item) ||
        !Number.isInteger(r.onHand) || r.onHand < 0 || r.onHand > 99999 ||
        !Number.isInteger(r.perDay) || r.perDay < 1 || r.perDay > 24) ||
      ['riskWindow', 'lowPlatelets', 'bleedingRisk', 'anticoagulant'].some(k =>
        ctx[k] != null && typeof ctx[k] !== 'boolean') ||
      (ctx.temperatureAt != null && !inDay(ctx.temperatureAt)) ||
      (input.person != null && !ids.has(input.person)) ||
      (input.lang != null && !LANGS.includes(input.lang))) {
    throw new TypeError('Bookmark fields are outside the demo limits.');
  }
  return {
    v: 1,
    scenario: preset.id,
    dropped: [...dropped],
    meds: meds.map(({ item, at, status }) => ({ item, at, status })),
    medCtx: {
      riskWindow: !!ctx.riskWindow,
      lowPlatelets: !!ctx.lowPlatelets,
      bleedingRisk: !!ctx.bleedingRisk,
      anticoagulant: !!ctx.anticoagulant,
      temperatureAt: ctx.temperatureAt ?? null,
    },
    refills: refills.map(({ item, onHand, perDay }) => ({ item, onHand, perDay })),
    person: input.person ?? null,
    lang: input.lang ?? 'en',
  };
}

export function encodeBookmark(state) {
  const safe = validateBookmark(state);
  return `#care=${encodeBytes(encoder.encode(canonicalJSON(safe)))}`;
}

export function decodeBookmark(hash) {
  const match = typeof hash === 'string' && hash.length <= 6400 &&
    /^#care=([A-Za-z0-9_-]{8,6300})$/.exec(hash);
  if (!match || match[0] !== hash) throw new TypeError('This setup link is invalid or has been changed.');
  let value;
  try {
    value = JSON.parse(decoder.decode(decodeBytes(match[1])));
  } catch {
    throw new TypeError('This setup link is invalid or has been changed.');
  }
  return validateBookmark(value);
}
