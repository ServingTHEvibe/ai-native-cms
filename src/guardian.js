'use strict';

/**
 * THE GUARDIAN
 * A deterministic, NO-AI validator. Every proposed change — whether typed by a
 * human in the inline editor or produced by the AI chat — must pass through here
 * before it is applied. It rejects anything malformed, anything that targets an
 * unknown slot, and anything that removes or empties a structural section.
 *
 * validate(slots, currentContent, proposedChanges) -> {
 *   ok: boolean,
 *   errors: [{ slotId, message }],
 *   content: mergedSanitizedContent   // only present when ok
 * }
 */

const MAX_TEXT = 20000;
const SAFE_LINK_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function hasControlChars(s) {
  // Disallow control chars except tab/newline/carriage-return.
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);
}

function checkSafeUrl(url, { allowDataImage = false } = {}) {
  const v = String(url).trim();
  if (v === '') return { ok: true, value: v }; // emptiness handled by structural rules
  if (v.startsWith('#') || v.startsWith('/') || v.startsWith('./') || v.startsWith('../')) {
    return { ok: true, value: v }; // relative / anchor
  }
  let parsed;
  try { parsed = new URL(v); } catch (_) {
    // Could be a relative path without a leading slash, e.g. "about.html"
    if (/^[\w.\-]+(\/[\w.\-]*)*$/.test(v)) return { ok: true, value: v };
    return { ok: false, message: 'Malformed URL' };
  }
  const scheme = parsed.protocol.toLowerCase();
  if (allowDataImage && scheme === 'data:' && /^data:image\//i.test(v)) {
    return { ok: true, value: v };
  }
  if (!SAFE_LINK_SCHEMES.includes(scheme)) {
    return { ok: false, message: `Unsafe or disallowed URL scheme: ${scheme}` };
  }
  return { ok: true, value: v };
}

function validateText(value, errors, slotId) {
  if (!isPlainObject(value) || typeof value.text !== 'string') {
    errors.push({ slotId, message: 'Text slot requires { text: string }' });
    return null;
  }
  if (value.text.length > MAX_TEXT) {
    errors.push({ slotId, message: 'Text exceeds maximum length' });
    return null;
  }
  if (hasControlChars(value.text)) {
    errors.push({ slotId, message: 'Text contains disallowed control characters' });
    return null;
  }
  return { text: value.text };
}

function validateButton(value, errors, slotId) {
  if (!isPlainObject(value) || typeof value.text !== 'string') {
    errors.push({ slotId, message: 'Button slot requires { text: string }' });
    return null;
  }
  if (value.text.length > 300 || hasControlChars(value.text)) {
    errors.push({ slotId, message: 'Invalid button text' });
    return null;
  }
  return { text: value.text };
}

function validateLink(value, slot, current, errors, slotId) {
  if (!isPlainObject(value)) {
    errors.push({ slotId, message: 'Link slot requires an object' });
    return null;
  }
  const out = {};
  if (slot.fields.includes('text')) {
    const text = value.text != null ? value.text : (current.text || '');
    if (typeof text !== 'string' || text.length > 500 || hasControlChars(text)) {
      errors.push({ slotId, message: 'Invalid link text' });
      return null;
    }
    out.text = text;
  }
  const href = value.href != null ? value.href : current.href;
  const safe = checkSafeUrl(href || '');
  if (!safe.ok) {
    errors.push({ slotId, message: `Link href rejected: ${safe.message}` });
    return null;
  }
  out.href = safe.value;
  return out;
}

function validateImage(value, current, errors, slotId) {
  if (!isPlainObject(value)) {
    errors.push({ slotId, message: 'Image slot requires an object' });
    return null;
  }
  const src = value.src != null ? value.src : current.src;
  const safe = checkSafeUrl(src || '', { allowDataImage: true });
  if (!safe.ok) {
    errors.push({ slotId, message: `Image src rejected: ${safe.message}` });
    return null;
  }
  const alt = value.alt != null ? value.alt : (current.alt || '');
  if (typeof alt !== 'string' || alt.length > 500 || hasControlChars(alt)) {
    errors.push({ slotId, message: 'Invalid image alt text' });
    return null;
  }
  return { src: safe.value, alt };
}

function validate(slots, currentContent, proposedChanges) {
  const errors = [];

  if (!isPlainObject(proposedChanges)) {
    return { ok: false, errors: [{ slotId: null, message: 'Proposed change must be an object of slotId -> value' }] };
  }

  const merged = { ...currentContent };

  for (const [slotId, value] of Object.entries(proposedChanges)) {
    const slot = slots[slotId];
    if (!slot) {
      errors.push({ slotId, message: 'Unknown slot id — refusing to invent new structure' });
      continue;
    }
    const current = currentContent[slotId] || {};
    let sanitized = null;
    switch (slot.type) {
      case 'text': sanitized = validateText(value, errors, slotId); break;
      case 'button': sanitized = validateButton(value, errors, slotId); break;
      case 'link': sanitized = validateLink(value, slot, current, errors, slotId); break;
      case 'image': sanitized = validateImage(value, current, errors, slotId); break;
      default: errors.push({ slotId, message: `Unknown slot type: ${slot.type}` });
    }
    if (sanitized) merged[slotId] = sanitized;
  }

  // Structural protection — no structural section may be removed or emptied.
  for (const [slotId, slot] of Object.entries(slots)) {
    if (!slot.structural) continue;
    const v = merged[slotId];
    if (v == null) {
      errors.push({ slotId, message: 'A structural section cannot be removed' });
      continue;
    }
    if (slot.type === 'text' && (!v.text || !v.text.trim())) {
      errors.push({ slotId, message: 'A structural heading cannot be left empty' });
    }
    if (slot.type === 'image' && (!v.src || !String(v.src).trim())) {
      errors.push({ slotId, message: 'A structural image cannot be removed' });
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], content: merged };
}

module.exports = { validate, checkSafeUrl };
