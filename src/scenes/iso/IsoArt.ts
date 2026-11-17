// Proceduralne tekstury świata izometrycznego: podłogi, ściany, bloki budynków, rekwizyty,
// kalkomanie (plamy, przypalenia), okluzja otoczenia i efekty (poświata, kursor, czcionka).
// Palety pochodzą z Oldgame/src/gfx/textures.js i props.js; geometria 3D zastąpiona rzutem izometrycznym 2:1.
import { textPixels } from '../ui/FontGlyphs';
import { addHiRes } from './HiRes';
import type Phaser from 'phaser';
import type { Biome, FloorType, PropType } from '../../core/tactical/mapgen';
import { floraPixels } from '../legacy/flora';
import {
  type Fill, IsoPen, PixelCanvas, type RGB, TILE_H, TILE_W, bayer, clamp01, diamondSpan, forDiamond, hash2, mix, pick, ramp,
  rng, shade, vnoise,
} from './Pixel';

/** Gdzie w teksturze leży górny wierzchołek rombu pola bazowego. */
export interface ArtInfo {
  key: string;
  ax: number;
  ay: number;
}

// ------------------------------------------------------------------ rejestr tekstur

export class ArtBook {
  private readonly scene: Phaser.Scene;
  private readonly infos = new Map<string, ArtInfo>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Zwraca teksturę z pamięci lub buduje ją leniwie. */
  get(key: string, build: () => { pc: PixelCanvas; ax: number; ay: number }): ArtInfo {
    const hit = this.infos.get(key);
    if (hit && this.scene.textures.exists(key)) return hit;
    const { pc, ax, ay } = build();
    // kafelki w szerokości pola (podłogi, przejścia, bloki ścian) składają się z sąsiadami: bez wygładzania krawędzi
    addHiRes(this.scene, key, pc, { smooth: pc.w !== TILE_W });
    const info = { key, ax, ay };
    this.infos.set(key, info);
    return info;
  }

  /** Arkusz klatek ułożonych poziomo (frame = nazwa). */
  sheet(key: string, pc: PixelCanvas, frames: { name: string; x: number; y: number; w: number; h: number }[]): void {
    if (this.scene.textures.exists(key)) return;
    addHiRes(this.scene, key, pc, {}, frames.map((f) => ({ ...f, name: f.name })));
  }
}

/** Rysuje rekwizyt na dużym płótnie, obrysowuje i przycina; anchor = wierzchołek rombu. */
function propCanvas(draw: (pen: IsoPen) => void, outline = true): { pc: PixelCanvas; ax: number; ay: number } {
  const big = new PixelCanvas(64, 104);
  const pen = new IsoPen(big, 32, 80);
  draw(pen);
  if (outline) big.outline();
  const { pc, ox, oy } = big.crop();
  return { pc, ax: 32 - ox, ay: 80 - oy };
}

/** Miękki cień rzucany w stronę +u (światło z lewej-góry). */
function castShadow(pen: IsoPen, u0: number, v0: number, u1: number, v1: number, len = 0.25, a = 70): void {
  pen.flat(u0 + len * 0.2, v0 + 0.02, u1 + len, v1 + 0.06, 0, (x, y) => (bayer(x, y) < 0.85 ? 0x0a0608 : -1), a);
}

// ------------------------------------------------------------------ palety

export const FLOOR_BASE: Record<FloorType, RGB> = {
  sand: 0xc4a064, asphalt: 0x3b3b40, asphalt_cracked: 0x3e3d42, rubble: 0x6e6a62, concrete: 0x85807a,
  dirt: 0x6a4a30, toxic: 0x3a3a2c, grass_dead: 0x8a7c3e, metal: 0x59626a, tiles: 0xa39a84,
};

export const BIOME_STYLE: Record<Biome, { bg: number; memory: number; wall: RGB; facade: RGB[] }> = {
  ruins: { bg: 0x141217, memory: 0x2a2e48, wall: 0x8a4a38, facade: [0x8a7a68, 0x6a7078, 0x7a5a48, 0x76705e] },
  wastes: { bg: 0x141316, memory: 0x262c4a, wall: 0xa08a64, facade: [0x9a8460, 0x8a7458] },
  industrial: { bg: 0x121416, memory: 0x283044, wall: 0x7a7670, facade: [0x6a7078, 0x5a6268] },
  bunker: { bg: 0x0a0b0d, memory: 0x262c42, wall: 0x56606a, facade: [0x4a525a] },
};

const CAR_COLS: RGB[] = [0x9a3a28, 0x3a5a7a, 0x5a6a3a, 0xa89a4a, 0xb8b4a8, 0x5a4a5a, 0x2a2a2e];
const RUST = ramp(0x8a4a28);
const METAL = ramp(0x5a626a);
const DARK_METAL = ramp(0x3a3f44);
const CONCRETE = ramp(0x85807a);
const WOOD = ramp(0x8a6038);
const BONE = 0xd8ccae;
/** Wysokość piętra budynku w pikselach. */
export const FLOOR_PX = 16;

// ------------------------------------------------------------------ podłogi

/** Kafelek podłogi 32x16. */
export function paintFloor(type: FloorType, variant: number): PixelCanvas {
  const pc = new PixelCanvas(TILE_W, TILE_H);
  const pen = new IsoPen(pc, 16, 0);
  const seed = variant * 7919 + type.length * 131;
  const r = ramp(FLOOR_BASE[type], 6, 0.42);
  const R = rng(seed + 17);
  const sp = (x: number, y: number) => hash2(x, y, seed) - 0.5;

  forDiamond((x, y) => {
    const [u, v] = pen.uv(x, y);
    let L = 0.5;
    switch (type) {
      case 'asphalt':
      case 'asphalt_cracked': {
        const h = hash2(x, y, seed);
        L = 0.42 + sp(x, y) * 0.3 + (h > 0.94 ? 0.32 : 0) + (vnoise(u * 5, v * 5, seed) - 0.5) * 0.1;
        if (variant === 1 && Math.hypot(u - 0.55, (v - 0.45) * 1.3) < 0.22 + (hash2(x >> 1, y, 5) - 0.5) * 0.08) L -= 0.22;
        break;
      }
      case 'concrete': {
        L = 0.56 + sp(x, y) * 0.16 + (vnoise(u * 4, v * 4, seed) - 0.5) * 0.18;
        if (u < 0.05 || v < 0.05) L += 0.18;
        if (u > 0.95 || v > 0.95) L -= 0.32;
        if (variant === 1 && Math.abs(u - 0.5) < 0.03) L -= 0.28;
        if (variant === 2 && Math.hypot(u - 0.4, v - 0.6) < 0.2) L -= 0.14;
        break;
      }
      case 'tiles': {
        const fu = u * 3, fv = v * 3;
        const iu = Math.floor(fu), iv = Math.floor(fv);
        const gu = fu - iu, gv = fv - iv;
        const hTile = hash2(iu, iv, seed);
        const missing = hTile < 0.08 + variant * 0.03;
        if (gu < 0.12 || gv < 0.12) L = 0.12;
        else if (missing) L = 0.22 + sp(x, y) * 0.2;
        else L = ((iu + iv) & 1 ? 0.62 : 0.5) + (hTile - 0.5) * 0.14 + sp(x, y) * 0.08 + (gu < 0.24 || gv < 0.24 ? 0.12 : 0);
        break;
      }
      case 'metal': {
        const fu = (u * 2) % 1, fv = (v * 2) % 1;
        L = 0.52 + sp(x, y) * 0.08 + (hash2(0, Math.floor(v * 40), seed) - 0.5) * 0.1;
        if (fu < 0.05 || fv < 0.05) L = 0.18;
        else if (fu < 0.1 || fv < 0.1) L += 0.25;
        if ((Math.abs(fu - 0.17) < 0.04 || Math.abs(fu - 0.83) < 0.04) && (Math.abs(fv - 0.17) < 0.06 || Math.abs(fv - 0.83) < 0.06)) L = 0.9;
        if (variant === 3 && v > 0.72 && v < 0.92) {
          const stripe = ((x + y * 2) >> 2) & 1;
          return void pc.set(x, y, stripe ? pick(ramp(0xc0a030), 0.5 + sp(x, y) * 0.3, x, y) : 0x24221e);
        }
        if (vnoise(u * 3, v * 3, seed + 9) > 0.72) return void pc.set(x, y, pick(RUST, 0.35 + sp(x, y) * 0.4, x, y));
        break;
      }
      case 'rubble':
        L = 0.45 + sp(x, y) * 0.3 + (vnoise(u * 6, v * 6, seed) - 0.5) * 0.2;
        break;
      case 'sand': {
        const ripple = Math.sin(2 * Math.PI * 3 * (u - v) + 0.7 * Math.sin(2 * Math.PI * 2 * (u + v)));
        L = 0.55 + ripple * 0.12 + sp(x, y) * 0.16;
        break;
      }
      case 'dirt':
        L = 0.5 + sp(x, y) * 0.28 + (vnoise(u * 4, v * 4, seed) - 0.5) * 0.16;
        if (variant === 1 && (Math.abs(v - 0.32) < 0.05 || Math.abs(v - 0.68) < 0.05)) L -= 0.2;
        break;
      case 'grass_dead': {
        // Oldgame/src/gfx/textures.js: plamy wyschniętej darni + łysiny gołej ziemi
        const patch = vnoise(u * 3.2, v * 3.2, seed);
        L = 0.46 + sp(x, y) * 0.22 + (patch - 0.5) * 0.3;
        if (vnoise(u * 2.4 + 7, v * 2.4, seed + 3) > 0.7 - variant * 0.03) return void pc.set(x, y, pick(ramp(0x6a5030, 5, 0.4), 0.45 + sp(x, y) * 0.4, x, y));
        break;
      }
      case 'toxic': {
        L = 0.45 + sp(x, y) * 0.26;
        const d = Math.hypot(u - 0.5, (v - 0.5) * 1.1) + (vnoise(u * 7, v * 7, seed) - 0.5) * 0.14;
        const rad = 0.24 + (variant % 3) * 0.05;
        if (d < rad) {
          const goo = ramp(0x4fae2a, 6, 0.55);
          const k = 1 - d / rad;
          return void pc.set(x, y, d > rad - 0.05 ? 0x1c3a14 : pick(goo, 0.3 + k * 0.6 + sp(x, y) * 0.2, x, y));
        }
        if (d < rad + 0.06) L -= 0.2;
        break;
      }
    }
    pc.set(x, y, pick(r, L, x, y));
  });

  // detale nakładane na wierzch
  if (type === 'asphalt_cracked' || (type === 'concrete' && variant > 0) || (type === 'tiles' && variant > 1)) {
    for (let k = 0; k < (type === 'asphalt_cracked' ? 2 : 1); k++) crack(pc, pen, R, r[0], r[r.length - 2]);
    if (type === 'asphalt_cracked') for (let k = 0; k < 3; k++) weed(pc, pen, R);
  }
  if (type === 'asphalt' && variant === 3) {
    // przerywana linia drogi wzdłuż osi u
    for (let u = 0.08; u < 0.95; u += 0.5) pen.flat(u, 0.47, u + 0.28, 0.55, 0, (x, y) => pick(ramp(0xb8a84a), 0.45 + (hash2(x, y, 3) - 0.5) * 0.5, x, y));
  }
  if (type === 'rubble') {
    const stones = 6 + (R() * 5) | 0;
    const cols = [0x8a8478, 0x6a655c, 0x9a958a, 0x5a564f, 0x76665a];
    const list: [number, number, number][] = [];
    for (let i = 0; i < stones; i++) list.push([0.12 + R() * 0.72, 0.12 + R() * 0.72, R()]);
    list.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    for (const [u, v, q] of list) {
      const s = 0.06 + q * 0.09;
      pen.shadedBox(u, v, u + s, v + s * (0.7 + q * 0.5), 0, 1 + Math.round(q * 2), ramp(cols[(q * 5) | 0], 4, 0.3), undefined, false);
    }
  }
  if (type === 'dirt' || type === 'sand') {
    for (let k = 0; k < 3; k++) {
      const [x, y] = pen.p(0.15 + R() * 0.7, 0.15 + R() * 0.7);
      pc.set(x, y, r[r.length - 1]);
      pc.set(x + 1, y + 1, r[1]);
    }
  }
  if (type === 'grass_dead') {
    // kępki suchej trawy: 2-3 źdźbła z jaśniejszym czubkiem i cieniem u podstawy
    const tuft = [0xa89a4a, 0x6a5a2a, 0xc0b060, 0x5a6a2a, 0xb8a858];
    for (let k = 0; k < 9; k++) {
      const [x, y] = pen.p(0.14 + R() * 0.72, 0.14 + R() * 0.72);
      const c = tuft[(R() * tuft.length) | 0];
      if (!pc.alpha(x, y) || !pc.alpha(x - 1, y) || !pc.alpha(x + 1, y)) continue;
      pc.set(x, y, shade(c, 0.6));
      pc.set(x - 1, y - 1, c);
      pc.set(x + 1, y - 1, shade(c, 0.85));
      if (R() < 0.6 && pc.alpha(x, y - 2)) pc.set(x, y - 2, shade(c, 1.25));
    }
  }
  if (type === 'toxic') {
    for (let k = 0; k < 3; k++) {
      const [x, y] = pen.p(0.4 + R() * 0.2, 0.4 + R() * 0.2);
      pc.set(x, y, 0xe8ffb0);
    }
  }
  return pc;
}

function crack(pc: PixelCanvas, pen: IsoPen, R: () => number, dark: RGB, lite: RGB): void {
  let [x, y] = pen.p(0.2 + R() * 0.6, 0.2 + R() * 0.6);
  let dir = R() * Math.PI * 2;
  for (let i = 0; i < 12; i++) {
    const [u, v] = pen.uv(x, y);
    if (u < 0.04 || v < 0.04 || u > 0.96 || v > 0.96) break;
    pc.set(x, y, dark);
    if (pc.alpha(x, y + 1)) pc.set(x, y + 1, lite);
    dir += (R() - 0.5) * 1.2;
    x += Math.round(Math.cos(dir) * 1.4);
    y += Math.round(Math.sin(dir) * 0.8);
  }
}

function weed(pc: PixelCanvas, pen: IsoPen, R: () => number): void {
  const [x, y] = pen.p(0.2 + R() * 0.6, 0.2 + R() * 0.6);
  pc.set(x, y, 0x5a6a2a);
  pc.set(x - 1, y - 1, 0x7a8a3a);
  pc.set(x + 1, y - 1, 0x6a7a2a);
}

/** Materiały "miękkie" rozlewają się na sąsiednie pola (wyższy priorytet przykrywa niższy). */
export const FLOOR_SPILL: Partial<Record<FloorType, number>> = { sand: 3, grass_dead: 2.5, dirt: 2, rubble: 1 };

/**
 * Przejście terenu: tekstura sąsiedniego materiału wchodząca od krawędzi pola, z poszarpanym,
 * ditherowanym brzegiem. edges: 1=-u, 2=-v, 4=+u, 8=+v.
 */
export function paintBlend(type: FloorType, edges: number, seed: number): PixelCanvas {
  const src = paintFloor(type, seed % 3);
  const pc = new PixelCanvas(TILE_W, TILE_H);
  const pen = new IsoPen(pc, 16, 0);
  forDiamond((x, y) => {
    const [u, v] = pen.uv(x, y);
    let k = 0;
    const reach = 0.42;
    if (edges & 1) k = Math.max(k, 1 - u / reach);
    if (edges & 2) k = Math.max(k, 1 - v / reach);
    if (edges & 4) k = Math.max(k, 1 - (1 - u) / reach);
    if (edges & 8) k = Math.max(k, 1 - (1 - v) / reach);
    if (k <= 0) return;
    k += (vnoise(x / 3, y / 2, seed) - 0.5) * 0.7;
    if (k > 0.35 + bayer(x, y) * 0.4) pc.set(x, y, src.get(x, y));
  });
  return pc;
}

/** Boczna "skarpa" na krawędzi mapy (efekt dioramy). side: 'l' = ściana +v, 'r' = ściana +u. */
export function paintEdge(side: 'l' | 'r', biome: Biome): PixelCanvas {
  const depth = 12;
  const pc = new PixelCanvas(TILE_W, TILE_H + depth);
  const pen = new IsoPen(pc, 16, 0);
  const soil = ramp(biome === 'bunker' ? 0x3a3c40 : biome === 'wastes' ? 0x6a4e34 : 0x4a3a30, 5, 0.4);
  const f: Fill = (x, y, s, z) => {
    const band = Math.floor((z + depth + hash2(Math.floor(s / 3), 0, 7) * 2) / 4);
    const stone = hash2(x >> 1, y >> 1, 11) > 0.86;
    const base = (side === 'l' ? 0.45 : 0.25) + (band % 2 ? 0.08 : -0.04) + (hash2(x, y, 3) - 0.5) * 0.16 + (stone ? 0.22 : 0) + (z > -2 ? 0.15 : 0);
    return pick(soil, base * (1 + (z + depth) / depth * 0.4), x, y);
  };
  pen.box(0, 0, 1, 1, -depth, 0, side === 'l' ? { left: f } : { right: f });
  return pc;
}

/** Okluzja otoczenia przy ścianach. mask: 1=-u, 2=-v, 4=+u, 8=+v, 16=narożnik -u-v. */
export function paintAO(mask: number): PixelCanvas {
  const pc = new PixelCanvas(TILE_W, TILE_H);
  const pen = new IsoPen(pc, 16, 0);
  forDiamond((x, y) => {
    const [u, v] = pen.uv(x, y);
    let k = 0;
    if (mask & 1) k = Math.max(k, 1 - u / 0.5);
    if (mask & 2) k = Math.max(k, 1 - v / 0.5);
    if (mask & 4) k = Math.max(k, 1 - (1 - u) / 0.32);
    if (mask & 8) k = Math.max(k, 1 - (1 - v) / 0.32);
    if (mask & 16) k = Math.max(k, 1 - Math.hypot(u, v) / 0.45);
    k = clamp01(k);
    if (k <= 0) return;
    const lvl = k * k * 3;
    const i = Math.floor(lvl) + (lvl - Math.floor(lvl) > bayer(x, y) ? 1 : 0);
    if (i > 0) pc.set(x, y, 0x06040a, [0, 46, 84, 120][Math.min(3, i)]);
  });
  return pc;
}

// ------------------------------------------------------------------ bloki (budynki, bunkier)

/**
 * Pełny blok pola: budynek (piętra z oknami) albo lita ściana bunkra.
 * open: 1 = odsłonięta ściana +v (lewa), 2 = +u (prawa), 4 = -u, 8 = -v (dla gzymsu dachu).
 */
export function paintBlock(kind: 'building' | 'bunker', floors: number, open: number, color: RGB, seed: number): { pc: PixelCanvas; ax: number; ay: number } {
  const H = kind === 'bunker' ? 28 : 6 + floors * FLOOR_PX;
  const pc = new PixelCanvas(TILE_W, TILE_H + H + 4);
  const pen = new IsoPen(pc, 16, H + 3);
  const R = rng(seed);
  const r = ramp(color, 6, 0.46);
  const dark = 0x15161c;

  const facade = (face: 1 | 2): Fill => (x, y, s, z) => {
    const lit = face === 1 ? 0.55 : 0.3;
    if (kind === 'bunker') {
      let L = lit + (hash2(x, y, seed) - 0.5) * 0.1 + (vnoise(s / 6, z / 6, seed) - 0.5) * 0.12;
      if (s < 1) L -= 0.18;
      if (z > 15 && z < 19) return pick(METAL, (face === 1 ? 0.45 : 0.25) + (z > 17 ? 0.25 : z < 16 ? -0.15 : 0.1), x, y);
      if (z < 3) return ((x + y) >> 1) & 2 ? 0xc0a030 : 0x1e1c18;
      if (z > H - 2) L += 0.2;
      return pick(r, L, x, y);
    }
    // budynek: piętra po FLOOR_PX, okno pośrodku każdego segmentu ściany
    const fl = Math.floor((z - 4) / FLOOR_PX);
    const fz = (z - 4) - fl * FLOOR_PX;
    let L = lit + (hash2(x, y, seed) - 0.5) * 0.12 + (vnoise(s / 5, z / 5, seed + face) - 0.5) * 0.16;
    if (z < 4) L -= 0.22; // cokół / brud
    if (fl >= 0 && fl < floors && fz >= 5 && fz < 13 && s >= 5 && s < 12) {
      const broken = hash2(fl, face, seed) < 0.35;
      const litWin = hash2(fl, face + 7, seed) < 0.12;
      if (fz === 12 || s === 5) return pick(r, lit - 0.25, x, y); // nadproże / ościeże w cieniu
      if (litWin) return fz > 9 ? 0xb07838 : 0xe8b860;
      if (broken && hash2(x, y, 99) < 0.5) return 0x0c0c10;
      return fz === 11 && s === 6 ? 0x5a6a7a : dark;
    }
    if (fl >= 0 && fz < 2 && z > 4) L -= 0.12; // linia stropu
    if (fl >= 0 && fz >= 13 && s >= 5 && s < 12 && hash2(fl, face + 3, seed) < 0.6) L -= 0.5 * (FLOOR_PX + 1 - fz) / 3; // sadza nad oknem
    return pick(r, L, x, y);
  };

  if (open & 1) pen.box(0, 0, 1, 1, 0, H, { left: facade(1) });
  if (open & 2) pen.box(0, 0, 1, 1, 0, H, { right: facade(2) });

  // dach / wierzch
  const top = kind === 'bunker' ? ramp(0x2a2c32, 5, 0.3) : ramp(shade(color, 0.85), 5, 0.36);
  pen.flat(0, 0, 1, 1, H, (x, y, u, v) => {
    let L = 0.45 + (hash2(x, y, seed + 1) - 0.5) * 0.2 + (vnoise(u * 3, v * 3, seed) - 0.5) * 0.2;
    if (kind === 'building') {
      const rim = ((open & 4) && u < 0.1) || ((open & 8) && v < 0.1) || ((open & 2) && u > 0.9) || ((open & 1) && v > 0.9);
      if (rim) L += 0.3;
    }
    return pick(top, L, x, y);
  });
  if (kind === 'building') {
    // gzymsy dachu jako niska ścianka
    const rim = ramp(shade(color, 1.05), 5, 0.4);
    if (open & 8) pen.shadedBox(0, 0, 1, 0.1, H, H + 2, rim);
    if (open & 4) pen.shadedBox(0, 0, 0.1, 1, H, H + 2, rim);
    if (open & 1) pen.shadedBox(0, 0.9, 1, 1, H, H + 2, rim);
    if (open & 2) pen.shadedBox(0.9, 0, 1, 1, H, H + 2, rim);
    // rupiecie na dachu
    if (R() < 0.25) pen.shadedBox(0.3, 0.3, 0.65, 0.6, H, H + 6, METAL);
    else if (R() < 0.2) for (let i = 0; i < 4; i++) pen.shadedBox(0.2 + R() * 0.5, 0.2 + R() * 0.5, 0.3 + R() * 0.5, 0.3 + R() * 0.5, H, H + 1 + R() * 2, CONCRETE);
  }
  return { pc, ax: 16, ay: H + 3 };
}

// ------------------------------------------------------------------ ściany z łączeniami

/** Ściana łącząca się z sąsiednimi ścianami. conn: 1=-u, 2=+u, 4=-v, 8=+v. */
export function paintWall(conn: number, broken: boolean, color: RGB, biome: Biome, seed: number): { pc: PixelCanvas; ax: number; ay: number } {
  return propCanvas((pen) => {
    const R = rng(seed);
    const r = ramp(color, 6, 0.46);
    const brick = biome === 'ruins' || biome === 'wastes';
    const t0 = 0.34, t1 = 0.66;
    const hFull = 22;
    const tex = (face: 0 | 1 | 2, x: number, y: number, s: number, z: number): number => {
      let n = (hash2(x, y, seed) - 0.5) * 0.5;
      if (face === 0) return n + 0.2;
      if (brick) {
        const row = Math.floor(z / 3);
        const col = Math.floor((s + (row & 1) * 3) / 6);
        if (Math.floor(z) % 3 === 0 || Math.floor(s + (row & 1) * 3) % 6 === 0) n -= 0.9;
        else n += (hash2(col, row, seed) - 0.5) * 0.8;
      } else if (Math.floor(s) % 8 === 0) n -= 0.6;
      if (z < 2) n -= 0.5;
      return n;
    };
    if (broken) {
      // ---- ruina muru: poszarpany, schodkowy szczyt, odsłonięty rdzeń, pręty zbrojeniowe i gruz u podstawy
      const core = ramp(brick ? mix(color, 0xd8c8a8, 0.35) : mix(color, 0xb0aca4, 0.4), 6, 0.4); // jaśniejszy przełam
      const rebar = (u: number, v: number, z: number): void => {
        const len = 3 + Math.floor(R() * 5), bend = R() < 0.5 ? -1 : 1;
        const [x, y] = pen.p(u, v, z);
        for (let i = 1; i <= len; i++) pen.pc.set(x + (i > len - 2 ? bend : 0), y - i, i === len ? 0xc87a48 : i & 1 ? 0x7a3a1c : 0x9a5228);
      };
      const chunk = (u0: number, v0: number, u1: number, v1: number, h: number, bar: boolean): void => {
        pen.shadedBox(u0, v0, u1, v1, 0, h, r, tex, false);
        // przełam na szczycie: jasny rdzeń z ciemnymi szczerbami
        pen.flat(u0, v0, u1, v1, h, (x, y) => (hash2(x, y, seed + 5) < 0.22 ? r[0] : pick(core, 0.55 + (hash2(x, y, seed) - 0.5) * 0.5, x, y)));
        if (bar) rebar((u0 + u1) / 2, (v0 + v1) / 2, h);
      };
      // ramię dzielone na 3 odcinki o malejącej / rosnącej wysokości (profil "wyszczerbiony")
      const arm = (u0: number, v0: number, u1: number, v1: number, rising: boolean): void => {
        const alongU = u1 - u0 > v1 - v0, n = 3;
        for (let i = 0; i < n; i++) {
          const k = rising ? i : n - 1 - i; // 0 = przy końcu muru (najniższy), n-1 = przy środku
          const h = 3 + k * 4 + Math.floor(R() * 5);
          if (k === 0 && R() < 0.35) continue; // wyrwa przy końcu
          const f0 = i / n, f1 = (i + 1) / n;
          if (alongU) chunk(u0 + (u1 - u0) * f0, v0, u0 + (u1 - u0) * f1, v1, h, R() < 0.3);
          else chunk(u0, v0 + (v1 - v0) * f0, u1, v0 + (v1 - v0) * f1, h, R() < 0.3);
        }
      };
      castShadow(pen, 0.1, 0.1, 0.9, 0.9, 0.2, 40);
      // pył i okruchy na ziemi dookoła
      pen.flat(0.04, 0.04, 0.96, 0.96, 0, (x, y, u, v) => (hash2(x, y, seed + 9) < 0.16 - Math.hypot(u - 0.5, v - 0.5) * 0.2 ? (hash2(x, y, 2) < 0.5 ? core[3] : r[2]) : -1));
      if (conn & 1) arm(0, t0, t0, t1, true);
      if (conn & 4) arm(t0, 0, t1, t0, true);
      chunk(t0, t0, t1, t1, 9 + Math.floor(R() * 10), true);
      if (conn & 2) arm(t1, t0, 1, t1, false);
      if (conn & 8) arm(t0, t1, t1, 1, false);
      // gruz: odłamane bloki (część w kolorze przełamu) rozrzucone przed murem
      const bits: [number, number, number][] = [];
      for (let i = 0; i < 9; i++) bits.push([0.06 + R() * 0.84, 0.06 + R() * 0.84, R()]);
      bits.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
      for (const [u, v, q] of bits) {
        if (u > t0 - 0.08 && u < t1 && v > t0 - 0.08 && v < t1) continue;
        const sz = 0.06 + q * 0.09;
        pen.shadedBox(u, v, u + sz, v + sz * (0.7 + q * 0.6), 0, 1 + Math.round(q * 2.4), q > 0.55 ? core : r, undefined, false);
      }
      return;
    }
    castShadow(pen, 0, 0, 1, 1, 0.3, 50);
    // kolejność malarza: ramiona z tyłu, środek, ramiona z przodu
    const arm = (u0: number, v0: number, u1: number, v1: number) => {
      pen.shadedBox(u0, v0, u1, v1, 0, hFull, r, tex, false);
      // jasna krawędź tylko wzdłuż ściany (bez pionowych szwów między segmentami)
      if (v1 - v0 < u1 - u0) pen.pc.line(...pen.p(u0, v1, hFull), ...pen.p(u1, v1, hFull), r[5]);
      else pen.pc.line(...pen.p(u1, v0, hFull), ...pen.p(u1, v1, hFull), r[4]);
    };
    if (conn & 1) arm(0, t0, t0, t1);
    if (conn & 4) arm(t0, 0, t1, t0);
    pen.shadedBox(t0, t0, t1, t1, 0, hFull, r, tex, conn === 0);
    if (conn) pen.flat(t0, t0, t1, t1, hFull, (x, y) => pick(r, 0.8 + (hash2(x, y, seed) - 0.5) * 0.1, x, y));
    if (conn & 2) arm(t1, t0, 1, t1);
    if (conn & 8) arm(t0, t1, t1, 1);
  });
}

// ------------------------------------------------------------------ rekwizyty

type AxisBox = (a0: number, a1: number, b0: number, b1: number, z0: number, z1: number, r: readonly RGB[], tex?: (face: 0 | 1 | 2, x: number, y: number, s: number, z: number) => number) => void;
const axisBox = (pen: IsoPen, alongU: boolean): AxisBox => (a0, a1, b0, b1, z0, z1, r, tex) =>
  alongU ? pen.shadedBox(a0, b0, a1, b1, z0, z1, r, tex) : pen.shadedBox(b0, a0, b1, a1, z0, z1, r, tex);

const line3 = (pen: IsoPen, u0: number, v0: number, z0: number, u1: number, v1: number, z1: number, c: RGB | ((x: number, y: number, t: number) => RGB)): void =>
  pen.pc.line(...pen.p(u0, v0, z0), ...pen.p(u1, v1, z1), c);

/** Gruba belka 3D: ciemna + jasna krawędź. */
function beam(pen: IsoPen, u0: number, v0: number, z0: number, u1: number, v1: number, z1: number, r: readonly RGB[]): void {
  line3(pen, u0, v0, z0, u1, v1, z1, r[1]);
  const [x0, y0] = pen.p(u0, v0, z0), [x1, y1] = pen.p(u1, v1, z1);
  pen.pc.line(x0, y0 - 1, x1, y1 - 1, r[3]);
}

export function paintProp(type: PropType, rot: number, seed: number, biome: Biome): { pc: PixelCanvas; ax: number; ay: number } {
  const R = rng(seed * 31 + 7);
  const alongU = rot % 2 === 0;
  return propCanvas((pen) => {
    const box = axisBox(pen, alongU);
    switch (type) {
      case 'car': {
        // wrak samochodu po latach w pustkowiu: wyblakły lakier pod kurzem i rdzą, martwe (wybite) światła,
        // wybite szyby, przebite / zdjęte koła (puste nadkola), brakujące drzwi i maska, wgnieciony dach,
        // przestrzeliny, plama oleju i części rozwleczone obok; warianty: spalony, przód albo tył do widza
        const burnt = R() < 0.3;
        const paint = CAR_COLS[(R() * CAR_COLS.length) | 0];
        const dust = biome === 'wastes' ? 0xb49a6c : 0x8a8274;
        const body = burnt ? ramp(0x3a2a20, 6, 0.3) : ramp(mix(mix(paint, 0x6a6458, 0.3), dust, 0.1), 6, 0.45);
        const frontNear = R() < 0.55; // widoczny koniec (+oś) to przód
        const hood: 'shut' | 'open' | 'gone' = burnt ? 'gone' : frontNear ? (R() < 0.3 ? 'open' : R() < 0.5 ? 'gone' : 'shut') : 'shut';
        // koła (bliższa strona): całe, flak, goła felga, brak (puste nadkole)
        type Wheel = 'tire' | 'flat' | 'rim' | 'none';
        const wheel = (): Wheel => { const q = R(); return burnt ? (q < 0.5 ? 'rim' : 'none') : q < 0.2 ? 'tire' : q < 0.55 ? 'flat' : q < 0.8 ? 'rim' : 'none'; };
        const W: Wheel[] = [wheel(), wheel()];
        const doorGone = !burnt && R() < 0.35; // przednie drzwi od strony widza
        const roofCaved = R() < 0.35;
        const shot = R() < 0.4; // podziurawiony kulami
        const A0 = 0.03, A1 = 0.97, B0 = 0.27, B1 = 0.73;
        const LEN = (A1 - A0) * 16, WID = (B1 - B0) * 16;
        const glassR = ramp(0x3a4c5c, 5, 0.5);
        const at = (a: number, b: number): [number, number] => (alongU ? [a, b] : [b, a]);
        /** `bias` > 0 = więcej rdzy (dół nadwozia), < 0 = mniej (dach). */
        const rusty = (x: number, y: number, bias = 0): boolean => vnoise(x / 1.7, y / 1.7, seed) > (burnt ? 0.58 : 0.68) - bias;
        const rust = burnt ? ramp(0x5a3424, 5, 0.35) : RUST;
        const soot = (x: number, y: number): boolean => vnoise(x / 3, y / 3, seed + 21) > 0.6;
        const holeAt = (x: number, y: number): RGB => {
          if (!shot) return -1;
          const h = hash2(x, y, seed + 11);
          return h < 0.035 ? 0x0a0806 : h < 0.05 ? 0x9a948a : -1;
        };
        const paintAt = (x: number, y: number, lit: number, bias = 0): RGB => {
          if (burnt && soot(x, y)) return pick(ramp(0x1c1612, 4, 0.3), lit, x, y);
          if (rusty(x, y, bias)) return pick(rust, lit * 0.8 + (hash2(x, y, seed) - 0.5) * 0.3, x, y);
          const dent = vnoise(x / 3, y / 3, seed + 5) > 0.74 ? -0.12 : 0; // wgniecenia
          return pick(body, lit + dent + (hash2(x, y, seed) - 0.5) * 0.14, x, y);
        };
        /** Górne płaszczyzny: kurz / piasek nawiany na lakier. */
        const dusty = (x: number, y: number, lit: number, bias = 0): RGB =>
          !burnt && vnoise(x / 2.4, y / 2.4, seed + 9) > 0.7 ? pick(ramp(dust, 5, 0.35), lit - 0.1, x, y) : paintAt(x, y, lit, bias);
        // bryła z własnymi wypełnieniami: side(t, z) - długi bok (t = 0 tył .. 1 widoczny koniec), end(q, z) - widoczny koniec (q = 0..1 w poprzek)
        const carBox = (
          a0: number, a1: number, b0: number, b1: number, z0: number, z1: number,
          side: (x: number, y: number, t: number, z: number) => RGB, end: (x: number, y: number, q: number, z: number) => RGB, top: (x: number, y: number, t: number) => RGB,
        ): void => {
          const len = (a1 - a0) * 16, wid = (b1 - b0) * 16;
          if (alongU)
            pen.box(a0, b0, a1, b1, z0, z1, {
              left: (x, y, sx, z) => side(x, y, sx / len, z),
              right: (x, y, sx, z) => end(x, y, sx / wid, z),
              top: (x, y, u) => top(x, y, (u - a0) / (a1 - a0)),
            });
          else
            pen.box(b0, a0, b1, a1, z0, z1, {
              right: (x, y, sx, z) => side(x, y, 1 - sx / len, z),
              left: (x, y, sx, z) => end(x, y, sx / wid, z),
              top: (x, y, _u, v) => top(x, y, (v - a0) / (a1 - a0)),
            });
        };
        const SIDE = alongU ? 0.56 : 0.3, END = alongU ? 0.3 : 0.56; // światło z lewej-góry
        // plama oleju / sadzy pod wrakiem
        pen.flat(...at(A0 + 0.1, B0 - 0.04), ...at(A1 - 0.05, B1 + 0.12), 0,
          (x, y, u, v) => { const [a, b] = alongU ? [u, v] : [v, u]; const d = Math.hypot((a - 0.55) * 1.4, (b - 0.55) * 2.2); return d < 0.5 && vnoise(x / 2, y / 2, seed + 3) > 0.35 + d * 0.5 ? (burnt ? 0x141010 : 0x161418) : -1; }, 150);
        alongU ? castShadow(pen, A0, B0, A1, B1 + 0.04, 0.3, 80) : castShadow(pen, B0, A0, B1 + 0.04, A1, 0.3, 80);
        const AX = [0.2, 0.8];
        const tire = ramp(0x1c1814, 4, 0.25), rim = ramp(0x6a625a, 4, 0.4);
        // dalsze koła (w cieniu pod nadwoziem)
        AX.forEach((t, i) => {
          if (W[i] === 'none') return;
          const a = A0 + (A1 - A0) * t - 0.09;
          box(a, a + 0.18, B0 - 0.01, B0 + 0.06, 0, W[i] === 'tire' ? 4 : 3, W[i] === 'rim' ? rim : tire);
        });
        // nadwozie osiada tam, gdzie brakuje kół
        const sag = W.every((w) => w === 'none') ? 0 : W.some((w) => w === 'none' || w === 'rim') ? 1 : W.some((w) => w === 'flat') ? 1 : 2;
        const ZT = 7;
        const doorT = (t: number): boolean => doorGone && t > (frontNear ? 0.38 : 0.37) && t < (frontNear ? 0.63 : 0.62);
        carBox(A0, A1, B0, B1, sag, ZT,
          (x, y, t, z) => {
            for (let i = 0; i < 2; i++) {
              const d = Math.abs(t - AX[i]) * LEN;
              if (d < 2.4 && z < 5.2 - d * d * 0.45) {
                const w = W[i];
                if (w === 'none') return z < 1.2 + sag ? -1 : 0x0a0807; // puste nadkole
                if (w === 'rim') return z < 4 && d < 1.6 ? pick(rim, 0.3 + (d < 0.7 ? 0.3 : 0), x, y) : 0x0c0908;
                if (w === 'flat') return z < 3.2 ? (d < 0.8 && z > 1.2 ? 0x5a5650 : 0x100c0a) : 0x0c0908;
                return z < 4 ? (d < 1 && z > 1.5 && z < 3.6 ? 0x6a6660 : 0x100c0a) : 0x0c0908;
              }
            }
            if (doorT(t) && z >= 2.5) return z > 5.5 ? 0x2a2420 : 0x14100e; // wnętrze bez drzwi
            const hole = holeAt(x, y);
            if (hole >= 0 && z > 3) return hole;
            if (z < 3) return pick(burnt ? DARK_METAL : rust, 0.25, x, y); // przegniły próg
            if (z >= 6) return paintAt(x, y, SIDE + 0.22, -0.05); // linia boczna
            if (Math.abs(t - 0.38) * LEN < 0.5 || Math.abs(t - 0.63) * LEN < 0.5) return pick(body, SIDE - 0.3, x, y); // szczeliny drzwi
            return paintAt(x, y, SIDE, z < 4.5 ? 0.14 : 0.04);
          },
          (x, y, q, z) => {
            const edge = Math.min(q, 1 - q) * WID;
            if (z < 3.6) {
              if (!burnt && frontNear && q > 0.62 && z < 2.4) return -1; // urwany kawałek zderzaka
              return pick(burnt ? DARK_METAL : RUST, burnt ? 0.2 : 0.45 - Math.abs(q - 0.5) * 0.3, x, y); // zardzewiały zderzak
            }
            if (z < 6 && edge < 2.2 && edge > 0.4) // martwe światła: puste oprawy, resztki szkła
              return burnt ? 0x1a1410 : frontNear ? (hash2(x, y, seed + 7) < 0.25 ? 0x8a8a7a : 0x161412) : hash2(x, y, seed + 7) < 0.4 ? 0x5a2018 : 0x1a1210;
            if (frontNear && z < 6 && edge >= 2.2) return ((x + y) & 1) ? 0x14100e : (hood === 'gone' ? 0x3a2a20 : 0x2a2622); // atrapa
            if (!frontNear && z < 5 && Math.abs(q - 0.5) * WID < 1.4) return burnt ? 0x2a2018 : 0x8a8270; // wyblakła tablica
            return paintAt(x, y, END, z < 4.5 ? 0.14 : 0.04);
          },
          (x, y, t) => {
            if (hood !== 'shut' && t > 0.74) { // komora silnika: blok, przewody, rdza
              const h = hash2(x, y, seed + 2);
              return h < 0.3 ? 0x0e0c0a : h < 0.55 ? pick(RUST, 0.3 + h, x, y) : pick(DARK_METAL, 0.3 + h * 0.4, x, y);
            }
            return dusty(x, y, 0.78 + (t > 0.97 || t < 0.03 ? 0.12 : 0), -0.06);
          });
        // kabina: słupki, szyby (prawie zawsze wybite), dach (czasem wgnieciony)
        const C0 = frontNear ? 0.22 : 0.3, C1 = frontNear ? 0.66 : 0.74;
        const ca0 = A0 + (A1 - A0) * C0, ca1 = A0 + (A1 - A0) * C1, cLen = (ca1 - ca0) * 16;
        const ROOF = roofCaved ? 10.5 : 12, rz = ROOF - 1.2;
        const glassAt = (x: number, y: number, z: number, lit: number, broken: boolean): RGB => {
          if (burnt) return hash2(x, y, seed + 3) < 0.2 ? 0x2a2018 : 0x0a0808;
          if (broken) return hash2(x, y, seed + 3) < 0.22 ? glassR[4] : 0x0e0c10; // odłamki w ramie
          // brudna, popękana szyba
          if (hash2(x, y, seed + 4) < 0.18) return pick(ramp(dust, 4, 0.3), 0.4, x, y);
          return (x + y * 2 + seed) % 5 === 0 ? glassR[3] : pick(glassR, lit - 0.15 + (z - 9) * 0.08, x, y);
        };
        const sideBroken = [R() < 0.8, R() < 0.65];
        const frontBroken = burnt || R() < 0.75;
        carBox(ca0, ca1, B0 + 0.02, B1 - 0.02, ZT, ROOF,
          (x, y, t, z) => {
            const sx = t * cLen;
            const tg = C0 + t * (C1 - C0);
            if (z > rz || sx < 0.9 || sx > cLen - 0.9 || Math.abs(sx - cLen / 2) < 0.55) { // dach / słupki A-B-C
              if (doorT(tg) && z <= rz) return 0x14100e;
              return paintAt(x, y, SIDE + (z > rz ? 0.2 : -0.05));
            }
            if (doorT(tg)) return z > 9 ? 0x2a2420 : 0x14100e; // wnętrze: oparcie fotela
            return glassAt(x, y, z, 0.45, sideBroken[sx < cLen / 2 ? 0 : 1]);
          },
          (x, y, q, z) => {
            const e = Math.min(q, 1 - q) * (WID - 0.64);
            if (z > rz || e < 0.8) return paintAt(x, y, END + (z > rz ? 0.15 : 0));
            return glassAt(x, y, z, 0.3, frontBroken);
          },
          (x, y, t) => {
            if (roofCaved && t > 0.25 && t < 0.8 && vnoise(x / 2, y / 2, seed + 13) > 0.5) return pick(body, 0.4, x, y); // wgniecenie
            return dusty(x, y, 0.74 + (t < 0.12 ? 0.14 : 0), -0.06);
          });
        if (hood === 'open') {
          // uniesiona maska oparta o podszybie
          const h0 = A0 + (A1 - A0) * (C1 + 0.02), h1 = h0 + 0.05;
          carBox(h0, h1, B0 + 0.02, B1 - 0.02, ZT, ROOF, (x, y) => paintAt(x, y, SIDE), (x, y) => pick(body, END - 0.1 + (hash2(x, y, 4) - 0.5) * 0.1, x, y), (x, y) => paintAt(x, y, 0.85));
        }
        // jasna krawędź dachu od strony światła (przerwana rdzą)
        const hi = body[5];
        const [ex0, ey0] = alongU ? pen.p(ca0, B1 - 0.02, ROOF) : pen.p(B1 - 0.02, ca0, ROOF);
        const [ex1, ey1] = alongU ? pen.p(ca1, B1 - 0.02, ROOF) : pen.p(B1 - 0.02, ca1, ROOF);
        pen.pc.line(ex0, ey0, ex1, ey1, (x, y) => (rusty(x, y) || burnt ? rust[2] : hi));
        // bliższe koła (wystają przed bok)
        AX.forEach((t, i) => {
          const a = A0 + (A1 - A0) * t - 0.09;
          if (W[i] === 'tire') box(a, a + 0.18, B1 - 0.05, B1 + 0.03, 0, 5, tire);
          else if (W[i] === 'flat') box(a - 0.02, a + 0.2, B1 - 0.05, B1 + 0.03, 0, 3, tire);
          else if (W[i] === 'rim') box(a + 0.03, a + 0.15, B1 - 0.05, B1 + 0.02, 0, 3, rim);
          else if (!burnt && R() < 0.6) box(a + 0.04, a + 0.14, B1 - 0.08, B1 - 0.01, 0, 2, CONCRETE); // pustak zamiast koła
        });
        // części rozwleczone obok wraku (po stronie widza)
        const parts: (() => void)[] = [];
        if (W.some((w) => w === 'none' || w === 'rim') && R() < 0.7) {
          const a = 0.15 + R() * 0.6, b = 0.86 + R() * 0.04;
          parts.push(() => { // zdjęta opona leżąca płasko: czarny krążek z dziurą
            pen.flat(...at(a, b), ...at(a + 0.16, b + 0.1), 0, (x, y, u, v) => { const [p, q] = alongU ? [u, v] : [v, u]; const d = Math.hypot((p - a - 0.08) / 0.08, (q - b - 0.05) / 0.05); return d > 1 ? -1 : d < 0.4 ? -1 : d < 0.6 ? 0x4a4640 : pick(tire, 0.3 + (1 - d) * 0.4, x, y); });
          });
        }
        if (doorGone) {
          const a = 0.2 + R() * 0.45;
          parts.push(() => box(a, a + 0.26, 0.82, 0.93, 0, 1, body)); // odpadnięte drzwi
        }
        if (hood === 'gone' && !burnt && R() < 0.6) {
          const a = 0.5 + R() * 0.25;
          parts.push(() => box(a, a + 0.24, 0.8, 0.94, 0, 1, RUST));
        }
        parts.forEach((f) => f());
        if (biome === 'wastes') {
          // nawiany piasek przy kołach
          const sand = ramp(0xc4a064, 5, 0.4);
          for (let i = 0; i < 2; i++) { const t = 0.1 + R() * 0.7, a = A0 + (A1 - A0) * t; box(a, a + 0.2, B1 + 0.01, B1 + 0.1, 0, 1 + Math.round(R()), sand); }
        }
        break;
      }
      case 'bus': {
        const body = ramp(R() < 0.6 ? 0xb8902a : 0x6a7a5a, 6, 0.48);
        alongU ? castShadow(pen, 0, 0.18, 1, 0.84, 0.5) : castShadow(pen, 0.18, 0, 0.84, 1, 0.5);
        box(0.0, 1.0, 0.18, 0.82, 2, 12, body, (_f, x, y) => (vnoise(x / 4, y / 4, seed) > 0.68 ? -0.4 : 0));
        box(0.0, 1.0, 0.18, 0.82, 12, 21, body, (f, _x, _y, s, z) => (f > 0 && z > 13 && z < 19 && Math.floor(s) % 5 !== 0 ? -2.2 : 0));
        box(0.02, 0.98, 0.2, 0.8, 21, 23, RUST);
        break;
      }
      case 'barrel':
      case 'barrel_toxic': {
        const toxic = type === 'barrel_toxic';
        const col = toxic ? 0xc8a020 : [0x8a4a28, 0x3a5a7a, 0x5a6a3a][(R() * 3) | 0];
        castShadow(pen, 0.3, 0.3, 0.7, 0.7, 0.2);
        pen.cylinder(0.5, 0.5, 0.2, 0, 14, ramp(col, 6, 0.5), (z) => (Math.abs(z - 4) < 1 || Math.abs(z - 10) < 1 ? -0.22 : toxic && z > 5 && z < 9 ? -0.6 : 0));
        const [cx, cy] = pen.p(0.5, 0.5, 14);
        if (toxic) {
          pen.pc.set(cx - 2, cy, 0x8fe04a);
          pen.pc.set(cx - 1, cy, 0xd8ff8a);
          pen.pc.set(cx - 2, cy + 1, 0x4fae2a);
          for (let i = 0; i < 4; i++) pen.pc.set(cx - 3, cy + 2 + i, i < 3 ? 0x6ad030 : 0x2a7a18);
        } else {
          pen.pc.set(cx + 2, cy - 1, 0x1a1410);
          pen.pc.set(cx + 3, cy - 1, 0x2a2018);
        }
        break;
      }
      case 'crate': {
        castShadow(pen, 0.18, 0.18, 0.82, 0.82, 0.25);
        const z1 = 11;
        pen.shadedBox(0.18, 0.18, 0.82, 0.82, 0, z1, WOOD, (f, x, y, s, z) => {
          if (f === 0) return (Math.floor((pen.uv(x, y, z1)[0]) * 14) % 3 === 0 ? -0.6 : 0) + (hash2(x, y, seed) - 0.5) * 0.4;
          if (s < 1.5 || s > 9.5 || Math.floor(z) % 4 === 0) return -0.8;
          return (hash2(x, y, seed) - 0.5) * 0.4;
        });
        break;
      }
      case 'debris':
      case 'scrap_pile': {
        const scrap = type === 'scrap_pile';
        const n = scrap ? 16 : 9;
        const items: [number, number, number, number][] = [];
        for (let i = 0; i < n; i++) {
          const a = R() * Math.PI * 2, d = R() * 0.32;
          items.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, R(), 1 - d / 0.32]);
        }
        items.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
        castShadow(pen, 0.15, 0.15, 0.85, 0.85, 0.2, 55);
        const pal = scrap ? [RUST, METAL, ramp(0x6a3a20), ramp(0x7a828a), ramp(CAR_COLS[seed % CAR_COLS.length])] : [CONCRETE, ramp(0x6a655c), ramp(0x8a4a38)];
        for (const [u, v, q, center] of items) {
          const s = 0.07 + q * 0.12;
          const z0 = scrap ? center * 6 : 0;
          pen.shadedBox(u - s / 2, v - s / 2, u + s / 2, v + s * 0.4, z0, z0 + 2 + q * 4, pal[(q * pal.length) | 0]);
        }
        for (let i = 0; i < 3; i++) {
          const u = 0.3 + R() * 0.4, v = 0.3 + R() * 0.4;
          line3(pen, u, v, 2, u + (R() - 0.5) * 0.3, v + (R() - 0.5) * 0.3, 8 + R() * 8, 0x7a3a20);
        }
        if (scrap) pen.pc.ellipse(...pen.p(0.62, 0.32, 3), 4, 2, (x, y, dx, dy) => (dx * dx + dy * dy < 0.25 ? -1 : (x + y) & 1 ? 0x18130f : 0x2a2420));
        break;
      }
      case 'sandbags': {
        castShadow(pen, 0.05, 0.3, 0.95, 0.75, 0.2);
        const bag = ramp(0x9a8a62, 6, 0.42);
        const rounded = (_f: 0 | 1 | 2, x: number, y: number) => (hash2(x, y, seed) - 0.5) * 0.4;
        for (let i = 0; i < 3; i++) box(0.04 + i * 0.31, 0.32 + i * 0.31, 0.32, 0.68, 0, 5, bag, rounded);
        for (let i = 0; i < 2; i++) box(0.19 + i * 0.31, 0.47 + i * 0.31, 0.34, 0.66, 5, 9, bag, rounded);
        break;
      }
      case 'container': {
        const col = [0x8a3a2a, 0x2a4a6a, 0x3a5a3a, 0x9a7a3a][(R() * 4) | 0];
        castShadow(pen, 0.02, 0.02, 0.98, 0.98, 0.5, 60);
        pen.shadedBox(0.02, 0.02, 0.98, 0.98, 0, 24, ramp(col, 6, 0.48), (f, x, y, s, z) => {
          if (f === 0) return (vnoise(x / 4, y / 4, seed) > 0.66 ? -0.5 : 0) + (hash2(x, y, seed) - 0.5) * 0.3;
          let n = Math.floor(s / 2) % 2 ? 0.35 : -0.15;
          if (z < 2 || z > 22) n = -0.3;
          if (vnoise(s / 3, z / 3, seed + f) > 0.72) n -= 0.6;
          return n + (hash2(x, y, seed) - 0.5) * 0.2;
        });
        break;
      }
      case 'fence': {
        const mesh = 0x8a929a;
        for (const a of [0.04, 0.5, 0.96]) box(a - 0.03, a + 0.03, 0.47, 0.53, 0, 19, METAL);
        const [x0, y0] = alongU ? pen.p(0, 0.5, 0) : pen.p(0.5, 0, 0);
        const [x1, y1] = alongU ? pen.p(1, 0.5, 0) : pen.p(0.5, 1, 0);
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
          const t = (x - x0) / (x1 - x0);
          const yb = y0 + (y1 - y0) * t;
          for (let z = 1; z < 17; z++) {
            const y = Math.round(yb - z);
            if ((x + z) % 3 === 0 || (x - z + 300) % 3 === 0) pen.pc.set(x, y, mix(mesh, 0x3a4048, hash2(x, z, seed) * 0.5), 200);
          }
          if (x % 2 === 0) pen.pc.set(x, Math.round(yb - 18 - (x % 4 === 0 ? 1 : 0)), 0x5a6068);
        }
        break;
      }
      case 'generator': {
        castShadow(pen, 0.14, 0.14, 0.86, 0.86, 0.3);
        pen.shadedBox(0.14, 0.18, 0.86, 0.82, 0, 13, ramp(0x4a6a4a, 6, 0.46), (f, x, y, s, z) => {
          if (f === 2 && z > 3 && z < 11 && Math.floor(s) % 2 === 0) return -1;
          if (f === 1 && z > 6 && z < 10 && s > 3 && s < 8) return -0.8;
          return (hash2(x, y, seed) - 0.5) * 0.3 + (vnoise(x / 3, y / 3, seed) > 0.72 ? -0.5 : 0);
        });
        pen.cylinder(0.3, 0.45, 0.06, 13, 22, RUST);
        const [lx, ly] = pen.p(0.4, 0.82, 8);
        pen.pc.set(lx, ly, 0x8fe04a);
        pen.pc.set(lx + 2, ly + 1, 0xe04030);
        break;
      }
      case 'pillar': {
        castShadow(pen, 0.3, 0.3, 0.7, 0.7, 0.7, 60);
        pen.shadedBox(0.3, 0.3, 0.7, 0.7, 0, 30, CONCRETE, (_f, x, y, _s, z) => (hash2(x, y, seed) - 0.5) * 0.4 + (z < 3 ? -0.5 : 0) + (vnoise(x / 3, y / 2, seed) > 0.74 ? -0.6 : 0));
        pen.shadedBox(0.36, 0.36, 0.58, 0.6, 30, 33, CONCRETE);
        for (let i = 0; i < 3; i++) line3(pen, 0.4 + i * 0.1, 0.45, 30, 0.35 + i * 0.15 + (R() - 0.5) * 0.2, 0.45 + (R() - 0.5) * 0.3, 38 + R() * 6, 0x7a3a20);
        break;
      }
      case 'terminal': {
        castShadow(pen, 0.2, 0.25, 0.8, 0.75, 0.25);
        pen.shadedBox(0.22, 0.25, 0.78, 0.75, 0, 10, DARK_METAL);
        pen.shadedBox(0.26, 0.32, 0.74, 0.62, 10, 22, METAL);
        // świecący ekran na ścianie +v
        pen.box(0.3, 0.3, 0.7, 0.62, 13, 20, {
          left: (_x, _y, s, z) => {
            if (Math.floor(z) % 2 === 0) return 0x1e7a64;
            return hash2(Math.floor(s / 2), Math.floor(z), seed) < 0.55 ? 0x46f2c8 : 0x2ab090;
          },
        });
        break;
      }
      case 'tent': {
        const cloth = ramp(R() < 0.5 ? 0x6a5a3a : 0x4a5a3a, 6, 0.44);
        castShadow(pen, 0.05, 0.05, 0.95, 0.95, 0.35);
        const P = (a: number, b: number, z: number) => (alongU ? pen.p(a, b, z) : pen.p(b, a, z));
        const tex = (lv: number): Fill => (x, y) => pick(cloth, lv + (hash2(x, y, seed) - 0.5) * 0.14 + (vnoise(x / 4, y / 4, seed) - 0.5) * 0.18, x, y);
        pen.pc.poly([P(0.05, 0.1, 0), P(0.95, 0.1, 0), P(0.95, 0.5, 17), P(0.05, 0.5, 17)], tex(alongU ? 0.75 : 0.85));
        pen.pc.poly([P(0.05, 0.5, 17), P(0.95, 0.5, 17), P(0.95, 0.9, 0), P(0.05, 0.9, 0)], tex(alongU ? 0.55 : 0.28));
        pen.pc.poly([P(0.95, 0.1, 0), P(0.95, 0.5, 17), P(0.95, 0.9, 0)], tex(alongU ? 0.28 : 0.55));
        // wejście
        pen.pc.poly([P(0.95, 0.36, 0), P(0.95, 0.5, 11), P(0.95, 0.64, 0)], 0x140e0a);
        pen.pc.line(...P(0.05, 0.5, 17), ...P(0.95, 0.5, 17), cloth[5]);
        break;
      }
      case 'tank_trap': {
        castShadow(pen, 0.2, 0.2, 0.8, 0.8, 0.25, 50);
        beam(pen, 0.2, 0.25, 0, 0.8, 0.75, 13, DARK_METAL);
        beam(pen, 0.8, 0.2, 0, 0.2, 0.8, 13, DARK_METAL);
        beam(pen, 0.5, 0.15, 13, 0.5, 0.85, 0, DARK_METAL);
        break;
      }
      case 'lamp': {
        line3(pen, 0.5, 0.5, 0, 0.5, 0.5, 40, METAL[1]);
        const [x, y] = pen.p(0.5, 0.5, 0);
        pen.pc.line(x + 1, y, x + 1, y - 40, METAL[3]);
        line3(pen, 0.5, 0.5, 40, 0.85, 0.5, 40, METAL[2]);
        pen.shadedBox(0.78, 0.44, 0.95, 0.56, 37, 40, DARK_METAL);
        const [bx, by] = pen.p(0.86, 0.5, 37);
        pen.pc.set(bx, by, 0xffe8b0);
        pen.pc.set(bx + 1, by, 0xffc260);
        pen.shadedBox(0.42, 0.42, 0.58, 0.58, 0, 3, CONCRETE);
        break;
      }
      case 'sign': {
        line3(pen, 0.5, 0.5, 0, 0.5, 0.5, 20, METAL[1]);
        const plate = ramp(0xd8b020, 5, 0.4);
        box(0.28, 0.72, 0.48, 0.52, 16, 28, plate, (f, x, y, s, z) => {
          if (f === 0) return -1;
          if (s < 1 || z < 1 || z > 11) return -2.5; // ramka
          if (Math.abs(s - 7) < 1 && z > 4 && z < 10) return -4; // wykrzyknik
          if (Math.abs(s - 7) < 1 && z > 1.5 && z < 3) return -4;
          return vnoise(x / 2, y / 2, seed) > 0.75 ? -1.4 : 0;
        });
        break;
      }
      case 'antenna': {
        const top = 54;
        const lat = METAL;
        const corners: [number, number][] = [[0.36, 0.36], [0.64, 0.36], [0.64, 0.64], [0.36, 0.64]];
        for (const [u, v] of corners) line3(pen, u, v, 0, 0.5 + (u - 0.5) * 0.2, 0.5 + (v - 0.5) * 0.2, top, u + v > 1 ? lat[3] : lat[1]);
        for (let z = 0; z < top - 6; z += 7) {
          const k0 = 1 - z / top * 0.8, k1 = 1 - (z + 7) / top * 0.8;
          line3(pen, 0.5 - 0.14 * k0, 0.5 + 0.14 * k0, z, 0.5 + 0.14 * k1, 0.5 + 0.14 * k1, z + 7, lat[2]);
        }
        line3(pen, 0.5, 0.5, top, 0.5, 0.5, top + 8, lat[3]);
        pen.shadedBox(0.38, 0.38, 0.62, 0.62, 0, 3, CONCRETE);
        break;
      }
      case 'tree_dead': {
        const bark = ramp(0x4a3424, 5, 0.3);
        const branch = (u: number, v: number, z: number, ang: number, len: number, depth: number): void => {
          const u1 = u + Math.cos(ang) * len * 0.04, v1 = v + Math.sin(ang) * len * 0.04, z1 = z + len * (0.55 + R() * 0.3);
          line3(pen, u, v, z, u1, v1, z1, depth > 2 ? bark[2] : bark[1]);
          if (depth === 0) return;
          for (let i = 0; i < 2; i++) branch(u1, v1, z1, ang + (R() - 0.5) * 2.4, len * 0.62, depth - 1);
        };
        castShadow(pen, 0.4, 0.4, 0.6, 0.6, 0.5, 45);
        const [x, y] = pen.p(0.5, 0.5, 0);
        pen.pc.rect(x - 1, y - 16, 3, 16, (xx, yy) => pick(bark, xx === x - 1 ? 0.7 : 0.3 + hash2(xx, yy, 2) * 0.2, xx, yy));
        branch(0.5, 0.5, 14, R() * 6, 14, 3);
        branch(0.5, 0.5, 10, R() * 6, 10, 2);
        break;
      }
      case 'skeleton': {
        const [x, y] = pen.p(0.5, 0.5, 0);
        const b = (dx: number, dy: number) => pen.pc.set(x + dx, y + dy, BONE);
        pen.pc.rect(x - 6, y - 3, 3, 2, BONE);
        pen.pc.set(x - 5, y - 2, 0x2a2018);
        for (let i = 0; i < 4; i++) { b(-2 + i * 2, 0); b(-2 + i * 2, 1); b(-1 + i * 2, -1); }
        for (let i = 0; i < 5; i++) b(-2 + i * 2, 2 + (i & 1));
        for (let i = 0; i < 5; i++) b(5 + i, 1 + (i >> 1));
        for (let i = 0; i < 4; i++) b(3 - i, 4 + i);
        break;
      }
      case 'campfire': {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const u = 0.5 + Math.cos(a) * 0.22, v = 0.5 + Math.sin(a) * 0.22;
          pen.shadedBox(u - 0.05, v - 0.04, u + 0.05, v + 0.04, 0, 2, ramp(0x5a564f, 4, 0.4));
        }
        pen.pc.ellipse(...pen.p(0.5, 0.5, 0), 6, 3, (x, y) => (hash2(x, y, 4) < 0.3 ? 0x6a2a10 : 0x18100c));
        for (let i = 0; i < 3; i++) beam(pen, 0.35 + i * 0.1, 0.38, 1, 0.6 - i * 0.05, 0.64, 2, WOOD);
        break;
      }
      case 'door': {
        const r = METAL;
        box(0.0, 0.12, 0.34, 0.66, 0, 20, r);
        box(0.88, 1.0, 0.34, 0.66, 0, 20, r);
        box(0.0, 1.0, 0.36, 0.64, 18, 21, DARK_METAL);
        const [x, y] = alongU ? pen.p(0.5, 0.66, 20) : pen.p(0.66, 0.5, 20);
        pen.pc.set(x, y + 1, 0xe04030);
        break;
      }
      case 'flora_saguaro': case 'flora_pear': case 'flora_deadbush': case 'flora_shrooms': case 'flora_flower': case 'flora_reeds':
      case 'flora_grass': case 'flora_vine': case 'flora_pod': case 'flora_fern': case 'flora_crystal': {
        // roślinność (Oldgame/src/gfx/flora.js -> legacy/flora.ts): gotowe piksele z własnym obrysem, stoi na środku pola
        const f = floraPixels(type.slice(6), seed % 3) as { w: number; h: number; data: Uint8ClampedArray; bx: number; by: number };
        const [cx, cy] = pen.p(0.5, 0.5, 0);
        let minX = f.w, maxX = 0;
        for (let y = f.h - 6; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.data[(y * f.w + x) * 4 + 3] > 0) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
        const half = Math.max(2, Math.min(9, (maxX - minX) / 2 + 1));
        pen.pc.ellipse(cx + 1, cy, half + 1, Math.max(1, Math.round(half / 2.4)), (x, y) => (bayer(x, y) < 0.8 ? 0x0a0608 : -1), 70);
        const flip = (seed >> 2) & 1;
        for (let y = 0; y < f.h; y++)
          for (let x = 0; x < f.w; x++) {
            const i = (y * f.w + (flip ? f.w - 1 - x : x)) * 4;
            if (f.data[i + 3] > 0) pen.pc.set(cx - f.bx + x, cy - f.by + y + 1, (f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2]);
          }
        break;
      }
      case 'wall':
      case 'wall_broken':
        // ściany rysuje paintWall (łączenia z sąsiadami); tu tylko awaryjnie
        pen.shadedBox(0.3, 0.3, 0.7, 0.7, 0, 18, ramp(BIOME_STYLE[biome].wall));
        break;
    }
  }, type !== 'skeleton' && !type.startsWith('flora_'));
}

/** Skrzynia z łupem (wojskowa) - ważny element rozgrywki, więc kontrastowa. */
export function paintLootCrate(): { pc: PixelCanvas; ax: number; ay: number } {
  return propCanvas((pen) => {
    castShadow(pen, 0.2, 0.25, 0.8, 0.75, 0.3);
    const olive = ramp(0x4a5a3a, 6, 0.5);
    pen.shadedBox(0.2, 0.26, 0.8, 0.74, 0, 10, olive, (f, x, y, s, z) => {
      if (f === 0) return (hash2(x, y, 5) - 0.5) * 0.3;
      if (s < 1.2 || z < 1) return -0.8;
      if (f === 1 && z > 4 && z < 7 && s > 3 && s < 8) return 1.6; // żółty szablon
      return (hash2(x, y, 5) - 0.5) * 0.3;
    });
    pen.shadedBox(0.2, 0.26, 0.8, 0.74, 10, 12, ramp(0x3a4a2e, 5, 0.4));
    const [x, y] = pen.p(0.5, 0.74, 8);
    pen.pc.set(x, y, 0xd8b020);
    pen.pc.set(x + 1, y, 0xf0d060);
  });
}

/** Otwarta (splądrowana) skrzynia: uchylone wieko, ciemne wnętrze. */
export function paintLootCrateOpen(): { pc: PixelCanvas; ax: number; ay: number } {
  return propCanvas((pen) => {
    castShadow(pen, 0.2, 0.25, 0.8, 0.75, 0.3);
    const olive = ramp(0x3e4c32, 6, 0.5);
    pen.shadedBox(0.2, 0.26, 0.8, 0.74, 0, 9, olive, (f, x, y) => (f === 0 ? -0.9 : (hash2(x, y, 6) - 0.5) * 0.3));
    pen.shadedBox(0.24, 0.3, 0.76, 0.7, 8, 9, ramp(0x141810, 3, 0.2));
    // wieko oparte z tyłu
    pen.shadedBox(0.2, 0.18, 0.8, 0.26, 9, 17, ramp(0x34422a, 5, 0.4));
  });
}

/** Słupek strefy ewakuacji (zielony, z czarnym pasem i świecącą głowicą - rysowaną osobno). */
export function paintExtractPost(): { pc: PixelCanvas; ax: number; ay: number } {
  return propCanvas((pen) => {
    castShadow(pen, 0.44, 0.44, 0.56, 0.56, 0.2);
    pen.shadedBox(0.45, 0.45, 0.55, 0.55, 0, 18, ramp(0x3fae4a, 4, 0.4));
    pen.shadedBox(0.44, 0.44, 0.56, 0.56, 12, 14, ramp(0x161616, 3, 0.2));
  });
}

/** Cel misji: walizka z nadajnikiem. */
/** Gniazdo zmutowanej fauny: kopiec z mięsistej narośli, pulsujące jaja i macki (zlecenie oczyszczenia). */
export function paintNest(seed = 1): { pc: PixelCanvas; ax: number; ay: number } {
  const R = rng(seed * 53 + 11);
  return propCanvas((pen) => {
    castShadow(pen, 0.12, 0.14, 0.88, 0.86, 0.25, 55);
    // kopiec: kilka warstw coraz mniejszych elips (cieniowanie od lewej-góry)
    for (let k = 0; k < 4; k++) {
      const [x, y] = pen.p(0.5, 0.5, k * 3);
      const rx = 13 - k * 3, ry = 7 - k * 1.5;
      pen.pc.ellipse(x, y, rx, ry, (px, py, dx, dy) => {
        const l = -dx * 0.6 - dy * 0.8 + (hash2(px, py, 9 + k) - 0.5) * 0.5;
        return l > 0.45 ? 0x8a4a78 : l > 0 ? 0x5e2c56 : l > -0.5 ? 0x3e1a3c : 0x24101f;
      });
    }
    // jaja
    for (let i = 0; i < 6; i++) {
      const a = R() * Math.PI * 2, d = 0.12 + R() * 0.2;
      const [x, y] = pen.p(0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 2 + R() * 6);
      pen.pc.ellipse(x, y, 2, 2.5, (_x, _y, dx, dy) => (dx + dy < -0.6 ? 0xe8ffb0 : dx * dx + dy * dy > 0.7 ? 0x4a7a30 : 0x9ad860));
    }
    // macki
    for (let i = 0; i < 4; i++) {
      const u = 0.35 + R() * 0.3, v = 0.35 + R() * 0.3;
      line3(pen, u, v, 6, u + (R() - 0.5) * 0.5, v + (R() - 0.5) * 0.5, 12 + R() * 8, 0x6a2a5a);
    }
  });
}

export function paintObjective(): { pc: PixelCanvas; ax: number; ay: number } {
  return propCanvas((pen) => {
    castShadow(pen, 0.3, 0.32, 0.7, 0.68, 0.2);
    pen.shadedBox(0.3, 0.34, 0.7, 0.66, 0, 6, ramp(0x2a2e34, 5, 0.4));
    pen.shadedBox(0.3, 0.34, 0.7, 0.66, 6, 7, ramp(0x9aa4aa, 4, 0.3));
    line3(pen, 0.62, 0.4, 7, 0.66, 0.4, 20, 0x8a929a);
  });
}

/** Zapasy żywności (zlecenie zaopatrzenia): drewniana skrzynia z konserwami i worki z ziarnem; `v` = wariant ułożenia. */
export function paintSupplies(v = 0): { pc: PixelCanvas; ax: number; ay: number } {
  return propCanvas((pen) => {
    castShadow(pen, 0.2, 0.25, 0.82, 0.78, 0.2);
    const wood = ramp(0x7a5230, 5, 0.4), sack = ramp(0xc8b080, 5, 0.35), tin = ramp(0xb04030, 4, 0.35);
    // skrzynia
    pen.shadedBox(0.22, 0.28, 0.58, 0.6, 0, 7, wood);
    pen.shadedBox(0.22, 0.28, 0.58, 0.6, 7, 8, ramp(0x9a6c40, 4, 0.3));
    // puszki na wieku
    pen.shadedBox(0.3, 0.34, 0.38, 0.42, 8, 10, tin);
    pen.shadedBox(0.42, 0.36, 0.5, 0.44, 8, 10, ramp(0x40709a, 4, 0.35));
    // worki
    if (v !== 1) pen.shadedBox(0.6, 0.3, 0.8, 0.52, 0, 6, sack);
    if (v !== 2) pen.shadedBox(0.5, 0.6, 0.76, 0.8, 0, 5, sack);
    if (v === 2) pen.shadedBox(0.6, 0.32, 0.78, 0.5, 0, 9, ramp(0xa89060, 5, 0.35));
  });
}

// ------------------------------------------------------------------ kalkomanie (łamią siatkę)

export type DecalType = 'scorch' | 'oil' | 'stain' | 'sand' | 'blood' | 'moss';

export function paintDecal(type: DecalType, seed: number): PixelCanvas {
  const pc = new PixelCanvas(48, 24);
  const R = rng(seed);
  const cx = 24, cy = 12;
  const rx = 12 + R() * 8, ry = rx / 2;
  const blobs = Array.from({ length: 5 }, () => [cx + (R() - 0.5) * rx, cy + (R() - 0.5) * ry, 0.5 + R() * 0.5] as const);
  for (let y = 0; y < pc.h; y++)
    for (let x = 0; x < pc.w; x++) {
      let d = 1e9;
      for (const [bx, by, s] of blobs) d = Math.min(d, Math.hypot((x - bx) / (rx * 0.6 * s), (y - by) / (ry * 0.6 * s)));
      d += (vnoise(x / 3, y / 2, seed) - 0.5) * 0.5;
      if (d > 1) continue;
      const k = 1 - d;
      switch (type) {
        case 'scorch':
          if (bayer(x, y) < k * 1.6) pc.set(x, y, k > 0.5 ? 0x0c0a0a : 0x1e1814, 150 + k * 80);
          break;
        case 'oil':
          pc.set(x, y, d > 0.85 ? 0x2a2630 : k > 0.6 && hash2(x, y, seed) > 0.8 ? 0x4a5068 : 0x0e0c12, 200);
          break;
        case 'stain':
          if (bayer(x, y) < k * 1.4) pc.set(x, y, 0x2a2018, 90);
          break;
        case 'sand':
          if (bayer(x, y) < k * 1.8) pc.set(x, y, hash2(x, y, seed) > 0.5 ? 0xb89a64 : 0xa48a58, 210);
          break;
        case 'blood':
          if (d < 0.7 || hash2(x, y, seed) > 0.8) pc.set(x, y, k > 0.5 ? 0x4a0e0c : 0x6a1a14, 200);
          break;
        case 'moss':
          if (bayer(x, y) < k * 1.3) pc.set(x, y, hash2(x, y, seed) > 0.5 ? 0x4a5a2a : 0x3a4a22, 200);
          break;
      }
    }
  return pc;
}

// ------------------------------------------------------------------ efekty

/** Miękki cień pod postacią. */
export function paintBlobShadow(w = 16, h = 7): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  pc.ellipse(w / 2, h / 2, w / 2, h / 2, (x, y, dx, dy) => {
    const d = dx * dx + dy * dy;
    return d < 0.45 || bayer(x, y) > d ? 0x06040a : -1;
  }, 120);
  return pc;
}

/** Poświata do mieszania ADD: biała, kwantyzowana w pasma z ditheringiem (pixel-artowy gradient). */
export function paintGlow(w: number, h: number): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
      const k = clamp01(1 - Math.sqrt(dx * dx + dy * dy));
      if (k <= 0) continue;
      const lvl = k * k * 4;
      const i = Math.floor(lvl) + (lvl - Math.floor(lvl) > bayer(x, y) ? 1 : 0);
      if (i > 0) pc.set(x, y, 0xffffff, [0, 34, 62, 96, 140][Math.min(4, i)]);
    }
  return pc;
}

/** Kursor pola: narożne klamry rombu + kropkowany obrys. */
export function paintCursor(): PixelCanvas {
  const pc = new PixelCanvas(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++) {
    const [a, b] = diamondSpan(y);
    const corner = y < 3 || y > 12 || (y > 5 && y < 10);
    for (const x of [a, b]) if (corner || (x + y) % 3 === 0) pc.set(x, y, 0xffffff, corner ? 255 : 150);
    if (y < 3 || y > 12) for (let x = a; x <= b; x++) pc.set(x, y, 0xffffff, y === 0 || y === 15 ? 255 : 0);
  }
  forDiamond((x, y) => { if (pc.alpha(x, y) === 0 && bayer(x, y) < 0.18) pc.set(x, y, 0xffffff, 70); });
  return pc;
}

/** Kropka ścieżki: mały romb. */
export function paintPathDot(): PixelCanvas {
  const pc = new PixelCanvas(10, 6);
  const rows = [[4, 5], [2, 7], [1, 8], [2, 7], [4, 5]];
  rows.forEach(([a, b], y) => { for (let x = a; x <= b; x++) pc.set(x, y, y < 2 ? 0xffffff : 0xc8c8c8); });
  pc.outline(0, 0x0a0608, 1);
  return pc;
}

/** Płomień ogniska, 4 klatki 10x16. */
export function paintFlames(): { pc: PixelCanvas; frames: { name: string; x: number; y: number; w: number; h: number }[] } {
  const W = 10, H = 16, N = 4;
  const pc = new PixelCanvas(W * N, H);
  const fire = [0x8a1e10, 0xd8481a, 0xff9a2a, 0xffe070, 0xfffbe0];
  const frames = [];
  for (let f = 0; f < N; f++) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = 1 - y / H; // 0 u góry
        const wob = Math.sin(y * 0.8 + f * 1.7) * 1.2 * (1 - t);
        const dx = Math.abs(x + 0.5 - W / 2 - wob) / (W / 2);
        const heat = t * 1.3 - dx * 1.1 + (vnoise(x * 0.7, y * 0.5 - f * 2.3, 9) - 0.5) * 0.7;
        if (heat <= 0.12) continue;
        pc.set(f * W + x, y, pick(fire, clamp01(heat), x, y + f));
      }
    frames.push({ name: `f${f}`, x: f * W, y: 0, w: W, h: H });
  }
  return { pc, frames };
}

/** Lśnienie znaleziska, 4 klatki 7x7. */
export function paintSparkle(): { pc: PixelCanvas; frames: { name: string; x: number; y: number; w: number; h: number }[] } {
  const pc = new PixelCanvas(28, 7);
  const frames = [];
  const sizes = [1, 2, 3, 1];
  for (let f = 0; f < 4; f++) {
    const cx = f * 7 + 3, s = sizes[f];
    pc.set(cx, 3, 0xffffff);
    for (let i = 1; i <= s; i++) {
      const c = i === s ? 0xc8d8ff : 0xffffff;
      pc.set(cx + i, 3, c); pc.set(cx - i, 3, c); pc.set(cx, 3 + i, c); pc.set(cx, 3 - i, c);
    }
    frames.push({ name: `s${f}`, x: f * 7, y: 0, w: 7, h: 7 });
  }
  return { pc, frames };
}

/** Winieta ekranowa z ditheringiem. */
export function paintVignette(w: number, h: number): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5) / w * 2 - 1, dy = (y + 0.5) / h * 2 - 1;
      const k = clamp01((Math.sqrt(dx * dx * 0.8 + dy * dy) - 0.62) / 0.6);
      if (k <= 0) continue;
      const lvl = k * 3;
      const i = Math.floor(lvl) + (lvl - Math.floor(lvl) > bayer(x, y) ? 1 : 0);
      if (i > 0) pc.set(x, y, 0x050308, [0, 50, 100, 150][Math.min(3, i)]);
    }
  return pc;
}

// ------------------------------------------------------------------ napisy w świecie (czcionka bitmapowa 6x8)

/**
 * Napis ręcznie rysowaną czcionką 6x8 (FontGlyphs.ts): białe wnętrze (koloruj przez setTint) + czarny obrys 1 px
 * w 8-sąsiedztwie. Wymiary płótna są nieparzyste, więc obraz z originem 0.5 trafia środkiem w pełny piksel.
 */
export function paintText(raw: string): PixelCanvas {
  const { px, w, h } = textPixels(raw.toUpperCase());
  // margines: obrys 1 px, u góry dodatkowo wiersz akcentów wielkich liter (y = -1)
  const W = (w + 2) | 1, H = (h + 3) | 1;
  const pc = new PixelCanvas(W, H);
  for (const [x, y] of px) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) pc.set(1 + x + dx, 2 + y + dy, 0x000000);
  for (const [x, y] of px) pc.set(1 + x, 2 + y, 0xffffff);
  return pc;
}
