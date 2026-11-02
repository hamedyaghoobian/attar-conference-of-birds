# What the Birds Leave: find every dot (nuqta) in Attar's Manteq al-Tayr.
#
# The text is shaped with HarfBuzz in a given hand, the same font file the page draws with,
# so each dot lands exactly where the browser would put it. Both hands lay their dots over
# a dotless letter skeleton: Amiri (naskh) as components of the letter, Gulzar (nastaliq) as
# separate mark glyphs. Touching dots (the pair under ی, the three over ش) share one outline,
# so each dot mark is split by area into dots.
#
#   .venv/bin/python tools/extract.py data/manteq-ganjoor.json naskh site/data/naskh
#   .venv/bin/python tools/extract.py data/manteq-ganjoor.json nastaliq site/data/nastaliq
#   .venv/bin/python tools/extract.py data/fitzgerald.json english site/data/english
#
# English is Edward FitzGerald's Bird-Parliament (1889), set in EB Garamond: its only dots
# are the tittles of i and j, and the fi ligature swallows the one on its i.

import json, struct, sys, os, re, random
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib.tables._g_l_y_f import Glyph
from fontTools import subset
from PIL import Image, ImageDraw

# the dot marks of each hand, found by looking at them. Amiri: one, two side by side, two stacked,
# three, four. Gulzar: every mark glyph it draws for dots (its other marks are vowels and hamza).
HANDS = {
    "naskh": {"font": "fonts/Amiri-Regular.ttf", "one": "glyph01392",
              "dots": {"glyph01392": 1, "glyph01393": 2, "glyph01394": 3, "glyph01403": 3, "glyph01408": 2,
                       "glyph01427": 4, "glyph01429": 3}},
    "nastaliq": {"font": "fonts/Gulzar-Regular.ttf", "one": "glyph01042",
                 "dots": re.compile(r"glyph0(08[34]\d|10[4-8]\d)$")},
    "english": {"font": "fonts/EBGaramond-Regular.ttf", "one": "dotaccent", "dots": {"dotaccent": 1},
                "dir": "ltr", "script": "Latn", "lang": "en", "gold": "[Tt]hirty"},
}
src, hand, out = sys.argv[1:4]
H = HANDS[hand]
font_path = H["font"]
os.makedirs(out, exist_ok=True)
book = json.load(open(src))

# ---------- the lines, in reading order ----------

ZWNJ = "‌"
def clean(t):
    t = t.replace("ي", "ی").replace("ك", "ک").replace("‏", "").replace("‎", "")
    return re.sub(r"\s+", " ", t).strip()

sections, lines = [], []
if isinstance(book, dict):   # FitzGerald: one poem, no sections
    lines = [clean(l) for l in book["lines"]]
    sections = [{"title": book["title"], "slug": "fitzgerald", "poems": [
        {"title": f"{book['translator']}, {book['year']}", "url": book["source"], "start": 0, "end": len(lines), "audio": []}]}]
for s in (book if isinstance(book, list) else []):
    sec = {"title": clean(s["section"]), "slug": s["slug"], "poems": []}
    for p in s["poems"]:
        start = len(lines)
        for v in sorted(p["verses"], key=lambda v: v["o"]):
            lines.append(clean(v["t"]))
        sec["poems"].append({"title": clean(p["title"]), "url": p["url"], "start": start, "end": len(lines),
                             "audio": [r["mp3"] for r in p["recitations"]][:1]})
    sections.append(sec)
print("hemistichs", len(lines))

# ---------- the font, cut down to the letters Attar uses ----------

chars = sorted(set("".join(lines) + "".join(s["title"] for s in sections)
                   + "".join(p["title"] for s in sections for p in s["poems"]) + " ۰۱۲۳۴۵۶۷۸۹"))
opts = subset.Options()
opts.layout_features = ["*"]
opts.name_IDs = ["*"]
opts.notdef_outline = True
opts.glyph_names = True
ft = TTFont(font_path)
sub = subset.Subsetter(opts)
sub.populate(text="".join(chars))
sub.subset(ft)
ft.flavor = "woff2"
ft.save(os.path.join(out, "hand.woff2"))
# shape and measure with the whole font: subsetting renumbers glyphs but keeps every shape
ttf = font_path
ft = TTFont(ttf)

glyf, order, upem = ft["glyf"], ft.getGlyphOrder(), ft["head"].unitsPerEm
gs = ft.getGlyphSet()

# ---------- which marks are dots, and where each dot sits inside its mark ----------

class Poly(BasePen):
    def __init__(s, gs): super().__init__(gs); s.polys, s.cur = [], []
    def _moveTo(s, p): s.cur = [p]
    def _lineTo(s, p): s.cur.append(p)
    def _curveToOne(s, a, b, c):
        p0 = s.cur[-1]
        for i in range(1, 9):
            t = i / 8
            s.cur.append(tuple((1-t)**3*p0[k] + 3*(1-t)**2*t*a[k] + 3*(1-t)*t*t*b[k] + t**3*c[k] for k in (0, 1)))
    def _qCurveToOne(s, a, b):
        p0 = s.cur[-1]
        for i in range(1, 9):
            t = i / 8
            s.cur.append(tuple((1-t)**2*p0[k] + 2*(1-t)*t*a[k] + t*t*b[k] for k in (0, 1)))
    def _closePath(s):
        if s.cur: s.polys.append(s.cur)
        s.cur = []
    _endPath = _closePath

def ink(name):
    """filled pixels of a glyph, one per font unit, as (x, y) in font units"""
    p = Poly(gs); gs[name].draw(p)
    pts = [q for poly in p.polys for q in poly]
    if not pts: return []
    x0, y0 = min(q[0] for q in pts) - 2, min(q[1] for q in pts) - 2
    x1, y1 = max(q[0] for q in pts) + 2, max(q[1] for q in pts) + 2
    im = Image.new("1", (int(x1 - x0) + 1, int(y1 - y0) + 1), 0)
    d = ImageDraw.Draw(im)
    for poly in p.polys:   # even-odd is fine: dots have no holes
        d.polygon([(x - x0, y1 - y) for x, y in poly], fill=1)
    w, h = im.size
    px = im.load()
    return [(x + x0, y1 - y) for y in range(h) for x in range(w) if px[x, y]]

def kmeans(pts, k):
    rnd = random.Random(7)
    cs = [rnd.choice(pts)]
    while len(cs) < k:   # farthest point first
        cs.append(max(pts, key=lambda q: min((q[0]-c[0])**2 + (q[1]-c[1])**2 for c in cs)))
    for _ in range(30):
        groups = [[] for _ in cs]
        for q in pts:
            groups[min(range(k), key=lambda i: (q[0]-cs[i][0])**2 + (q[1]-cs[i][1])**2)].append(q)
        cs = [(sum(q[0] for q in g)/len(g), sum(q[1] for q in g)/len(g)) if g else cs[i] for i, g in enumerate(groups)]
    return cs

one = len(ink(H["one"]))
if isinstance(H["dots"], dict):
    DOT_MARKS = H["dots"]
else:   # count the dots in each mark by its area; Gulzar's dots overlap, so two cover 1.75 and three 2.5
    classes = ft["GDEF"].table.GlyphClassDef.classDefs
    count = lambda r: 1 if r < 1.4 else 2 if r < 2.2 else 3
    DOT_MARKS = {n: count(len(ink(n)) / one) for n in order if H["dots"].match(n) and classes.get(n) == 3}
dot_at = {}
for name, k in DOT_MARKS.items():
    if name not in gs: continue
    pts = ink(name)
    assert isinstance(H["dots"], re.Pattern) or abs(len(pts) / one - k) < .6, (name, len(pts) / one, k)
    dot_at[name] = kmeans(pts, k) if k > 1 else [(sum(q[0] for q in pts)/len(pts), sum(q[1] for q in pts)/len(pts))]

def dots_in(name, dx=0, dy=0):
    """(x, y, how many dots the mark has) for every dot a glyph draws"""
    if name in dot_at:
        return [(x + dx, y + dy, len(dot_at[name])) for x, y in dot_at[name]]
    g = glyf[name]
    if not g.isComposite(): return []
    out = []
    for c in g.components:
        out += dots_in(c.glyphName, dx + c.x, dy + c.y)
    return out

# ---------- shape every line ----------

face = hb.Face(hb.Blob.from_file_path(ttf))
font = hb.Font(face)

def shape(text):
    b = hb.Buffer(); b.add_str(text)
    b.direction, b.script, b.language = H.get("dir", "rtl"), H.get("script", "Arab"), H.get("lang", "fa")
    hb.shape(font, b)
    return b

# how many dots each letter should carry, to check the font against the text
DOTS = dict(zip("بپتثجچخذزژشضظغفقنیة", [1,3,2,3,1,3,1,1,1,3,3,1,1,1,1,2,1,2,2]))
LETTER = re.compile(r"[ؠ-يپچژکگی]")
def expected(text):
    if hand == "english":   # a tittle on every i and j, except where an f has swallowed it
        return text.count("i") + text.count("j") - text.count("fi")
    n = 0
    for i, ch in enumerate(text):
        if ch == "ی":   # Persian yeh is dotless when it ends a word
            rest = re.sub(r"^[\u064b-\u065f\u0670]+", "", text[i+1:])   # vowel marks sit on the yeh
            nxt = rest[0] if rest else " "
            n += 2 if LETTER.match(nxt) else 0
        else:
            n += DOTS.get(ch, 0)
    return n

# which layer a dot belongs to: its letter's dots (1, 2, 3), or 4 for پ چ ژ, the letters
# Persian added to the Arabic alphabet
PERSIAN = set("پچژ")
def group(text, cl, end, k):
    if hand == "english": return 1
    for ch in text[cl:end]:
        n = 2 if ch == "ی" else DOTS.get(ch)
        if n == k: return 4 if ch in PERSIAN else n
    return min(k, 3)

SIMORGH = re.compile(H.get("gold", "سیمرغ|سی‌مرغ|سی مرغ"))
xs, ys, flags, starts, widths, tops, bottoms = [], [], [], [], [], [], []
off = 0
bounds = {}
def glyph_bounds(n):
    if n not in bounds:
        bp = BoundsPen(gs); gs[n].draw(bp); bounds[n] = bp.bounds
    return bounds[n]
for li, text in enumerate(lines):
    starts.append(len(xs))
    sim = [m.span() for m in SIMORGH.finditer(text)]
    # cluster values are byte offsets into UTF-8 by default for str input; uharfbuzz uses
    # code point indices for add_str, so they index the string directly
    b = shape(text)
    x = 0
    found = []
    top, bottom = 0, 0
    clusters = sorted({i.cluster for i in b.glyph_infos}) + [len(text)]
    end_of = {c: clusters[i + 1] for i, c in enumerate(clusters[:-1])}
    for info, pos in zip(b.glyph_infos, b.glyph_positions):
        n = order[info.codepoint]
        for dx, dy, k in dots_in(n, x + pos.x_offset, pos.y_offset):
            found.append((dx, dy, info.cluster, group(text, info.cluster, end_of[info.cluster], k)))
        if glyph_bounds(n):
            top = max(top, glyph_bounds(n)[3] + pos.y_offset)
            bottom = min(bottom, glyph_bounds(n)[1] + pos.y_offset)
        x += pos.x_advance
    widths.append(x); tops.append(top); bottoms.append(bottom)
    for dx, dy, cl, g in found:   # flags: bit 0 the Simorgh, bits 1-3 the layer
        xs.append(round(dx)); ys.append(round(dy))
        flags.append((1 if any(a <= cl < z for a, z in sim) else 0) | g << 1)
    exp = expected(text)
    if len(found) != exp:
        off += 1
        if off <= 12: print("mismatch", li, len(found), exp, text)
starts.append(len(xs))
print("dots", len(xs), "lines whose dots differ from the letters:", off, "simorgh dots", sum(f & 1 for f in flags),
      "by layer", {g: sum(1 for f in flags if f >> 1 == g) for g in (1, 2, 3, 4)})

# ---------- the same font with its dots taken off: the bare skeletons, rasm ----------

rasm = TTFont(font_path)
for name in DOT_MARKS:   # a dot drawn as nothing, wherever the font places it
    rasm["glyf"][name] = Glyph()
sub = subset.Subsetter(opts)
sub.populate(text="".join(chars))
sub.subset(rasm)
rasm.flavor = "woff2"
rasm.save(os.path.join(out, "rasm.woff2"))

# ---------- write ----------

with open(os.path.join(out, "dots.bin"), "wb") as f:
    f.write(struct.pack(f"<{len(xs)}h", *xs))
    f.write(struct.pack(f"<{len(ys)}h", *ys))
    f.write(bytes(flags))
# how big the page has to be for this hand: wide enough for nearly every line, tall enough
# for nearly every rise and fall (the rest are scaled down to fit), and how big a dot is
pct = lambda v, q: sorted(v)[int(len(v) * q)]
top, bottom = pct(tops, .995), pct(bottoms, .005)
dot_px = ink(H["one"])
dot = max(max(q[0] for q in dot_px) - min(q[0] for q in dot_px), max(q[1] for q in dot_px) - min(q[1] for q in dot_px))
page = {"colW": round(pct(widths, .99) / upem + .4, 2), "rowH": round((top - bottom) / upem + .25, 2),
        "base": round(top / upem + .12, 2), "dot": round(dot / upem * 1.25, 3)}
# the hand's own dot, as an SVG path centred on itself, in em: the cursor and the shape of every bird
p = Poly(gs); gs[H["one"]].draw(p)
cx = sum(q[0] for q in dot_px) / len(dot_px); cy = sum(q[1] for q in dot_px) / len(dot_px)
page["dotPath"] = " ".join("M" + " L".join(f"{(x - cx) / upem:.4f} {(cy - y) / upem:.4f}" for x, y in poly) + " Z" for poly in p.polys)
print("page", {k: v for k, v in page.items() if k != "dotPath"})
page["dir"] = H.get("dir", "rtl")
json.dump({"hand": hand, "upem": upem, "dots": len(xs), "lines": lines, "widths": widths, "starts": starts,
           "sections": sections, "page": page},
          open(os.path.join(out, "text.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print("wrote", out)
