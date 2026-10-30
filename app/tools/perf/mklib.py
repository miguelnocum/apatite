"""A synthetic Apatite library for the performance test (bench.sh).

Usage: mklib.py <dir> <pdf> <note_paragraphs> <essays> <essay_paragraphs> <points> [--images N] [--image-px P] [--equations N]
  The library has two projects: Big (notes of that many paragraphs, that many essays, 3 papers, that many syllabus points,
  100 sources) and Small (a little of each).
  --images N     N pictures in the notes and in each essay of Big, as the page keeps a pasted picture: a PNG as a data: URL in
                 <img src data-nb="1"> on a paragraph of its own. They are P pixels square (default 300) and made of gradients
                 and noise, so they have real raster data in them (about 3 P² bytes before PNG compression, about half after).
  --equations N  N equation blocks (<div data-math="LaTeX">) and N inline ones (<span data-imath="LaTeX">) in the same places.
Without the options the library is what it was before they existed (the text does not depend on them)."""
import argparse, base64, json, os, random, shutil, struct, uuid, zlib

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('out'); ap.add_argument('pdf')
ap.add_argument('note_p', type=int); ap.add_argument('n_essays', type=int); ap.add_argument('essay_p', type=int); ap.add_argument('n_pts', type=int)
ap.add_argument('--images', type=int, default=0); ap.add_argument('--image-px', type=int, default=300); ap.add_argument('--equations', type=int, default=0)
args = ap.parse_args()
out, pdf, note_p, n_essays, essay_p, n_pts = args.out, args.pdf, args.note_p, args.n_essays, args.essay_p, args.n_pts

random.seed(7)
extra = random.Random(11)   # pictures and equations draw from this, so they never change the text
WORDS = 'cell membrane protein enzyme regulation transcription pathway receptor signal gradient model evidence analysis structure function kinetic binding substrate'.split()
LATEX = [r'\frac{a}{b}', r'E = mc^2', r'\sum_{i=1}^{n} x_i^2', r'\int_0^1 f(x)\,dx', r'\sigma(z) = \frac{1}{1 + e^{-z}}',
         r'\begin{pmatrix} a & b \\ c & d \end{pmatrix}', r'\hat{y} = \operatorname*{argmax}_k p_k', r'\nabla_\theta L(\theta)']
INLINE = [r'x_i', r'\alpha^2', r'p < 0.05', r'\mathbb{R}^n', r'\sqrt{n}', r'\theta']

def png(px, seed):
    """a PNG of gradients and noise: real raster data, deterministic"""
    rnd = random.Random(seed)
    rows = []
    for y in range(px):
        noise = rnd.randbytes(px * 3)
        rows.append(b'\0' + bytes(((x // 3 * (seed % 5 + 1) + y * 2) + noise[x] % 48) & 255 for x in range(px * 3)))
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', px, px, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 6)) + chunk(b'IEND', b''))
image_bytes = images_made = 0
def picture():
    global image_bytes, images_made
    data = png(args.image_px, extra.randrange(10**6))
    image_bytes += len(data)
    images_made += 1
    return '<p><img src="data:image/png;base64,%s" data-nb="1" alt="" draggable="false"></p>' % base64.b64encode(data).decode()
def block_equation():
    return '<div data-math="%s"></div>' % extra.choice(LATEX).replace('"', '&quot;')
def inline_equation():
    return ' <span data-imath="%s"></span>' % extra.choice(INLINE)

def para(i, refs):
    s = ' '.join(random.choice(WORDS) for _ in range(70))
    cite = f' <span data-cite="{random.choice(refs)}"></span>' if refs and i % 6 == 0 else ''
    head = f'<h2>Section {i}</h2>' if i % 12 == 0 else ''
    return f'{head}<p>{s}.{cite}</p>'
def document(count, refs, big):
    """the paragraphs, with the options' pictures and equations spread evenly among them"""
    pieces = [para(i, refs) for i in range(count)]
    if big:
        for k in range(args.images):
            pieces[k * count // args.images] += picture()
        for k in range(args.equations):
            pieces[k * count // args.equations] += block_equation()
            at = (2 * k + 1) * count // (2 * args.equations)   # between two blocks
            pieces[at] = pieces[at][:-len('</p>')] + inline_equation() + '</p>'
    return ''.join(pieces)
def mk_refs(n):
    return [{'id': f'r{i}', 'raw': f'Author{i}, A. ({2000 + i % 25}). Title of work {i}. Journal.', 'html': '', 'authors': [f'Author{i}'], 'year': str(2000 + i % 25)} for i in range(n)]
def j(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, 'w'))
def project(name, big):
    p = os.path.join(out, name)
    refs = mk_refs(100 if big else 3)
    j(p + '/project.json', {'id': str(uuid.uuid4()), 'name': name, 'refs': [], 'refSort': 'auto', 'created': 1.7e9})
    sid = str(uuid.uuid4())
    pts = [{'id': f'pt{i}', 'order': i + 1, 'sec': f'Topic {i // 20 + 1}', 'code': f'{i // 20 + 1}.{i % 20 + 1}', 'text': 'Describe ' + ' '.join(random.choice(WORDS) for _ in range(12)), 'guide': '', 'status': i % 5, 'notes': ''} for i in range(n_pts if big else 5)]
    j(p + '/Syllabi/Syllabus.json', {'id': sid, 'title': 'Syllabus', 'pts': pts})
    ids = [r['id'] for r in refs]
    doc = document(note_p if big else 20, ids, big)
    j(p + '/Notebooks/Notes.json', {'id': str(uuid.uuid4()), 'meta': {'title': 'Notes', 'hv': 2}, 'pts': [], 'doc': doc, 'refs': refs, 'refSort': 'auto', 'syllabus': sid})
    for e in range(n_essays if big else 1):
        d = document(essay_p, ids, big)
        j(f'{p}/Essays/Essay {e}.json', {'id': str(uuid.uuid4()), 'title': f'Essay {e}', 'doc': d, 'created': 1.7e12, 'updated': 1.7e12, 'refs': refs[:10], 'refSort': 'auto'})
    os.makedirs(p + '/Papers', exist_ok=True)
    os.makedirs(p + '/Decks', exist_ok=True)
    os.makedirs(p + '/Backups', exist_ok=True)
    items = []
    for k in range(3 if big else 1):
        f = f'paper{k}.pdf'
        shutil.copy(pdf, os.path.join(p, 'Papers', f))
        items.append({'id': str(uuid.uuid4()), 'file': f, 'title': f'Paper {k}', 'highlights': [], 'useLabels': False, 'offset': 0, 'pagesSet': True})
    j(p + '/Papers/papers.json', items)
if os.path.exists(out):
    shutil.rmtree(out)
project('Big', True)
project('Small', False)
if args.images or args.equations:
    print('%d pictures (PNG, %dx%d), %.1f MB (%.1f MB as base64 in the documents); %d block and %d inline equations in each document of Big'
          % (images_made, args.image_px, args.image_px, image_bytes / 1e6, image_bytes * 4 / 3e6, args.equations, args.equations))
