/* ===== resizing a picture from a bottom corner, and moving it between lines ===== */
const MIN_IMAGE_SHARE = 0.1; // a picture is at least this share of the line wide while dragging…
const MIN_IMAGE_PERCENT = 10; // …and kept at least this many percent
const WIDTH_STEPS_PER_LINE = 20; // widths snap to 5% of the line
const DROP_LINE_GAP = 2; // px below a line where the drop line shows

/* resize: drag a bottom corner; width snaps to 5% of the line */
function startImgResize(e) {
  const handle = e.target.closest('[data-rs]');
  if (!handle || !imgSel) return;
  e.preventDefault();
  const img = imgSel;
  const direction = +handle.dataset.rs;
  const startX = e.clientX;
  const startWidth = img.getBoundingClientRect().width;
  const line = (imgNode(img).parentElement || ed()).getBoundingClientRect().width;
  /* a picture in line grows on both sides, so it follows the mouse twice as fast */
  const speed = () => (img.getAttribute('data-wrap') ? 1 : 2);
  dragWithMouse(
    move => {
      const width = startWidth + direction * (move.clientX - startX) * speed();
      img.setAttribute('data-w', String(snappedPercent(width, line)));
      placeImgTool();
    },
    () => imgChanged()
  );
}

/* a width as a percentage of the line, in steps of 5 */
function snappedPercent(width, line) {
  const clamped = Math.max(line * MIN_IMAGE_SHARE, Math.min(line, width));
  const percent = Math.round((clamped / line) * WIDTH_STEPS_PER_LINE) * (100 / WIDTH_STEPS_PER_LINE);
  return Math.max(MIN_IMAGE_PERCENT, Math.min(100, percent));
}

/* follows the mouse until it's let go */
function dragWithMouse(onMove, onUp) {
  const up = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', up);
    onUp();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', up);
}

/* move: drag from the Move button; a line shows the gap between lines (or bullets) it will go into */
function startImgMove(e) {
  const img = imgSel;
  if (!img) return;
  const node = imgNode(img);
  const root = ed();
  const line = mk('div');
  line.id = 'imgdropline';
  document.body.appendChild(line);
  document.body.classList.add('imgmoving');
  let drop = null;
  const follow = move => (drop = showDropLine(line, nearestGap(dropGaps(root, node), move.clientY)));
  dragWithMouse(follow, () => {
    line.remove();
    document.body.classList.remove('imgmoving');
    if (drop) moveImageTo(node, drop.el, root);
  });
  follow(e);
}

/* the lines (and list items) a picture can go after */
function dropGaps(root, node) {
  const gaps = [];
  [...root.children]
    .filter(block => block !== node && block.id !== 'fnlist')
    .forEach(block => {
      if (block.tagName !== 'UL' && block.tagName !== 'OL') {
        gaps.push({ el: block, r: block.getBoundingClientRect() });
        return;
      }
      block.querySelectorAll('li').forEach(item => {
        if (!item.contains(node)) gaps.push({ el: item, r: item.getBoundingClientRect(), li: true });
      });
    });
  return gaps;
}

function nearestGap(gaps, y) {
  let best = null;
  let bestDistance = Infinity;
  gaps.forEach(gap => {
    const distance = Math.abs(y - gap.r.bottom);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = gap;
    }
  });
  return best;
}

function showDropLine(line, gap) {
  line.style.display = gap ? 'block' : 'none';
  if (!gap) return null;
  line.style.left = gap.r.left + 'px';
  line.style.width = gap.r.width + 'px';
  line.style.top = gap.r.bottom + DROP_LINE_GAP + 'px';
  return gap;
}

/* the picture after the line it was dropped on; the line it left goes if that's now empty */
function moveImageTo(node, after, root) {
  const old = node.parentNode;
  placeBetweenLines(node, after, root);
  if (old && old !== root && old.tagName === 'P' && !old.textContent.trim() && !old.querySelector('img')) old.remove();
  node.scrollIntoView({ block: 'nearest' });
  imgChanged();
}
