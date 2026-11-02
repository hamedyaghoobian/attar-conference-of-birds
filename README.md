# What the Birds Leave

Readings, Otherwise, No. 2. Attar's *Manteq al-Tayr* (The Conference of the Birds) with every
letter taken out: the 112,052 dots that remain fly as a murmuration and come home to the verse
when the viewer is still.

- `data/manteq-ganjoor.json`: the Persian text from the [Ganjoor](https://ganjoor.net/attar/manteghotteyr) API, 211 poems, 4,697 couplets.
- `data/fitzgerald.json`: Edward FitzGerald's *Bird-Parliament* (1889, public domain), 1,438 lines, parsed from sacred-texts.com by `tools/fitzgerald.py`.
- `tools/extract.py`: shapes every hemistich in one hand with HarfBuzz, lifts each dot from where it falls, and writes `site/data/<hand>/` (dots, text, and two subset fonts: the hand, and the hand with its dots removed). Three hands: naskh (Amiri), nastaliq (Gulzar), and English (FitzGerald in EB Garamond, whose only dots are on i and j).
- `site/`: the page (WebGL, no build step). Serve it with `python3 -m http.server -d site`.

```
uv venv .venv && uv pip install --python .venv/bin/python uharfbuzz fonttools brotli pillow
.venv/bin/python tools/extract.py data/manteq-ganjoor.json naskh site/data/naskh
.venv/bin/python tools/extract.py data/manteq-ganjoor.json nastaliq site/data/nastaliq
mkdir -p data/fitzgerald-html && curl -sL https://sacred-texts.com/isl/bp/bp01.htm -o data/fitzgerald-html/bp01.htm
python3 -I tools/fitzgerald.py data/fitzgerald-html/bp01.htm data/fitzgerald.json
.venv/bin/python tools/extract.py data/fitzgerald.json english site/data/english
```

Amiri (Khaled Hosny), Gulzar (Simon Cozens) and EB Garamond (Georg Duffner, Octavio Pardo) are under the SIL Open Font License 1.1 (`fonts/OFL.txt`); the subset fonts in `site/data` are modified versions of them, with each license beside them.
