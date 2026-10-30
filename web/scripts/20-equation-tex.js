/* ===== equations: a block of LaTeX drawn by KaTeX; click it to edit, with a palette of symbols.
   Each line of the LaTeX is a line of the equation (a matrix or other environment can still run over several lines). ===== */
const KT_OPTS = {
  displayMode: true,
  throwOnError: false,
  strict: 'ignore',
  trust: context => context.command === '\\htmlClass'
};
const EMPTY_BOX_COLOUR = '#9aa6b2'; // an empty box to fill in is drawn in this grey

/* "arg min" (MathLive's spelling) is written argmin, as in the books */
function texTidy(source) {
  return String(source || '').replace(
    /\\operatorname\*\{(?:\\mathrm\{arg(?:~|\\,|\\ |\s)+(min|max)\}|arg(?:~|\\,|\\ |\s)+(min|max))\}/g,
    (match, spelled, plain) => '\\operatorname*{arg' + (spelled || plain) + '}'
  );
}

/* LaTeX as drawn: tidied, with an empty box for each place still to fill in */
function texShow(source) {
  return texTidy(source).replace(
    /\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g,
    `\\textcolor{${EMPTY_BOX_COLOUR}}{\\square}`
  );
}

/* each line drawn as a displayed equation */
function texShowHTML(source) {
  return texLines(source)
    .map(line => {
      try {
        return katex.renderToString(texShow(line), { displayMode: true, throwOnError: false, strict: 'ignore' });
      } catch (x) {
        return esc(line);
      }
    })
    .join('');
}

/* the lines of an equation: a new line only outside braces and environments */
function texLines(source) {
  const lines = [];
  let line = '';
  let depth = 0;
  for (const { 0: piece, index } of source.matchAll(/\\[\s\S]?|[\s\S]/g)) {
    if (piece === '\n' && depth <= 0) {
      lines.push(line);
      line = '';
      depth = 0;
    } else {
      depth += piece[0] === '\\' ? environmentStep(source, index) : braceStep(piece);
      line += piece;
    }
  }
  lines.push(line);
  return lines.filter(l => l.trim());
}

/* \begin opens an environment and \end closes one */
function environmentStep(source, i) {
  const environment = /^\\(begin|end)(?![a-zA-Z])/.exec(source.slice(i, i + 7));
  if (!environment) return 0;
  return environment[1] === 'begin' ? 1 : -1;
}

function braceStep(c) {
  return c === '{' ? 1 : c === '}' ? -1 : 0;
}

function texInline(tex) {
  try {
    return window.katex ? katex.renderToString(tex, { throwOnError: false, strict: 'ignore' }) : esc(tex);
  } catch (x) {
    return esc(tex);
  }
}

/* LaTeX in pieces: a command (\sigma), a named block (\text{…}, \mathbb{R}) or one character */
const TEX_TOK =
  /\\(?:begin|end|text|textbf|textit|mathrm|operatorname|mathbb|mathcal)\s*\{[^{}]*\}|\\[a-zA-Z]+\*?|\\.|\s+|[\s\S]/g;

/* the pieces (not spaces), with where each starts (i) and ends (e) */
function texTokens(source) {
  const tokens = [];
  let match;
  TEX_TOK.lastIndex = 0;
  while ((match = TEX_TOK.exec(source)))
    if (match[0].trim()) tokens.push({ t: match[0], i: match.index, e: match.index + match[0].length });
  return tokens;
}

/* does KaTeX draw it without an error? */
function texOK(source) {
  try {
    katex.renderToString(source, { displayMode: true, throwOnError: true, strict: 'ignore', trust: KT_OPTS.trust });
    return true;
  } catch (x) {
    return false;
  }
}
