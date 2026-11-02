// What the Birds Leave: the dots of Attar's Manteq al-Tayr, flown as a murmuration.
// Every dot is a point drawn in WebGL, lifted from where it falls in the poem set in one of two
// hands: Amiri (naskh) or Gulzar (nastaliq). While the viewer moves, the dots fly as one flock.
// When the viewer is still they come home to the verse, right to left, and the letters they
// belong to show faintly beneath them. Change the hand and the same dots land somewhere else.

const HANDS = ["naskh", "nastaliq", "english"];
const FLOCK = 112052;          // the dots of the Persian poem: every hand flies this many birds, however few land
const HAND_KEY = "what-the-birds-leave:hand";
let COL_W, ROW_H, BASE, DOT, COL_PITCH;   // set by each hand's page: its slot, row, baseline and dot, in em
let LTR = false, PER = 2;      // English runs left to right, one line to a row; Persian two half-lines
const GUTTER = 1.4;            // between the two halves of a couplet
const COL_GAP = 4.5;           // between columns of the book
const MARGIN = 6;
const ASPECT = 1.45;           // the book is laid out to roughly this width over height
const MAX_PX_PER_EM = 110;     // closest zoom
const READ_PX_PER_EM = 7;      // from here on the letters show and the couplets can be read
const IDLE_MS = 2200;          // stillness before the birds come home
const FIRST_IDLE_MS = 5500;    // the first time, let the flock be seen
const LAND_MS = 5200;          // a full landing, swept right to left across the view
const LIFT_MS = 900;
const THEME_KEY = "what-the-birds-leave:theme";

const PALETTES = {
  dark:  { ink: [236, 226, 208], gold: [232, 172, 58], letters: [236, 226, 208], letterA: .34, title: [232, 172, 58] },
  light: { ink: [24, 19, 15],    gold: [168, 104, 6],  letters: [42, 33, 28],    letterA: .30, title: [150, 96, 10] },
};

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const frame = document.getElementById("frame");
const sky = document.getElementById("sky");
const letters = document.getElementById("letters");
const lctx = letters.getContext("2d");
const panel = document.getElementById("panel");
const hint = document.getElementById("hint");

let T, rows, perCol, cols, W, H;
let lineX, lineY, lineS, lineRow, dotLine;
let gl, prog, U = {}, N = 0;
let cw = 1, ch = 1, dpr = 1;
let view = { s: 1, x: 0, y: 0 };
let land = 0, lastMove = performance.now() + FIRST_IDLE_MS - IDLE_MS;
let pointer = null, startle = 0;
let palette = PALETTES[document.documentElement.dataset.theme] || PALETTES.dark;
let lettersKey = "";
let running = true;
let hand = (() => {
  const q = new URLSearchParams(location.search).get("hand");
  if (HANDS.includes(q)) return q;
  try { const h = localStorage.getItem(HAND_KEY); if (HANDS.includes(h)) return h; } catch (_) {}
  return "naskh";
})();
let shown = -1;
let switching = null;          // the hand the flock is on its way to
let buf;

// ---------- data ----------

const loaded = {};
function fetchHand(h) {
  if (loaded[h]) return loaded[h];
  const dir = `data/${h}/`;
  const face = (name, file) => new FontFace(name, `url(${dir}${file})`).load()
    .then(f => document.fonts.add(f)).catch(() => {});
  return loaded[h] = Promise.all([
    fetch(dir + "text.json").then(r => r.json()),
    fetch(dir + "dots.bin").then(r => r.arrayBuffer()),
    face(`Hand ${h}`, "hand.woff2"),
    face(`Rasm ${h}`, "rasm.woff2"),
  ]).then(([text, bin]) => {
    const n = text.dots;
    return { text, xs: new Int16Array(bin, 0, n), ys: new Int16Array(bin, n * 2, n), flags: new Uint8Array(bin, n * 4, n) };
  });
}

function useHand(h, data) {
  hand = h;
  T = data.text;
  N = T.dots;
  ({ colW: COL_W, rowH: ROW_H, base: BASE, dot: DOT } = T.page);
  LTR = T.page.dir === "ltr";
  PER = LTR ? 1 : 2;
  COL_PITCH = PER * COL_W + (PER - 1) * GUTTER + COL_GAP;
  layout();
  const cp = document.getElementById("couplet");
  cp.dir = LTR ? "ltr" : "rtl";
  cp.lang = LTR ? "en" : "fa";
  document.body.classList.toggle("hand-english", LTR);
  if (LTR && solo >= 0) chooseLayer(-1);
  if (LTR && explodeTarget) setExplode(false);
  shown = -1;
  lettersKey = "";
  document.getElementById("couplet").style.fontFamily = `"Hand ${h}", serif`;
  rasmPage = null;
  if (gl) { useSprite(); useCursor(); }
  for (const b of document.querySelectorAll("[data-hand]")) b.setAttribute("aria-pressed", b.dataset.hand === h);
}

// ---------- layout: the book as a manuscript, columns read right to left (English: left to right) ----------

// a column's outer edge, and the slot a line sits in: Persian puts the first half-line on the right
const colEdge = c => LTR ? MARGIN + c * COL_PITCH : W - MARGIN - c * COL_PITCH;
const colAt = x => Math.floor((LTR ? x - MARGIN : W - MARGIN - x) / COL_PITCH);
const slotLeft = (c, h) => LTR ? colEdge(c) : colEdge(c) - (h + 1) * COL_W - h * GUTTER;
const colCentre = c => LTR ? colEdge(c) + COL_W / 2 : colEdge(c) - COL_W - GUTTER / 2;

const bare = s => s.replace(/[\s‌]/g, "");

function layout() {
  rows = [];
  T.sections.forEach((s, si) => {
    rows.push({ kind: 2, si });
    s.poems.forEach((p, pi) => {
      const same = pi === 0 && (bare(p.title).startsWith(bare(s.title)) || bare(s.title).startsWith(bare(p.title)));
      if (!same) rows.push({ kind: 1, si, pi });
      for (let l = p.start; l < p.end; l += PER) rows.push({ kind: 0, l, si, pi });
    });
  });
  cols = Math.max(1, Math.round(Math.sqrt(ASPECT * ROW_H * rows.length / COL_PITCH)));
  perCol = Math.ceil(rows.length / cols);
  W = cols * COL_PITCH - COL_GAP + 2 * MARGIN;
  H = perCol * ROW_H + 2 * MARGIN;

  const n = T.lines.length;
  lineX = new Float32Array(n); lineY = new Float32Array(n); lineS = new Float32Array(n);
  lineRow = new Int32Array(n);
  rows.forEach((r, i) => {
    r.col = Math.floor(i / perCol);
    r.row = i % perCol;
    if (r.kind !== 0) return;
    const base = MARGIN + r.row * ROW_H + BASE;
    for (let h = 0; h < PER && r.l + h < n; h++) {
      const l = r.l + h;
      const w = T.widths[l] / T.upem;
      const s = Math.min(1, (COL_W - .4) / w);
      // Persian half-lines are centred in their slots, English verse is set flush left
      lineX[l] = LTR ? slotLeft(r.col, h) : slotLeft(r.col, h) + COL_W / 2 - w * s / 2;
      lineY[l] = base;
      lineS[l] = s;
      lineRow[l] = i;
    }
  });
}

function homes({ xs, ys, flags }) {
  // every bird sets out; those with no dot to land on in this hand are lost on the way (layer 7)
  const v = new Float32Array(Math.max(FLOCK, N) * 3);
  for (let i = N; i < FLOCK; i++) v[i * 3 + 2] = 7 << 1;
  dotFlags = flags;
  layerCount = [0, 0, 0, 0, 0, 0];
  for (const f of flags) layerCount[layerOf(f)]++;
  dotLine = new Int32Array(N);
  for (let l = 0; l < T.lines.length; l++) {
    const k = lineS[l] / T.upem;
    for (let i = T.starts[l]; i < T.starts[l + 1]; i++) {
      v[i * 3] = lineX[l] + xs[i] * k;
      v[i * 3 + 1] = lineY[l] - ys[i] * k;
      v[i * 3 + 2] = flags[i];
      dotLine[i] = l;
    }
  }
  return v;
}

// ---------- WebGL ----------

const VS = `#version 300 es
in vec2 aHome;
in float aFlag;
uniform vec2 uRes;       // css px
uniform vec3 uView;      // px per em, offset x, offset y
uniform float uDpr, uTime, uLand;
uniform float uThin;      // fewer pixels for the same flock: lighter birds
uniform vec3 uFlock;     // centre x, y and size, in em
uniform vec3 uPointer;   // css px x, y, strength
uniform float uDot;      // a resting dot's size, in em
// taken apart: each layer a plane seen from above, as an affine map of the page
uniform float uExplode, uExS;
uniform vec2 uSolo;      // the layer chosen, and how far the others have gone (0..1); -1 for none
uniform vec3 uExA;       // a, b, d of the map (x' = a x + e, y' = b x + d y + f)
uniform vec4 uExE;       // e and f at layer 0, and how much each moves per layer
out float vFlag;
out float vSize;
out float vAlpha;

float h(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  float id = float(gl_VertexID);
  vec3 r = vec3(h(id * 1.37 + .11), h(id * 2.71 + .37), h(id * 3.97 + .73));

  // the flock: a long ribbon of birds folding over itself, the tail following the head
  vec3 q = r * 2. - 1.;
  q = sign(q) * pow(abs(q), vec3(1.25, 1.7, 1.4)) * vec3(1.7, .40, .75);   // a dense core, thin edges
  float t = uTime * .2 - (q.x + 1.7) * .34;
  q.y += .36 * sin(q.x * 2.1 + t * 2.0) + .12 * sin(q.z * 4.0 + t * 1.4);
  q.z += .30 * cos(q.x * 1.6 - t * 1.7);
  float a = .7 * sin(t * .61) + .35 * sin(t * .23 + 1.);
  q.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * q.xy;
  float b = t * .45;
  q.xz = mat2(cos(b), sin(b), -sin(b), cos(b)) * q.xz;
  vec2 wander = vec2(.9 * sin(t * .83) + .35 * sin(t * 2.1 + 2.), .55 * sin(t * 1.17 + 1.) + .2 * sin(t * 2.9));
  float depth = 1. + .4 * q.z;
  vec2 flock = uFlock.xy + (wander * .45 + q.xy * depth) * uFlock.z;

  // coming home: right to left across the view, the way the poem is read
  vec2 homeS = aHome * uView.x + uView.yz;
  vec2 sn = clamp(homeS / uRes, 0., 1.);
  float stagger = .7 * clamp(.84 * (1. - sn.x) + .16 * sn.y + .05 * r.x, 0., 1.);
  float e = smoothstep(0., 1., uLand * 1.7 - stagger);

  vec2 d = aHome - flock;
  vec2 pos = mix(flock, aHome, e) + vec2(-d.y, d.x) * .22 * sin(3.14159 * e) * (r.y - .5);
  // flags: bit 0 the Simorgh, the rest the layer (1 one dot, 2 two, 3 three, 4 the Persian letters)
  float simorgh = mod(aFlag, 2.);
  float layer = simorgh > .5 ? 5. : floor(aFlag / 2.);
  // lost on the way: as the others come home these scatter out of the sky and are gone
  float lost = step(6.5, layer);
  float gone = smoothstep(0., 1., uLand * 1.4 - .4 * r.x);
  pos = mix(pos, flock + normalize(vec2(r.x - .5, r.z - .5) + .001) * uFlock.z * (2. + 5. * r.y) * gone, lost);
  vec2 s = pos * uView.x + uView.yz;
  vec2 ex = vec2(uExA.x * pos.x + uExE.x + layer * uExE.z, uExA.y * pos.x + uExA.z * pos.y + uExE.y + layer * uExE.w);
  s = mix(s, ex, uExplode);

  // a pointer near a resting line startles its birds
  vec2 dp = s - uPointer.xy;
  float R = 52.;
  float L = length(dp);
  if (L < R && uPointer.z > 0.) {
    float k = 1. - L / R;
    k *= k * uPointer.z * e * (1. - uExplode);
    float ang = uTime * 3. + r.z * 6.283;
    s += normalize(dp + .001) * R * .8 * k + vec2(cos(ang), sin(ang)) * R * .3 * k;
  }

  gl_Position = vec4(s.x / uRes.x * 2. - 1., 1. - s.y / uRes.y * 2., 0., 1.);
  float settled = max(mix(.9, 1.2, uThin), uDot * mix(uView.x, uExS, uExplode));
  float flying = (1.4 + 1.3 * r.z) * depth;
  vSize = mix(flying, settled, e) * (1. + .45 * simorgh) * uDpr;
  gl_PointSize = vSize;
  vFlag = simorgh;
  vAlpha = mix(.5, .95, e) * mix(uThin, 1., smoothstep(2., 6., vSize / uDpr));
  // one layer chosen: the others leave; taken apart they stay faintly, so you can see where they were
  if (uSolo.x >= 0. && abs(layer - uSolo.x) > .5) vAlpha *= 1. - uSolo.y * (1. - .12 * uExplode);
  vAlpha *= 1. - lost * gone;
  if (lost > .5) { vSize = flying * uDpr; gl_PointSize = vSize; }   // a lost bird never comes close enough to grow
}`;

const FS = `#version 300 es
precision mediump float;
in float vFlag;
in float vSize;
in float vAlpha;
uniform vec3 uInk, uGold;
uniform sampler2D uSprite;                             // the hand's own dot
out vec4 o;
void main() {
  float m = texture(uSprite, gl_PointCoord).a;
  m = mix(1., m, smoothstep(1.5, 4., vSize));          // too small to have a shape: a speck
  if (m * vAlpha <= .004) discard;
  vec3 c = mix(uInk, uGold, vFlag);
  o = vec4(c, 1.) * m * vAlpha;
}`;

function compile(vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function setupGL(verts) {
  gl = sky.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error("no webgl2");
  prog = compile(VS, FS);
  gl.useProgram(prog);
  for (const n of ["uRes", "uView", "uDpr", "uTime", "uLand", "uThin", "uFlock", "uPointer", "uInk", "uGold", "uDot",
                   "uExplode", "uExS", "uExA", "uExE", "uSprite", "uSolo"])
    U[n] = gl.getUniformLocation(prog, n);
  buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const aHome = gl.getAttribLocation(prog, "aHome");
  const aFlag = gl.getAttribLocation(prog, "aFlag");
  gl.enableVertexAttribArray(aHome);
  gl.vertexAttribPointer(aHome, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(aFlag);
  gl.vertexAttribPointer(aFlag, 1, gl.FLOAT, false, 12, 8);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  sprite = gl.createTexture();
  useSprite();
  usePalette();
}

// every bird is drawn in the shape of the hand's own dot, cut from the font
let sprite;
function useSprite() {
  const n = 64, c = document.createElement("canvas");
  c.width = c.height = n;
  const x = c.getContext("2d");
  x.translate(n / 2, n / 2);
  x.scale(n / DOT, n / DOT);
  x.fillStyle = "#fff";
  x.fill(new Path2D(T.page.dotPath));
  gl.bindTexture(gl.TEXTURE_2D, sprite);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// and so is the pointer: one more dot among them
function useCursor() {
  if (explodeTarget) { sky.style.cursor = "default"; return; }
  const [r, g, b] = palette.ink, edge = palette === PALETTES.light ? "#f4efe6" : "#0b0a09";
  const v = DOT * .62;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="${-v} ${-v} ${2 * v} ${2 * v}">` +
    `<path d="${T.page.dotPath}" fill="rgb(${r},${g},${b})" stroke="${edge}" stroke-width="${v * .09}"/></svg>`;
  sky.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 11 11, crosshair`;
}

function usePalette() {
  gl.useProgram(prog);
  gl.uniform3fv(U.uInk, palette.ink.map(c => c / 255));
  gl.uniform3fv(U.uGold, palette.gold.map(c => c / 255));
  lettersKey = "";
  rasmPage = null;
  useCursor();
}

// ---------- taking the flock apart into its layers ----------

const LAYERS = [
  ["I · the letters", "every letter with its dots taken off"],
  ["II · one dot", '<span lang="fa">ب ج خ ذ ز ض ظ غ ف ن</span>'],
  ["III · two dots", '<span lang="fa">ت ق ی</span>'],
  ["IV · three dots", '<span lang="fa">ث ش</span>'],
  ["V · Persian", '<span lang="fa">پ چ ژ</span>, the letters Persian added to Arabic'],
  ["VI · the Simorgh", '<span lang="fa">سیمرغ</span>, in gold'],
];
const YAW = -0.32, PITCH = 1.02, GAP = .26;   // the planes, seen from above, a quarter of a page apart
let explode = 0, explodeTarget = 0, layerCount = [];
let solo = -1, soloAmt = 0, peek = -1;   // the layer chosen, how far the rest have gone, a layer looked at
let dotFlags;
let rasmPage = null;

// the affine map of layer z, in its exploded place: x' = a x + e(z), y' = b x + d y + f(z)
function exMap() {
  const cy = Math.cos(YAW), sy = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
  const zMid = (LAYERS.length - 1) / 2, gap = GAP * H;
  const raw = (x, y, z) => {
    const zz = (z - zMid) * gap, X = x - W / 2, Y = y - H / 2;
    return [cy * X + sy * zz, cp * Y + sp * sy * X - sp * cy * zz];
  };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const z of [0, LAYERS.length - 1]) for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const [a, b] = raw(x, y, z);
    x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
  }
  const S = Math.min(cw * .7 / (x1 - x0), ch * .86 / (y1 - y0));
  const Cx = cw * .42 - S * (x0 + x1) / 2, Cy = ch * .5 - S * (y0 + y1) / 2;
  const e0 = Cx + S * (-cy * W / 2 - sy * zMid * gap), f0 = Cy + S * (-cp * H / 2 - sp * sy * W / 2 + sp * cy * zMid * gap);
  return { S, a: S * cy, b: S * sp * sy, d: S * cp, e0, f0, de: S * sy * gap, df: -S * sp * cy * gap };
}

// a layer's map, part way between flat on the wall and taken apart
function layerMatrix(m, z, t) {
  const f = [view.s, 0, 0, view.s, view.x, view.y];
  const x = [m.a, m.b, 0, m.d, m.e0 + z * m.de, m.f0 + z * m.df];
  return f.map((v, i) => v + (x[i] - v) * t);
}

// the whole page of bare letters, drawn once, small, to be laid flat under the layers
function buildRasmPage() {
  const k = Math.min(3.2, 4000 / W, 4000 / H);
  const c = document.createElement("canvas");
  c.width = Math.ceil(W * k); c.height = Math.ceil(H * k);
  const x = c.getContext("2d");
  const [r, g, b] = palette.letters;
  x.fillStyle = `rgba(${r},${g},${b},.75)`;
  x.direction = "rtl"; x.textAlign = "left"; x.textBaseline = "alphabetic";
  let size = 0;
  for (let l = 0; l < T.lines.length; l++) {
    const px = Math.round(k * lineS[l] * 100) / 100;
    if (px !== size) { x.font = `${px}px "Rasm ${hand}"`; size = px; }
    x.fillText(T.lines[l], lineX[l] * k, lineY[l] * k);
  }
  return { c, k };
}

function drawLayers(t) {
  lettersKey = "";
  if (!rasmPage) rasmPage = buildRasmPage();
  const m = exMap();
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.clearRect(0, 0, letters.width, letters.height);
  const [r, g, b] = palette.letters;
  for (let z = LAYERS.length - 1; z >= 0; z--) {
    const [a, bb, c, d, e, f] = layerMatrix(m, z, t);
    lctx.setTransform(a * dpr, bb * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    lctx.strokeStyle = `rgba(${r},${g},${b},${.45 * t})`;
    lctx.lineWidth = 1 / Math.max(.01, Math.hypot(a, bb));
    lctx.strokeRect(0, 0, W, H);
    if (z === 0) {
      lctx.globalAlpha = .55 + .2 * t;
      lctx.drawImage(rasmPage.c, 0, 0, W, H);
      lctx.globalAlpha = 1;
    }
  }
  labels.forEach((el, z) => {
    const [a, bb, , d, e, f] = layerMatrix(m, z, 1);
    const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [a * x + e, bb * x + d * y + f]);
    const [x, y] = corners.reduce((p, q) => q[0] > p[0] ? q : p);
    el.style.opacity = t * t;
    el.style.transform = `translate(${x + 14}px, ${y}px) translateY(-50%)`;
  });
  return m;
}

const labels = LAYERS.map(([title, sub], z) => {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "layer-label";
  el.title = "Go through this layer alone";
  el.innerHTML = `<b>${title}</b><small>${sub}</small><small class="n"></small>`;
  el.onpointerenter = el.onfocus = () => { peek = z; };
  el.onpointerleave = el.onblur = () => { if (peek === z) peek = -1; };
  el.onclick = () => chooseLayer(z);
  frame.appendChild(el);
  return el;
});

// go through one layer alone: the flock is put back together with only those birds in it
const soloChip = document.getElementById("solo");
function chooseLayer(z) {
  solo = z;
  peek = -1;
  if (z >= 0) {
    const [title, sub] = LAYERS[z];
    soloChip.querySelector(".what").innerHTML = `${title}<small>${sub}</small>`;
    setExplode(false);
  }
  soloChip.hidden = z < 0;
  shown = -1;
  try {
    const url = new URL(location.href);
    if (z >= 0) url.searchParams.set("layer", z + 1); else url.searchParams.delete("layer");
    history.replaceState(null, "", url);
  } catch (_) {}
}
soloChip.querySelector("button").onclick = () => chooseLayer(-1);

function countLayers() {
  labels[0].querySelector(".n").textContent = `${(T.lines.length).toLocaleString("en")} half-lines`;
  labels.slice(1).forEach((el, i) => el.querySelector(".n").textContent = `${layerCount[i + 1].toLocaleString("en")} dots`);
}

function setExplode(on) {
  explodeTarget = on ? 1 : 0;
  fit();
  lastMove = 0;                  // the birds settle while they are being looked at from above
  document.body.classList.toggle("exploded", on);
  useCursor();
}

// ---------- view ----------

const fitScale = () => Math.min(cw / W, ch / H);

function clampView() {
  view.s = Math.min(MAX_PX_PER_EM, Math.max(fitScale(), view.s));
  const pw = W * view.s, ph = H * view.s;
  view.x = pw <= cw ? (cw - pw) / 2 : Math.min(0, Math.max(cw - pw, view.x));
  view.y = ph <= ch ? (ch - ph) / 2 : Math.min(0, Math.max(ch - ph, view.y));
}

function fit() { view.s = fitScale(); clampView(); }

function resize() {
  const r = frame.getBoundingClientRect();
  const wasFit = Math.abs(view.s - fitScale()) < 1e-6;
  const cx = (cw / 2 - view.x) / view.s, cy = (ch / 2 - view.y) / view.s;
  cw = Math.max(1, r.width); ch = Math.max(1, r.height);
  dpr = Math.min(2, devicePixelRatio || 1);
  for (const c of [sky, letters]) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  if (gl) gl.viewport(0, 0, sky.width, sky.height);
  if (wasFit || !T) fit();
  else { view.x = cw / 2 - cx * view.s; view.y = ch / 2 - cy * view.s; clampView(); }
  lettersKey = "";
}

function moved() { lastMove = performance.now(); }

function zoomAt(px, py, f) {
  const s = Math.min(MAX_PX_PER_EM, Math.max(fitScale(), view.s * f));
  view.x = px - (px - view.x) * s / view.s;
  view.y = py - (py - view.y) * s / view.s;
  view.s = s;
  clampView();
  moved();
}

// ---------- the letters, faint and dotless, under the resting dots ----------

function drawLetters(alpha) {
  const key = `${view.s.toFixed(3)} ${view.x.toFixed(1)} ${view.y.toFixed(1)} ${alpha.toFixed(3)} ${cw} ${ch}`;
  if (key === lettersKey) return;
  lettersKey = key;
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lctx.clearRect(0, 0, cw, ch);
  if (alpha < .005) return;
  const [r, g, b] = palette.letters;
  const [tr, tg, tb] = palette.title;
  lctx.direction = LTR ? "ltr" : "rtl";
  lctx.textBaseline = "alphabetic";
  const x0 = -view.x / view.s, x1 = (cw - view.x) / view.s;
  const y0 = -view.y / view.s, y1 = (ch - view.y) / view.s;
  const cFrom = Math.max(0, Math.min(colAt(x0), colAt(x1)));
  const cTo = Math.min(cols - 1, Math.max(colAt(x0), colAt(x1)));
  const rFrom = Math.max(0, Math.floor((y0 - MARGIN) / ROW_H) - 1);
  const rTo = Math.min(perCol - 1, Math.ceil((y1 - MARGIN) / ROW_H) + 1);
  let size = 0;
  for (let c = cFrom; c <= cTo; c++) {
    for (let rr = rFrom; rr <= rTo; rr++) {
      const row = rows[c * perCol + rr];
      if (!row) break;
      if (row.kind === 0) {
        lctx.textAlign = "left";
        lctx.fillStyle = `rgba(${r},${g},${b},${palette.letterA * alpha})`;
        for (let l = row.l; l < row.l + PER && l < T.lines.length; l++) {
          const px = Math.round(view.s * lineS[l] * 100) / 100;
          if (px !== size) { lctx.font = `${px}px "Rasm ${hand}"`; size = px; }
          lctx.fillText(T.lines[l], lineX[l] * view.s + view.x, lineY[l] * view.s + view.y);
        }
      } else {
        const sec = T.sections[row.si];
        const title = row.kind === 2 ? sec.title : sec.poems[row.pi].title;
        const px = view.s * (row.kind === 2 ? 1.25 : .85);
        lctx.font = `${px}px "Hand ${hand}"`; size = px;
        lctx.textAlign = "center";
        lctx.fillStyle = `rgba(${tr},${tg},${tb},${(row.kind === 2 ? .8 : .55) * alpha})`;
        const y = MARGIN + row.row * ROW_H + BASE;
        lctx.fillText(title, colCentre(c) * view.s + view.x, y * view.s + view.y);
      }
    }
  }
}

// ---------- the couplet under the pointer ----------

const layerOf = f => f & 1 ? 5 : f >> 1;
const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

function lineAt(px, py) {
  const x = (px - view.x) / view.s, y = (py - view.y) / view.s;
  const c = colAt(x);
  const rr = Math.floor((y - MARGIN) / ROW_H);
  if (c < 0 || c >= cols || rr < 0 || rr >= perCol) return -1;
  const row = rows[c * perCol + rr];
  if (!row || row.kind !== 0) return -1;
  for (let h = 0; h < PER; h++) if (x >= slotLeft(c, h) && x <= slotLeft(c, h) + COL_W) return row.l + h;
  return -1;
}

function showPanel(l) {
  if (l === shown) return;
  shown = l;
  if (l < 0) { panel.classList.remove("show"); return; }
  const row = rows[lineRow[l]];
  const sec = T.sections[row.si], poem = sec.poems[row.pi];
  const a = row.l, b = row.l + 1;
  const half = i => i === l ? `<b>${esc(T.lines[i])}</b>` : esc(T.lines[i]);
  let n = 0;
  for (let i = T.starts[l]; i < T.starts[l + 1]; i++) n += solo <= 0 || layerOf(dotFlags[i]) === solo;
  if (LTR) {
    document.getElementById("where").textContent = `${sec.title} · ${poem.title}`;
    document.getElementById("couplet").innerHTML = `<b>${esc(T.lines[l])}</b>`;
    document.getElementById("count").textContent =
      `line ${(l + 1).toLocaleString("en")} of ${T.lines.length.toLocaleString("en")} · ${n} ${n === 1 ? "dot" : "dots"}`;
    panel.classList.add("show");
    return;
  }
  document.getElementById("where").innerHTML =
    `<span lang="fa">${esc(sec.title)}${poem.title !== sec.title ? " · " + esc(poem.title) : ""}</span>`;
  document.getElementById("couplet").innerHTML = `${half(a)}<span class="sep">✦</span>${half(b)}`;
  n = 0;
  for (let i = T.starts[l]; i < T.starts[l + 1]; i++) n += solo <= 0 || layerOf(dotFlags[i]) === solo;
  const kind = solo > 0 ? ` ${LAYERS[solo][0].split(" · ")[1]}` : "";
  document.getElementById("count").textContent =
    `couplet ${((a / 2) + 1).toLocaleString("en")} of ${(T.lines.length / 2).toLocaleString("en")} · ${n}${kind} ${n === 1 ? "dot" : "dots"} in this half`;
  panel.classList.add("show");
}

// ---------- input ----------

const pts = new Map();
let pinch = null, dragFrom = null;

function local(e) {
  const r = frame.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

sky.addEventListener("pointerdown", e => {
  sky.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, local(e));
  if (pts.size === 1) { dragFrom = local(e); sky.classList.add("dragging"); }
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
  }
});

sky.addEventListener("pointermove", e => {
  const p = local(e);
  pointer = p;
  if (!pts.has(e.pointerId)) return;
  const prev = pts.get(e.pointerId);
  pts.set(e.pointerId, p);
  if (explodeTarget) return;
  if (pts.size === 2 && pinch) {
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch.d);
    pinch.d = d;
  } else if (pts.size === 1) {
    if (dragFrom && Math.hypot(p[0] - dragFrom[0], p[1] - dragFrom[1]) < 3) return;
    dragFrom = null;
    view.x += p[0] - prev[0];
    view.y += p[1] - prev[1];
    clampView();
    moved();
  }
});

function release(e) {
  pts.delete(e.pointerId);
  if (pts.size < 2) pinch = null;
  if (pts.size === 0) sky.classList.remove("dragging");
  if (e.pointerType !== "mouse" && pts.size === 0) pointer = null;
}
sky.addEventListener("pointerup", release);
sky.addEventListener("pointercancel", release);
sky.addEventListener("pointerleave", () => { if (!pts.size) pointer = null; });

sky.addEventListener("wheel", e => {
  if (explodeTarget) return;
  e.preventDefault();
  const [x, y] = local(e);
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(x, y, Math.exp(-dy * .0016));
}, { passive: false });

const centre = () => [cw / 2, ch / 2];
document.getElementById("zoom-in").onclick = () => zoomAt(...centre(), 1.8);
document.getElementById("zoom-out").onclick = () => zoomAt(...centre(), 1 / 1.8);
document.getElementById("reset").onclick = () => { if (explodeTarget) setExplode(false); fit(); moved(); };
document.getElementById("layers").onclick = () => setExplode(!explodeTarget);

addEventListener("keydown", e => {
  if (e.target.closest && e.target.closest("input, textarea")) return;
  const r = frame.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return;
  const k = e.key, step = 80;
  if (explodeTarget) { if (k === "Escape") setExplode(false); return; }
  if (k === "Escape" && solo >= 0) { chooseLayer(-1); return; }
  if (k === "+" || k === "=") zoomAt(...centre(), 1.5);
  else if (k === "-" || k === "_") zoomAt(...centre(), 1 / 1.5);
  else if (k === "0") { fit(); moved(); }
  else if (k.startsWith("Arrow")) {
    e.preventDefault();
    view.x += k === "ArrowLeft" ? step : k === "ArrowRight" ? -step : 0;
    view.y += k === "ArrowUp" ? step : k === "ArrowDown" ? -step : 0;
    clampView(); moved();
  }
});

const themeBtn = document.getElementById("theme");
function labelTheme() { themeBtn.textContent = document.documentElement.dataset.theme === "light" ? "dark" : "light"; }
themeBtn.onclick = () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
  palette = PALETTES[next];
  labelTheme();
  if (gl) usePalette();
};
labelTheme();

// ---------- the loop ----------

let then = performance.now();
let soloShown = -1;
const t0 = then;

function frameLoop(now) {
  if (!running) return;
  const dt = Math.min(100, now - then);
  then = now;
  const still = now - lastMove > IDLE_MS;
  if (switching) lastMove = now;   // no landing until the new hand is ready
  land = still && !switching ? Math.min(1, land + dt / (reduceMotion ? 1200 : LAND_MS)) : Math.max(0, land - dt / LIFT_MS);

  explode += (explodeTarget - explode) * (1 - Math.pow(.02, dt / 1000));
  if (Math.abs(explodeTarget - explode) < .0005) explode = explodeTarget;
  const ex = explode * explode * (3 - 2 * explode);

  const near = pointer && !pts.size && land > .9 && !explodeTarget;
  const want = explodeTarget ? (peek >= 0 ? peek : solo) : solo;
  if (want >= 0) soloShown = want;
  soloAmt += ((want >= 0 ? 1 : 0) - soloAmt) * (1 - Math.pow(.01, dt / 1000));
  startle += ((near ? 1 : 0) - startle) * Math.min(1, dt / 250);

  const vw = cw / view.s, vh = ch / view.s;
  const cx = (cw / 2 - view.x) / view.s, cy = (ch / 2 - view.y) / view.s;

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(U.uRes, cw, ch);
  gl.uniform3f(U.uView, view.s, view.x, view.y);
  gl.uniform1f(U.uDpr, dpr);
  gl.uniform1f(U.uTime, (now - t0) / 1000 * (reduceMotion ? .3 : 1));
  gl.uniform1f(U.uLand, land);
  gl.uniform1f(U.uDot, DOT);
  gl.uniform1f(U.uThin, Math.min(1, Math.max(.22, .3 * cw * ch / FLOCK)));
  gl.uniform3f(U.uFlock, cx, cy, Math.min(vw, vh * 1.45) * .2);
  gl.uniform3f(U.uPointer, pointer ? pointer[0] : -1e4, pointer ? pointer[1] : -1e4, startle);
  gl.uniform1f(U.uExplode, ex);
  gl.uniform2f(U.uSolo, soloAmt > .001 ? soloShown : -1, soloAmt);
  if (ex > 0) {
    const m = drawLayers(ex);
    gl.uniform1f(U.uExS, m.S);
    gl.uniform3f(U.uExA, m.a, m.b, m.d);
    gl.uniform4f(U.uExE, m.e0, m.f0, m.de, m.df);
  } else {
    const read = Math.min(1, Math.max(0, (view.s - READ_PX_PER_EM * .6) / (READ_PX_PER_EM * .4)));
    const rest = Math.min(1, Math.max(0, (land - .75) / .25));
    drawLetters(read * rest * rest);
  }
  gl.drawArrays(gl.POINTS, 0, Math.max(FLOCK, N));

  showPanel(near && view.s >= READ_PX_PER_EM * .6 ? lineAt(...pointer) : -1);
  if (land > .99 && now - t0 > 15000) hint.classList.add("gone");

  requestAnimationFrame(frameLoop);
}

function wake() {
  const visible = !document.hidden && frameVisible;
  if (visible && !running) { running = true; then = performance.now(); requestAnimationFrame(frameLoop); }
  else if (!visible) running = false;
}
let frameVisible = true;
new IntersectionObserver(([en]) => { frameVisible = en.isIntersecting; wake(); }).observe(frame);
document.addEventListener("visibilitychange", wake);

// ---------- start ----------

// the same birds, another hand: they take off, and land where the new letters put them
async function changeHand(h) {
  if (h === hand || switching || !gl) return;
  switching = h;
  moved();
  const data = await fetchHand(h);
  while (land > 0 && running) await new Promise(r => setTimeout(r, 60));
  useHand(h, data);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, homes(data), gl.STATIC_DRAW);
  countLayers();
  fit();
  try { localStorage.setItem(HAND_KEY, h); } catch (_) {}
  const url = new URL(location.href);
  url.searchParams.set("hand", h);
  history.replaceState(null, "", url);
  switching = null;
  moved();
}
for (const b of document.querySelectorAll("[data-hand]")) b.onclick = () => changeHand(b.dataset.hand);

(async () => {
  const dots = await fetchHand(hand);
  useHand(hand, dots);
  resize();
  setupGL(homes(dots));
  countLayers();
  const z = +new URLSearchParams(location.search).get("layer") - 1;
  if (z >= 0 && z < LAYERS.length) chooseLayer(z);
  new ResizeObserver(resize).observe(frame);
  requestAnimationFrame(frameLoop);
})().catch(err => {
  console.error(err);
  frame.insertAdjacentHTML("beforeend", `<p class="fallback" style="position:absolute;inset:auto 0 45%;">The flock could not take off in this browser. <a href="https://ganjoor.net/attar/manteghotteyr">Read the poem on Ganjoor.</a></p>`);
});
