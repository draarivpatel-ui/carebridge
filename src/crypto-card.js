import { CAREGIVER_ALIASES, NOTES, ROLES } from './presets.js';
import { wallToUTC, ZONES } from './clock.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const aad = encoder.encode('CareBridge handoff card v1');
const maxText = 3840;
const expectedTasks = 18;

function exactKeys(record, keys) {
  return record && typeof record === 'object' && !Array.isArray(record) &&
    Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key));
}

function validate(card) {
  if (!exactKeys(card, ['v', 'alias', 'zone', 'tasks', 'notes']) || card.v !== 1 ||
      !CAREGIVER_ALIASES.includes(card.alias) || !ZONES.includes(card.zone) ||
      !Array.isArray(card.tasks) || card.tasks.length > expectedTasks ||
      !Array.isArray(card.notes) || card.notes.length > Object.keys(NOTES).length ||
      new Set(card.notes).size !== card.notes.length || [...card.notes].some(key => typeof key !== 'string' || !Object.hasOwn(NOTES, key))) {
    throw new TypeError('Not a valid synthetic caregiver card.');
  }
  for (const task of card.tasks) {
    if (!exactKeys(task, ['role', 'start', 'end']) || typeof task.role !== 'string' || !Object.hasOwn(ROLES, task.role) ||
        wallToUTC(task.start, card.zone) >= wallToUTC(task.end, card.zone)) {
      throw new TypeError('Not a valid synthetic handoff shift.');
    }
  }
  return {
    v: 1, alias: card.alias, zone: card.zone,
    tasks: card.tasks.map(({ role, start, end }) => ({ role, start, end })), notes: [...card.notes],
  };
}

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(text) {
  const raw = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  const value = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (encode(value) !== text) throw new TypeError('Non-canonical link encoding.');
  return value;
}

function cryptoAPI() {
  if (!globalThis.crypto?.subtle) throw new Error('Secure local handoff requires HTTPS or localhost.');
  return globalThis.crypto;
}

export async function sealCard(card) {
  const safe = validate(card);
  const message = encoder.encode(JSON.stringify(safe));
  if (message.length > maxText) throw new RangeError('Handoff is too large.');
  const api = cryptoAPI();
  const key = await api.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = api.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await api.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: aad, tagLength: 128,
  }, key, message));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv);
  packed.set(cipher, iv.length);
  return `#handoff=${encode(packed)}&k=${encode(new Uint8Array(await api.subtle.exportKey('raw', key)))}`;
}

export async function openCard(fragment) {
  const api = cryptoAPI();
  try {
    const match = typeof fragment === 'string' && fragment.length <= 5400 &&
      /^#handoff=([A-Za-z0-9_-]{39,5158})&k=([A-Za-z0-9_-]{43})$/.exec(fragment);
    if (!match || match[0] !== fragment) throw new TypeError();
    const packed = decode(match[1]);
    const raw = decode(match[2]);
    if (packed.length < 29 || packed.length > 28 + maxText || raw.length !== 32) throw new TypeError();
    const key = await api.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await api.subtle.decrypt({
      name: 'AES-GCM', iv: packed.subarray(0, 12), additionalData: aad, tagLength: 128,
    }, key, packed.subarray(12));
    return validate(JSON.parse(decoder.decode(plain)));
  } catch {
    throw new Error('This handoff link is invalid or has been changed.');
  }
}
