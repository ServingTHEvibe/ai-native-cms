'use strict';
const cheerio = require('cheerio');

/**
 * INGEST
 * Given raw HTML, parse it and auto-tag every editable piece (text, image,
 * button, link) as a content slot with a STABLE id. Everything else (layout,
 * structure, classes, scripts, styles) becomes part of the FROZEN template.
 *
 * Output:
 *   {
 *     template: '<html ... data-slot-id="...">',   // structure, frozen
 *     slots: { [slotId]: { type, label, structural, fields } },
 *     content: { [slotId]: value }                  // editable values only
 *   }
 *
 * Stable ids: a per-type running index assigned in document order. Re-ingesting
 * the same page produces the same ids as long as the structure is unchanged.
 */

const TEXT_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'span', 'td', 'th',
  'figcaption', 'blockquote', 'small', 'strong', 'em', 'label', 'summary',
  'cite', 'dt', 'dd', 'caption', 'b', 'i', 'time', 'div',
]);

const STRUCTURAL_TEXT_TAGS = new Set(['h1', 'h2', 'h3']);

function cleanText(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

function ingestHtml(html, sourceUrl = '') {
  const $ = cheerio.load(html, { decodeEntities: false });
  const slots = {};
  const content = {};
  const counters = {};

  function nextId(type) {
    counters[type] = (counters[type] || 0) + 1;
    return `${type}-${counters[type]}`;
  }

  function shortLabel(s) {
    const t = cleanText(s);
    return t.length > 48 ? t.slice(0, 45) + '…' : t;
  }

  // 1) Images
  $('img').each((_, el) => {
    const $el = $(el);
    if ($el.attr('data-slot-id')) return;
    const id = nextId('img');
    $el.attr('data-slot-id', id);
    const src = $el.attr('src') || '';
    const alt = $el.attr('alt') || '';
    slots[id] = {
      type: 'image',
      label: alt ? shortLabel(alt) : 'Image',
      structural: true, // an image disappearing usually breaks the layout
      fields: ['src', 'alt'],
    };
    content[id] = { src, alt };
  });

  // 2) Buttons (real buttons + button-like inputs + role=button)
  $('button, [role="button"], input[type="submit"], input[type="button"]').each((_, el) => {
    const $el = $(el);
    if ($el.attr('data-slot-id')) return;
    const id = nextId('btn');
    $el.attr('data-slot-id', id);
    const tag = (el.tagName || el.name || '').toLowerCase();
    let text;
    if (tag === 'input') text = $el.attr('value') || '';
    else text = cleanText($el.text());
    slots[id] = {
      type: 'button',
      label: shortLabel(text) || 'Button',
      structural: false,
      fields: ['text'],
    };
    content[id] = { text };
  });

  // 3) Links (anchors with an href). Capture href + visible text when the
  //    anchor's text is its own (no nested element children other than inline).
  $('a[href]').each((_, el) => {
    const $el = $(el);
    if ($el.attr('data-slot-id')) return;
    const href = $el.attr('href') || '';
    const hasElementChildren = $el.children().length > 0;
    const id = nextId('link');
    $el.attr('data-slot-id', id);
    const text = hasElementChildren ? null : cleanText($el.text());
    slots[id] = {
      type: 'link',
      label: shortLabel(text || href) || 'Link',
      structural: false,
      // If the anchor wraps other elements, only the href is editable.
      fields: text === null ? ['href'] : ['text', 'href'],
    };
    content[id] = text === null ? { href } : { text, href };
  });

  // 4) Text — leaf elements whose content is plain text only.
  $('*').each((_, el) => {
    const $el = $(el);
    if ($el.attr('data-slot-id')) return;
    const tag = (el.tagName || el.name || '').toLowerCase();
    if (!TEXT_TAGS.has(tag)) return;
    if ($el.children().length > 0) return; // not a leaf — keep structure frozen
    const text = cleanText($el.text());
    if (!text) return;
    const id = nextId('text');
    $el.attr('data-slot-id', id);
    slots[id] = {
      type: 'text',
      label: shortLabel(text),
      structural: STRUCTURAL_TEXT_TAGS.has(tag),
      fields: ['text'],
    };
    content[id] = { text };
  });

  const template = $.html();
  const meta = {
    sourceUrl,
    title: cleanText($('title').first().text()) || sourceUrl || 'Untitled',
    slotCount: Object.keys(slots).length,
  };

  return { template, slots, content, meta };
}

/**
 * Fetch a URL and ingest it. Resolves relative asset/link URLs to absolute so
 * the captured page still renders standalone.
 */
async function ingestUrl(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AI-CMS-Ingest/1.0 (+https://example.com)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  let html = await res.text();
  html = absolutizeAssets(html, url);
  return ingestHtml(html, url);
}

/**
 * Rewrite relative src/href and inject a <base> so styles/images load when the
 * captured page is served from our editor or a different host.
 */
function absolutizeAssets(html, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const attrs = [['img', 'src'], ['script', 'src'], ['link', 'href'], ['source', 'src']];
  for (const [sel, attr] of attrs) {
    $(sel).each((_, el) => {
      const v = $(el).attr(attr);
      if (!v) return;
      try { $(el).attr(attr, new URL(v, baseUrl).href); } catch (_) { /* ignore */ }
    });
  }
  // Anchors -> absolute too (keeps navigation working in preview).
  $('a[href]').each((_, el) => {
    const v = $(el).attr('href');
    if (!v || v.startsWith('#')) return;
    try { $(el).attr('href', new URL(v, baseUrl).href); } catch (_) { /* ignore */ }
  });
  return $.html();
}

module.exports = { ingestHtml, ingestUrl, absolutizeAssets, TEXT_TAGS, STRUCTURAL_TEXT_TAGS };
