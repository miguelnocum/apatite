/* ===== choosing the spec point for the blocks just marked ===== */
const PICKER_MARGIN = 12; // px the picker keeps from the window's edges
let spPick = null;

function closeSpPick() {
  if (spPick) {
    spPick.remove();
    spPick = null;
  }
  const bracket = $('sptemp');
  if (bracket) bracket.remove();
  const box = $('sptempbox');
  if (box) box.remove();
}

/* a search box, the points that match (by section, arrow keys to move), and untag / cancel */
class SpecPointPicker {
  constructor(range) {
    this.range = range;
    const el = mk('div');
    el.className = 'tagpop sppick';
    el.range = range;
    el.q = '';
    el.active = 0;
    el.innerHTML = SpecPointPicker.html(range);
    this.el = el;
  }

  static html(range) {
    const tagged = range.some(block => block.hasAttribute('data-sp'));
    return (
      `<h5>Tag ${range.length} block${range.length === 1 ? '' : 's'} with</h5>` +
      '<input type="text" placeholder="Find a spec point" aria-label="Find a spec point"><div class="tp-list"></div>' +
      `<div class="tp-row">${tagged ? '<button data-spclear class="del">Untag these</button>' : '<span></span>'}` +
      '<button data-spcancel>Cancel</button></div>'
    );
  }

  matches() {
    const query = this.el.q.toLowerCase().trim();
    return pts.filter(
      point => !query || ((point.code || '') + ' ' + point.text + ' ' + point.sec).toLowerCase().indexOf(query) >= 0
    );
  }

  draw() {
    const points = this.matches();
    if (this.el.active >= points.length) this.el.active = Math.max(0, points.length - 1);
    let section = null;
    const html = points.map((point, i) => {
      const heading = point.sec !== section ? `<div class="spg">${esc(point.sec || 'Untitled section')}</div>` : '';
      section = point.sec;
      return heading + this.pointHTML(point, i);
    });
    this.el.querySelector('.tp-list').innerHTML = html.join('') || '<p class="spnone">No matching points</p>';
    const active = this.el.querySelector('.tp-list .on');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  pointHTML(point, i) {
    const className = (i === this.el.active ? 'on ' : '') + (lvl(point) === 3 ? 'sub' : '');
    return (
      `<button data-sppick="${point.id}" class="${className}"><i class="dot" style="background:var(--s${point.status || 0})"></i>` +
      `<code>${esc(point.code || '')}</code><span>${esc(point.text)}</span></button>`
    );
  }

  /* beside the first block, kept inside the window */
  place() {
    const first = this.range[0].getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const el = this.el;
    el.style.left = Math.max(PICKER_MARGIN, Math.min(first.left, width - el.offsetWidth - PICKER_MARGIN)) + 'px';
    el.style.top = Math.max(PICKER_MARGIN, Math.min(first.top, innerHeight - el.offsetHeight - PICKER_MARGIN)) + 'px';
  }

  listen() {
    const search = this.el.querySelector('input');
    search.focus();
    search.addEventListener('input', () => {
      this.el.q = search.value;
      this.el.active = 0;
      this.draw();
    });
    search.addEventListener('keydown', e => this.onKey(e));
    this.el.addEventListener('mousedown', e => {
      if (e.target.closest('button')) e.preventDefault();
    });
    this.el.addEventListener('click', e => this.onClick(e));
  }

  onKey(e) {
    const points = this.matches();
    const move = {
      ArrowDown: Math.min(points.length - 1, this.el.active + 1),
      ArrowUp: Math.max(0, this.el.active - 1)
    };
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.el.active = move[e.key];
      this.draw();
    } else if (e.key === 'Enter' && points[this.el.active]) {
      e.preventDefault();
      spApply(this.range, points[this.el.active].id);
    } else if (e.key === 'Escape') closeSpPick();
  }

  onClick(e) {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-spcancel')) closeSpPick();
    else if (button.hasAttribute('data-spclear')) {
      this.range.forEach(block => block.removeAttribute('data-sp'));
      closeSpPick();
      spChanged();
    } else if (button.dataset.sppick) spApply(this.range, button.dataset.sppick);
  }
}

function openSpPick(range) {
  closeSpPick();
  if (!range.length) return;
  const picker = new SpecPointPicker(range);
  spPick = picker.el;
  document.body.appendChild(picker.el);
  picker.draw();
  picker.place();
  picker.listen();
}

/* a press anywhere else closes it */
document.addEventListener('mousedown', e => {
  if (spPick && !spPick.contains(e.target)) closeSpPick();
});

/* the Heading menu's "Tag with spec point…": the top-level blocks the selection touches */
function spTagSelection() {
  const editor = ed();
  const selection = getSelection();
  const range = editor && selection.rangeCount ? selection.getRangeAt(0) : null;
  const first = range && mdTopBlock(range.startContainer);
  const last = range && mdTopBlock(range.endContainer);
  if (!first || !last) {
    toast('Click into your notes first');
    return;
  }
  const blocks = edBlocks(editor);
  const from = blocks.indexOf(first);
  const to = blocks.indexOf(last);
  if (from < 0 || to < 0) return;
  openSpPick(blocks.slice(Math.min(from, to), Math.max(from, to) + 1));
}

function spApply(range, id) {
  closeSpPick();
  ui.spMode = true;
  range.forEach(block => block.setAttribute('data-sp', id));
  ui.spCur = id;
  spChanged();
}
