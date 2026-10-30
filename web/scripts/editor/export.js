import { NATIVE, esc, meta, post, toast, ui } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { tableVar } from '../tables/table-sizing.js';
import { TABLE_PADDINGS, tableTextLook } from '../tables/table-look.js';
import { HLKEY } from './highlight-key.js';
import { docHTML, saveDocNow } from './notes-document.js';
import { orderedRefs, refHTML, yearLabels } from '../citations/references.js';
import { citeWithPg } from '../citations/in-text-citations.js';
import { annColor, annList } from '../equations/equation-drawing.js';

/* ===== exporting the notes as a web page (Word opens it): equations as LaTeX, citations as text, a reference list ===== */
// prettier-ignore
const EXPORT_CSS =
  'body{font:11pt/1.6 Georgia,serif;max-width:7.3in;margin:.6in auto;color:#1a1f24}h1{font:700 22pt Arial,sans-serif}' +
  'h2{font:700 15pt Arial,sans-serif;text-transform:uppercase;text-align:center;margin:26pt 0 10pt}' +
  'h3{font:11pt Arial,sans-serif;margin:14pt 0 4pt}h4{font:700 12pt Arial,sans-serif}' +
  'h5{font:700 9pt Arial,sans-serif;text-transform:uppercase;color:#566069}table{border-collapse:collapse;width:100%}' +
  'td,th{border:.5pt solid #999;padding:3pt 5pt;vertical-align:top;text-align:left}mark{padding:0 1pt}' +
  'span[data-cite]{color:#6b35b5}th{background:#eef0f2}table[data-fixed]{table-layout:fixed}' +
  'table[data-ts=lines]{border-top:1.5pt solid #333;border-bottom:1.5pt solid #333}' +
  'table[data-ts=lines] td,table[data-ts=lines] th{border-left:0;border-right:0}' +
  'table[data-ts=lines] th,table[data-ts=minimal] th,table[data-ts=plain] th{background:none}' +
  'table[data-ts=accent] th{background:#3b5bdb;color:#fff}table[data-ts=soft] th{background:#eef2ff}' +
  'table[data-ts=minimal] td,table[data-ts=minimal] th,table[data-ts=plain] td,table[data-ts=plain] th{border:0}' +
  'table[data-ts=minimal] th{border-bottom:1pt solid #999}table[data-band] tr:nth-child(even)>td{background:#f3f4f6}' +
  'table[data-fcol] tr>:first-child{font-weight:700}td[data-shade="1"],th[data-shade="1"]{background:#fbd5d6}' +
  'td[data-shade="2"],th[data-shade="2"]{background:#fde0cc}td[data-shade="3"],th[data-shade="3"]{background:#fff1c4}' +
  'td[data-shade="4"],th[data-shade="4"]{background:#d3eedf}td[data-shade="5"],th[data-shade="5"]{background:#d1e9ff}' +
  'td[data-shade="6"],th[data-shade="6"]{background:#e8daf4}td[data-shade="7"],th[data-shade="7"]{background:#e5e7eb}';

export function exportHTML() {
  if (ui.view === 'notes') saveDocNow();
  const box = mk('div');
  box.innerHTML = docHTML || '';
  box.querySelectorAll('[data-imath]').forEach(exportInlineEquation);
  box.querySelectorAll('[data-math]').forEach(exportEquation);
  box.querySelectorAll('[data-cot]').forEach(title => (title.style.fontWeight = '700'));
  box.querySelectorAll('table').forEach(exportTable);
  const references = exportCitations(box);
  box.querySelectorAll('img').forEach(img => {
    const note = mk('em');
    note.textContent = '[image not exported]';
    img.replaceWith(note);
  });
  saveExport(exportPage(box.innerHTML + references));
}

function exportInlineEquation(equation) {
  const code = mk('code');
  code.textContent = '$' + (equation.getAttribute('data-imath') || '') + '$';
  equation.replaceWith(code);
}

/* a table's text size, spacing, cell room and row heights written out (Word doesn't read the page's variables) */
function exportTable(table) {
  const look = tableTextLook(table);
  const padding = (TABLE_PADDINGS.find(p => p[0] === look.padding) || TABLE_PADDINGS[1])[2];
  const rowHeight = tableVar(table, '--row-h');
  table.style.fontSize = look.size + 'px';
  if (look.spacing) table.style.lineHeight = look.spacing;
  table.querySelectorAll('td,th').forEach(cell => (cell.style.padding = padding));
  table.querySelectorAll('tr').forEach(row => {
    if (rowHeight && !row.style.height) row.style.height = rowHeight;
  });
  ['--tfs', '--tlh', '--row-h'].forEach(name => table.style.removeProperty(name));
}

/* an equation as its LaTeX, each explained part under it in its colour with its note */
function exportEquation(equation) {
  const line = mk('p');
  const code = mk('code');
  code.textContent = '$$ ' + (equation.getAttribute('data-math') || '') + ' $$';
  line.appendChild(code);
  annList(equation).forEach(note => {
    const row = mk('div');
    const part = mk('code');
    row.style.cssText = 'margin-left:2em;border-left:3px solid ' + annColor(note) + ';padding-left:8px';
    part.style.color = annColor(note);
    part.textContent = note.t;
    row.append(part, document.createTextNode(' — ' + (note.n || '')));
    line.appendChild(row);
  });
  equation.replaceWith(line);
}

/* citations written out; returns the reference list of the sources cited, in the Works Cited's order */
function exportCitations(box) {
  const labels = yearLabels();
  const cited = new Set();
  box.querySelectorAll('span[data-cite]').forEach(citation => {
    const ids = (citation.getAttribute('data-cite') || '').split(',').filter(Boolean);
    ids.forEach(id => cited.add(id));
    citation.textContent = ids.length
      ? citeWithPg(ids, citation.getAttribute('data-pg'), labels, citation.getAttribute('data-form')) ||
        '(missing source)'
      : '(citation needed)';
  });
  const list = orderedRefs().filter(r => cited.has(r.id));
  if (!list.length) return '';
  return (
    '<h2>Reference list</h2>' + list.map(r => `<p style="padding-left:2em;text-indent:-2em">${refHTML(r)}</p>`).join('')
  );
}

function exportPage(body) {
  const highlights = HLKEY.map(key => `mark[data-h="${key.id}"]{background:${key.hex}}`).join('');
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(meta.title)}</title>` +
    `<style>${EXPORT_CSS}${highlights}</style></head><body><h1>${esc(meta.title)}</h1>${body}</body></html>`
  );
}

function exportFilename() {
  return (
    (meta.title || 'notebook')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '.html'
  );
}

/* the Mac app saves it; on the web, it's offered as a download where the page can do that */
function saveExport(html) {
  if (NATIVE) {
    post({ type: 'export', html, filename: exportFilename() });
    return;
  }
  if (!(window.claude && claude.use)) {
    toast('Saving is not available here');
    return;
  }
  claude
    .use('downloads')
    .then(downloads => downloadExport(downloads, html))
    .catch(() => toast('Could not save'));
}

function downloadExport(downloads, html) {
  if (!downloads) {
    toast('Saving is not available here');
    return;
  }
  return downloads.save({ filename: exportFilename(), data: html }).then(
    () => toast('Saved'),
    err => {
      if (!err || err.code !== 'declined') toast('Could not save');
    }
  );
}
