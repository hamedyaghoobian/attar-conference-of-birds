# Edward FitzGerald's Bird-Parliament (1889, public domain), from the sacred-texts.com
# transcription, as plain lines of verse: page furniture, adverts and line numbers removed.
#
#   python3 -I tools/fitzgerald.py data/fitzgerald-html/bp01.htm data/fitzgerald.json

import html, json, re, sys

src, out = sys.argv[1:3]
t = open(src, encoding="utf-8", errors="replace").read()
t = re.sub(r"(?is)<(script|style|svg|noscript)\b.*?</\1>", "", t)
t = re.sub(r"(?i)<br\s*/?>", "\n", t)
t = re.sub(r"(?i)</(p|div|h\d|li)>", "\n", t)
rows = [l.strip() for l in html.unescape(re.sub(r"<[^>]+>", "", t)).split("\n") if l.strip()]

start = rows.index("by Edward FitzGerald") + 1
end = next(i for i, l in enumerate(rows) if l.startswith("Their Road is thine")) + 1
JUNK = re.compile(r"Advertisement|Own the Wisdom|Buy USB|Get the drive|go ad-free|Become a Supporter|^p\. \d+$")
lines = []
for l in rows[start:end]:
    if JUNK.search(l): continue
    l = re.sub(r"(\s+|(?<=[—:;,.!?]))\d+$", "", l)   # the editor's line numbers, every fifth line
    l = re.sub(r"\s+", " ", l).strip()
    if l: lines.append(l)
json.dump({"title": "Bird-Parliament", "translator": "Edward FitzGerald", "year": 1889,
           "source": "https://sacred-texts.com/isl/bp/bp01.htm", "lines": lines},
          open(out, "w"), ensure_ascii=False, indent=0)
print(len(lines), "lines;", sum(l.count("i") + l.count("j") for l in lines), "i and j")
for l in lines[:3] + ["..."] + lines[-3:]: print(" ", l)
odd = [l for l in lines if re.search(r"[\[\]{}*†]|^\d|\d$", l)]
print("odd lines:", odd[:10])
