/* ===== the parts of an equation: coloured where explained, clickable to explain in annotation mode ===== */
/* big operators: limits above and below (\sum, lim, argmin) or beside (integrals) */
const ANN_LIMOP =
  /^\\(sum|prod|coprod|bigcup|bigcap|bigsqcup|bigvee|bigwedge|bigodot|bigoplus|bigotimes|biguplus|lim|liminf|limsup|max|min|sup|inf|det|gcd|Pr|argmax|argmin)$|^\\operatorname\*\s*\{[^{}]*\}$/;
const ANN_INTOP = /^\\(int|iint|iiint|oint|smallint)$/;
/* what can be clicked to explain it: letters, numbers, Greek letters, and marked ones such as \hat{y} or \mathbf{w} */
const ANN_MARKS = /^\\(hat|bar|vec|tilde|dot|ddot|mathbf|boldsymbol|overline)$/;
const ANN_SYMBOLS =
  /^\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Phi|Psi|Omega|partial|nabla|infty|sum|prod|int|log|ln|exp|sin|cos|tan|max|min|lim)$/;
const MARKED_SYMBOL_TOKENS = 4; // \hat { y }

/* the LaTeX with every place each explained part appears wrapped in its colour; in annotation mode the other symbols are
   wrapped too, so a click on one can explain it (a wrap that would break the equation is skipped) */
function annotateTex(source, list, candidates) {
  if (!window.katex || (!list.length && !(candidates && candidates.length))) return source;
  const tokens = texTokens(source);
  const spans = [];
  list.forEach((note, i) => findPart(tokens, note.t, { cls: 'mann' + i, color: annColor(note) }, spans));
  (candidates || []).forEach((tex, k) => findPart(tokens, tex, { cls: 'mcand' + k }, spans));
  spans.sort((a, b) => b.s - a.s);
  return spans.reduce((out, span) => {
    const wrapped = out.slice(0, span.s) + wrapPart(out, span) + out.slice(span.e);
    return texOK(wrapped) ? wrapped : out;
  }, source);
}

/* every place a part's tokens appear (balanced in braces, not inside a part found earlier) */
function findPart(tokens, tex, mark, spans) {
  const part = texTokens(tex).map(token => token.t);
  if (!part.length || !bracesBalance(part)) return;
  for (let i = 0; i + part.length <= tokens.length; i++) {
    if (!part.every((t, k) => tokens[i + k].t === t)) continue;
    const start = tokens[i].i;
    const end = tokens[i + part.length - 1].e;
    if (spans.some(span => start < span.e && end > span.s)) continue; // already part of something explained earlier
    spans.push({ s: start, e: end, mark });
    i += part.length - 1;
  }
}

/* the braces in a part close as they open (never more closing than opening on the way) */
function bracesBalance(part) {
  let depth = 0;
  for (let k = 0; k < part.length && depth >= 0; k++) {
    if (part[k] === '{') depth++;
    else if (part[k] === '}') depth--;
  }
  return depth === 0;
}

/* a part in its colour and class; a big operator stays one once wrapped: \sum, lim, argmin keep their limits above and
   below, integrals beside */
function wrapPart(source, span) {
  const part = source.slice(span.s, span.e);
  const coloured = span.mark.color ? '\\textcolor{' + span.mark.color + '}{' + part + '}' : part;
  const wrapped = '\\htmlClass{' + span.mark.cls + '}{' + coloured + '}';
  const operator = part.trim();
  if (!ANN_LIMOP.test(operator) && !ANN_INTOP.test(operator)) return wrapped;
  const ownLimits = /^\s*\\(no)?limits/.test(source.slice(span.e)); // written with its own \limits: that stays
  return '\\mathop{' + wrapped + '}' + (ownLimits ? '' : ANN_LIMOP.test(operator) ? '\\limits' : '\\nolimits');
}

/* the symbols of an equation that can be explained, each once, in the order they appear */
function annCandidates(source) {
  const tokens = texTokens(source);
  const found = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const tex = tokens[i].t;
    const last = i + MARKED_SYMBOL_TOKENS - 1;
    if (ANN_MARKS.test(tex) && tokens[last] && tokens[i + 1].t === '{' && tokens[last].t === '}') {
      found.add(source.slice(tokens[i].i, tokens[last].e));
      i = last;
    } else if (ANN_SYMBOLS.test(tex) || /^[A-Za-z]$/.test(tex)) found.add(tex);
    else if (/^[0-9]$/.test(tex)) {
      const end = numberEnd(tokens, i);
      found.add(source.slice(tokens[i].i, tokens[end].e));
      i = end;
    }
  }
  return [...found];
}

/* a number's last token: digits and points written together */
function numberEnd(tokens, i) {
  let end = i;
  while (tokens[end + 1] && /^[0-9.]$/.test(tokens[end + 1].t) && tokens[end + 1].i === tokens[end].e) end++;
  return end;
}
