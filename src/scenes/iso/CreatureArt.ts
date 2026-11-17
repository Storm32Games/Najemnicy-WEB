// Proceduralne sprite'y wrogów nie-humanoidalnych (24x32, te same nazwy klatek co paintUnitSheet).
// Kształty z EnemyDef.look.shape (Oldgame/src/gfx/creature.js w uproszczeniu do skali izometrycznej):
//   quad = czworonóg (szczur, pies), swarm = rój, big = wielka bestia, drone = latający dron, turret = wieżyczka.
// Gatunki (jak speciesBody w creature.js) wybierane po templateId: skorpion, kretowij, wilk, dzik, pająk, chrząszcz,
// szczur, pies - malowane w podwójnej gęstości (48x64 px, iso/CreatureHD); kształty bez gatunku - tutaj, 24x32.
// Klatki 'b_*' patrzą w prawo-od-kamery (NE), 'f_*' w prawo-do-kamery (SE); lewe kierunki = flipX.
import type { EnemyShape } from '../../core/data/types';
import { PixelCanvas, type RGB, hash2, mix, pick, ramp } from './Pixel';
import { HD, HD_SPECIES, HG, type HdCtx, lieOf as lieOfHD } from './CreatureHD';
import { BASE_ANIMS, type Pose, type UnitSheet, blitRotated, buildUnitSheet } from './UnitArt';

export type CreatureSpecies = 'scorpion' | 'mole' | 'wolf' | 'boar' | 'spider' | 'beetle' | 'rat' | 'dog';

type Painter = (pc: PixelCanvas, skin: readonly RGB[], accent: readonly RGB[], front: boolean, p: Pose, big: boolean) => void;

const GY = 27; // linia stóp
const INK = 0x1a1012;

/** Bryła cieniowana od lewej-góry. */
function blob(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, r: readonly RGB[], seed = 0, base = 0.55): void {
  pc.ellipse(cx, cy, rx, ry, (x, y) => {
    const L = base - ((x - cx) / (rx + 0.01)) * 0.22 - ((y - cy) / (ry + 0.01)) * 0.26 + (hash2(x, y, seed) - 0.5) * 0.14;
    return pick(r, L, x, y);
  });
}

// ------------------------------------------------------------------ czworonogi

/** Stopień położenia na boku przy śmierci (0 = stoi, 1 = leży). */
const lieOf = (p: Pose): number => (p.die < 0 ? 0 : [0.2, 0.55, 1, 1, 1, 1, 1][p.die]);
const isDead = (p: Pose): boolean => p.die >= 2;
/** Odbicie ciała od ziemi w klatce upadku. */
const bounceOf = (p: Pose): number => (p.die === 2 ? -1 : 0);
const BLOOD = 0x9a1a14;

/**
 * Nogi czworonoga: [dx biodra, faza, rampa]. Stojąc - dwa segmenty z kolanem i krokiem; leżąc - sztywne, wyciągnięte w bok.
 * hipY = dół tułowia, len = długość nogi w staniu.
 */
function quadLegs(pc: PixelCanvas, cx: number, hipY: number, defs: readonly (readonly [number, number, readonly RGB[]])[], p: Pose, w = 1, paw?: RGB): void {
  const lie = lieOf(p);
  for (const [dx, ph, r] of defs) {
    const x = cx + dx;
    if (lie >= 1) {
      const far = ph < 0 ? -1 : 0;
      pc.line(x, GY - 2 + far, x + 3, GY + far, r[1]);
      if (w > 1) pc.line(x, GY - 1 + far, x + 3, GY + 1 + far, r[0]);
      if (paw !== undefined) pc.set(x + 4, GY + far, paw);
      continue;
    }
    const st = p.stride * ph, lift = st > 0 && p.anim === 'walk' ? 1 : 0;
    const splay = lie > 0 ? (dx > 0 ? 1 : -1) * Math.round(lie * 3) : 0;
    const fx = x + (p.anim === 'walk' ? st : 0) + splay, fy = GY - lift;
    const kx = Math.round((x + fx) / 2) + (dx < 0 ? -1 : 0) * (lie > 0 ? 0 : 1), ky = Math.round((hipY + fy) / 2);
    for (let k = 0; k < w; k++) { pc.line(x + k, hipY, kx + k, ky, r[1]); pc.line(kx + k, ky, fx + k, fy, r[2]); }
    if (paw !== undefined) pc.set(fx + w, fy, paw);
  }
}

const quad: Painter = (pc, skin, accent, front, p, big) => {
  const s = big ? 1.45 : 1;
  const len = Math.round(7 * s), hgt = Math.round(3.4 * s);
  const lie = lieOf(p);
  const stand = Math.round(5 * s);
  const cx = 12 + p.lunge, cy = GY - stand + p.bob + Math.round(lie * (stand - hgt)) + bounceOf(p);
  const far = skin.map((c) => mix(c, 0x000000, 0.25));
  quadLegs(pc, cx, cy + hgt - 1, [[-len + 2, 1, far], [len - 4, -1, far], [-len + 4, -1, skin], [len - 2, 1, skin]], p, big ? 2 : 1);
  pc.line(cx - len, cy, cx - (len + 4), cy - 2 + p.bob + Math.round(lie * 3), big ? skin[1] : accent[1]);
  blob(pc, cx, cy, len, hgt, skin, 3);
  for (let x = -len + 2; x < len - 1; x += 2) pc.set(cx + x, cy - hgt, skin[0]);
  const hx = cx + (len - 1), hy = cy - Math.round(1.5 * s) + Math.round(lie * 2);
  blob(pc, hx, hy, Math.round(3 * s), Math.round(2.6 * s), skin, 7);
  pc.set(hx - 1, hy - Math.round(3 * s), skin[1]);
  pc.set(hx + 1, hy - Math.round(3 * s), skin[1]);
  if (front) {
    pc.set(hx + 1, hy - 1, isDead(p) ? INK : accent[4]);
    pc.set(hx + Math.round(3 * s), hy + 1, INK);
    if (p.attack) pc.line(hx + 2, hy + 2, hx + 4, hy + 2, 0xf0e8d8);
  }
  if (p.hurt && p.die < 3) pc.set(cx, cy, BLOOD);
};

// ------------------------------------------------------------------ inne kształty

/** Rój: owady krążą; przy śmierci opadają na ziemię i zostaje garść martwych. */
const swarm: Painter = (pc, skin, accent, _front, p) => {
  const n = 13;
  const fall = p.die < 0 ? 0 : [0.1, 0.3, 0.6, 0.85, 1, 1, 1][p.die];
  const ph = p.anim === 'idle' ? p.i * 0.7 : p.anim === 'walk' ? p.i * 0.8 : p.i * 0.5;
  for (let i = 0; i < n; i++) {
    if (p.die >= 2 && i % 3 === 2) continue; // część rozpierzcha się
    const a = i * 2.4, r = 2 + (i % 5) * 1.5;
    const jx = Math.round(Math.cos(a + ph) * r * 1.3 + (p.attack ? 3 + (i % 3) : 0) + p.lunge * 0.5);
    const jy = Math.round(Math.sin(a * 1.7 + ph * 0.8) * r * 0.9);
    const x = 12 + jx + Math.round(fall * ((i % 5) - 2)), y0 = 19 + jy;
    const y = Math.round(y0 + (GY - (i % 2) - y0) * fall);
    if (fall >= 1) { pc.set(x, y, skin[1]); pc.set(x + 1, y, skin[0]); if (i % 4 === 0) pc.set(x, y - 1, skin[2]); continue; }
    pc.rect(x, y, 2, 2, pick(skin, 0.3 + (i % 3) * 0.2, x, y));
    pc.set(x + 1, y, i % 4 === 0 ? accent[4] : skin[3]);
    if ((i + p.i) % 3 === 0) {
      pc.set(x - 1, y - 1, accent[2], 150);
      pc.set(x + 2, y - 1, accent[2], 150);
    }
  }
  if (p.hurt && p.die < 2) pc.rect(11, 18, 2, 2, accent[4]);
};

/** Dron: korpus z wirnikiem, soczewka, lufa pod spodem. Ginie spadając i rozbijając się (obrót w paintCreatureSheet). */
const drone: Painter = (pc, skin, accent, front, p) => {
  const dead = p.die >= 0;
  const cx = 12 + (dead ? 0 : Math.sign(p.lunge)), cy = 14 + p.bob + (p.hurt && !dead ? 2 : 0);
  const spin = dead ? (p.die >= 3 ? 3 : 4 + (p.die & 1) * 3) : (p.i & 1) ? 5 : 7;
  pc.line(cx - spin, cy - 5, cx + spin, cy - 5, 0x9aa4ac, dead && p.die >= 3 ? 255 : 190);
  if (!dead && (p.i & 1)) { pc.set(cx - 7, cy - 5, 0xc8d0d6, 90); pc.set(cx + 7, cy - 5, 0xc8d0d6, 90); }
  pc.rect(cx, cy - 5, 1, 2, skin[1]);
  blob(pc, cx, cy, 6, 3, skin, 5);
  pc.rect(cx - 6, cy, 13, 1, skin[1]);
  pc.set(cx - 5, cy - 1, skin[4]); pc.set(cx + 5, cy + 1, skin[0]);
  pc.set(cx - 4, cy + 2, accent[2]); // lampka pozycyjna
  if (front) {
    pc.rect(cx - 1, cy - 1, 3, 2, 0x14100e);
    pc.set(cx, cy - 1, p.die >= 2 ? 0x3a1410 : accent[p.attack ? 4 : 3]);
    if (p.attack && !dead) pc.set(cx + 1, cy - 1, 0xffffff);
  } else pc.set(cx, cy - 1, skin[4]);
  pc.rect(cx + 2, cy + 3, 2, 2, skin[0]); pc.rect(cx + 4, cy + 4, 2, 1, skin[1]);
  if (p.flash === 1) { pc.set(cx + 6, cy + 4, 0xffffff); pc.set(cx + 7, cy + 4, 0xfff0a0); pc.set(cx + 8, cy + 4, 0xff9a2a); pc.set(cx + 7, cy + 3, 0xff9a2a); pc.set(cx + 7, cy + 5, 0xff9a2a); }
  else if (p.flash === 2) { pc.set(cx + 6, cy + 3, 0xb8b0a4, 150); pc.set(cx + 7, cy + 2, 0xa8a094, 100); }
  else if (p.attack && p.anim === 'attack') { pc.set(cx + 6, cy + 4, 0xfff0a0); pc.set(cx + 7, cy + 4, 0xff9a2a); }
};

/** Wieżyczka: podstawa, kolumna, obrotowa głowica z lufą; po zniszczeniu głowica opada, lufa zwisa. */
const turret: Painter = (pc, skin, accent, _front, p) => {
  const cx = 12;
  const dead = p.die >= 2;
  pc.poly([[cx - 6, GY], [cx + 6, GY], [cx + 4, GY - 4], [cx - 4, GY - 4]], (x, y) => pick(skin, 0.3 - (x - cx) * 0.03, x, y));
  for (let x = cx - 4; x <= cx + 4; x += 4) pc.set(x, GY - 1, skin[4]); // nity
  pc.rect(cx - 1, GY - 9, 3, 5, skin[1]); pc.rect(cx - 1, GY - 9, 1, 5, skin[3]);
  const hy = GY - 12 + (p.hurt ? 1 : 0) + (dead ? 2 : 0) + (p.anim === 'idle' && p.i === 2 ? 0 : 0);
  const hxo = dead ? 1 : 0;
  blob(pc, cx + hxo, hy, 5, 3, skin, 9);
  pc.rect(cx - 3 + hxo, hy - 1, 5, 1, skin[0]); // szczelina pancerza
  if (dead) {
    pc.line(cx + 3, hy + 1, cx + 7, hy + 6, skin[0]); pc.line(cx + 4, hy + 1, cx + 8, hy + 6, skin[2]);
    pc.set(cx - 1, hy - 2, 0x3a1410);
    pc.line(cx - 3, hy + 3, cx - 5, hy + 6, 0x2a2a30); // wyrwany kabel
    pc.set(cx - 5, hy + 7, accent[4]);
  } else {
    const rec = p.flash === 2 ? -1 : 0;
    const aimY = p.anim === 'idle' && p.i >= 2 && p.i < 4 ? 0 : 0;
    pc.rect(cx + 3, hy + aimY, 6 + rec, 2, skin[0]); pc.rect(cx + 3, hy + aimY, 6 + rec, 1, skin[2]);
    pc.set(cx + 8 + rec, hy + aimY, skin[4]);
    pc.set(cx - 2, hy - 2, accent[p.blink || (p.i & 1) ? 4 : 2]);
    if (p.attack && p.anim !== 'shoot') pc.set(cx - 1, hy - 2, accent[4]);
    if (p.flash === 1) { pc.set(cx + 9, hy, 0xffffff); pc.set(cx + 10, hy, 0xfff0a0); pc.set(cx + 11, hy + 1, 0xff9a2a); pc.set(cx + 10, hy - 1, 0xff9a2a); pc.set(cx + 10, hy + 1, 0xffe070); }
    else if (p.flash === 2) { pc.set(cx + 9, hy - 1, 0xb8b0a4, 150); pc.set(cx + 10, hy - 2, 0xa8a094, 100); pc.set(cx + 4, hy - 2, 0xc8a048); }
    else if (p.attack && p.anim === 'attack') { pc.set(cx + 10, hy, 0xfff0a0); pc.set(cx + 11, hy + 1, 0xff9a2a); }
  }
};

const PAINTERS: Partial<Record<EnemyShape, Painter>> = { quad, swarm, drone, turret, big: quad };
/** Gatunki HD (iso/CreatureHD), które giną przewracając się na grzbiet (odnóża w górę). */
const ROLLS_HD = new Set<CreatureSpecies>(['scorpion', 'spider', 'beetle', 'mole']);
const MACHINES = new Set<Painter>([drone, turret]);

/** Gatunek po templateId / nazwie (np. 'scorpion', 'kretowij', 'wolf_pack'); undefined = malarz wg kształtu. */
export function creatureSpecies(id: string | undefined | null): CreatureSpecies | undefined {
  const s = String(id ?? '').toLowerCase();
  if (!s) return undefined;
  if (/scorp|skorp/.test(s)) return 'scorpion';
  if (/kret|mole/.test(s)) return 'mole';
  if (/wolf|wilk|hyena|hien|coyote|kojot/.test(s)) return 'wolf';
  if (/boar|dzik|bear|nied/.test(s)) return 'boar';
  if (/spider|pajak|pająk/.test(s)) return 'spider';
  if (/beetle|chrzas|chrząsz|roach|karalu|scarab/.test(s)) return 'beetle';
  if (/(^|_)rat|szczur/.test(s)) return 'rat';
  if (/dog|pies|hound|psy/.test(s)) return 'dog';
  return undefined;
}

/** Ramka nieprzezroczystych pikseli: [y góra, y dół]. */
function rowsOf(pc: PixelCanvas): [number, number] {
  let y0 = pc.h, y1 = -1;
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) if (pc.alpha(x, y) > 0) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [y0, y1];
}

function under(pc: PixelCanvas, x: number, y: number, c: RGB, a = 255): void {
  if (pc.alpha(x, y) === 0) pc.set(x, y, c, a);
}

/** Kałuża pod ciałem (krew ssaków / jucha owadów / olej maszyn). */
function pool(pc: PixelCanvas, cx: number, r: number, cols: readonly [RGB, RGB, RGB], k = 1): void {
  for (let y = 26 * k; y <= 31 * k - 1; y++)
    for (let x = 0; x < pc.w; x++) {
      const dx = (x + 0.5 - cx * k) / (r * k), dy = (y + 0.5 - 28.5 * k) / (r * k * 0.42);
      const q = dx * dx + dy * dy + (hash2(x, y, 11) - 0.5) * 0.35;
      if (q <= 1) under(pc, x, y, q < 0.35 ? cols[2] : q < 0.7 ? cols[1] : cols[0], 230);
    }
}

/** Iskry (wczesne etapy) i dym (późne) nad wrakiem maszyny. */
function wreckFx(pc: PixelCanvas, d: number, cy: number): void {
  if (d <= 4) for (let k = 0; k < 5; k++) {
    const x = 5 + Math.floor(hash2(k, d, 31) * 14), y = cy - 4 + Math.floor(hash2(k, d, 37) * 9);
    pc.set(x, y, k % 2 ? 0xfff6c0 : 0xffc040);
    if (k === 0) { pc.set(x + 1, y, 0xffffff, 200); pc.set(x, y - 1, 0xffd060, 160); }
  }
  if (d >= 3) for (let k = 0; k < 2 + (d >> 1); k++) {
    const x = 9 + Math.floor(hash2(k, 7, d) * 7), y = cy - 6 - k * 3 - (d - 3);
    pc.set(x, y, 0x8a8a8a, 120); pc.set(x + 1, y, 0x7a7a7a, 95); pc.set(x, y - 1, 0x9a9a9a, 75);
  }
}

/**
 * Arkusz klatek bestii. `species` (opcjonalnie: gatunek albo templateId, np. 'scorpion', 'kretowij', 'wolf')
 * wybiera dedykowanego malarza; bez niego decyduje kształt (jak dotąd).
 * Śmierć: ssaki kładą się na boku (malarz), owady i kretowij przewracają się na grzbiet, dron spada i rozbija się,
 * wieżyczka gaśnie z opadniętą lufą, rój opada na ziemię.
 */
export function paintCreatureSheet(shape: EnemyShape, skinColor: RGB, accentColor: RGB, species?: string): UnitSheet {
  const skin = ramp(skinColor, 5, 0.4), accent = ramp(accentColor, 5, 0.4);
  const sp = species ? ((species in HD_SPECIES ? species : creatureSpecies(species)) as CreatureSpecies | undefined) : undefined;
  const ichor: readonly [RGB, RGB, RGB] = [mix(accentColor, 0x1a2a0a, 0.75), mix(accentColor, 0x2a4a10, 0.6), mix(accentColor, 0x4a6a1a, 0.45)];
  if (sp) return paintHdSheet(sp, skinColor, accentColor, ichor);
  const paint = PAINTERS[shape] || quad;
  const big = shape === 'big';
  return buildUnitSheet(
    (pc, front, pose) => {
      const d = pose.die;
      if (d >= 1 && paint === drone) {
        const tmp = new PixelCanvas(pc.w, pc.h);
        paint(tmp, skin, accent, front, { ...pose, bob: 0 }, big);
        blitRotated(pc, tmp, [0, 12, 30, 62, 70, 70, 70][d], 12, 14, [0, 0, 1, 1, 1, 1, 1][d], [0, 3, 7, 10, 11, 11, 11][d]);
        return;
      }
      paint(pc, skin, accent, front, pose, big);
    },
    (pc, _front, pose) => {
      const d = pose.die;
      if (d < 0) return;
      if (MACHINES.has(paint)) {
        wreckFx(pc, d, paint === drone ? [14, 17, 21, 24, 25, 25, 25][d] : GY - 12);
        if (d >= 5) pool(pc, 12, d === 5 ? 3 : 4.5, [0x101014, 0x18181e, 0x2a2a44]);
        return;
      }
      if (paint === swarm) { if (d >= 5) pool(pc, 12, d === 5 ? 2 : 3, ichor); return; }
      if (d >= 5) pool(pc, 11, (d === 5 ? 3 : 5) * (big ? 1.2 : 1), [0x3a0808, 0x5a0e0c, 0x7a1812]);
    },
    BASE_ANIMS,
  );
}

/** Kolor rampy przyciemniony (dalsze odnóża). */
const farOf = (r: readonly RGB[]): RGB[] => r.map((c) => mix(c, 0x0a0610, 0.3));

/** Arkusz gatunku HD (iso/CreatureHD): klatki 48x64 px, density 2. */
function paintHdSheet(sp: CreatureSpecies, skinColor: RGB, accentColor: RGB, ichor: readonly [RGB, RGB, RGB]): UnitSheet {
  const paint = HD_SPECIES[sp];
  const skin = ramp(skinColor, 6, 0.52), acc = ramp(accentColor, 5, 0.45), far = farOf(skin);
  const ctx = (pc: PixelCanvas, front: boolean, p: Pose): HdCtx => ({ pc, p, front, skin, far, acc, lie: lieOfHD(p), dead: p.die >= 2 });
  const rolls = ROLLS_HD.has(sp);
  return buildUnitSheet(
    (pc, front, pose) => {
      const d = pose.die;
      if (d >= 1 && rolls) {
        // przewrót na grzbiet: obrót wokół środka ciała, potem osadzenie na ziemi (odnóża podkurczone)
        const tmp = new PixelCanvas(pc.w, pc.h), rot = new PixelCanvas(pc.w, pc.h);
        const still = { ...pose, anim: 'die' as const, attack: false, lunge: 0, stride: d >= 4 ? 1 : 0, bob: 0, legs: [0, 0, 0, 0] as const };
        paint({ ...ctx(tmp, front, still), lie: 0, dead: d >= 2 });
        const ang = [0, -40, -110, -180, -180, -180, -180][d];
        blitRotated(rot, tmp, ang, 24, HG - 10, 0, 0);
        const [, y1] = rowsOf(rot);
        const dy = (d === 2 ? HG - 4 : HG + 1) - y1;
        for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) { const c = rot.get(x, y); if (c >= 0) pc.set(x, y + dy, c); }
        return;
      }
      paint(ctx(pc, front, pose));
    },
    (pc, _front, pose) => {
      const d = pose.die;
      if (pose.hurt && pose.anim === 'hurt' && pose.i === 0) tint(pc, 0xff4a3a, 0.32);
      if (d < 0) return;
      if (d <= 1) tint(pc, 0xff4a3a, 0.18);
      if (d >= 5) tint(pc, 0x1a0e0c, 0.16);
      if (d >= 5) pool(pc, 11.5, (d === 5 ? 3.5 : 5.5) * (sp === 'mole' ? 1.25 : 1), rolls && sp !== 'mole' ? ichor : [0x3a0808, 0x5a0e0c, 0x7a1812], HD);
    },
    BASE_ANIMS,
    HD,
  );
}

/** Zabarwienie nieprzezroczystych pikseli (błysk trafienia, ciemnienie zwłok). */
function tint(pc: PixelCanvas, c: RGB, k: number): void {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  for (let i = 0; i < pc.data.length; i += 4) {
    if (!pc.data[i + 3]) continue;
    pc.data[i] += (r - pc.data[i]) * k;
    pc.data[i + 1] += (g - pc.data[i + 1]) * k;
    pc.data[i + 2] += (b - pc.data[i + 2]) * k;
  }
}
