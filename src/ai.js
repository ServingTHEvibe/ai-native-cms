'use strict';
const config = require('./config');

/**
 * AI CHAT (optional)
 * Turns a plain-English request into a STRUCTURED slot change. The model is only
 * ever allowed to propose values for slots that already exist — it can never add
 * structure. Whatever it returns is then handed to the Guardian for validation,
 * so a bad or unsafe suggestion is rejected exactly like a manual edit would be.
 *
 * Supports two providers, chosen by whichever key is configured:
 *   - Anthropic   (ANTHROPIC_API_KEY)
 *   - OpenRouter  (OPENROUTER_API_KEY)
 */

function buildSlotDigest(slots, content) {
  // Compact catalogue the model can reason over.
  const lines = [];
  for (const [id, slot] of Object.entries(slots)) {
    const cur = content[id] || {};
    let val;
    if (slot.type === 'image') val = `src=${cur.src || ''} alt=${cur.alt || ''}`;
    else if (slot.type === 'link') val = `text=${cur.text || ''} href=${cur.href || ''}`;
    else val = cur.text || '';
    lines.push(`${id} [${slot.type}${slot.structural ? ',structural' : ''}] :: ${val}`);
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You edit website content. You are given a catalogue of editable "slots" with ids, types, and current values. The user asks for a change in plain English.
Return ONLY a JSON object of the form {"changes": { "<slotId>": <value> }, "note": "<short human summary>"}.
Value shapes by slot type:
- text:   {"text": "..."}
- button: {"text": "..."}
- link:   {"text": "...", "href": "..."}   (omit "text" if the slot has no editable text)
- image:  {"src": "...", "alt": "..."}
Rules:
- Only use slot ids that exist in the catalogue. Never invent ids.
- Never empty a slot marked "structural".
- Change as few slots as needed. If nothing matches, return {"changes": {}, "note": "..."}.
- Output JSON only. No prose, no code fences.`;

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; }
}

async function callAnthropic(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map((b) => b.text || '').join('');
}

async function callOpenRouter(messages) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.openrouterKey}`,
    },
    body: JSON.stringify({
      model: config.openrouterModel,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Returns { changes, note, provider }. Throws if no provider configured.
 */
async function proposeChanges(message, slots, content) {
  if (!config.aiEnabled) {
    const err = new Error('AI chat is not configured. Add an ANTHROPIC_API_KEY or OPENROUTER_API_KEY.');
    err.code = 'AI_DISABLED';
    throw err;
  }
  const userMsg = {
    role: 'user',
    content: `Editable slot catalogue:\n${buildSlotDigest(slots, content)}\n\nRequest: ${message}`,
  };
  const provider = config.anthropicKey ? 'anthropic' : 'openrouter';
  const raw = provider === 'anthropic'
    ? await callAnthropic([userMsg])
    : await callOpenRouter([userMsg]);
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.changes) {
    throw new Error('AI did not return a usable change set.');
  }
  return { changes: parsed.changes || {}, note: parsed.note || '', provider };
}

module.exports = { proposeChanges, buildSlotDigest };
