import Phaser from 'phaser';
import { type Ctx2D, canvasTexture } from '../ui/Kit';
import { type ColorIn, css, glow, line, mix, rgbOf } from './Painter';

// Flora i fauna plansz w stylu pixel art.
//   - Flora malowana raz na płótnie tła: drzewa (liściaste, martwe, spalone), krzaki, kępy trawy, kaktusy,
//     zmutowane świecące grzyby, bluszcz. Cieniowanie z 3-4 tonów, światło z jednej strony, bez wygładzania.
//   - Fauna to małe sprite'y rysowane "piksel po pikselu" z map znakowych (jak w edytorze pixel artu),
//     każda klatka to osobna tekstura; ruch i animacja w klasach na dole pliku.

// ================================================================== flora

const put = (g: Ctx2D, c: ColorIn, x: number, y: number, w = 1, h = 1): void => {
  g.fillStyle = css(c);
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** Dysk pikselowy (bez wygładzania). */
function disc(g: Ctx2D, c: ColorIn, cx: number, cy: number, r: number): void {
  g.fillStyle = css(c);
  const R = Math.max(1, Math.round(r));
  for (let dy = -R; dy <= R; dy++) {
    const hw = Math.round(Math.sqrt(R * R - dy * dy + R * 0.5));
    g.fillRect(Math.round(cx) - hw, Math.round(cy) + dy, hw * 2 + 1, 1);
  }
}

export interface FoliageTones {
  /** Obrys / najgłębszy cień, cień, środek, światło, blik. */
  outline: ColorIn;
  shade: ColorIn;
  mid: ColorIn;
  lit: ColorIn;
  hi?: ColorIn;
  trunk: ColorIn;
  trunkLit?: ColorIn;
}

export const FOLIAGE = {
  dusk: { outline: '#1a1410', shade: '#3a3a1c', mid: '#5a5626', lit: '#8a7a34', hi: '#c0a048', trunk: '#2a1a12', trunkLit: '#7a4a2a' },
  night: { outline: '#06080c', shade: '#141c20', mid: '#1e2a2a', lit: '#2e4038', hi: '#4a5e48', trunk: '#120e0e', trunkLit: '#3a2e2a' },
  toxic: { outline: '#0a100a', shade: '#1e2e18', mid: '#36502a', lit: '#5a7a3a', hi: '#9ac060', trunk: '#1a140e', trunkLit: '#4a3a24' },
  day: { outline: '#1a2010', shade: '#2e4a1e', mid: '#4a6e2a', lit: '#78983a', hi: '#b0c860', trunk: '#3a2414', trunkLit: '#7a5030' },
} as const satisfies Record<string, FoliageTones>;

/**
 * Drzewo liściaste: pień z odnogami, korona z kilkunastu kęp (każda cieniowana od światła), obrys selektywny
 * tylko od strony cienia i od dołu. light: -1 światło z lewej, 1 z prawej.
 */
export function leafyTree(g: Ctx2D, x: number, y: number, h: number, rnd: () => number, t: FoliageTones, light = -1): void {
  const tw = Math.max(2, Math.round(h * 0.09));
  const th = Math.round(h * 0.45);
  // pień
  put(g, t.trunk, x - tw / 2, y - th, tw, th);
  if (t.trunkLit) put(g, t.trunkLit, light < 0 ? x - tw / 2 : x + tw / 2 - 1, y - th, 1, th);
  put(g, t.trunk, x - tw / 2 - 1, y - 1, tw + 2, 1); // korzenie
  line(g, x, y - th * 0.7, x + light * -h * 0.18, y - th * 1.05, t.trunk);
  line(g, x, y - th * 0.8, x + light * h * 0.15, y - th * 1.1, t.trunk);
  // korona z kęp
  const cy = y - th - h * 0.25, R = h * 0.36;
  const clumps: [number, number, number][] = [];
  for (let k = 0; k < 9; k++) {
    const a = rnd() * Math.PI * 2, d = rnd() * R * 0.75;
    clumps.push([x + Math.cos(a) * d * 1.15, cy + Math.sin(a) * d * 0.75, R * (0.38 + rnd() * 0.22)]);
  }
  clumps.sort((a, b) => a[1] - b[1]);
  // 1) obrys: każda kępa powiększona o 1 px, przesunięta w stronę cienia
  for (const [cx2, cy2, r] of clumps) disc(g, t.outline, cx2 - light, cy2 + 1, r + 1);
  // 2) kępy: cień, środek, światło (przesunięte ku słońcu), blik
  for (const [cx2, cy2, r] of clumps) {
    disc(g, t.shade, cx2, cy2, r);
    disc(g, t.mid, cx2 + light * r * 0.18, cy2 - r * 0.18, r * 0.78);
    disc(g, t.lit, cx2 + light * r * 0.38, cy2 - r * 0.38, r * 0.42);
    if (t.hi && r > 3) put(g, t.hi, cx2 + light * r * 0.5, cy2 - r * 0.55, 2, 1);
  }
  // pojedyncze listki / dziury na brzegu korony (postrzępiony obrys)
  for (let k = 0; k < 14; k++) {
    const a = rnd() * Math.PI * 2;
    put(g, rnd() < 0.5 ? t.mid : t.shade, x + Math.cos(a) * R * 1.12, cy + Math.sin(a) * R * 0.8, 1, 1);
  }
}

/** Spalone drzewo po wybuchu: czarny pień z kikutami, żarzące się punkty. */
export function burntTree(g: Ctx2D, x: number, y: number, h: number, rnd: () => number, ember = '#ff7a30'): void {
  put(g, '#0c0808', x - 1, y - h * 0.8, 3, h * 0.8);
  put(g, '#2a1a14', x - 1, y - h * 0.8, 1, h * 0.8);
  for (let k = 0; k < 4; k++) {
    const by = y - h * (0.35 + rnd() * 0.4), dir = k % 2 ? 1 : -1, len = 2 + rnd() * h * 0.25;
    line(g, x + (dir > 0 ? 1 : -1), by, x + dir * len, by - len * 0.6, '#0c0808');
  }
  for (let k = 0; k < 3; k++) put(g, ember, x - 1 + Math.floor(rnd() * 3), y - rnd() * h * 0.7, 1, 1);
}

/** Krzak / zarośla: kilka kęp przy ziemi. */
export function bush(g: Ctx2D, x: number, y: number, r: number, rnd: () => number, t: FoliageTones, light = -1): void {
  const parts: [number, number, number][] = [];
  const n = 2 + Math.floor(r / 2);
  for (let k = 0; k < n; k++) parts.push([x + (k / Math.max(1, n - 1) - 0.5) * r * 2, y - r * 0.6 - rnd() * r * 0.5, r * (0.55 + rnd() * 0.35)]);
  for (const [cx, cy, rr] of parts) disc(g, t.outline, cx - light, cy + 1, rr + 1);
  for (const [cx, cy, rr] of parts) {
    disc(g, t.shade, cx, cy, rr);
    disc(g, t.mid, cx + light * rr * 0.2, cy - rr * 0.2, rr * 0.7);
    if (rr > 2) disc(g, t.lit, cx + light * rr * 0.4, cy - rr * 0.4, rr * 0.35);
  }
  put(g, t.outline, x - r * 1.1, y, r * 2.2, 1);
}

/** Uschnięty krzak pustynny (gałązki zamiast liści). */
export function dryShrub(g: Ctx2D, x: number, y: number, h: number, rnd: () => number, c: ColorIn, hi: ColorIn): void {
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2, len = h * (0.5 + rnd() * 0.5);
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    line(g, x, y, ex, ey, k % 3 ? c : hi);
    if (rnd() < 0.6) line(g, (x + ex) / 2, (y + ey) / 2, (x + ex) / 2 + (rnd() - 0.5) * 4, (y + ey) / 2 - 2, c);
  }
}

/** Kępa trawy: pojedyncze źdźbła (1 px) o różnej wysokości, pochylone; jaśniejsze czubki od światła. */
export function grass(g: Ctx2D, x: number, y: number, n: number, h: number, rnd: () => number, dark: ColorIn, mid: ColorIn, tip: ColorIn): void {
  for (let k = 0; k < n; k++) {
    const bx = Math.round(x + (rnd() - 0.5) * n * 1.4), bh = Math.max(1, Math.round(h * (0.4 + rnd() * 0.6)));
    const lean = rnd() < 0.33 ? -1 : rnd() < 0.5 ? 1 : 0;
    for (let j = 0; j < bh; j++) {
      const lx = bx + (j > bh * 0.6 ? lean : 0);
      put(g, j === bh - 1 ? tip : j < bh * 0.4 ? dark : mid, lx, y - j, 1, 1);
    }
  }
}

/** Kaktus (saguaro): pień z ramionami, jasna krawędź od światła, ciemna od cienia, kolce. */
export function cactus(g: Ctx2D, x: number, y: number, h: number, rnd: () => number, dark: ColorIn, mid: ColorIn, lit: ColorIn, light = -1): void {
  const w = Math.max(3, Math.round(h * 0.16));
  const col = (cx: number, top: number, bot: number, ww: number): void => {
    put(g, mid, cx, top + 1, ww, bot - top - 1);
    put(g, mid, cx + 1, top, ww - 2, 1);
    put(g, lit, light < 0 ? cx : cx + ww - 1, top + 1, 1, bot - top - 1);
    put(g, dark, light < 0 ? cx + ww - 1 : cx, top + 1, 1, bot - top - 1);
    for (let yy = top + 2; yy < bot - 1; yy += 3) put(g, dark, cx + Math.floor(ww / 2), yy, 1, 1); // żeberka / kolce
  };
  col(x - Math.floor(w / 2), y - h, y, w);
  for (const dir of [-1, 1]) {
    if (rnd() < 0.25) continue;
    const ay = y - h * (0.35 + rnd() * 0.25), reach = w + 1 + Math.floor(rnd() * 2), ah = Math.round(h * (0.25 + rnd() * 0.2));
    const ax = dir < 0 ? x - Math.floor(w / 2) - reach : x + Math.ceil(w / 2) + reach - w + 1;
    put(g, mid, Math.min(ax, x) + (dir < 0 ? 0 : 0), ay, reach + 1, w - 1); // łokieć
    put(g, dark, Math.min(ax, x), ay + w - 2, reach + 1, 1);
    col(ax, ay - ah, ay + w - 1, w - 1);
  }
}

/** Zmutowane, świecące grzyby / rośliny (toksyczna flora Rdzawiska). */
export function glowShrooms(g: Ctx2D, x: number, y: number, n: number, rnd: () => number, cap: ColorIn = '#b8ff60', stem: ColorIn = '#4a5a3a'): void {
  const c = rgbOf(cap);
  for (let k = 0; k < n; k++) {
    const sx = Math.round(x + (rnd() - 0.5) * n * 3), sh = 2 + Math.floor(rnd() * 4), cw = 2 + Math.floor(rnd() * 2);
    // poświata wokół kapelusza (ditherowana, bez prostokąta)
    glow(g, sx + 0.5, y - sh - 1, cw + 4, cw + 3, c, 0.45, { levels: 3, add: true });
    put(g, stem, sx, y - sh, 1, sh);
    put(g, mix(c, '#000000', 0.35), sx - cw + 1, y - sh - 1, cw * 2 - 1, 1);
    put(g, c, sx - cw + 2, y - sh - 2, cw * 2 - 3 || 1, 1);
    put(g, '#ffffff', sx, y - sh - 2, 1, 1);
  }
}

/** Bluszcz spływający z krawędzi (dachu, muru): pnącza o różnej długości z listkami. */
export function ivy(g: Ctx2D, x0: number, x1: number, y: number, maxLen: number, rnd: () => number, dark: ColorIn, lit: ColorIn): void {
  for (let x = x0; x < x1; x += 1 + Math.floor(rnd() * 3)) {
    const len = Math.floor(rnd() * maxLen);
    for (let j = 0; j < len; j++) {
      const xx = x + (j % 4 === 3 ? (rnd() < 0.5 ? -1 : 1) : 0);
      put(g, rnd() < 0.3 ? lit : dark, xx, y + j, 1, 1);
    }
  }
}

/** Szkielet zwierzęcia w piasku (żebra, czaszka). */
export function skeleton(g: Ctx2D, x: number, y: number, bone: ColorIn, shade: ColorIn): void {
  put(g, bone, x, y - 1, 14, 1); // kręgosłup
  for (let k = 0; k < 5; k++) {
    put(g, bone, x + 2 + k * 2, y - 4, 1, 3);
    put(g, shade, x + 2 + k * 2, y, 1, 1);
  }
  put(g, bone, x + 14, y - 3, 4, 3); // czaszka
  put(g, shade, x + 15, y - 2, 1, 1);
  put(g, bone, x + 18, y - 2, 2, 1);
  put(g, bone, x + 17, y - 5, 1, 2); // róg
}

// ================================================================== fauna (sprite'y z map znakowych)

type Pal = Record<string, ColorIn>;

/** Klatki z map znakowych -> tekstury `${key}_${i}` (kropka = przezroczysty). Zwraca klucze klatek. */
export function pixelFrames(scene: Phaser.Scene, key: string, frames: readonly (readonly string[])[], pal: Pal): string[] {
  return frames.map((rows, i) => {
    const k = `${key}_${i}`;
    if (scene.textures.exists(k)) return k;
    const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
    canvasTexture(scene, k, w, h, (g) => {
      rows.forEach((row, y) => [...row].forEach((ch, x) => {
        const c = pal[ch];
        if (c === undefined) return;
        g.fillStyle = css(c);
        g.fillRect(x, y, 1, 1);
      }));
    });
    return k;
  });
}

// Kruk: lot (skrzydła w górze / poziomo / w dole), na ziemi (stoi / dzióbie)
const CROW_FLY = [
  ['#.......#', '##.....##', '.##...##.', '..#####>.', '....#....'],
  ['.........', '.........', '###.#.###', '..#####>.', '....#....'],
  ['.........', '.........', '..#####>.', '.##.#.##.', '##.....##'],
];
const CROW_GROUND = [
  ['..##..', '.##o>.', '####..', '#####.', '.###..', '.#.#..'],
  ['......', '......', '.###..', '#####o', '.####>', '.#.#..'],
];
// Sęp: szerokie skrzydła z "palcami" lotek, różowa głowa
const VULTURE = [
  ['#.#.........#.#', '.###.......###.', '..####...####..', '....###o###....', '......#p#......', '.......p.......'],
  ['...............', '...............', '#.#####o#####.#', '.#....#p#....#.', '......#.#......', '.......p.......'],
  ['...............', '.......o.......', '....###p###....', '..####.#.####..', '.###.......###.', '#.#.........#.#'],
];
// Szczur: bieg (2 klatki), długi ogon
const RAT = [
  ['......##.', '~~.#####o', '..######.', '...#..#..'],
  ['......##.', '~~.#####o', '..######.', '..#....#.'],
];
// Pies / zmutowany ogar: chód (4 klatki)
const DOG_BODY = ['..........##..', '.........####>', '#........####.', '.##########...', '.###########..', '..#########...'];
const DOG = [
  [...DOG_BODY, '..#.#....#.#..', '..#..#...#..#.', '.#...#..#...#.'],
  [...DOG_BODY, '..#.#....#.#..', '..#.#....#.#..', '..#.#....#.#..'],
  [...DOG_BODY, '...##.....##..', '..#..#...#..#.', '..#...#.#...#.'],
  [...DOG_BODY, '..#.#....#.#..', '..#.#....#.#..', '..#.#....#.#..'],
];
// Kura (Przystań): stoi / dzióbie
const HEN = [
  ['....r.', '...#o>', '#..##.', '#####.', '.###..', '..y.y.'],
  ['......', '......', '#.....', '####r.', '.####o', '..y.y>'],
];
// Kot na murze: siedzi / macha ogonem
const CAT = [
  ['#.#..', '###..', '.#...', '##...', '###..', '###.#', '####.'],
  ['#.#..', '###..', '.#...', '##...', '###..', '###..', '#####'],
];
// Jaszczurka: dwie klatki ruchu łap
const LIZARD = [
  ['#.......#..', '.##.##.###>', '...#..#....'],
  ['.#.....#...', '.##.##.###>', '#.....#....'],
];
// Biegacz-kołotoczyk (biegacz pustyni - "tumbleweed"): 4 klatki obrotu
const WEED = [
  ['..#.#..', '.#.#.#.', '#.###.#', '.##.##.', '#.###.#', '.#.#.#.', '..#.#..'],
  ['..##...', '.#..##.', '#.#.#.#', '.#####.', '#.#.#.#', '.##..#.', '...##..'],
  ['...#...', '.#.#.#.', '.#####.', '###.###', '.#####.', '.#.#.#.', '...#...'],
  ['...##..', '.##..#.', '#.#.#.#', '.#####.', '#.#.#.#', '.#..##.', '..##...'],
];

export const SPRITES = { CROW_FLY, CROW_GROUND, VULTURE, RAT, DOG, HEN, CAT, LIZARD, WEED } as const;

/** Prosty animowany sprite: lista klatek + bieżąca klatka wybierana co update. */
class Anim {
  readonly img: Phaser.GameObjects.Image;
  private readonly keys: string[];
  constructor(scene: Phaser.Scene, keys: string[], x: number, y: number, depth: number) {
    this.keys = keys;
    this.img = scene.add.image(x, y, keys[0]).setOrigin(0.5, 1).setDepth(depth);
  }
  frame(i: number): void {
    const k = this.keys[((i % this.keys.length) + this.keys.length) % this.keys.length];
    if (this.img.texture.key !== k) this.img.setTexture(k);
  }
}

export interface Critter {
  update(t: number, dt: number): void;
  /** Przesunięcie warstwy (paralaksa), na której stoi zwierzę. */
  offset?: number;
}

/** Ptaki krążące po elipsie (sępy nad padliną / nad pustynią). */
export class Circlers implements Critter {
  private readonly b: { a: Anim; ph: number; r: number; sp: number }[];
  private readonly cx: number;
  private readonly cy: number;
  constructor(scene: Phaser.Scene, kind: 'vulture' | 'crow', n: number, cx: number, cy: number, r: number, depth: number, pal: Pal) {
    this.cx = cx;
    this.cy = cy;
    const keys = pixelFrames(scene, `fauna_${kind}_${Object.values(pal).join('')}`, kind === 'vulture' ? VULTURE : CROW_FLY, pal);
    this.b = Array.from({ length: n }, (_, i) => ({ a: new Anim(scene, keys, cx, cy, depth), ph: (i / n) * Math.PI * 2, r: r * (0.7 + (i % 3) * 0.2), sp: 0.22 + (i % 2) * 0.07 }));
  }
  update(t: number): void {
    for (const b of this.b) {
      const a = b.ph + t * b.sp;
      b.a.img.setPosition(Math.round(this.cx + Math.cos(a) * b.r), Math.round(this.cy + Math.sin(a) * b.r * 0.32));
      b.a.img.setFlipX(Math.sin(a) < 0);
      // szybowanie: skrzydła poziomo, co jakiś czas kilka machnięć
      const flap = Math.sin(t * 0.7 + b.ph * 3) > 0.6;
      b.a.frame(flap ? Math.floor(t * 8 + b.ph * 5) % 3 : 1);
    }
  }
}

/** Zwierzę chodzące / biegające w tę i z powrotem po linii ziemi (z pauzami). */
export class Walker implements Critter {
  private readonly a: Anim;
  private x: number;
  private dir: number;
  private pause = 0;
  private readonly x0: number;
  private readonly x1: number;
  private readonly y: number;
  private readonly speed: number;
  private readonly fps: number;
  private readonly idle: number[];
  private readonly walk: number[];
  offset = 0;
  get image(): Phaser.GameObjects.Image {
    return this.a.img;
  }
  constructor(scene: Phaser.Scene, kind: 'rat' | 'dog' | 'hen' | 'lizard' | 'crow', x0: number, x1: number, y: number, depth: number, pal: Pal, seed = 1) {
    const src = { rat: RAT, dog: DOG, hen: HEN, lizard: LIZARD, crow: CROW_GROUND }[kind];
    const keys = pixelFrames(scene, `fauna_${kind}_${Object.values(pal).join('')}`, src, pal);
    this.a = new Anim(scene, keys, x0, y, depth);
    this.x0 = x0;
    this.x1 = x1;
    this.y = y;
    this.x = x0 + ((seed * 37) % 100) / 100 * (x1 - x0);
    this.dir = seed % 2 ? 1 : -1;
    this.speed = { rat: 34, dog: 14, hen: 6, lizard: 22, crow: 5 }[kind];
    this.fps = { rat: 14, dog: 7, hen: 3, lizard: 10, crow: 2 }[kind];
    // kury i kruki głównie stoją i dziobią, reszta głównie chodzi
    this.idle = kind === 'hen' || kind === 'crow' ? [0, 1] : [0];
    this.walk = keys.map((_, i) => i);
    this.pause = kind === 'rat' ? 1.5 + (seed % 3) : 0;
  }
  update(t: number, dt: number): void {
    const img = this.a.img;
    if (this.pause > 0) {
      this.pause -= dt;
      this.a.frame(this.idle[Math.floor(t * this.fps) % this.idle.length]);
    } else {
      this.x += this.dir * this.speed * dt;
      this.a.frame(this.walk[Math.floor(t * this.fps) % this.walk.length]);
      if (this.x < this.x0 || this.x > this.x1) {
        this.dir = -this.dir;
        this.x = Math.max(this.x0, Math.min(this.x1, this.x));
        this.pause = 1 + ((t * 7) % 3);
      } else if (Math.sin(t * 0.9 + this.x0) > 0.985) this.pause = 0.8 + ((t * 3) % 2);
    }
    // sprite'y patrzą w prawo; idąc w lewo - odbicie
    img.setFlipX(this.dir < 0).setPosition(Math.round(this.x + this.offset), this.y);
  }
}

/** Biegacz pustyni (tumbleweed) toczący się z podskokami przez scenę. */
export class Tumbleweed implements Critter {
  private readonly a: Anim;
  private x: number;
  private readonly y: number;
  private readonly w: number;
  private readonly speed: number;
  constructor(scene: Phaser.Scene, y: number, w: number, depth: number, c: ColorIn, hi: ColorIn, speed = 26, x = -20) {
    const keys = pixelFrames(scene, `fauna_weed_${String(c)}${String(hi)}`, WEED, { '#': c, o: hi });
    this.a = new Anim(scene, keys, x, y, depth);
    this.x = x;
    this.y = y;
    this.w = w;
    this.speed = speed;
  }
  update(t: number, dt: number): void {
    this.x += this.speed * dt;
    if (this.x > this.w + 20) this.x = -20 - ((t * 13) % 60);
    const hop = Math.abs(Math.sin(this.x * 0.09)) * 5;
    this.a.img.setPosition(Math.round(this.x), Math.round(this.y - hop));
    this.a.frame(Math.floor(this.x / 4));
  }
}

/** Palety fauny. */
export const FAUNA_PAL = {
  crow: { '#': '#121016', o: '#3a3646', '>': '#4a4436' },
  crowDusk: { '#': '#1a0e12', o: '#5a2a2a', '>': '#6a4a30' },
  vulture: { '#': '#2a1c18', o: '#d8ccb0', p: '#c88a7a' },
  vultureDusk: { '#': '#2a140e', o: '#f0b080', p: '#d07a5a' },
  rat: { '#': '#3a3230', '~': '#6a5048', o: '#c04030' },
  dog: { '#': '#2a1e18', '>': '#100a08' },
  dogNight: { '#': '#14141c', '>': '#06060a' },
  hen: { '#': '#d8ccb0', r: '#c43d2f', o: '#1a1210', '>': '#e0a040', y: '#c08a30' },
  cat: { '#': '#141218' },
  lizard: { '#': '#5a6a3a', '>': '#2a3018' },
} as const satisfies Record<string, Pal>;

