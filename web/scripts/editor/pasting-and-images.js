import { NATIVE, curEd, setCurEd, toast } from '../core/helpers-and-state.js';
import { mk, plainToHTML, sanitize } from './paste-cleaning.js';
import { closestTag } from './editor-commands.js';
import { caretInto } from '../essays/essays.js';
import { emptyLine } from './callouts.js';

/* ===== pasting and dropping into the notes, and putting pictures in ===== */
const MAX_IMAGE_BYTES_APP = 8e6; // a picture larger than this isn't kept (the Mac app)
const MAX_IMAGE_BYTES_WEB = 140000; // (the web version, which keeps pictures in the page's own storage)

/* ⇧ held while pasting pastes plain text */
let shiftDown = false;
const onPastingAndImagesKeydown = e => (shiftDown = e.shiftKey);
const onPastingAndImagesKeyup = e => (shiftDown = e.shiftKey);

const onPastingAndImagesPaste = function (e) {
  const editor = e.target.closest && e.target.closest('.notes,.stmt');
  if (!editor) return;
  e.preventDefault();
  const data = e.clipboardData;
  const text = data.getData('text/plain');
  if (editor.classList.contains('stmt')) {
    document.execCommand('insertText', false, text.replace(/\s+/g, ' ')); // a syllabus statement: one line of plain text
    return;
  }
  const images = [...(data.files || [])].filter(file => /^image\//.test(file.type));
  if (images.length && !text.trim()) insertImages(images);
  else pasteText(data.getData('text/html'), text);
};

/* HTML is cleaned; plain text (or ⇧, or in a table cell) becomes lines, on one line in a cell */
function pasteText(html, text) {
  if (!html && !text) {
    toast('Nothing to paste');
    return;
  }
  const inCell = !!closestTag('td,th');
  let out;
  if (!html || shiftDown || inCell) out = plainToHTML(text, inCell);
  else {
    out = sanitize(html, true);
    if (!out.trim()) out = plainToHTML(text, false);
  }
  document.execCommand('insertHTML', false, out);
}

/* the block a node is in: a list item, or a direct child of the editor */
export function blockOf(node, root) {
  node = node && node.nodeType === 3 ? node.parentNode : node;
  while (node && node !== root) {
    if (node.tagName === 'LI' || node.parentNode === root) return node;
    node = node.parentNode;
  }
  return null;
}

/* pictures sit between lines: after the block (inside a list item, at its end), with an empty line after it (one
   there already, or a new one, whatever comes next) for the caret to go on to, so you can write on under it */
export function placeBetweenLines(node, block, root) {
  if (!block) root.appendChild(node);
  else if (block.tagName === 'LI') block.appendChild(node);
  else block.after(node);
  if (node.parentNode !== root) return null;
  let line = node.nextElementSibling;
  if (!(line && line.tagName === 'P' && !line.textContent.trim() && !line.querySelector('img'))) {
    line = emptyLine();
    node.after(line);
  }
  caretInto(line);
  return line;
}

/* pictures put in where the caret is (or at a given range): uploaded where the web version can, else kept in the page */
export function insertImages(files, at) {
  const editor = curEd;
  const selection = getSelection();
  let range = at || (selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null);
  /* each picture after the one before */
  const put = src => {
    const line = putImage(editor, range, src);
    if (!line) return;
    range = document.createRange();
    range.selectNodeContents(line);
  };
  if (!(window.claude && claude.use)) {
    files.forEach(file => readImage(file, put));
    return;
  }
  claude.use('assets').then(assets => {
    if (assets) uploadImages(files, assets, put);
    else files.forEach(file => readImage(file, put));
  });
}

function putImage(editor, range, src) {
  if (!editor) return;
  editor.focus();
  const image = mk('img');
  image.setAttribute('src', src);
  image.setAttribute('data-nb', '1');
  image.setAttribute('alt', '');
  image.setAttribute('draggable', 'false');
  const block = range && editor.contains(range.startContainer) ? blockOf(range.startContainer, editor) : null;
  const line = placeBetweenLines(image, block, editor);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  return line;
}

/* a picture kept in the page itself, as data */
function readImage(file, put) {
  if (file.size > (NATIVE ? MAX_IMAGE_BYTES_APP : MAX_IMAGE_BYTES_WEB)) {
    toast('Image is too large to keep');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => put(reader.result);
  reader.readAsDataURL(file);
}

/* pictures uploaded one after another, each put in as it arrives */
function uploadImages(files, assets, put) {
  toast('Adding image…');
  files
    .reduce((chain, file) => chain.then(() => assets.upload(file).then(result => put(result.url))), Promise.resolve())
    .then(
      () => toast('Image added'),
      () => toast('Could not add image')
    );
}

/* dropped pictures go between the lines nearest the drop; dropped text goes in as lines */
const onPastingAndImagesDrop = function (e) {
  const editor = e.target.closest && e.target.closest('.notes');
  if (!editor) return;
  e.preventDefault();
  setCurEd(editor);
  const images = [...(e.dataTransfer.files || [])].filter(file => /^image\//.test(file.type));
  if (images.length) {
    editor.focus();
    insertImages(images, document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null);
    return;
  }
  if (e.dataTransfer.types && [...e.dataTransfer.types].includes('Files')) return;
  const text = e.dataTransfer.getData('text/plain');
  if (!text) return;
  editor.focus();
  document.execCommand('insertHTML', false, plainToHTML(text, false));
};

export function initPastingAndImages() {
  document.addEventListener('keydown', onPastingAndImagesKeydown, true);
  document.addEventListener('keyup', onPastingAndImagesKeyup, true);
  document.addEventListener('paste', onPastingAndImagesPaste, true);
  document.addEventListener('drop', onPastingAndImagesDrop, true);
  /* new lines are paragraphs; no resize handles on pictures and tables */
  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand('enableObjectResizing', false, false);
    document.execCommand('enableInlineTableEditing', false, false);
  } catch (e) {}
}
