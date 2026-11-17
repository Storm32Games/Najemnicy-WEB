import Phaser from 'phaser';
import { Circlers, type Critter, FAUNA_PAL, type FoliageTones, Walker, bush, dryShrub, grass, leafyTree } from './Nature';
import { BASE_H, BASE_W, type Ctx2D, canvasTexture, seeded } from '../ui/Kit';
import {
  Birds, type ColorIn, css, deadTree, streaks, DriftLayer, LightRays, ParallaxLayer, Windows, clouds, ditherGradient, glow, ground, haze, mix, num, ruins, stars, sun, vignette,
} from './Painter';

// Wspólne, warstwowe tła scen menu (tytuł, werbunek, Przystań, podsumowanie, zakończenia).
// Warstwy od tyłu: niebo (gwiazdy, słońce / księżyc, poświata) -> chmury przewijane w pętli -> promienie światła ->
// daleka linia ruin we mgle -> bliższe ruiny z oknami -> ptaki -> grunt (statyczny, na nim stoją postaci).
// Plany ruin przesuwają się powoli z różną szybkością (paralaksa), więc tło "oddycha" jak w grach z ręcznie
// malowanym pixel artem. Zwracana funkcja update(t, dt) - t w sekundach od startu sceny.

export interface Mood {
  sky: readonly (readonly [number, ColorIn])[];
  starsN: number;
  /** Słońce / księżyc. */
  orb: { core: ColorIn; rim: ColorIn; halo: ColorIn; bands: ColorIn | null; haloA: number } | null;
  cloud: readonly [ColorIn, ColorIn, ColorIn, ColorIn];
  cloudA: number;
  far: ColorIn;
  farHaze: ColorIn;
  mid: ColorIn;
  midRim: ColorIn;
  lit: ColorIn | null;
  groundCrest: ColorIn;
  ground: ColorIn;
  groundDeep: ColorIn;
  rays: number | null;
  birds: number;
  vignette: ColorIn;
}

export const MOODS = {
  dusk: {
    sky: [[0, '#140a26'], [0.22, '#3a1a40'], [0.42, '#86384a'], [0.58, '#d8683a'], [0.7, '#f4a858'], [0.8, '#ffd890']],
    starsN: 70,
    orb: { core: '#fff2c0', rim: '#ffc870', halo: '#ff9a50', bands: '#e88848', haloA: 0.4 },
    cloud: ['#ffc888', '#e0785a', '#9a4256', '#5a2448'],
    cloudA: 0.95,
    far: '#7a3a4c',
    farHaze: '#f0905a',
    mid: '#2c1620',
    midRim: '#d0704a',
    lit: '#ffbe5a',
    groundCrest: '#e09a5c',
    ground: '#7a4428',
    groundDeep: '#2a140c',
    rays: 0xffc070,
    birds: 0x1a0c12,
    vignette: '#0a0410',
  },
  night: {
    sky: [[0, '#02030a'], [0.35, '#081028'], [0.62, '#1a2444'], [0.8, '#36345a']],
    starsN: 220,
    orb: { core: '#f4f0dc', rim: '#c8c8b4', halo: '#8aa0d0', bands: null, haloA: 0.25 },
    cloud: ['#8a96c0', '#4a5684', '#2a3258', '#161c38'],
    cloudA: 0.8,
    far: '#1c2240',
    farHaze: '#3a4470',
    mid: '#0c0e1c',
    midRim: '#4a5a8a',
    lit: '#ffc860',
    groundCrest: '#4a4a5a',
    ground: '#22202a',
    groundDeep: '#0a0a10',
    rays: null,
    birds: 0x05060c,
    vignette: '#000004',
  },
  dawn: {
    sky: [[0, '#1c2a5a'], [0.3, '#5a5a8a'], [0.5, '#d08a70'], [0.66, '#f8c070'], [0.8, '#fff0b8']],
    starsN: 25,
    orb: { core: '#fffbe8', rim: '#ffe8a0', halo: '#ffd080', bands: '#f8c878', haloA: 0.5 },
    cloud: ['#fff0c8', '#f8b890', '#b07888', '#6a5070'],
    cloudA: 0.95,
    far: '#a06a70',
    farHaze: '#ffd0a0',
    mid: '#3a2428',
    midRim: '#f0a060',
    lit: '#ffe08a',
    groundCrest: '#d8a068',
    ground: '#7a4e30',
    groundDeep: '#2a1810',
    rays: 0xffe0a0,
    birds: 0x2a1818,
    vignette: '#100810',
  },
  blood: {
    sky: [[0, '#040206'], [0.4, '#160810'], [0.62, '#3a0e10'], [0.78, '#7a1e14']],
    starsN: 30,
    orb: { core: '#ff8a5a', rim: '#c03020', halo: '#a01810', bands: '#5a1010', haloA: 0.35 },
    cloud: ['#a03a2a', '#5a1a1a', '#2c0c10', '#16060a'],
    cloudA: 0.9,
    far: '#2a0c10',
    farHaze: '#801c14',
    mid: '#0c0406',
    midRim: '#8a2a1a',
    lit: null,
    groundCrest: '#4a1a14',
    ground: '#1c0a0a',
    groundDeep: '#060203',
    rays: null,
    birds: 0x050102,
    vignette: '#100000',
  },
} as const satisfies Record<string, Mood>;

export interface BackdropOptions {
  mood: Mood;
  seed: number;
  /** Środek i promień słońca / księżyca. */
  orb?: [number, number, number];
  /** Podstawa dalekich i bliższych ruin. */
  farBase?: number;
  midBase?: number;
  midH?: [number, number];
  /** Linia gruntu (pierwsza wydma). */
  groundY?: number;
  /** Amplituda powolnej panoramy (px). */
  pan?: number;
  clouds?: number;
  /** Dodatkowe malowanie na warstwie gruntu (rekwizyty pierwszego planu). */
  props?: (g: Ctx2D, w: number, h: number, profile: number[]) => void;
  vignette?: number;
  /** Roślinność na pierwszym planie (drzewa, krzaki, trawa); `avoid` - przedziały x bez roślin (postaci, napisy). */
  flora?: { tones: FoliageTones; density?: number; avoid?: [number, number][]; dead?: boolean };
  /** Zwierzęta: kruki na ziemi i krążące ptaki. */
  fauna?: { crows?: number; circlers?: 'vulture' | 'crow'; avoid?: [number, number][] };
}

const M = 24; // zapas warstw paralaksy z każdej strony

/** Buduje warstwy tła sceny; zwraca update(t, dt). */
export function backdrop(scene: Phaser.Scene, key: string, o: BackdropOptions): (t: number, dt: number) => void {
  const md = o.mood, W = BASE_W, H = BASE_H, rnd = seeded(o.seed);
  const [sx, sy, sr] = o.orb ?? [196, 150, 30];
  const farBase = o.farBase ?? 196, midBase = o.midBase ?? 204, gY = o.groundY ?? 202;
  const [mhMin, mhMax] = o.midH ?? [20, 96];

  // 1) niebo
  canvasTexture(scene, `${key}_sky`, W + 2 * M, H, (g, w, h) => {
    ditherGradient(g, 0, 0, w, h, md.sky, 22);
    stars(g, w, h * 0.55, seeded(o.seed + 1), md.starsN);
    if (md.orb) sun(g, sx + M, sy, sr, { ...md.orb, haloR: sr * 4 });
  });
  const sky = new ParallaxLayer(scene, `${key}_sky`, 0.05, M, 0);

  // 2) chmury (pętla)
  const nc = o.clouds ?? 7;
  canvasTexture(scene, `${key}_clouds`, W, Math.round(H * 0.6), (g, w, h) => {
    const r = seeded(o.seed + 2);
    const list: [number, number, number, number][] = [];
    // kilka dużych cumulusów wyżej + smugi chmur warstwowych nisko nad horyzontem
    for (let i = 0; i < Math.ceil(nc / 2); i++) {
      const y = 26 + r() * (h * 0.45);
      const s = 0.65 + (y / h) * 0.6;
      list.push([((i + r() * 0.6) / Math.ceil(nc / 2)) * w, y, (60 + r() * 70) * s, (13 + r() * 9) * s]);
    }
    clouds(g, w, h, r, list, { tones: md.cloud, light: sx < W / 2 ? -1 : 1, wrap: true });
    streaks(g, w, r, h * 0.55, h * 0.92, nc * 2, [md.cloud[0], md.cloud[1], md.cloud[2]], true);
  });
  const cl = new DriftLayer(scene, `${key}_clouds`, W, 2.2, 0, 0, md.cloudA);

  // 3) promienie
  const rays = md.rays !== null && md.orb ? new LightRays(scene, sx, sy, 9, md.rays, -Math.PI * 0.95, -Math.PI * 0.05, 360, 0, 0.035, o.seed) : null;

  // 4) dalekie ruiny we mgle
  canvasTexture(scene, `${key}_far`, W + 2 * M, H, (g, w) => {
    ruins(g, rnd, { base: farBase, n: 44, hMin: 8, hMax: 46, wMin: 8, wMax: 20, body: md.far, side: mix(md.far, '#000000', 0.2), rim: null, win: mix(md.far, '#000000', 0.15), lit: null, detail: 0.35, x0: 0, x1: w });
    haze(g, 0, farBase - 70, w, 74, md.farHaze, 0.05, 0.65);
  });
  const far = new ParallaxLayer(scene, `${key}_far`, 0.25, M, 0);

  // 5) bliższe ruiny z oknami i obwódką światła
  const spots: [number, number][] = [];
  canvasTexture(scene, `${key}_mid`, W + 2 * M, H, (g, w) => {
    ruins(g, rnd, { base: midBase, n: 22, hMin: mhMin, hMax: mhMax, wMin: 14, wMax: 30, body: md.mid, rim: md.midRim, lit: md.lit, litChance: 0.07, light: sx < W / 2 ? -1 : 1, detail: 1, x0: 0, x1: w });
    haze(g, 0, midBase - 18, w, 20, md.farHaze, 0, 0.28);
    // migające okna: tylko w miejscach, gdzie stoi budynek (pełne piksele na całej wysokości okna i wokół)
    const d = g.getImageData(0, 0, w, BASE_H).data;
    const solid = (x: number, y: number): boolean => d[(y * w + x) * 4 + 3] === 255;
    for (let k = 0; k < 400 && spots.length < 14; k++) {
      const x = Math.round(M + 8 + rnd() * (W - 16)), y = Math.round(midBase - 8 - rnd() * mhMax);
      if (solid(x - 2, y - 3) && solid(x + 2, y - 3) && solid(x, y + 3) && solid(x, y - 4)) spots.push([x - M, y]);
    }
  });
  const mid = new ParallaxLayer(scene, `${key}_mid`, 0.6, M, 0);
  const win = md.lit ? new Windows(scene, spots, num(md.lit), 0, o.seed + 9) : null;

  // 6) ptaki
  const birds = md.birds ? new Birds(scene, 5, { x: 0, y: 40, w: W, h: 60 }, md.birds, 0, o.seed + 4) : null;

  // 7) grunt + rekwizyty + flora
  let groundY = (_x: number): number => gY;
  canvasTexture(scene, `${key}_ground`, W, H, (g, w, h) => {
    const r = seeded(o.seed + 5);
    const p1 = ground(g, w, h, gY, { crest: md.groundCrest, body: md.ground, deep: md.groundDeep, amp: 3, freq: 0.022, seed: o.seed, debris: 0.25, rnd: r });
    groundY = (x: number): number => p1[Math.max(0, Math.min(w - 1, Math.round(x)))];
    const p2 = ground(g, w, h, gY + 18, { crest: mix(md.groundCrest, md.ground, 0.4), body: mix(md.ground, md.groundDeep, 0.45), deep: md.groundDeep, amp: 4, freq: 0.035, seed: o.seed + 3, debris: 0.4, rnd: r });
    if (md.orb) glow(g, sx, gY + 2, sr * 3, 6, md.orb.halo, 0.25, { levels: 4 });
    if (o.flora) {
      const f = o.flora, fr = seeded(o.seed + 11), dens = f.density ?? 1;
      const free = (x: number): boolean => x > 4 && x < w - 4 && !(f.avoid ?? []).some(([a, b]) => x >= a && x <= b);
      const yAt = (x: number): number => groundY(x);
      // drzewa w tle przy linii pierwszej wydmy, krzaki i trawa bliżej
      for (let k = 0; k < Math.round(3 * dens); k++) {
        const x = Math.round(fr() * w);
        if (!free(x)) continue;
        if (f.dead || fr() < 0.5) deadTree(g, x, yAt(x) + 1, 26 + fr() * 26, fr, f.tones.trunk, f.tones.trunkLit, sx < W / 2 ? -1 : 1);
        else leafyTree(g, x, yAt(x) + 1, 26 + fr() * 18, fr, f.tones, sx < W / 2 ? -1 : 1);
      }
      for (let k = 0; k < Math.round(7 * dens); k++) {
        const x = Math.round(fr() * w);
        if (!free(x)) continue;
        if (f.dead) dryShrub(g, x, yAt(x) + 2, 5 + fr() * 6, fr, f.tones.trunk, f.tones.trunkLit ?? f.tones.lit);
        else bush(g, x, yAt(x) + 2, 3 + fr() * 4, fr, f.tones, sx < W / 2 ? -1 : 1);
      }
      for (let k = 0; k < Math.round(40 * dens); k++) {
        const x = Math.round(fr() * w);
        if (!free(x)) continue;
        const y = fr() < 0.5 ? yAt(x) + 1 + Math.floor(fr() * 4) : p2[x] + 1 + Math.floor(fr() * 10);
        grass(g, x, y, 3 + Math.floor(fr() * 5), 3 + fr() * 4, fr, f.tones.shade, f.dead ? f.tones.trunkLit ?? f.tones.mid : f.tones.mid, f.dead ? md.groundCrest : f.tones.lit);
      }
    }
    o.props?.(g, w, h, p2);
    if (o.vignette !== 0) vignette(g, w, h, md.vignette, o.vignette ?? 0.5);
  });
  scene.add.image(0, 0, `${key}_ground`).setOrigin(0).setDepth(0);

  // fauna: kruki dreptające po ziemi, ptaki krążące wysoko
  const critters: Critter[] = [];
  if (o.fauna) {
    const fr = seeded(o.seed + 13), pal = md === MOODS.night ? FAUNA_PAL.crow : FAUNA_PAL.crowDusk;
    for (let k = 0; k < (o.fauna.crows ?? 2); k++) {
      let x = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = Math.round(20 + fr() * (W - 40));
        if (!(o.fauna.avoid ?? []).some(([a, b]) => x >= a - 10 && x <= b + 10)) break;
      }
      critters.push(new Walker(scene, 'crow', x - 6, x + 6, groundY(x) + 2, 0, pal, k + 1));
    }
    if (o.fauna.circlers) critters.push(new Circlers(scene, o.fauna.circlers, 3, sx < W / 2 ? W * 0.7 : W * 0.3, 52, 40, 0, o.fauna.circlers === 'vulture' ? FAUNA_PAL.vultureDusk : pal));
  }

  const pan = o.pan ?? 14;
  return (t: number, dt: number) => {
    const p = Math.sin(t * 0.045) * pan;
    sky.set(p);
    far.set(p);
    mid.set(p);
    cl.update(dt);
    rays?.update(t);
    birds?.update(t, dt);
    win?.update(t, mid.dx);
    for (const c of critters) c.update(t, dt);
  };
}

/** Wrak samochodu (sylwetka z obwódką światła i ciepłym blikiem w szybie). */
export function paintWreck(g: Ctx2D, x: number, y: number, body: ColorIn, rim: ColorIn, glass: ColorIn): void {
  const px = (c: ColorIn, a: number, b: number, w: number, h: number): void => {
    g.fillStyle = css(c);
    g.fillRect(x + a, y + b, w, h);
  };
  px(body, 0, -12, 58, 9); // nadwozie
  px(body, 10, -21, 30, 10); // kabina
  px(body, 6, -14, 6, 2);
  px(mix(body, '#000000', 0.4), 0, -4, 58, 2); // próg w cieniu
  px(glass, 13, -19, 11, 6); // szyby
  px(glass, 27, -19, 10, 6);
  px(mix(glass, '#ffffff', 0.4), 13, -19, 3, 1);
  px(mix(body, '#000000', 0.5), 24, -19, 3, 6); // słupek
  px(rim, 0, -12, 58, 1); // obwódka
  px(rim, 10, -21, 30, 1);
  px(rim, 0, -12, 1, 8);
  // koła (jedno urwane - wrak przechylony)
  px(mix(body, '#000000', 0.6), 6, -4, 11, 5);
  px(mix(body, '#000000', 0.6), 42, -4, 11, 4);
  px(mix(rim, body, 0.6), 9, -3, 4, 2);
  // rdza i dziury po kulach
  px(mix(body, '#a04a20', 0.5), 44, -10, 8, 3);
  for (const [a, b] of [[20, -9], [34, -8], [48, -7]] as const) px(mix(body, '#000000', 0.7), a, b, 1, 1);
}
