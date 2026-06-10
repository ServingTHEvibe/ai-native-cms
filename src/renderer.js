'use strict';
const cheerio = require('cheerio');

/**
 * RENDER — design + content separation.
 * Takes the frozen template (structure) and a content map (slot values) and
 * produces the final HTML. The template is never mutated structurally; only
 * the values inside tagged slots are written.
 */
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function render(template, slots, content, opts = {}) {
  const $ = cheerio.load(template, { decodeEntities: false });
  const editable = Boolean(opts.editable);

  for (const [slotId, slot] of Object.entries(slots)) {
    const $el = $(`[data-slot-id="${slotId}"]`);
    if (!$el.length) continue;
    const value = content[slotId] || {};

    switch (slot.type) {
      case 'text':
        $el.text(value.text != null ? String(value.text) : '');
        break;
      case 'button': {
        const tag = ($el.get(0).tagName || '').toLowerCase();
        if (tag === 'input') $el.attr('value', value.text || '');
        else $el.text(value.text != null ? String(value.text) : '');
        break;
      }
      case 'link':
        if (value.href != null) $el.attr('href', String(value.href));
        if (slot.fields.includes('text') && value.text != null) $el.text(String(value.text));
        break;
      case 'image':
        if (value.src != null) $el.attr('src', String(value.src));
        if (value.alt != null) $el.attr('alt', String(value.alt));
        break;
      default:
        break;
    }

    if (editable) {
      $el.attr('data-slot-type', slot.type);
      $el.attr('data-slot-editable', 'true');
    }
  }

  if (editable) {
    // Inject helper styles/script so slots are clickable in the live preview.
    $('head').append(`<style>
      [data-slot-editable]{outline:1px dashed rgba(99,102,241,.0);transition:outline .12s;cursor:pointer}
      [data-slot-editable]:hover{outline:2px dashed #6366f1;outline-offset:2px}
      [data-slot-editable].cms-active{outline:2px solid #6366f1;outline-offset:2px}
    </style>`);
  }

  return $.html();
}

/** Strip editor-only attributes for a clean published page. */
function renderClean(template, slots, content) {
  const $ = cheerio.load(render(template, slots, content, { editable: false }), { decodeEntities: false });
  $('[data-slot-id]').each((_, el) => {
    $(el).removeAttr('data-slot-id').removeAttr('data-slot-type').removeAttr('data-slot-editable');
  });
  return $.html();
}

module.exports = { render, renderClean, escapeText };
