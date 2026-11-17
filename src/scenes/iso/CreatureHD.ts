// Fauna w podwójnej gęstości (klatka 48x64 px = 24x32 projektowych, density 2 - jak sprite'y PixelLab postaci).
//
// Zamiast płaskich elips bestie są "rzeźbione" z brył: elipsoid (egg) i kapsuł o zmiennym promieniu (bone).
// Każdy piksel bryły dostaje normalną (półkula nad płótnem), a jasność = iloczyn z kierunkiem światła (lewa-góra,
// jak reszta gry) + szum sierści / pancerza, wybór z rampy koloru z ditheringiem Bayera. Kończyny liczone IK
// (biodro -> kolano -> stopa), chód kłusem (pary po przekątnej), dalsze odnóża ciemniejsze i przesunięte w głąb.
//
// Klatki 'f_*' patrzą w prawo-do-kamery (SE): widać pysk i oba ślepia, łeb niżej; 'b_*' w prawo-od-kamery (NE):
// łeb wyżej, odwrócony (jedno ślepie). Lewe kierunki = flipX w scenie.
import { type RGB, PixelCanvas, bayer, hash2, mix, pick, vnoise } from './Pixel';
import type { Pose } from './UnitArt';

/** Pikseli płótna na piksel projektowy. */
export const HD = 2;
/** Linia stóp (dolny wiersz łap) w klatce 48x64. */
export const HG = 55;
const CX = 24;

type Ramp = readonly RGB[];
type XY = { x: number; y: number };

/** Materiał bryły. */
interface Mat {
  r: Ramp;
  /** Przesunięcie jasności (+ jaśniej). */
  lift?: number;
  /** Ziarno (pojedyncze piksele). */
  noise?: number;
  /** Pasma sierści (wygładzony szum ukośny). */
  fur?: number;
  seed?: number;
  /** Połysk pancerza: próg blasku (0.05 = mały refleks). */
  gloss?: number;
  /** Jaśniejszy spód (brzuch). */
  belly?: RGB;
  /** Kontrast cieniowania. */
  k?: number;
}

const INK = 0x1a1012;
const BLOOD = 0x8a1410;
const GUM = 0x5a1a1a;
const TOOTH = 0xf2ead8;
const LIGHT = ((v: number[]) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; })([-0.55, -0.8, 0.6]);

function lit(pc: PixelCanvas, x: number, y: number, nx: number, ny: number, nz: number, m: Mat): void {
  const d = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  let v = 0.34 + d * 0.62 * (m.k ?? 1) + (m.lift ?? 0);
  const s = m.seed ?? 0;
  if (m.noise) v += (hash2(x, y, s) - 0.5) * m.noise;
  if (m.fur) v += (vnoise(x * 0.85 + y * 0.5, y * 0.32 - x * 0.12, s + 7) - 0.5) * m.fur;
  let c = pick(m.r, v, x, y);
  if (m.belly !== undefined && ny > 0.3 + bayer(x, y) * 0.45) c = mix(c, m.belly, 0.42);
  if (m.gloss && d > 1 - m.gloss) c = mix(m.r[m.r.length - 1], 0xffffff, 0.5);
  pc.set(x, y, c);
}

/** Elipsoida (opcjonalnie obrócona o `rot` radianów). */
function egg(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, m: Mat, rot = 0): void {
  const ca = Math.cos(rot), sa = Math.sin(rot), R = Math.max(rx, ry) + 1;
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = (dx * ca + dy * sa) / rx, w = (-dx * sa + dy * ca) / ry;
      const q = u * u + w * w;
      if (q > 1) continue;
      lit(pc, x, y, u * ca - w * sa, u * sa + w * ca, Math.sqrt(1 - q), m);
    }
}

/** Kapsuła A -> B o promieniu ra -> rb (kończyny, szyje, ogony, segmenty). */
function bone(pc: PixelCanvas, ax: number, ay: number, bx: number, by: number, ra: number, rb: number, m: Mat): void {
  const R = Math.max(ra, rb) + 1;
  const vx = bx - ax, vy = by - ay, ll = vx * vx + vy * vy || 1e-6;
  for (let y = Math.floor(Math.min(ay, by) - R); y <= Math.ceil(Math.max(ay, by) + R); y++)
    for (let x = Math.floor(Math.min(ax, bx) - R); x <= Math.ceil(Math.max(ax, bx) + R); x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      const t = Math.max(0, Math.min(1, (px * vx + py * vy) / ll));
      const qx = px - vx * t, qy = py - vy * t, r = ra + (rb - ra) * t;
      const d = Math.hypot(qx, qy);
      if (d > r) continue;
      const s = d / r;
      lit(pc, x, y, qx / r, qy / r, Math.sqrt(1 - s * s), m);
    }
}

/** Łańcuch kapsuł przez punkty [x, y, promień]. */
function chain(pc: PixelCanvas, pts: readonly (readonly [number, number, number])[], m: Mat): void {
  for (let k = 0; k + 1 < pts.length; k++) bone(pc, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], pts[k][2], pts[k + 1][2], m);
}

/** Staw dwuczłonowej kończyny (IK): bend +1 = staw za linią A-F (łokieć do tyłu), -1 = przed (kolano do przodu). */
function ik(ax: number, ay: number, fx: number, fy: number, l1: number, l2: number, bend: number): XY {
  const dx = fx - ax, dy = fy - ay, d = Math.hypot(dx, dy) || 1e-6;
  const dd = Math.min(d, l1 + l2 - 0.01);
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  return { x: ax + ux * a - uy * h * bend, y: ay + uy * a + ux * h * bend };
}

/** Trójkąt (uszy, kolce) cieniowany wg pionu. */
function tri(pc: PixelCanvas, pts: readonly (readonly [number, number])[], r: Ramp, base: number, grad = 0.04): void {
  const top = Math.min(...pts.map((p) => p[1]));
  pc.poly(pts, (x, y) => pick(r, base - (y - top) * grad, x, y));
}

const darker = (r: Ramp, k: number): RGB[] => r.map((c) => mix(c, 0x0a0610, k));

// ================================================================== kontekst i poza

export interface HdCtx {
  pc: PixelCanvas;
  p: Pose;
  front: boolean;
  skin: Ramp;
  far: Ramp;
  acc: Ramp;
  /** Stopień położenia (0 stoi .. 1 leży). */
  lie: number;
  dead: boolean;
}

/** Stopień położenia na boku przy śmierci. */
export const lieOf = (p: Pose): number => (p.die < 0 ? 0 : [0.2, 0.55, 1, 1, 1, 1, 1][p.die]);

/** Ślepie: jasny rdzeń w kolorze akcentu + odblask; martwe = kreska. */
function eye(c: HdCtx, x: number, y: number, size: 1 | 2 = 2, dim = false): void {
  const { pc, acc } = c;
  x = Math.round(x); y = Math.round(y);
  if (c.dead) { pc.set(x, y, INK); if (size > 1) pc.set(x + 1, y, INK); return; }
  if (c.p.blink && !dim) { pc.set(x, y, INK); pc.set(x + 1, y, mix(acc[1], INK, 0.5)); return; }
  const core = dim ? acc[2] : acc[acc.length - 1];
  pc.set(x, y, core);
  if (size > 1) { pc.set(x + 1, y, dim ? acc[1] : acc[acc.length - 2]); pc.set(x, y + 1, acc[1]); pc.set(x + 1, y + 1, INK); }
  if (!dim) pc.set(x, y - 1, mix(core, 0xffffff, 0.5), 200);
}

// ================================================================== czworonogi

interface QuadDef {
  /** Bark / biodro: [dx od środka klatki, wysokość nad ziemią]. */
  sh: readonly [number, number];
  hp: readonly [number, number];
  chestR: number;
  hipR: number;
  /** Brzuch w połowie tułowia: promień (0 = brak), opuszczenie. */
  belly?: readonly [number, number];
  /** Grubość nóg: [udo, łydka]. */
  leg: readonly [number, number];
  /** Pikseli kroku na jednostkę `stride`. */
  step: number;
  /** Przesunięcie dalszych nóg w głąb (px). */
  farDx: number;
  /** Środek łba względem barku. */
  head: readonly [number, number];
  neckR: number;
  /** Kolor łap (pazury / kopyta), brak = skóra. */
  paw?: RGB;
  mat: Omit<Mat, 'r'>;
}

/** Punkty zaczepienia po ustawieniu pozy. */
interface QA {
  S: XY;
  H: XY;
  /** Środek łba. */
  N: XY;
  /** Rozwarcie szczęki 0..1. */
  jaw: number;
  tw: number;
}

/**
 * Wspólny szkielet czworonoga. Kolejność: dalsze nogi, ogon (hook), tułów, dodatki na tułowiu, bliższe nogi, szyja + łeb.
 */
function quadruped(c: HdCtx, d: QuadDef, hooks: { tail?: (c: HdCtx, a: QA) => void; torso?: (c: HdCtx, a: QA) => void; head: (c: HdCtx, a: QA) => void }): void {
  const { pc, p, lie } = c;
  const m: Mat = { r: c.skin, ...d.mat };
  const mf: Mat = { ...m, r: c.far };
  const lx = p.lunge * 2;
  const tilt = c.front ? 1 : -1;
  const restS = HG - d.sh[1], restH = HG - d.hp[1];
  const lowS = HG - d.chestR * 0.95, lowH = HG - d.hipR * 0.95;
  const bob = p.die === 2 ? -2 : p.bob;
  const S = { x: CX + d.sh[0] + lx, y: restS + (lowS - restS) * lie + bob + tilt * (1 - lie) };
  const H = { x: CX + d.hp[0] + lx * 0.5, y: restH + (lowH - restH) * lie + bob - tilt * (1 - lie) };
  const atk = p.attack ? 1 : 0;
  const N = {
    x: S.x + d.head[0] + atk * 2,
    y: S.y + d.head[1] * (1 - lie) + atk * 2 + (c.front ? 1 : -1) + lie * Math.max(0, HG - 3 - (S.y + d.head[1])) * 0.75,
  };
  if (lie >= 1) N.y = HG - 4;
  const a: QA = { S, H, N, jaw: p.attack ? (p.i === 2 ? 1 : 0.6) : 0, tw: p.anim === 'idle' ? p.i & 1 : p.anim === 'walk' ? (p.i >> 1) & 1 : 0 };

  // nogi: [korzeń, przód?, przesunięcie stopy, uniesienie, materiał, dalsza?]
  const L = p.legs;
  const farOff = c.front ? d.farDx : -d.farDx;
  const legsOf = (far: boolean) => {
    const mm = far ? mf : m;
    const ox = far ? farOff : 0, oy = far ? -1 : 0;
    // kłus: bliższa przednia + dalsza tylna = para A (L[0], L[1]), dalsza przednia + bliższa tylna = para B (L[2], L[3])
    const fr = far ? [L[2], L[3]] : [L[0], L[1]];
    const hr = far ? [L[0], L[1]] : [L[2], L[3]];
    leg(c, { x: S.x + ox, y: S.y + d.chestR * 0.35 + oy }, restS + d.chestR * 0.35, fr[0] * d.step, fr[1] * 2, true, d, mm, oy);
    leg(c, { x: H.x + ox, y: H.y + d.hipR * 0.3 + oy }, restH + d.hipR * 0.3, hr[0] * d.step, hr[1] * 2, false, d, mm, oy);
  };
  legsOf(true);
  hooks.tail?.(c, a);
  // tułów: zad -> kłąb, brzuch
  bone(pc, H.x, H.y, S.x, S.y, d.hipR, d.chestR, m);
  if (d.belly && d.belly[0] > 0) egg(pc, (S.x + H.x) / 2, (S.y + H.y) / 2 + d.belly[1], Math.abs(S.x - H.x) * 0.45, d.belly[0], m);
  hooks.torso?.(c, a);
  legsOf(false);
  // szyja
  bone(pc, S.x + d.chestR * 0.2, S.y - d.chestR * 0.25, N.x - 1, N.y + 1, d.neckR, d.neckR * 0.8, m);
  hooks.head(c, a);
  if (p.hurt && p.die < 3) { pc.set(Math.round(S.x - 2), Math.round(S.y), BLOOD); pc.set(Math.round(S.x - 1), Math.round(S.y + 1), BLOOD); pc.set(Math.round(S.x - 3), Math.round(S.y + 1), 0x5a0a0a); }
}

/** Noga czworonoga (przednia: łokieć do tyłu; tylna: kolano do przodu, staw skokowy do tyłu). Leżąc - sztywna, wyciągnięta. */
function leg(c: HdCtx, root: XY, restY: number, shift: number, lift: number, fore: boolean, d: QuadDef, m: Mat, oy: number): void {
  const { pc, lie, p } = c;
  const len = HG - restY;
  const [r0, r1] = d.leg;
  const pawM: Mat = d.paw !== undefined ? { r: [mix(d.paw, 0, 0.5), mix(d.paw, 0, 0.3), d.paw, mix(d.paw, 0xffffff, 0.2), mix(d.paw, 0xffffff, 0.4)], k: 0.8 } : m;
  const walk = p.anim === 'walk' || p.anim === 'attack';
  let fx = root.x + (fore ? 1 : -1) + (walk ? shift : 0), fy = HG + oy - (walk ? lift : 0);
  if (lie > 0) {
    // leżąc: nogi wyciągnięte w stronę kamery (w dół ekranu), sztywne
    const lx = root.x + (fore ? len * 0.55 : -len * 0.15) + (oy ? -2 : 0), ly = root.y + len * 0.6 + (oy ? -2 : 0);
    fx += (lx - fx) * lie;
    fy += (ly - fy) * lie;
  }
  if (lie >= 1) {
    bone(pc, root.x, root.y, fx, fy, r0, r1, m);
    egg(pc, fx + (fore ? 0.5 : -0.5), fy + 0.5, r1 + 0.6, r1 + 0.2, pawM);
    return;
  }
  if (fore) {
    const l1 = len * 0.52, l2 = len * 0.56;
    const j = ik(root.x, root.y, fx, fy, l1, l2, 1);
    bone(pc, root.x, root.y, j.x, j.y, r0, (r0 + r1) / 2, m);
    bone(pc, j.x, j.y, fx, fy - 1, (r0 + r1) / 2, r1, m);
  } else {
    const hock = { x: fx - len * 0.12, y: fy - len * 0.32 };
    const lh = Math.hypot(hock.x - root.x, len - len * 0.32);
    const j = ik(root.x, root.y, hock.x, hock.y, lh * 0.56, lh * 0.56, -1);
    bone(pc, root.x, root.y, j.x, j.y, r0 * 1.15, (r0 + r1) / 2, m);
    bone(pc, j.x, j.y, hock.x, hock.y, (r0 + r1) / 2, r1, m);
    bone(pc, hock.x, hock.y, fx, fy - 1, r1, r1 * 0.9, m);
  }
  egg(pc, fx + 1, fy - 0.5, r1 + 0.9, Math.max(1, r1 * 0.75), pawM);
}

interface HeadDef {
  r: number;
  ry: number;
  snout: number;
  snoutR: number;
  /** Opadanie końca pyska. */
  droop?: number;
  nose?: RGB;
  /** Kły widoczne przy zamkniętym pysku. */
  fang?: boolean;
  teeth?: RGB;
}

/** Łeb psowatego / gryzonia: czaszka, pysk, żuchwa (rozwiera się w ataku), nos, ślepia. Zwraca czubek pyska. */
function snoutHead(c: HdCtx, N: XY, h: HeadDef, jaw: number, m: Mat): XY {
  const { pc } = c;
  const back = !c.front;
  const sn = h.snout * (back ? 0.85 : 1);
  const tip = { x: N.x + h.r + sn, y: N.y + h.ry * 0.35 + (h.droop ?? 0) };
  const jm: Mat = { ...m, lift: (m.lift ?? 0) - 0.12 };
  // żuchwa (pod pyskiem), opada przy ataku
  const jx = N.x + h.r + sn * 0.8, jy = tip.y + h.snoutR * 0.8 + jaw * 4;
  bone(pc, N.x + h.r * 0.1, N.y + h.ry * 0.55, jx, jy, h.snoutR * 0.7, h.snoutR * 0.5, jm);
  if (jaw > 0) {
    // wnętrze paszczy i zęby
    pc.line(Math.round(N.x + h.r * 0.6), Math.round(N.y + h.ry * 0.6), Math.round(jx - 1), Math.round(jy - 1), GUM);
    for (let k = 0; k < 3; k++) {
      const t = 0.45 + k * 0.22;
      pc.set(Math.round(N.x + h.r * 0.5 + (tip.x - N.x - h.r * 0.5) * t), Math.round(N.y + h.ry * 0.35 + (tip.y - N.y - h.ry * 0.35) * t + h.snoutR * 0.7), h.teeth ?? TOOTH);
      pc.set(Math.round(N.x + h.r * 0.5 + (jx - N.x - h.r * 0.5) * t), Math.round(N.y + h.ry * 0.6 + (jy - N.y - h.ry * 0.6) * t - h.snoutR * 0.4), h.teeth ?? TOOTH);
    }
  }
  egg(pc, N.x, N.y, h.r, h.ry, m);
  bone(pc, N.x + h.r * 0.3, N.y + h.ry * 0.05, tip.x, tip.y, h.snoutR, h.snoutR * 0.72, m);
  // nos
  const nx = Math.round(tip.x + h.snoutR * 0.45), ny = Math.round(tip.y - h.snoutR * 0.55);
  pc.set(nx, ny, h.nose ?? INK); pc.set(nx - 1, ny, h.nose ?? INK); pc.set(nx, ny + 1, mix(h.nose ?? INK, 0, 0.3));
  pc.set(nx - 1, ny - 1, mix(h.nose ?? INK, 0xffffff, 0.35));
  // linia pyska
  if (jaw === 0) {
    pc.line(Math.round(N.x + h.r * 0.55), Math.round(tip.y + h.snoutR * 0.55), Math.round(tip.x - 1), Math.round(tip.y + h.snoutR * 0.6), mix(m.r[0], INK, 0.5));
    if (h.fang) { pc.set(Math.round(tip.x - 2), Math.round(tip.y + h.snoutR * 0.6 + 1), h.teeth ?? TOOTH); }
  }
  // ślepia (przodem także dalsze, nad grzbietem nosa)
  const ex = N.x + h.r * 0.3, ey = N.y - h.ry * 0.25;
  pc.line(Math.round(ex - 1), Math.round(ey - 1), Math.round(ex + 2), Math.round(ey - 1), mix(m.r[0], INK, 0.4)); // łuk brwiowy
  eye(c, ex, ey, 2, back);
  if (c.front && !c.dead) pc.set(Math.round(N.x + h.r * 0.95), Math.round(ey - 0.5), c.acc[2]);
  if (c.dead && c.p.die >= 4) { pc.set(Math.round(jx), Math.round(jy + 1), 0xc06070); pc.set(Math.round(jx + 1), Math.round(jy + 1), 0xa04a5a); } // jęzor
  return tip;
}

// ------------------------------------------------------------------ gatunki: ssaki

/** Szczur-mutant: niski, garbaty zad, długi nagi ogon, wielkie uszy, spiczasty pysk z żółtymi siekaczami, łyse placki. */
function ratHD(c: HdCtx): void {
  const pink = mix(c.skin[3], 0xe0a09a, 0.6);
  const pinkR = [mix(pink, 0x2a1018, 0.55), mix(pink, 0x2a1018, 0.3), pink, mix(pink, 0xfff0e0, 0.2), mix(pink, 0xfff0e0, 0.45)];
  quadruped(c, {
    sh: [7, 8], hp: [-5, 11], chestR: 4.6, hipR: 6.4, belly: [4.4, 1.5], leg: [1.7, 1.0], step: 1.5, farDx: 2,
    head: [6, -1], neckR: 3.4, paw: pink, mat: { fur: 0.32, noise: 0.12, seed: 3, belly: mix(c.skin[4], 0xd8c8b0, 0.4) },
  }, {
    tail: (c, a) => {
      const { p } = c;
      const H = a.H, sw = a.tw;
      const pts: [number, number, number][] = c.dead
        ? [[H.x - 5, H.y + 1, 1.5], [H.x - 10, HG - 1, 1.2], [H.x - 15, HG, 0.9], [H.x - 19, HG - 1, 0.7]]
        : p.attack ? [[H.x - 5, H.y, 1.5], [H.x - 10, H.y - 3, 1.2], [H.x - 13, H.y - 9, 0.9], [H.x - 13, H.y - 15, 0.7]]
          : [[H.x - 5, H.y + 1, 1.5], [H.x - 10, H.y + 4, 1.25], [H.x - 15, H.y + 3 - sw, 1.0], [H.x - 18, H.y - 1 - sw, 0.8], [H.x - 17, H.y - 5 - sw, 0.65]];
      chain(c.pc, pts, { r: pinkR, noise: 0.1, seed: 9 });
      // obrączki na ogonie
      for (let k = 1; k < pts.length; k++) c.pc.set(Math.round(pts[k][0]), Math.round(pts[k][1]), pinkR[1]);
    },
    torso: (c, a) => {
      const { pc } = c;
      // nastroszona sierść na garbie
      for (let k = 0; k < 6; k++) {
        const x = Math.round(a.H.x - 3 + k * 2), y = Math.round(a.H.y - 6 + Math.abs(k - 2) * 0.6);
        pc.set(x, y, c.skin[1]); pc.set(x - 1, y - 1, c.skin[0]);
      }
      // łyse placki z krostami
      const bx = Math.round(a.H.x + 3), by = Math.round(a.H.y);
      pc.set(bx, by, pinkR[1]); pc.set(bx + 1, by, pinkR[2]); pc.set(bx, by + 1, pinkR[2]);
      pc.set(bx - 4, by + 3, pinkR[2]); pc.set(bx + 2, by - 2, c.acc[2]);
    },
    head: (c, a) => {
      const { pc } = c;
      const m: Mat = { r: c.skin, fur: 0.25, noise: 0.1, seed: 5 };
      // dalsze ucho
      egg(pc, a.N.x + 0.5, a.N.y - 4, 2.6, 2.9, { r: c.far });
      const tip = snoutHead(c, a.N, { r: 3.6, ry: 3.1, snout: 5.5, snoutR: 2.1, droop: 1, nose: mix(pink, 0x6a2a2a, 0.3), teeth: 0xe8d48a }, a.jaw, m);
      // siekacze
      if (a.jaw === 0) { pc.set(Math.round(tip.x - 1), Math.round(tip.y + 2), 0xe8d48a); pc.set(Math.round(tip.x - 1), Math.round(tip.y + 3), 0xc8b46a); }
      // bliższe ucho: duże, okrągłe, różowe w środku
      egg(pc, a.N.x - 2, a.N.y - 4.2, 2.8, 3.1, m);
      egg(pc, a.N.x - 1.6, a.N.y - 4, 1.6, 2, { r: pinkR, k: 0.6 });
      // wąsy
      if (!c.dead) {
        pc.set(Math.round(tip.x + 1), Math.round(tip.y - 2), 0xd8d0c0, 170); pc.set(Math.round(tip.x + 3), Math.round(tip.y - 3), 0xd8d0c0, 120);
        pc.set(Math.round(tip.x + 2), Math.round(tip.y + 1), 0xd8d0c0, 150); pc.set(Math.round(tip.x + 4), Math.round(tip.y + 2), 0xd8d0c0, 100);
      }
    },
  });
}

/** Pies-mutant: wychudzony, wysokie nogi, podkasany brzuch, żebra, kostne płytki na grzbiecie, parchy, podarte ucho. */
function dogHD(c: HdCtx): void {
  const mange = mix(c.skin[2], 0xc08a80, 0.55);
  const bone_ = [0x6a5a48, 0x9a8a70, 0xc8b898, 0xe8dcc0, 0xfff6e0];
  quadruped(c, {
    sh: [6, 19], hp: [-7, 18], chestR: 5.6, hipR: 3.8, leg: [2.0, 1.1], step: 2, farDx: 3,
    head: [6, -7], neckR: 2.6, paw: 0x3a2e28, mat: { fur: 0.34, noise: 0.16, seed: 4 },
  }, {
    tail: (c, a) => {
      const H = a.H;
      const pts: [number, number, number][] = c.dead
        ? [[H.x - 2, H.y, 1.3], [H.x - 7, H.y + 2, 1.0], [H.x - 11, HG - 1, 0.7]]
        : [[H.x - 2, H.y - 1, 1.3], [H.x - 6, H.y - 5 - (c.p.attack ? 2 : 0), 1.0], [H.x - 6, H.y - 10 - a.tw, 0.8], [H.x - 4, H.y - 12 - a.tw, 0.6]];
      chain(c.pc, pts, { r: c.skin, fur: 0.2, seed: 8 });
    },
    torso: (c, a) => {
      const { pc } = c;
      const { S, H } = a;
      // żebra na klatce piersiowej
      for (let k = 0; k < 4; k++) {
        const x = S.x - 4 + k * 2.2;
        pc.line(Math.round(x + 1), Math.round(S.y - 2), Math.round(x - 0.5), Math.round(S.y + 3), c.skin[0]);
        pc.set(Math.round(x + 1.5), Math.round(S.y - 2), c.skin[4]);
      }
      // kostne płytki wzdłuż grzbietu
      for (let k = 0; k < 5; k++) {
        const t = k / 4, x = H.x + (S.x - H.x) * t, y = H.y + (S.y - H.y) * t - (t < 0.5 ? 3.6 : 5.2);
        tri(pc, [[x - 1.5, y + 1.5], [x + 1.5, y + 1.5], [x + 0.5, y - 1.5 - (k % 2)]], bone_, 0.85, 0.06);
      }
      // parchy i toksyczne krosty
      const mx = Math.round(H.x + 1), my = Math.round(H.y);
      pc.set(mx, my, mange); pc.set(mx + 1, my, mange); pc.set(mx, my + 1, mix(mange, 0, 0.2)); pc.set(mx - 2, my - 1, mange);
      pc.set(Math.round(S.x - 6), Math.round(S.y + 2), c.acc[3]); pc.set(Math.round(S.x - 5), Math.round(S.y + 2), c.acc[1]);
      pc.set(Math.round(H.x + 4), Math.round(H.y - 2), c.acc[2]);
    },
    head: (c, a) => {
      const { pc } = c;
      const m: Mat = { r: c.skin, fur: 0.22, noise: 0.14, seed: 6 };
      // dalsze ucho: postrzępione, oklapnięte
      tri(pc, [[a.N.x - 1, a.N.y - 2], [a.N.x + 2, a.N.y - 3], [a.N.x + 1.5, a.N.y - 6]], c.far, 0.5);
      snoutHead(c, a.N, { r: 3.8, ry: 3.3, snout: 6, snoutR: 2.2, fang: true }, a.jaw, m);
      // bliższe ucho: stojące, z wyrwą
      tri(pc, [[a.N.x - 3.5, a.N.y - 1.5], [a.N.x, a.N.y - 2.5], [a.N.x - 2.5, a.N.y - 8]], c.skin, 0.7);
      pc.set(Math.round(a.N.x - 2), Math.round(a.N.y - 5), mix(c.skin[3], 0xc08a80, 0.5));
      pc.clear(Math.round(a.N.x - 1), Math.round(a.N.y - 5));
      // blizna przez pysk
      pc.set(Math.round(a.N.x + 3), Math.round(a.N.y - 1), mange); pc.set(Math.round(a.N.x + 4), Math.round(a.N.y), mange);
    },
  });
}

/** Wilk: smukły, gęsta grzywa na karku, jasny spód, puszysty ogon, szpiczaste uszy. */
function wolfHD(c: HdCtx): void {
  const pale = mix(c.skin[4], 0xe8e0d0, 0.45);
  quadruped(c, {
    sh: [6, 18], hp: [-7, 17], chestR: 6.2, hipR: 4.8, leg: [2.1, 1.2], step: 2, farDx: 3,
    head: [7, -6], neckR: 3.8, paw: 0x2a2420, mat: { fur: 0.42, noise: 0.12, seed: 5, belly: pale },
  }, {
    tail: (c, a) => {
      const H = a.H, sw = c.p.bob ? 1 : 0;
      const pts: [number, number, number][] = c.dead
        ? [[H.x - 2, H.y, 2.4], [H.x - 8, H.y + 2, 2.6], [H.x - 13, HG - 2, 1.6]]
        : [[H.x - 2, H.y - 1, 2.2], [H.x - 7, H.y + 2 + sw, 2.8], [H.x - 10, H.y + 7 + sw, 2.3], [H.x - 11, H.y + 10 + sw, 1.4]];
      chain(c.pc, pts, { r: c.skin, fur: 0.5, seed: 11 });
      const e = pts[pts.length - 1];
      egg(c.pc, e[0], e[1], 1.6, 1.4, { r: [c.skin[2], c.skin[3], pale, pale, mix(pale, 0xffffff, 0.3)] });
    },
    torso: (c, a) => {
      // grzywa na karku i łopatkach
      egg(c.pc, a.S.x - 1, a.S.y - 2, 4.8, 4.6, { r: c.skin, fur: 0.55, seed: 13, lift: 0.04 });
      for (let k = 0; k < 4; k++) c.pc.set(Math.round(a.S.x - 4 + k * 2), Math.round(a.S.y - 6.5 + (k % 2)), c.skin[0]);
      // pasmo ciemniejszej sierści wzdłuż grzbietu
      c.pc.line(Math.round(a.H.x), Math.round(a.H.y - 4.5), Math.round(a.S.x - 4), Math.round(a.S.y - 5), c.skin[1]);
    },
    head: (c, a) => {
      const { pc } = c;
      const m: Mat = { r: c.skin, fur: 0.3, noise: 0.1, seed: 7 };
      tri(pc, [[a.N.x, a.N.y - 2], [a.N.x + 2.5, a.N.y - 2.5], [a.N.x + 1.5, a.N.y - 7.5]], c.far, 0.5);
      const tip = snoutHead(c, a.N, { r: 3.9, ry: 3.3, snout: 5.5, snoutR: 2.0, fang: true }, a.jaw, m);
      // jasny podbródek i policzek
      pc.line(Math.round(a.N.x), Math.round(a.N.y + 3), Math.round(tip.x - 3), Math.round(tip.y + 2), pale);
      tri(pc, [[a.N.x - 3.5, a.N.y - 1.5], [a.N.x, a.N.y - 2.5], [a.N.x - 2.2, a.N.y - 8.5]], c.skin, 0.75);
      pc.set(Math.round(a.N.x - 2), Math.round(a.N.y - 4), mix(c.skin[1], 0x4a2a2a, 0.3));
    },
  });
}

/** Dzik: krępy, wysoki kłąb, szczecinowata grzywa, krótkie nogi z racicami, płaski ryj z zakręconymi szablami. */
function boarHD(c: HdCtx): void {
  const tusk = [0x6a5a40, 0xa8987a, 0xd8ccb0, 0xf0e8d4, 0xffffff];
  quadruped(c, {
    sh: [5, 15], hp: [-7, 13], chestR: 7.6, hipR: 6.6, belly: [5.5, 2], leg: [2.6, 1.6], step: 1.5, farDx: 3,
    head: [7, 2], neckR: 5.5, paw: 0x2a2018, mat: { fur: 0.4, noise: 0.2, seed: 6 },
  }, {
    tail: (c, a) => {
      const H = a.H;
      chain(c.pc, [[H.x - 5, H.y - 2, 1], [H.x - 8, H.y + (c.dead ? 2 : -1 + c.p.bob), 0.7]], { r: c.skin });
      c.pc.set(Math.round(H.x - 9), Math.round(H.y + (c.dead ? 3 : c.p.bob)), INK);
    },
    torso: (c, a) => {
      const { pc } = c;
      // szczecina: ciemne pasma wzdłuż grzbietu, najwyższa na kłębie
      for (let k = 0; k <= 9; k++) {
        const t = k / 9, x = a.H.x - 2 + (a.S.x + 1 - a.H.x) * t;
        const y = a.H.y + (a.S.y - a.H.y) * t - (6.2 + t * 1.8);
        const h = 1 + Math.round(t * 2.5);
        pc.line(Math.round(x), Math.round(y), Math.round(x - 1), Math.round(y - h), k % 2 ? INK : c.skin[0]);
      }
      // błoto na bokach
      for (let k = 0; k < 5; k++) pc.set(Math.round(a.H.x + k * 2.5), Math.round(a.H.y + 4 + (k % 2)), mix(c.skin[0], 0x3a2a1a, 0.5));
    },
    head: (c, a) => {
      const { pc } = c;
      const N = a.N;
      const m: Mat = { r: c.skin, fur: 0.3, noise: 0.16, seed: 8 };
      egg(pc, N.x, N.y, 5.0, 4.6, m);
      // ryj: stożek do płaskiej tarczy nosa
      const tx = N.x + 8 + (a.jaw ? 1 : 0), ty = N.y + 2.5;
      bone(pc, N.x + 2, N.y + 0.5, tx, ty, 3.4, 2.4, m);
      egg(pc, tx + 0.5, ty, 1.3, 2.4, { r: [0x3a2028, 0x6a3a40, 0x9a5a5a, 0xc07a74, 0xd89a90], k: 0.6 });
      pc.set(Math.round(tx + 0.5), Math.round(ty - 1), INK); pc.set(Math.round(tx + 0.5), Math.round(ty + 1), INK);
      // szable: z dolnej szczęki, zakrzywione w górę
      chain(pc, [[N.x + 5, N.y + 4, 1.1], [N.x + 7.5, N.y + 3.5, 0.9], [N.x + 8.5, N.y + 0.5, 0.6]], { r: tusk, k: 0.7 });
      if (a.jaw) pc.line(Math.round(N.x + 3), Math.round(N.y + 4), Math.round(tx - 1), Math.round(ty + 2), GUM);
      // ucho: małe, spiczaste, położone przy szarży
      const ex = N.x - 2.5, ey = N.y - 3.5;
      tri(pc, a.jaw ? [[ex, ey], [ex + 3, ey + 0.5], [ex - 3, ey - 2]] : [[ex - 1, ey + 1], [ex + 2, ey], [ex - 1.5, ey - 4]], c.skin, 0.6);
      eye(c, N.x + 1.5, N.y - 1.5, 2, !c.front);
    },
  });
}

/** Kretowij: wielki, garbaty, aksamitne futro, kostne guzy, łopaty z trzema pazurami, gwiaździsty różowy ryjek. */
function moleHD(c: HdCtx): void {
  const { pc, p } = c;
  const m: Mat = { r: c.skin, fur: 0.2, noise: 0.08, seed: 3, k: 0.95 };
  const mf: Mat = { ...m, r: c.far };
  const claw = [0x5a4a38, 0x9a8a6a, 0xd0c4a4, 0xf0e8d0, 0xffffff];
  const clawF = darker(claw, 0.3);
  const pink = [0x6a2a3a, 0xa04a5a, 0xd07080, 0xe898a0, 0xf8c0c0];
  const cx = CX - 3 + Math.sign(p.lunge) * 2, cy = HG - 13 + p.bob;
  const stepA = p.anim === 'walk' ? p.legs[0] : 0, stepB = p.anim === 'walk' ? p.legs[2] : 0;
  /** Łopata: dłoń + trzy długie pazury (w dół-do przodu albo, w zamachu, do przodu-w górę). */
  const shovel = (x: number, y: number, mm: Mat, cl: Ramp, raised: boolean) => {
    egg(pc, x, y, 3.6, 2.6, mm, raised ? -0.6 : 0.2);
    for (let k = 0; k < 3; k++) {
      if (raised) chain(pc, [[x + 2, y - 2 + k * 1.6, 0.9], [x + 5, y - 4 + k * 1.8, 0.7], [x + 7, y - 4 + k * 2.2, 0.45]], { r: cl, k: 0.7 });
      else chain(pc, [[x + 1 + k * 1.3, y + 1.5, 0.9], [x + 3 + k * 1.4, y + 3.5, 0.7], [x + 4.5 + k * 1.4, y + 4, 0.45]], { r: cl, k: 0.7 });
    }
  };
  // dalsza łapa przednia i tylne łapy
  bone(pc, cx + 6, cy - 1, cx + 10 + stepB, HG - 5, 2.6, 2.2, mf);
  shovel(cx + 10 + stepB, HG - 5, mf, clawF, false);
  egg(pc, cx - 9 + stepA, HG - 2, 3, 2.2, mf);
  // korpus z garbem
  egg(pc, cx, cy, 12.5, 10.5, m);
  egg(pc, cx - 3, cy - 5, 8.5, 6.5, { ...m, lift: 0.05 });
  // aksamitne pasma futra
  for (let k = 0; k < 7; k++) pc.line(Math.round(cx - 9 + k * 3), Math.round(cy - 4 + (k % 2) * 2), Math.round(cx - 8 + k * 3), Math.round(cy + 4 + (k % 2)), c.skin[1]);
  // kostne guzy na grzbiecie
  for (const [dx, dy, r] of [[-8, -9, 1.6], [-3, -12, 2], [2, -10.5, 1.7]] as const) egg(pc, cx + dx, cy + dy, r, r * 0.9, { r: claw, k: 0.8 });
  egg(pc, cx - 5 + stepB, HG - 1.8, 3.2, 2.2, m);
  // łeb nisko z przodu: wydłużony ryj zakończony gwiazdą różowych macek
  const hx = cx + 11, hy = cy + 4 + (p.attack ? -2 : 0);
  egg(pc, hx, hy, 5.2, 4.4, m);
  const tx = hx + 9, ty = hy + 2;
  bone(pc, hx + 2, hy + 0.5, tx, ty, 2.8, 1.8, m);
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2 + (p.anim === 'idle' ? p.i * 0.3 : 0);
    const r = 2.6 + (k % 2) * 0.6;
    bone(pc, tx + 0.5, ty, tx + 0.5 + Math.cos(ang) * r * 0.6 + 0.8, ty + Math.sin(ang) * r, 0.7, 0.55, { r: pink, k: 0.6 });
  }
  pc.set(Math.round(tx + 1), Math.round(ty), 0x5a1a2a);
  if (p.attack) { pc.line(Math.round(hx + 3), Math.round(hy + 3), Math.round(tx - 1), Math.round(ty + 2), GUM); pc.set(Math.round(hx + 5), Math.round(hy + 3), TOOTH); pc.set(Math.round(hx + 7), Math.round(hy + 3), TOOTH); }
  // oczka: maleńkie, świecące
  eye(c, hx + 1, hy - 1.5, 1, !c.front);
  // bliższa łapa: w ataku uniesiona w zamachu
  if (p.attack) {
    bone(pc, cx + 5, cy, cx + 10, cy - 6, 3, 2.6, m);
    shovel(cx + 12, cy - 7, m, claw, true);
    for (let k = 0; k < 4; k++) pc.set(cx + 22, cy - 9 + k * 3, 0xffffff, 110);
  } else {
    bone(pc, cx + 4, cy + 2, cx + 8 + stepA, HG - 4, 3, 2.5, m);
    shovel(cx + 8 + stepA, HG - 4, m, claw, false);
  }
  if (p.hurt && p.die < 3) { pc.set(cx, cy - 4, BLOOD); pc.set(cx + 1, cy - 3, BLOOD); }
}

// ------------------------------------------------------------------ gatunki: stawonogi

/** Odnóże stawonoga: biodro -> kolano (w górę) -> stopa na ziemi; trzy kapsuły o malejącej grubości. */
function arthLeg(c: HdCtx, hx: number, hy: number, kx: number, ky: number, fx: number, fy: number, m: Mat, w = 1): void {
  const mx = (kx + fx) / 2 + (fx > kx ? 0.5 : -0.5), my = (ky + fy) / 2 - 1;
  bone(c.pc, hx, hy, kx, ky, 1.1 * w, 0.95 * w, m);
  bone(c.pc, kx, ky, mx, my, 0.95 * w, 0.8 * w, m);
  bone(c.pc, mx, my, fx, fy, 0.8 * w, 0.55 * w, m);
}

/** Skorpion: lśniący, segmentowany odwłok, wielkie szczypce, ogon łukiem nad grzbietem z jadowym żądłem. */
function scorpionHD(c: HdCtx): void {
  const { pc, p } = c;
  const m: Mat = { r: c.skin, gloss: 0.06, noise: 0.08, seed: 4, k: 1.1 };
  const mf: Mat = { ...m, r: c.far, gloss: 0 };
  const cx = CX - 3 + Math.sign(p.lunge) * (p.attack ? 0 : 1), by = HG - 7 + (p.bob > 0 ? 1 : 0);
  const legs = (mm: Mat, dy: number, sgn: number) => {
    for (let i = 0; i < 4; i++) {
      const ph = (i % 2 ? 1 : -1) * p.stride * sgn, lift = ph > 0 && p.anim === 'walk' ? 2 : 0;
      const hx = cx + 2 - i * 3, out = [3.5, 1.5, -1.5, -3.5][i];
      arthLeg(c, hx, by + dy, hx + out * 1.2, by - 5 + dy, hx + out * 2.6 + ph * 1.5, HG - lift + dy, mm, 1.1);
    }
  };
  legs(mf, -2, -1);
  const open = p.attack ? 2 : 0;
  const clawM: Mat = { ...m, r: c.skin.map((x) => mix(x, c.acc[2], 0.18)) };
  const clawF: Mat = { ...clawM, r: darker(clawM.r, 0.32), gloss: 0 };
  // szczypce dalsze
  chain(pc, [[cx + 5, by - 3, 1.6], [cx + 8, by - 8, 1.5], [cx + 11 + open, by - 9, 1.6]], clawF);
  egg(pc, cx + 14.5 + open, by - 9.5, 3.6, 2.4, clawF, -0.15);
  bone(pc, cx + 17 + open, by - 10.5, cx + 20 + open, by - 11, 1.1, 0.5, clawF);
  // odwłok: segmenty od głowotułowia do ogona, ze szwami
  const segs: [number, number, number][] = [[-2, 4.6, 3.8], [-7, 4.3, 3.6], [-11.5, 3.8, 3.3], [-15, 3.2, 2.9]];
  for (const [dx, rx, ry] of segs) egg(pc, cx + dx, by - 2, rx, ry, m);
  for (const [dx, , ry] of segs.slice(0, 3)) pc.line(Math.round(cx + dx - 3), Math.round(by - 2 - ry * 0.7), Math.round(cx + dx - 3.5), Math.round(by), c.skin[0]);
  // ogon: łuk nad grzbietem, w ataku żądło uderza do przodu
  const tail: [number, number, number][] = p.attack
    ? [[-17, -4, 2.7], [-19, -9, 2.6], [-18, -14, 2.5], [-15, -19, 2.4], [-10, -22, 2.2], [-4, -22, 2.0], [1, -18, 1.8]]
    : [[-17, -4, 2.7], [-19.5, -9, 2.6], [-19.5, -14, 2.5], [-17.5, -19, 2.4], [-14, -23, 2.2], [-9.5, -24.5 + (p.bob ? 1 : 0), 2.0], [-5.5, -22.5 + (p.bob ? 1 : 0), 1.8]];
  chain(pc, tail.map(([dx, dy, r]) => [cx + dx, by + dy, r * 0.8] as const), m);
  tail.forEach(([dx, dy, r], k) => egg(pc, cx + dx, by + dy, r + 0.2, r, { ...m, seed: 9 + k }));
  for (let k = 0; k + 1 < tail.length; k++) {
    const [ax, ay] = tail[k], [bx2, by2] = tail[k + 1];
    pc.set(Math.round(cx + (ax + bx2) / 2), Math.round(by + (ay + by2) / 2), c.skin[0]);
  }
  // żądło: bańka jadowa w kolorze akcentu + zakrzywiony kolec
  const [sx, sy] = tail[tail.length - 1];
  egg(pc, cx + sx + 2.5, by + sy + 2, 2.4, 2, { r: c.acc, gloss: 0.1, k: 0.9 });
  chain(pc, [[cx + sx + 4, by + sy + 3.5, 0.9], [cx + sx + 5, by + sy + 6, 0.6], [cx + sx + 4, by + sy + 7.5, 0.4]], { r: [0x100808, 0x2a1a1a, 0x4a3a3a, 0x6a5a5a, 0x9a8a8a] });
  if (p.attack && !c.dead) pc.set(Math.round(cx + sx + 4), Math.round(by + sy + 9), c.acc[4], 200);
  // głowotułów z oczami
  egg(pc, cx + 4, by - 2, 5.4, 4, m);
  eye(c, cx + 6, by - 5, 1, !c.front);
  if (c.front && !c.dead) { pc.set(cx + 4, by - 5, c.acc[3]); pc.set(cx + 8, by - 4, c.acc[2]); }
  legs(m, 0, 1);
  // bliższe szczypce: ramię z łokciem, duży kleszcz z rozcięciem
  chain(pc, [[cx + 6, by - 1, 1.8], [cx + 9, by - 5, 1.7], [cx + 12 + open, by - 5, 1.8]], clawM);
  egg(pc, cx + 15.5 + open, by - 5, 4.2, 2.9, clawM, -0.1);
  bone(pc, cx + 18 + open, by - 6.5, cx + 22 + open, by - 7.5, 1.4, 0.6, clawM);
  bone(pc, cx + 18 + open, by - 3.8, cx + 21.5 + open, by - 3.5 + open, 1.1, 0.5, clawM);
  if (!p.attack) pc.line(cx + 18, by - 5, cx + 21, by - 5.5, INK);
  if (p.hurt && p.die < 3) { pc.set(cx - 6, by - 4, 0x9a1a14); pc.set(cx - 5, by - 3, 0x9a1a14); }
}

/** Pająk: wielki włochaty odwłok z ostrzegawczym znakiem, osiem długich odnóży ugiętych w kolanach, skupisko oczu, kły. */
function spiderHD(c: HdCtx): void {
  const { pc, p } = c;
  const m: Mat = { r: c.skin, fur: 0.3, noise: 0.18, seed: 5 };
  const mf: Mat = { ...m, r: c.far };
  const cx = CX - 1 + Math.sign(p.lunge) * 2, by = HG - 11 + p.bob;
  const legs = (mm: Mat, dy: number, sgn: number) => {
    for (let i = 0; i < 4; i++) {
      const ph = (i % 2 ? 1 : -1) * p.stride * sgn, lift = ph > 0 && p.anim === 'walk' ? 2 : 0;
      const raise = p.attack && i === 0 && sgn > 0;
      const hx = cx + 3, kx = cx + [10, 4, -6, -12][i] + ph * 2, ky = by - [9, 12, 12, 9][i] + dy, fx = cx + [17, 8, -10, -19][i] + ph * 2;
      if (raise) arthLeg(c, hx, by + dy, cx + 11, by - 13, cx + 19, by - 9, mm);
      else arthLeg(c, hx, by + dy, kx, ky, fx, HG - lift + dy, mm);
      // włoski na kolanach
      if (!raise) pc.set(Math.round(kx), Math.round(ky - 1.5), mm.r[0]);
    }
  };
  legs(mf, -2, -1);
  // odwłok + znak (klepsydra / czaszka w kolorze akcentu)
  const ax = cx - 8, ay = by - 3;
  egg(pc, ax, ay, 9, 7.2, m);
  const mk = (x: number, y: number, k: number) => pc.set(Math.round(ax + x), Math.round(ay + y), c.acc[k]);
  mk(-1, -3, 3); mk(0, -3, 4); mk(1, -3, 3); mk(0, -2, 3); mk(0, -1, 2); mk(-1, 0, 3); mk(0, 0, 4); mk(1, 0, 3); mk(0, 1, 2);
  mk(-4, -1, 1); mk(4, -2, 1);
  // kosmyki sierści na krawędzi odwłoka
  for (let k = 0; k < 7; k++) { const a = Math.PI * (0.9 + k * 0.17); pc.set(Math.round(ax + Math.cos(a) * 9.5), Math.round(ay + Math.sin(a) * 7.8), c.skin[0]); }
  // głowotułów
  egg(pc, cx + 3, by, 5, 4, m);
  // kły (chelicery)
  const fo = p.attack ? 1 : 0;
  bone(pc, cx + 7, by + 2, cx + 8 + fo, by + 5, 1.2, 0.7, { r: c.far, k: 0.8 });
  pc.set(cx + 8 + fo, by + 6, 0xe8dcc0);
  // skupisko oczu
  if (c.front) { eye(c, cx + 6, by - 2, 2); pc.set(cx + 4, by - 3, c.acc[3]); pc.set(cx + 5, by - 4, c.acc[2]); pc.set(cx + 8, by - 1, c.acc[3]); }
  else { pc.set(cx + 6, by - 3, c.dead ? INK : c.acc[2]); pc.set(cx + 4, by - 3, c.dead ? INK : c.acc[1]); }
  legs(m, 0, 1);
  if (p.hurt && p.die < 3) { pc.set(cx - 8, by - 4, 0x9a1a14); pc.set(cx - 7, by - 3, 0x9a1a14); }
}

/** Chrząszcz: lśniący pancerz z opalizującym połyskiem i szwem, przedplecze, róg nosorożca, czułki, sześć odnóży. */
function beetleHD(c: HdCtx): void {
  const { pc, p } = c;
  const m: Mat = { r: c.skin, gloss: 0.08, noise: 0.06, seed: 6, k: 1.15 };
  const mf: Mat = { ...m, r: c.far, gloss: 0 };
  const cx = CX - 2 + Math.sign(p.lunge) * 2, by = HG - 8 + (p.bob > 0 ? 1 : 0);
  const legs = (mm: Mat, dy: number, sgn: number) => {
    for (let i = 0; i < 3; i++) {
      const ph = (i % 2 ? 1 : -1) * p.stride * sgn, lift = ph > 0 && p.anim === 'walk' ? 2 : 0;
      const hx = cx + 5 - i * 6, out = [4, 0, -4][i];
      arthLeg(c, hx, by + 1 + dy, hx + out * 0.6 + 2, by + 1 + dy, hx + out + ph * 2, HG - lift + dy, mm, 1.6);
    }
  };
  legs(mf, -2, -1);
  // czułki
  const ant = p.anim === 'idle' ? p.i & 1 : 0;
  bone(pc, cx + 15, by - 2, cx + 19, by - 7 - ant, 0.6, 0.5, mf);
  // pokrywy skrzydeł
  egg(pc, cx - 3, by - 3, 11.5, 7.4, m);
  // opalizujący refleks w kolorze akcentu i szew pokryw
  pc.line(cx - 13, by - 3, cx + 6, by - 6, c.skin[0]);
  for (let k = 0; k < 6; k++) pc.set(cx - 9 + k * 2, by - 8 + Math.abs(k - 2.5) * 0.4, mix(c.skin[4], c.acc[3], 0.45));
  for (let k = 0; k < 4; k++) pc.set(cx - 8 + k * 3, by + 1, c.skin[1]);
  // przedplecze i głowa
  egg(pc, cx + 9, by - 2, 4.6, 4.2, m);
  egg(pc, cx + 13.5, by, 2.8, 2.4, m);
  // róg: zakrzywiony do góry, w ataku pochylony do przodu
  const hr = p.attack ? 2 : 0;
  chain(pc, [[cx + 15, by - 1, 1.4], [cx + 18 + hr, by - 5 + hr, 1.0], [cx + 18 + hr * 1.5, by - 9 + hr * 2, 0.6]], { ...m, gloss: 0.12 });
  bone(pc, cx + 16, by - 1, cx + 20, by - 5 - ant, 0.6, 0.5, m);
  eye(c, cx + 14, by - 1, 1, !c.front);
  legs(m, 0, 1);
  if (p.hurt && p.die < 3) { pc.set(cx - 3, by - 5, 0x9a1a14); pc.set(cx - 2, by - 4, 0x9a1a14); }
}

export type HdPainter = (c: HdCtx) => void;
export const HD_SPECIES = { scorpion: scorpionHD, mole: moleHD, wolf: wolfHD, boar: boarHD, spider: spiderHD, beetle: beetleHD, rat: ratHD, dog: dogHD } as const;
