'use strict';
/* Minimal, no-network smoke tests for the core engine. */
const assert = require('assert');
const { ingestHtml } = require('../src/ingest');
const guardian = require('../src/guardian');
const { renderClean } = require('../src/renderer');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ✓', name); }

const HTML = `<!doctype html><html><head><title>Demo</title></head>
<body>
  <header><h1>Welcome to Acme</h1><a href="/pricing">Pricing</a></header>
  <main>
    <p>We build great things.</p>
    <img src="/logo.png" alt="Acme logo">
    <button>Get started</button>
    <a href="https://x.com/acme"><img src="/x.png" alt="x"></a>
  </main>
</body></html>`;

console.log('Ingest:');
const ing = ingestHtml(HTML, 'https://acme.test');
ok('tags text/image/button/link slots', () => {
  const types = Object.values(ing.slots).map((s) => s.type).sort();
  assert(types.includes('text') && types.includes('image') && types.includes('button') && types.includes('link'));
});
ok('h1 is structural', () => {
  const h1 = Object.entries(ing.slots).find(([, s]) => s.type === 'text' && s.structural);
  assert(h1, 'expected a structural heading');
});
ok('stable ids on re-ingest', () => {
  const again = ingestHtml(HTML, 'https://acme.test');
  assert.deepStrictEqual(Object.keys(ing.slots), Object.keys(again.slots));
});

console.log('\nGuardian:');
const slots = ing.slots, content = ing.content;
const textSlot = Object.keys(slots).find((k) => slots[k].type === 'text' && !slots[k].structural);
const headingSlot = Object.keys(slots).find((k) => slots[k].structural && slots[k].type === 'text');
const linkSlot = Object.keys(slots).find((k) => slots[k].type === 'link' && slots[k].fields.includes('href'));

ok('accepts a valid text edit', () => {
  const v = guardian.validate(slots, content, { [textSlot]: { text: 'New copy' } });
  assert(v.ok, JSON.stringify(v.errors));
});
ok('rejects unknown slot id', () => {
  const v = guardian.validate(slots, content, { 'nope-99': { text: 'x' } });
  assert(!v.ok);
});
ok('rejects emptying a structural heading', () => {
  const v = guardian.validate(slots, content, { [headingSlot]: { text: '   ' } });
  assert(!v.ok);
});
ok('rejects javascript: link href', () => {
  const v = guardian.validate(slots, content, { [linkSlot]: { href: 'javascript:alert(1)' } });
  assert(!v.ok);
});
ok('accepts a safe relative href', () => {
  const v = guardian.validate(slots, content, { [linkSlot]: { href: '/contact' } });
  assert(v.ok, JSON.stringify(v.errors));
});

console.log('\nRender:');
ok('renders content into frozen template', () => {
  const merged = guardian.validate(slots, content, { [textSlot]: { text: 'Rendered line' } });
  const html = renderClean(ing.template, slots, merged.content);
  assert(html.includes('Rendered line'));
  assert(!html.includes('data-slot-id'), 'published HTML must be clean');
});

console.log(`\nAll ${passed} checks passed.`);
