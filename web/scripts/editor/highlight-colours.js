/* ===== highlight key: what each highlighter colour is for (the Mac app keeps it, and hands it over as window.__HLKEY__) ===== */
const DEFAULT_HIGHLIGHT_KEY = [
  { id: '1', meaning: 'General', hex: '#FFE58A' },
  { id: '5', meaning: 'Key ideas', hex: '#9CCBFF' },
  { id: '4', meaning: 'Read more / secondary references', hex: '#CDB6FF' },
  { id: '2', meaning: 'Case studies & examples', hex: '#FFC58F' },
  { id: '3', meaning: 'Controversial ideas', hex: '#FF9C9C' },
  { id: '6', meaning: '', hex: '#A8E8C0', hidden: true }
];
export let HLKEY = window.__HLKEY__ || DEFAULT_HIGHLIGHT_KEY;
export function setHLKEY(value) {
  HLKEY = value;
  return value;
}

export function keyOf(id) {
  return (HLKEY || []).find(k => k.id === String(id));
}

/* the colours offered (removed ones stay in the key, so highlights already made keep their colour) */
export function keyShown() {
  return (HLKEY || []).filter(k => !k.hidden);
}

export function keyLabel(k) {
  return k ? k.meaning || 'No meaning yet' : '';
}
