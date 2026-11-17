import Phaser from 'phaser';
import type { Ctx2D } from '../ui/Kit';

// Malarz tła w stylu "AAA pixel art" (plansze intro, ekran tytułowy, tła scen menu).
// Wszystko maluje się raz na płótnie 2D w pikselach projektowych (480x270), a potem idzie jako tekstura hi-res:
//   - gradienty i poświaty z ditheringiem Bayera 4x4 zamiast gładkich przejść (ograniczona paleta, czyste pasma),
//   - chmury cieniowane w 4 tonach (światło od strony słońca, płaskie, ciemne spody),
//   - ruiny z bryłą (ściana boczna w cieniu, obwódka światła, okna, stropy, pręty zbrojeniowe, anteny, zbiorniki),
//   - grunt z jasnym grzbietem wydmy, ditherowanym cieniem i drobnym gruzem,
//   - mgła / smog warstwami (perspektywa powietrzna między planami).
// Ruchome dodatki (warstwy paralaksy, promienie światła, ptaki, migające okna) są na dole pliku.

export type RGB = readonly [number, number, number];
export type ColorIn = string | number | RGB;

export function rgbOf(c: ColorIn): RGB {
  if (typeof c === 'number') return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  if (typeof c !== 'string') return c;
  let s = c.replace('#', '');
  if (s.length === 3) s = [...s].map((k) => k + k).join('');
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mix = (a: ColorIn, b: ColorIn, t: number): RGB => {
  const x = rgbOf(a), y = rgbOf(b);
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
};
export const css = (c: ColorIn, a = 1): string => {
  const [r, g, b] = rgbOf(c).map((v) => Math.round(Math.max(0, Math.min(255, v))));
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
};
export const num = (c: ColorIn): number => {
  const [r, g, b] = rgbOf(c).map((v) => Math.round(Math.max(0, Math.min(255, v))));
  return (r << 16) | (g << 8) | b;
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Próg Bayera 4x4 w (0, 1). */
export const bayer = (x: number, y: number): number => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;

/** Kolor gradientu w punkcie t (0..1) z listy przystanków [pozycja, kolor]. */
export function sampleStops(stops: readonly (readonly [number, ColorIn])[], t: number): RGB {
  if (t <= stops[0][0]) return rgbOf(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    if (t <= p1) {
      const [p0, c0] = stops[i - 1];
      return mix(c0, c1, p1 > p0 ? (t - p0) / (p1 - p0) : 1);
    }
  }
  return rgbOf(stops[stops.length - 1][1]);
}

/** Operacja na pikselach prostokąta (kanwa poza prostokątem nietknięta). */
function pixels(g: Ctx2D, x0: number, y0: number, w: number, h: number, fn: (d: Uint8ClampedArray, i: number, x: number, y: number) => void): void {
  const W = g.canvas.width, H = g.canvas.height;
  const ax = Math.max(0, Math.floor(x0)), ay = Math.max(0, Math.floor(y0));
  const bx = Math.min(W, Math.ceil(x0 + w)), by = Math.min(H, Math.ceil(y0 + h));
  if (bx <= ax || by <= ay) return;
  const img = g.getImageData(ax, ay, bx - ax, by - ay);
  const d = img.data, iw = bx - ax;
  for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) fn(d, ((y - ay) * iw + (x - ax)) * 4, x, y);
  g.putImageData(img, ax, ay);
}

/** Wartość schodkowa z ditheringiem: `levels` pasm, przejście tylko wąsko przy granicy pasma (ostrość 0..1). */
const stepDither = (t: number, levels: number, x: number, y: number, sharp = 0.55): number => {
  const q = Math.max(0, Math.min(1, t)) * (levels - 1);
  const lo = Math.floor(q);
  const f = q - lo;
  const ff = Math.max(0, Math.min(1, (f - 0.5) / (1 - sharp) + 0.5));
  return Math.min(levels - 1, lo + (ff > bayer(x, y) ? 1 : 0)) / (levels - 1);
};

/** Niebo / dowolny pionowy gradient: pasma z ditheringiem na granicach. */
export function ditherGradient(g: Ctx2D, x0: number, y0: number, w: number, h: number, stops: readonly (readonly [number, ColorIn])[], levels = 18): void {
  const lut: RGB[] = Array.from({ length: levels }, (_, i) => sampleStops(stops, i / (levels - 1)));
  pixels(g, x0, y0, w, h, (d, i, x, y) => {
    const c = lut[Math.round(stepDither((y - y0) / Math.max(1, h - 1), levels, x, y) * (levels - 1))];
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  });
}

/** Poświata (elipsa) z ditheringiem: kolor nakładany z kryciem maleje od środka; `add` = mieszanie addytywne. */
export function glow(g: Ctx2D, cx: number, cy: number, rx: number, ry: number, color: ColorIn, maxA: number, o: { levels?: number; add?: boolean; pow?: number } = {}): void {
  const c = rgbOf(color), lv = o.levels ?? 6, pw = o.pow ?? 1.6;
  pixels(g, cx - rx, cy - ry, rx * 2 + 1, ry * 2 + 1, (d, i, x, y) => {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, r = Math.sqrt(dx * dx + dy * dy);
    if (r >= 1) return;
    const a = stepDither(Math.pow(1 - r, pw), lv + 1, x, y, 0.3) * maxA;
    if (a <= 0) return;
    for (let k = 0; k < 3; k++) d[i + k] = o.add ? d[i + k] + c[k] * a : d[i + k] + (c[k] - d[i + k]) * a;
    if (d[i + 3] < 255) d[i + 3] = Math.max(d[i + 3], a * 255);
  });
}

/** Pozioma warstwa mgły / smogu: krycie od aTop (góra) do aBot (dół), z ditheringiem. */
export function haze(g: Ctx2D, x0: number, y0: number, w: number, h: number, color: ColorIn, aTop: number, aBot: number, levels = 6): void {
  const c = rgbOf(color);
  pixels(g, x0, y0, w, h, (d, i, x, y) => {
    const t = (y - y0) / Math.max(1, h - 1);
    const a = aTop + (aBot - aTop) * stepDither(t, levels, x, y, 0.2);
    if (d[i + 3] === 0) return;
    for (let k = 0; k < 3; k++) d[i + k] = d[i + k] + (c[k] - d[i + k]) * a;
  });
}

/** Winieta: przyciemnienie krawędzi (dithering). */
export function vignette(g: Ctx2D, w: number, h: number, color: ColorIn = '#000000', a = 0.55, inner = 0.55): void {
  const c = rgbOf(color);
  pixels(g, 0, 0, w, h, (d, i, x, y) => {
    const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
    const r = Math.sqrt(dx * dx * 0.8 + dy * dy * 1.1);
    if (r < inner) return;
    const t = stepDither(Math.min(1, (r - inner) / (1.25 - inner)), 6, x, y, 0.3) * a;
    for (let k = 0; k < 3; k++) d[i + k] = d[i + k] + (c[k] - d[i + k]) * t;
  });
}

/** Gwiazdy: różna jasność, kilka jasnych w krzyżyk; zanikają ku horyzontowi (yMax). */
export function stars(g: Ctx2D, w: number, yMax: number, rnd: () => number, n: number, tint: ColorIn = '#ffffff'): void {
  const c = rgbOf(tint);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rnd() * w), y = Math.floor(Math.pow(rnd(), 1.4) * yMax);
    const a = (0.25 + rnd() * 0.75) * (1 - y / yMax) ** 0.6;
    g.fillStyle = css(c, a);
    g.fillRect(x, y, 1, 1);
    if (rnd() < 0.04) {
      g.fillStyle = css(c, a * 0.45);
      g.fillRect(x - 1, y, 1, 1);
      g.fillRect(x + 1, y, 1, 1);
      g.fillRect(x, y - 1, 1, 1);
      g.fillRect(x, y + 1, 1, 1);
    }
  }
}

export interface SunOptions {
  core: ColorIn;
  rim: ColorIn;
  halo: ColorIn;
  haloR?: number;
  haloA?: number;
  /** Pasy "zamglenia" na dolnej połowie tarczy (kolor nieba za słońcem). */
  bands?: ColorIn | null;
}

/** Tarcza słońca / księżyca: dithered halo, jaśniejszy środek, obwódka i ewentualne poziome przerwy w dolnej części. */
export function sun(g: Ctx2D, cx: number, cy: number, r: number, o: SunOptions): void {
  glow(g, cx, cy, o.haloR ?? r * 3.2, (o.haloR ?? r * 3.2) * 0.8, o.halo, o.haloA ?? 0.45, { levels: 7, pow: 1.8 });
  glow(g, cx, cy, r * 1.6, r * 1.6, o.halo, 0.4, { levels: 4, pow: 1.2 });
  const rim = rgbOf(o.rim), core = rgbOf(o.core), band = o.bands ? rgbOf(o.bands) : null;
  pixels(g, cx - r - 1, cy - r - 1, r * 2 + 3, r * 2 + 3, (d, i, x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rr = Math.sqrt(dx * dx + dy * dy);
    if (rr > r) return;
    let c = rr > r - 1.3 ? rim : mix(core, rim, stepDither(Math.max(0, (rr / r - 0.45) / 0.55), 4, x, y, 0.4));
    if (band && dy > r * 0.15) {
      const k = (dy - r * 0.15) / (r * 0.85); // 0..1 w dół tarczy
      const period = Math.max(3, Math.round(7 - k * 4)), gap = Math.round(1 + k * 2.6);
      if (Math.floor(dy) % period < gap) c = band;
    }
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  });
}

export interface CloudOptions {
  /** Najjaśniejsza krawędź (od światła), oświetlona góra, środek, cień spodu. */
  tones: readonly [ColorIn, ColorIn, ColorIn, ColorIn];
  /** Kierunek światła w poziomie (-1 z lewej, 1 z prawej, 0 z góry). */
  light?: number;
  alpha?: number;
  /** Zawijanie w poziomie (warstwa przesuwana w pętli). */
  wrap?: boolean;
}

/**
 * Chmury kłębiaste w stylu ręcznie stawianych pikseli: każda chmura to kilka kłębów (koła) na płaskim spodzie.
 * Piksel należy do kłębu "najbliżej widza" (niżej położony środek = bliżej), cieniowanie liczone z normalnej tego
 * kłębu i kwantowane do 4 tonów bez szumu ditheringu (czyste plamy koloru). Górna krawędź każdego kłębu - także tam,
 * gdzie zachodzi na kłąb za nim - dostaje jasny brzeg, więc widać pojedyncze "bąble"; spód jest płaski i ciemny.
 * clouds: [cx, cy, szerokość, wysokość].
 */
export function clouds(g: Ctx2D, w: number, h: number, rnd: () => number, list: readonly (readonly [number, number, number, number])[], o: CloudOptions): void {
  type Puff = { x: number; y: number; r: number; flat: number };
  const puffs: Puff[] = [];
  for (const [cx, cy, cw, ch] of list) {
    const flat = Math.round(cy + ch * 0.3);
    const n = Math.max(3, Math.round(cw / (ch * 0.75)));
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1) - 0.5; // -0.5..0.5
      const r = Math.max(2, ch * (0.42 + rnd() * 0.3) * (1 - Math.abs(u) * 1.1));
      puffs.push({ x: cx + u * cw * 0.92 + (rnd() - 0.5) * 3, y: flat - r * (0.35 + rnd() * 0.45), r, flat });
    }
    // druga warstwa wyższych kłębów na środku (wieżyczki cumulusa)
    const m = Math.max(1, Math.round(n / 3));
    for (let k = 0; k < m; k++) {
      const r = ch * (0.4 + rnd() * 0.25);
      puffs.push({ x: cx + (rnd() - 0.5) * cw * 0.45, y: flat - ch * 0.55 - r * 0.3, r, flat });
    }
  }
  // kłęby od najdalszego (najwyżej) do najbliższego - indeks w masce = właściciel piksela
  puffs.sort((a, b) => a.y - b.y);
  const own = new Int16Array(w * h).fill(-1);
  const wx = (x: number): number => (o.wrap ? ((x % w) + w) % w : x);
  puffs.forEach((p, idx) => {
    for (let y = Math.max(0, Math.floor(p.y - p.r)); y <= Math.min(h - 1, p.flat); y++)
      for (let x = Math.floor(p.x - p.r); x <= Math.ceil(p.x + p.r); x++) {
        const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y;
        if (dx * dx + dy * dy > p.r * p.r) continue;
        const xx = wx(x);
        if (xx >= 0 && xx < w) own[y * w + xx] = idx;
      }
  });
  const T = o.tones.map(rgbOf), A = o.alpha ?? 1, L = o.light ?? 0;
  const lx = L * 0.55, ly = -0.8, lz = 0.35;
  const at = (x: number, y: number): number => (y < 0 || y >= h ? -1 : own[y * w + wx(x)] ?? -1);
  pixels(g, 0, 0, w, h, (d, i, x, y) => {
    const id = own[y * w + x];
    if (id < 0) return;
    const p = puffs[id];
    let t: number;
    const above = at(x, y - 1), below = at(x, y + 1);
    if (y === p.flat || below < 0) t = 3; // płaski spód
    else if (above < 0 || (above !== id && puffs[above].y < p.y - 1)) {
      // brzeg kłębu: od strony światła najjaśniejszy, poza tym jasny
      const dx = (x + 0.5 - p.x) / p.r;
      t = L === 0 || dx * L < 0.25 ? 0 : 1;
    } else {
      const nx = (x + 0.5 - p.x) / p.r, ny = (y + 0.5 - p.y) / p.r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const dot = nx * lx + ny * ly + nz * lz;
      t = dot > 0.42 ? 1 : dot > -0.05 ? 2 : 3;
      if (y >= p.flat - 1) t = 3;
    }
    const c = T[t];
    if (d[i + 3] === 0) {
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = A * 255;
    } else for (let k = 0; k < 3; k++) d[i + k] = d[i + k] + (c[k] - d[i + k]) * A;
  });
}

/**
 * Smugi chmur warstwowych (klasyczny pixel-artowy zachód słońca): poziome pasma o zwężonych końcach,
 * jasna górna krawędź od słońca, ciemniejszy spód. Kolejne rzędy coraz krótsze ku górze i dołowi.
 */
export function streaks(g: Ctx2D, w: number, rnd: () => number, y0: number, y1: number, n: number, tones: readonly [ColorIn, ColorIn, ColorIn], wrap = false): void {
  const [hi, mid, lo] = tones.map(rgbOf);
  const row = (x: number, y: number, len: number, c: RGB): void => {
    g.fillStyle = css(c);
    const a = Math.round(x), l = Math.round(len);
    g.fillRect(a, y, l, 1);
    if (wrap && a + l > w) g.fillRect(a - w, y, l, 1);
    if (wrap && a < 0) g.fillRect(a + w, y, l, 1);
  };
  for (let i = 0; i < n; i++) {
    const y = Math.round(y0 + rnd() * (y1 - y0));
    const len = 18 + rnd() * 90, x = rnd() * w - (wrap ? 0 : 20);
    const thick = 1 + Math.floor(rnd() * 3);
    row(x + len * 0.12, y - 1, len * 0.7, hi);
    for (let k = 0; k < thick; k++) row(x + k * 2, y + k, len - k * 4, k === thick - 1 ? lo : mid);
    if (thick > 1) row(x + len * 0.3, y + thick, len * 0.35, lo);
  }
}

export interface RuinOptions {
  base: number;
  n: number;
  hMin: number;
  hMax: number;
  wMin?: number;
  wMax?: number;
  /** Fasada, ściana boczna w cieniu, obwódka światła. */
  body: ColorIn;
  side?: ColorIn;
  rim?: ColorIn | null;
  /** Okna (wnęki) i kolor zapalonych okien (null = żadne). */
  win?: ColorIn;
  lit?: ColorIn | null;
  litChance?: number;
  /** Kierunek światła: -1 z lewej, 1 z prawej. */
  light?: number;
  /** Ilość szczegółów 0..1 (dalekie plany mniej). */
  detail?: number;
  x0?: number;
  x1?: number;
}

/** Rząd zrujnowanych budynków z bryłą: fasada + boczna ściana, okna, stropy, szczerby, zbrojenie, anteny, zbiorniki. */
export function ruins(g: Ctx2D, rnd: () => number, o: RuinOptions): void {
  const wMin = o.wMin ?? 10, wMax = o.wMax ?? 26, L = o.light ?? -1, det = o.detail ?? 1;
  const body = rgbOf(o.body), side = o.side ? rgbOf(o.side) : mix(body, '#000000', 0.35), rim = o.rim === null ? null : rgbOf(o.rim ?? mix(body, '#ffffff', 0.25));
  const win = o.win ? rgbOf(o.win) : mix(body, '#000000', 0.5);
  const x0 = o.x0 ?? -10, x1 = o.x1 ?? g.canvas.width + 10;
  const px = (c: RGB, x: number, y: number, w = 1, h = 1): void => {
    g.fillStyle = css(c);
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  let prevTop: [number, number] | null = null;
  for (let i = 0; i < o.n; i++) {
    const bw = Math.round(wMin + rnd() * (wMax - wMin));
    const bh = Math.round(o.hMin + rnd() * (o.hMax - o.hMin));
    const x = Math.round(x0 + ((i + rnd() * 0.7) / o.n) * (x1 - x0) - bw / 2);
    const top = o.base - bh;
    const sw = Math.max(2, Math.round(bw * 0.22)); // ściana boczna
    const sx = L < 0 ? x + bw : x - sw; // cień po stronie przeciwnej do światła
    // poszarpany profil dachu: przesunięcie w dół dla każdej kolumny
    const broken = rnd() < 0.65;
    const prof: number[] = [];
    let cut = 0;
    const cutFrom = Math.floor(rnd() * bw * 0.6), cutTo = cutFrom + Math.floor(bw * (0.3 + rnd() * 0.5));
    for (let c = 0; c < bw; c++) {
      if (broken && c >= cutFrom && c <= cutTo) cut = Math.max(0, Math.min(bh * 0.45, cut + Math.round((rnd() - (c < (cutFrom + cutTo) / 2 ? 0.25 : 0.75)) * 4)));
      else cut = Math.max(0, cut - 2);
      prof.push(cut);
    }
    // ściana boczna (skos w głąb)
    for (let c = 0; c < sw; c++) {
      const edge = L < 0 ? prof[bw - 1] : prof[0];
      const lift = Math.round(((L < 0 ? c : sw - 1 - c) + 1) * 0.6);
      px(side, sx + c, top + edge + lift, 1, bh - edge - lift);
    }
    // fasada
    for (let c = 0; c < bw; c++) px(body, x + c, top + prof[c], 1, bh - prof[c]);
    // obwódka światła: krawędź od strony światła + górna linia profilu
    if (rim) {
      const ex = L < 0 ? x : x + bw - 1;
      const ep = L < 0 ? prof[0] : prof[bw - 1];
      px(rim, ex, top + ep, 1, bh - ep);
      for (let c = 0; c < bw; c++) if (c === 0 || prof[c] !== prof[c - 1] || rnd() < 0.85) px(rim, x + c, top + prof[c], 1, 1);
    }
    // stropy i okna
    const fh = 5 + (rnd() < 0.5 ? 1 : 0);
    const ww = bw > 18 && rnd() < 0.5 ? 2 : 1;
    const step = ww + 2;
    for (let fy = top + 3; fy < o.base - 3; fy += fh) {
      if (det > 0.4) for (let c = 1; c < bw - 1; c++) if (fy - 1 > top + prof[c]) px(mix(body, side, 0.5), x + c, fy - 1, 1, 1);
      for (let wx = x + 2; wx + ww <= x + bw - 1; wx += step) {
        const c = wx - x;
        if (fy <= top + prof[c] + 1) continue;
        if (rnd() < 0.12) continue;
        const litOn = o.lit && rnd() < (o.litChance ?? 0.05);
        px(litOn ? rgbOf(o.lit!) : win, wx, fy, ww, 2);
        if (litOn && det > 0.5) px(mix(rgbOf(o.lit!), body, 0.55), wx, fy + 2, ww, 1);
      }
    }
    if (det > 0.6) {
      const dark = mix(body, side, 0.6), light = rim ?? mix(body, '#ffffff', 0.18);
      // faktura muru: rzadkie ciemniejsze / jaśniejsze piksele (cegły, odpryski tynku)
      for (let k = 0; k < bw * bh * 0.025; k++) {
        const cx = x + 1 + Math.floor(rnd() * (bw - 2)), cy = top + 2 + Math.floor(rnd() * (bh - 3));
        if (cy > top + prof[cx - x] + 1) px(rnd() < 0.7 ? dark : mix(body, light, 0.4), cx, cy, 1, 1);
      }
      // rynna przy krawędzi
      if (rnd() < 0.4) {
        const gx = L < 0 ? x + bw - 2 : x + 1;
        px(dark, gx, top + prof[gx - x] + 2, 1, bh - prof[gx - x] - 2);
        for (let yy = top + prof[gx - x] + 5; yy < o.base - 2; yy += 7) px(light, gx, yy, 1, 1);
      }
      // balkony z balustradą na kilku piętrach
      if (bw > 14 && rnd() < 0.45) {
        const bx = x + 2 + Math.floor(rnd() * (bw - 10)), wdt = 6 + Math.floor(rnd() * 3);
        for (let yy = top + 9 + Math.floor(rnd() * 4); yy < o.base - 6; yy += fh * 2) {
          if (yy <= top + prof[bx - x] + 2 || rnd() < 0.3) continue;
          px(dark, bx - 1, yy, wdt + 2, 1);
          px(light, bx - 1, yy - 1, wdt + 2, 1);
          for (let k = 0; k < wdt + 2; k += 2) px(dark, bx - 1 + k, yy - 2, 1, 1);
        }
      }
      // skrzynki klimatyzatorów pod oknami
      for (let k = 0; k < bw / 8; k++) {
        if (rnd() < 0.5) continue;
        const ax = x + 2 + Math.floor(rnd() * (bw - 5)), ay = top + 6 + Math.floor(rnd() * (bh - 12));
        if (ay <= top + prof[ax - x] + 2) continue;
        px(mix(body, '#9a9a9a', 0.3), ax, ay, 3, 2);
        px(dark, ax, ay + 2, 3, 1);
      }
      // szyld / reklama (czasem z resztką neonu)
      if (rnd() < 0.22 && bh > 26) {
        const sw2 = Math.min(bw - 4, 6 + Math.floor(rnd() * 6)), sx2 = x + 2 + Math.floor(rnd() * Math.max(1, bw - sw2 - 3)), sy2 = top + 8 + Math.floor(rnd() * Math.max(1, bh * 0.4));
        if (sy2 > top + prof[sx2 - x] + 2) {
          const neon = o.lit && rnd() < 0.5;
          const sc = neon ? rgbOf(rnd() < 0.5 ? '#ff4a6a' : '#4ae0d0') : mix(rgbOf(rnd() < 0.5 ? '#7a2a1a' : '#2a5a5a'), body, 0.35);
          px(mix(sc, '#000000', 0.4), sx2 - 1, sy2 - 1, sw2 + 2, 6);
          px(sc, sx2, sy2, sw2, 4);
          for (let k = 1; k < sw2 - 1; k += 2) if (rnd() < 0.7) px(mix(sc, neon ? '#ffffff' : '#000000', 0.5), sx2 + k, sy2 + 1 + (k % 3 === 0 ? 1 : 0), 1, 1);
        }
      }
      // bluszcz / pnącza spływające z dachu
      if (rnd() < 0.3) {
        const ivyDark = mix(rgbOf('#2a3a1a'), body, 0.35), ivyLit = mix(rgbOf('#5a7a2a'), body, 0.3);
        const ix = x + Math.floor(rnd() * bw * 0.5), iw = 3 + Math.floor(rnd() * bw * 0.4);
        for (let cx = ix; cx < Math.min(x + bw, ix + iw); cx++) {
          const len = Math.floor(rnd() * bh * 0.45);
          for (let j = 0; j < len; j++) if (rnd() < 0.85) px(rnd() < 0.3 ? ivyLit : ivyDark, cx, top + prof[cx - x] + j, 1, 1);
        }
      }
    }
    // kable zwisające między dachami sąsiednich budynków
    if (det > 0.6 && prevTop !== null && rnd() < 0.5) {
      const [px0, py0] = prevTop, px1 = x + 1, py1 = top + prof[0] + 3;
      if (px1 - px0 > 3 && px1 - px0 < 60) {
        const sag = 3 + (px1 - px0) * 0.12;
        for (let cx = px0; cx <= px1; cx++) {
          const u = (cx - px0) / (px1 - px0);
          px(side, cx, Math.round(py0 + (py1 - py0) * u + Math.sin(u * Math.PI) * sag), 1, 1);
        }
      }
    }
    prevTop = [x + bw - 2, top + prof[bw - 1] + 3];
    // zbrojenie sterczące z wyrwy
    if (broken && det > 0.3) {
      const nRebar = 1 + Math.floor(rnd() * 3 * det);
      for (let k = 0; k < nRebar; k++) {
        const c = Math.min(bw - 1, cutFrom + Math.floor(rnd() * (cutTo - cutFrom + 1)));
        const len = 2 + Math.floor(rnd() * 5);
        const lean = rnd() < 0.5 ? 0 : rnd() < 0.5 ? -1 : 1;
        for (let k2 = 0; k2 < len; k2++) px(side, x + c + (k2 > len / 2 ? lean : 0), top + prof[c] - 1 - k2, 1, 1);
      }
    }
    // dodatki na dachu
    const r = rnd();
    if (!broken && det > 0.3) {
      if (r < 0.3) {
        // antena z kratownicą
        const ax = x + Math.floor(bw * (0.3 + rnd() * 0.4)), ah = 6 + Math.floor(rnd() * 10);
        px(side, ax, top - ah, 1, ah);
        for (let k = 3; k < ah; k += 3) px(side, ax - 1, top - k, 3, 1);
        if (rim) px(rim, ax, top - ah, 1, 1);
      } else if (r < 0.5) {
        // zbiornik na wodę na nóżkach
        const tx = x + Math.floor(rnd() * Math.max(1, bw - 7));
        px(side, tx + 1, top - 3, 1, 3);
        px(side, tx + 5, top - 3, 1, 3);
        px(body, tx, top - 8, 7, 5);
        px(side, tx, top - 9, 7, 1);
        if (rim) px(rim, L < 0 ? tx : tx + 6, top - 8, 1, 5);
      } else if (r < 0.62 && bh > o.hMin + (o.hMax - o.hMin) * 0.5) {
        // dźwig budowlany
        const cx = x + Math.floor(bw / 2), chh = 10 + Math.floor(rnd() * 10), arm = 10 + Math.floor(rnd() * 14);
        px(side, cx, top - chh, 1, chh);
        px(side, cx - Math.floor(arm * 0.3), top - chh, arm, 1);
        for (let k = 0; k < arm - 2; k += 2) px(side, cx - Math.floor(arm * 0.3) + k, top - chh + 1, 1, 1);
        px(side, cx + Math.floor(arm * 0.6), top - chh + 1, 1, 4 + Math.floor(rnd() * 6));
      }
    }
  }
}

export interface GroundOptions {
  /** Grzbiet (światło), korpus, głęboki cień u dołu. */
  crest: ColorIn;
  body: ColorIn;
  deep?: ColorIn;
  amp?: number;
  freq?: number;
  seed?: number;
  /** Drobny gruz / kamyki (0..1). */
  debris?: number;
  rnd?: () => number;
}

/** Pas gruntu / wydmy: sinusoidalny grzbiet, jasna krawędź, cień ditherowany w dół, drobny gruz. Zwraca profil y(x). */
export function ground(g: Ctx2D, w: number, h: number, y0: number, o: GroundOptions): number[] {
  const amp = o.amp ?? 3, freq = o.freq ?? 0.03, seed = o.seed ?? 1;
  const crest = rgbOf(o.crest), body = rgbOf(o.body), deep = rgbOf(o.deep ?? mix(body, '#000000', 0.35));
  const prof: number[] = [];
  for (let x = 0; x < w; x++) prof.push(Math.round(y0 + Math.sin(x * freq + seed) * amp + Math.sin(x * freq * 2.7 + seed * 1.7) * amp * 0.4));
  pixels(g, 0, Math.min(...prof), w, h, (d, i, x, y) => {
    const top = prof[x];
    if (y < top) return;
    const dy = y - top;
    // grzbiet: 1 px światła tam, gdzie zbocze opada w stronę widza (lewa / prawa krawędź łuku)
    const slope = (prof[Math.min(w - 1, x + 1)] - prof[Math.max(0, x - 1)]) / 2;
    let c: RGB;
    if (dy === 0) c = crest;
    else if (dy === 1 && slope < 0.15) c = bayer(x, y) < 0.6 ? crest : body;
    else {
      c = mix(body, deep, stepDither(Math.min(1, (y - y0 + amp) / Math.max(8, h - y0)), 5, x, y, 0.35));
      // zmarszczki piasku: przerywane jaśniejsze kreski idące za linią grzbietu
      const ry = dy + Math.round(Math.sin(x * 0.11 + seed * 3) * 1.5);
      if (dy > 3 && ry % 7 === 0 && Math.sin(x * 0.37 + ry * 1.3 + seed) > 0.1) c = mix(c, crest, 0.35 * Math.max(0, 1 - dy / 40));
    }
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  });
  const rnd = o.rnd;
  if (rnd && (o.debris ?? 0) > 0) {
    const n = Math.round(w * (o.debris ?? 0) * 0.5);
    for (let k = 0; k < n; k++) {
      const x = Math.floor(rnd() * w), y = prof[x] + 2 + Math.floor(rnd() * (h - prof[x] - 2));
      if (y >= h) continue;
      const big = rnd() < 0.2;
      g.fillStyle = css(deep);
      g.fillRect(x, y + 1, big ? 3 : 2, 1);
      g.fillStyle = css(mix(body, crest, 0.6));
      g.fillRect(x, y, big ? 2 : 1, 1);
    }
  }
  return prof;
}

/**
 * Obwódka światła od punktowego źródła (ognisko, latarnia): pełne piksele, których sąsiad w stronę światła jest pusty,
 * dostają kolor `color` z siłą malejącą z odległością (`radius`). Działa na warstwach z przezroczystym tłem.
 */
export function rimLight(g: Ctx2D, lx: number, ly: number, color: ColorIn, radius: number, strength = 1, width = 1): void {
  const W = g.canvas.width, H = g.canvas.height;
  const img = g.getImageData(0, 0, W, H), d = img.data, src = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) src[i] = d[i * 4 + 3] > 128 ? 1 : 0;
  const c = rgbOf(color);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (!src[y * W + x]) continue;
      const dx = lx - x, dy = ly - y, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const sx = Math.abs(dx) > dist * 0.38 ? Math.sign(dx) : 0, sy = Math.abs(dy) > dist * 0.38 ? Math.sign(dy) : 0;
      let edge = false;
      for (let k = 1; k <= width && !edge; k++) {
        const nx = x + sx * k, ny = y + sy * k;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !src[ny * W + nx]) edge = true;
      }
      if (!edge && !src[(y - 1) * W + x] && dy < 0) edge = true; // górne krawędzie łapią poświatę z góry
      if (!edge) continue;
      const a = stepDither(1 - dist / radius, 4, x, y, 0.3) * strength;
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) d[i + k] = d[i + k] + (c[k] - d[i + k]) * a;
    }
  g.putImageData(img, 0, 0);
}

/** Linia (Bresenham) kolorem. */
export function line(g: Ctx2D, x0: number, y0: number, x1: number, y1: number, color: ColorIn): void {
  g.fillStyle = css(color);
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

/** Pełny wielokąt kolorem (bez wygładzania - kanwa rysuje w pikselach projektowych, ostre krawędzie po skalowaniu). */
export function poly(g: Ctx2D, pts: readonly (readonly [number, number])[], color: ColorIn): void {
  g.fillStyle = css(color);
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
}

/** Martwe drzewo: pień z gałęziami (rekurencyjnie), obwódka światła z jednej strony. */
export function deadTree(g: Ctx2D, x: number, y: number, h: number, rnd: () => number, color: ColorIn, rim?: ColorIn, light = -1): void {
  const branch = (bx: number, by: number, len: number, angle: number, thick: number, depth: number): void => {
    const ex = bx + Math.cos(angle) * len, ey = by + Math.sin(angle) * len;
    for (let t = 0; t < thick; t++) line(g, bx + t, by, ex + t * 0.5, ey, color);
    if (rim && thick > 1) line(g, bx + (light < 0 ? 0 : thick - 1), by, ex, ey, rim);
    if (depth <= 0 || len < 3) return;
    const k = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i <= k; i++) branch(ex, ey, len * (0.55 + rnd() * 0.2), angle + (rnd() - 0.5) * 1.4 + (i - k / 2) * 0.5, Math.max(1, thick - 1), depth - 1);
  };
  branch(x, y, h * 0.55, -Math.PI / 2 + (rnd() - 0.5) * 0.2, 3, 3);
}

// ================================================================== ruchome warstwy

/**
 * Warstwa paralaksy: obraz szerszy od ekranu (BASE_W + 2*margin) przesuwany względem "kamery" z czynnikiem `k`.
 * `pan` (piksele) ustawia się co klatkę - warstwy bliższe mają większe k, więc ruszają się szybciej.
 */
export class ParallaxLayer {
  readonly image: Phaser.GameObjects.Image;
  private readonly k: number;
  private readonly margin: number;
  private readonly y: number;
  constructor(scene: Phaser.Scene, key: string, k: number, margin: number, depth: number, y = 0) {
    this.k = k;
    this.margin = margin;
    this.y = y;
    this.image = scene.add.image(-margin, y, key).setOrigin(0).setDepth(depth);
  }
  set(panX: number, panY = 0): void {
    this.image.setPosition(Math.round(-this.margin - panX * this.k), Math.round(this.y + panY * this.k));
  }
  /** Przesunięcie warstwy względem położenia spoczynkowego (dla obiektów "przyklejonych" do warstwy). */
  get dx(): number {
    return this.image.x + this.margin;
  }
}

/** Warstwa przewijana w pętli (np. chmury): dwa obrazy obok siebie, `speed` w px/s. */
export class DriftLayer {
  private readonly a: Phaser.GameObjects.Image;
  private readonly b: Phaser.GameObjects.Image;
  private readonly w: number;
  private readonly speed: number;
  private x = 0;
  constructor(scene: Phaser.Scene, key: string, w: number, speed: number, depth: number, y = 0, alpha = 1) {
    this.w = w;
    this.speed = speed;
    this.a = scene.add.image(0, y, key).setOrigin(0).setDepth(depth).setAlpha(alpha);
    this.b = scene.add.image(w, y, key).setOrigin(0).setDepth(depth).setAlpha(alpha);
  }
  /** Przesunięcie warstwy w pionie (np. całun dymu schodzący z góry). */
  setY(y: number): void {
    this.a.y = Math.round(y);
    this.b.y = Math.round(y);
  }
  update(dt: number): void {
    this.x = (((this.x + this.speed * dt) % this.w) + this.w) % this.w;
    const x = Math.round(this.x);
    this.a.x = x - this.w;
    this.b.x = x;
  }
}

const lcg = (seed: number): (() => number) => {
  let s = Math.max(1, Math.floor(seed)) % 2147483647;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

/** Promienie światła (god rays): wąskie trójkąty z mieszaniem addytywnym, powolne pulsowanie i kołysanie. */
export class LightRays {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly rays: { a: number; w: number; len: number; ph: number }[];
  private readonly x: number;
  private readonly y: number;
  private readonly color: number;
  private readonly alpha: number;
  constructor(scene: Phaser.Scene, x: number, y: number, n: number, color: number, from: number, to: number, len: number, depth: number, alpha = 0.08, seed = 1) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.alpha = alpha;
    this.g = scene.add.graphics().setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
    const r = lcg(seed);
    this.rays = Array.from({ length: n }, (_, i) => ({ a: from + ((to - from) * (i + r() * 0.6)) / n, w: 0.02 + r() * 0.05, len: len * (0.6 + r() * 0.4), ph: r() * 6.28 }));
  }
  update(t: number): void {
    const g = this.g.clear();
    for (const r of this.rays) {
      const a = r.a + Math.sin(t * 0.15 + r.ph) * 0.02;
      const al = this.alpha * (0.55 + 0.45 * Math.sin(t * 0.6 + r.ph));
      const x1 = this.x + Math.cos(a - r.w) * r.len, y1 = this.y + Math.sin(a - r.w) * r.len;
      const x2 = this.x + Math.cos(a + r.w) * r.len, y2 = this.y + Math.sin(a + r.w) * r.len;
      g.fillStyle(this.color, al).fillTriangle(this.x, this.y, x1, y1, x2, y2);
      g.fillStyle(this.color, al * 0.6).fillTriangle(this.x, this.y, (this.x + x1 * 2) / 3, (this.y + y1 * 2) / 3, (this.x + x2 * 2) / 3, (this.y + y2 * 2) / 3);
    }
  }
}

/** Stado ptaków (kruki / sępy): sylwetki z 3 klatek machania skrzydłami, lot w poprzek ekranu z lekkim falowaniem. */
export class Birds {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly b: { x: number; y: number; v: number; ph: number; s: number }[];
  private readonly box: { x: number; y: number; w: number; h: number };
  private readonly color: number;
  private readonly dir: number;
  /** Mnożnik prędkości (np. stado spłoszone wybuchem). */
  speedK = 1;
  constructor(scene: Phaser.Scene, n: number, box: { x: number; y: number; w: number; h: number }, color: number, depth: number, seed = 3, dir = 1) {
    this.box = box;
    this.color = color;
    this.dir = dir;
    this.g = scene.add.graphics().setDepth(depth);
    const r = lcg(seed);
    const lx = box.x + r() * box.w * 0.6, ly = box.y + r() * box.h * 0.5;
    this.b = Array.from({ length: n }, (_, i) => ({ x: lx - i * (6 + r() * 6) * dir, y: ly + (i % 2 ? 1 : -1) * i * (2 + r() * 2), v: 9 + r() * 3, ph: r() * 6.28, s: r() < 0.3 ? 2 : 1 }));
  }
  setVisible(v: boolean): void {
    this.g.setVisible(v);
  }
  update(t: number, dt: number): void {
    const g = this.g.clear();
    g.fillStyle(this.color, 1);
    for (const b of this.b) {
      b.x += b.v * this.speedK * dt * this.dir;
      if (this.speedK > 1) b.y -= b.v * (this.speedK - 1) * 0.25 * dt;
      if (this.dir > 0 && b.x > this.box.x + this.box.w + 20) b.x = this.box.x - 20;
      if (this.dir < 0 && b.x < this.box.x - 20) b.x = this.box.x + this.box.w + 20;
      const x = Math.round(b.x), y = Math.round(b.y + Math.sin(t * 0.8 + b.ph) * 3);
      const f = Math.floor((t * 7 + b.ph) % 3); // 0 skrzydła w górze, 1 poziomo, 2 w dół
      const s = b.s;
      g.fillRect(x - s, y, 2 * s + 1, 1); // tułów
      if (f === 0) g.fillRect(x - 2 * s, y - 1, s, 1).fillRect(x + s + 1, y - 1, s, 1).fillRect(x - 3 * s, y - 2, s, 1).fillRect(x + 2 * s + 1, y - 2, s, 1);
      else if (f === 1) g.fillRect(x - 3 * s, y, s * 2, 1).fillRect(x + s + 1, y, s * 2, 1);
      else g.fillRect(x - 2 * s, y + 1, s, 1).fillRect(x + s + 1, y + 1, s, 1);
    }
  }
}

/** Migające okna: kilka małych prostokątów, które co jakiś czas gasną / zapalają się (jak w ruinach z generatorami). */
export class Windows {
  private readonly r: { o: Phaser.GameObjects.Rectangle; x: number; ph: number; sp: number }[] = [];
  constructor(scene: Phaser.Scene, spots: readonly (readonly [number, number])[], color: number, depth: number, seed = 5) {
    const r = lcg(seed);
    for (const [x, y] of spots) this.r.push({ o: scene.add.rectangle(x, y, 1, 2, color).setOrigin(0).setDepth(depth), x, ph: r() * 100, sp: 0.2 + r() * 0.6 });
  }
  /** `dx` - przesunięcie warstwy, na której leżą okna (paralaksa). */
  update(t: number, dx = 0): void {
    for (const w of this.r) {
      const v = Math.sin(t * w.sp + w.ph) + Math.sin(t * w.sp * 3.1 + w.ph * 2) * 0.5;
      w.o.setAlpha(v > 0.2 ? 1 : v > -0.4 ? 0.55 : 0).setX(Math.round(w.x + dx));
    }
  }
}
