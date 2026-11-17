// Proceduralne sprite'y postaci (pixel art 24x32): gracz i wrogowie z jednego "szkieletu" z paletą.
// Kolory klas z Oldgame/src/gfx/look.js (CLASS_DEFAULTS), warianty ciała/broni/głów/fryzur/dodatków z Oldgame/src/gfx/hero.js.
// Kierunki: 'f' = przodem (SE), 'b' = tyłem (NE); SW / NW uzyskujemy przez flipX.
// Animacje (jak TIMING w hero.js, w skali 24x32): idle 5 (oddech + mrugnięcie), walk 8, attack 5 (przygotowanie / zamach /
// uderzenie / dokończenie / powrót), shoot 4 (celowanie / błysk / odrzut / dym), hurt 3, die 7 (ostatnia klatka = zwłoki),
// cast 4 (sięgnięcie / uniesienie / blask / rozbłysk).
// Postawy i czynności: crouch 4 (kucnięcie, oddech, wyglądanie zza osłony), sneak 8 (skradanie: chód w przysiadzie),
// hide 2 (przypadnięcie do osłony), prone 3 (leżenie z bronią, rozglądanie się), drop 3 (padnięcie; od tyłu = wstawanie),
// hack 4 (klęk, terminal ze świecącym ekranem), pick 4 (klęk, wytrych i napinacz w zamku), heal 4 (klęk, opatrywanie).
import { PixelCanvas, type RGB, hash2, mix, pick, ramp, shade } from './Pixel';

export const UNIT_FW = 24;
export const UNIT_FH = 32;
/** Piksel w klatce, który stoi na środku pola (stopy). */
export const UNIT_FOOT_X = 12;
export const UNIT_FOOT_Y = 28;

/** Rodzaj broni w dłoni (jak weaponKind w Oldgame/src/gfx/look.js; 'none' = bez broni / pięści, 'mg' = ciężki karabin maszynowy). */
export type WeaponKind =
  | 'rifle' | 'longgun' | 'shotgun' | 'smg' | 'mg' | 'pistol' | 'laser' | 'flamer' | 'bow'
  | 'scythe' | 'machete' | 'knife' | 'sledge' | 'axe' | 'pipe' | 'none';
export const WEAPON_KINDS: readonly WeaponKind[] = [
  'rifle', 'longgun', 'shotgun', 'smg', 'mg', 'pistol', 'laser', 'flamer', 'bow', 'scythe', 'machete', 'knife', 'sledge', 'axe', 'pipe', 'none',
];
export const isGunKind = (k: WeaponKind): boolean => k in GUN_LEN || k === 'pistol' || k === 'bow';
/**
 * Nakrycie głowy / twarz. 'bare' = włosy wg hairStyle, 'mask' = maska hokejowa, 'skull' = maska-czaszka,
 * 'headband' = opaska (medyk), 'machine' = głowa robota, 'reaper' = Kostucha.
 */
export type HeadKind = 'helmet' | 'mohawk' | 'hood' | 'bare' | 'gas' | 'cap' | 'goggles' | 'mask' | 'skull' | 'headband' | 'reaper' | 'machine';
export type BodyBuild = 'light' | 'medium' | 'heavy';
/** Pochodzenie z cechami wyglądu (reszta = człowiek). */
export type AncestryLook = 'ratling' | 'ogrin' | 'vault' | 'humanoid';

export interface UnitLook {
  skin: RGB;
  cloth: RGB;
  pants: RGB;
  boots: RGB;
  accent: RGB;
  hair: RGB;
  head: HeadKind;
  weapon: WeaponKind;
  pack: RGB;
  /** Budowa ciała (domyślnie medium). */
  body?: BodyBuild;
  /** Fryzura jak w hero.js (% 6): 0 krótkie, 1 łysy, 2 irokez, 3 długie z grzywką, 4 jeżyk, 5 kucyk; 6 = kolce (psychol). */
  hairStyle?: number;
  /** Chusta na dolnej części twarzy. */
  mask?: boolean;
  /** Mutacja: narośl na barku, świecące oko. */
  mutation?: boolean;
  /** Wszczepy: metalowe ramię, implant oka. */
  cyber?: boolean;
  /** Kolor tarczy na ramieniu (brak = bez tarczy). */
  shield?: RGB;
  /** Robot: kanciasty metalowy korpus, jedno czerwone oko. */
  robot?: boolean;
  /** Kolor płaszcza (brak = bez płaszcza). */
  cloak?: RGB;
  /** Gotowy sprite postaci (iso/SpriteUnits, id rekruta): zastępuje klatki malowane kodem. */
  sprite?: string;
  /** Kolor świecących oczu (mutacja / robot / implant). */
  eye?: RGB;
  /** Przygarbiony (ghule, mutanci). */
  hunch?: boolean;
  /** Gołe ramiona (kolor skóry) i rzemień zamiast ćwieków kurtki. */
  bareArms?: boolean;
  // ---- dodatki z hero.js (outfit)
  ancestry?: AncestryLook;
  beard?: boolean;
  /** Szal na szyi (kolor); z `mask` - zasłania też twarz. */
  scarf?: RGB;
  /** Tatuaż na gołym ramieniu / piersi (kolor). */
  tattoo?: RGB;
  /** Pas z nabojami przez pierś (kolor rzemienia). */
  bandolier?: RGB;
  /** Krosty (mutant). */
  pustules?: boolean;
  /** Pazury zamiast paznokci (mutant / ghul). */
  claws?: boolean;
  /** Kolce na naramiennikach. */
  spikes?: boolean;
  /** Pancerz z opony (naramiennik + pas). */
  tire?: boolean;
  /** Łańcuchy na piersi / nadgarstku. */
  chains?: boolean;
  /** Odsłonięte żebra. */
  ribs?: boolean;
  /** Czaszki przy pasie. */
  skulls?: boolean;
  /** Łachmany: podarta koszula z dziurami. */
  rags?: boolean;
  /** Płaszcz maskujący (strzępy w odcieniach zieleni / brązu). */
  ghillie?: boolean;
  /** Ogromne, asymetryczne ramię (mutant-kolos). */
  bigArm?: boolean;
  /** Fartuch (kolor). */
  apron?: RGB;
  /** Futrzany kołnierz (kolor). */
  fur?: RGB;
  /** Szarfa przez pierś (kolor). */
  sash?: RGB;
  /** Poły płaszcza / kitla (kolor). */
  coat?: RGB;
  /** Przesunięcie wzrostu: +1 niższy (schron, szczurak), -1 wyższy (humanoid, boss). */
  height?: number;
}

export const LOOK_SOLDIER: UnitLook = {
  skin: 0xc68a62, cloth: 0x5d6a3a, pants: 0x4a4a3a, boots: 0x2a221c, accent: 0xc9a468, hair: 0x3a2414,
  head: 'helmet', weapon: 'rifle', pack: 0x4a5236,
};

export const LOOK_RAIDER: UnitLook = {
  skin: 0xa56b46, cloth: 0x6a3a2a, pants: 0x2e2a30, boots: 0x1c1612, accent: 0xb4b0a4, hair: 0xc8361e,
  head: 'mohawk', weapon: 'pipe', pack: 0x4a3424,
};

// ================================================================== animacje

export type AnimName =
  | 'idle' | 'walk' | 'attack' | 'shoot' | 'hurt' | 'die' | 'cast'
  | 'crouch' | 'sneak' | 'hide' | 'prone' | 'drop' | 'hack' | 'pick' | 'heal';
/** Czynność rękami w klęku: hakowanie terminala, wytrych, opatrywanie rany. */
export type WorkKind = '' | 'hack' | 'pick' | 'heal';
/** Ułożenie bliższego ramienia (z bronią). */
export type ArmPose = 'rest' | 'ready' | 'wind' | 'strike' | 'follow' | 'aim';

export interface Pose {
  anim: AnimName;
  i: number;
  /** Tułów w pionie (+ = w dół). */
  bob: number;
  /** Głowa względem tułowia (opóźniony oddech, odrzut głowy). */
  hbob: number;
  /** Skrót dla czworonogów: przesunięcie bliższej nogi (-2..2). */
  stride: number;
  /** Nogi: [bliższa przesunięcie, bliższa uniesienie, dalsza przesunięcie, dalsza uniesienie]. */
  legs: readonly [number, number, number, number];
  /** Pochylenie: przesunięcie tułowia / głowy względem nóg (+ = do przodu). */
  lean: number;
  /** Przesunięcie całej postaci (odrzut przy trafieniu). */
  dx: number;
  arm: ArmPose;
  /** Klatka uderzenia (bestie: ugryzienie / żądło). */
  attack: boolean;
  /** Wypad bestii (+ = do przodu). */
  lunge: number;
  hurt: boolean;
  /** 0 brak, 1 błysk wylotowy / wystrzał, 2 dym / zanikanie. */
  flash: number;
  /** 0 brak, 1 sięga do pasa, 2 unosi przedmiot, 3 blask nad głową, 4 rozbłysk. */
  cast: number;
  /** -1 żywy, 0..6 etap śmierci (6 = zwłoki). */
  die: number;
  blink: boolean;
  /** Przysiad: o ile pikseli obniżona postać (0 stoi, 1 półprzysiad, 2 skradanie, 3 pełny przysiad). */
  crouch: number;
  /** Klęk na jedno kolano (czynności). */
  kneel: boolean;
  work: WorkKind;
  /** Leżenie żywej postaci: kąt obrotu w stopniach (0 = nie leży, 90 = płasko, głowa do przodu). */
  prone: number;
}

const BASE: Pose = {
  anim: 'idle', i: 0, bob: 0, hbob: 0, stride: 0, legs: [0, 0, 0, 0], lean: 0, dx: 0, arm: 'rest',
  attack: false, lunge: 0, hurt: false, flash: 0, cast: 0, die: -1, blink: false, crouch: 0, kneel: false, work: '', prone: 0,
};

export interface AnimDef {
  poses: Pose[];
  /** Czas klatki w ms. */
  durs: number[];
  loop: boolean;
  /** Kolejność klatek (indeksy w poses); domyślnie po kolei. */
  seq?: number[];
}

function anim(name: AnimName, durs: number[], loop: boolean, f: (i: number) => Partial<Pose>, seq?: number[]): AnimDef {
  const n = seq ? Math.max(...seq) + 1 : durs.length;
  return { poses: Array.from({ length: n }, (_, i) => ({ ...BASE, anim: name, i, ...f(i) })), durs, loop, seq };
}

const WALK_LEGS: readonly (readonly [number, number, number, number])[] = [
  [2, 0, -2, 0], [1, 0, -1, 1], [0, 0, 0, 1], [-1, 0, 1, 1], [-2, 0, 2, 0], [-1, 1, 1, 0], [0, 1, 0, 0], [1, 1, -1, 0],
];

export const ANIMS: Readonly<Record<AnimName, AnimDef>> = {
  idle: anim('idle', [320, 260, 320, 260, 320, 260, 140, 260], true, (i) => ({
    bob: [0, 1, 1, 0, 1][i], hbob: [0, -1, 0, 1, 0][i], blink: i === 4,
  }), [0, 1, 2, 3, 0, 1, 4, 3]),
  walk: anim('walk', [80, 80, 80, 80, 80, 80, 80, 80], true, (i) => ({
    legs: WALK_LEGS[i], stride: WALK_LEGS[i][0], bob: [0, 1, 0, -1, 0, 1, 0, -1][i],
  })),
  attack: anim('attack', [70, 100, 60, 100, 120], false, (i) => ({
    arm: (['ready', 'wind', 'strike', 'follow', 'ready'] as const)[i],
    lean: [0, -1, 1, 1, 0][i], bob: [0, 0, 0, 1, 0][i], hbob: [0, 0, 0, 0, 0][i],
    legs: ([[1, 0, -1, 0], [1, 0, -1, 0], [2, 0, -1, 0], [2, 0, -1, 0], [1, 0, -1, 0]] as const)[i],
    stride: [0, -1, 1, 1, 0][i], attack: i === 2 || i === 3, lunge: [-1, -2, 2, 2, 1][i],
  })),
  shoot: anim('shoot', [90, 60, 80, 150], false, (i) => ({
    arm: 'aim', flash: [0, 1, 2, 0][i], lean: [0, 0, -1, 0][i], attack: i === 1 || i === 2,
    legs: [1, 0, -1, 0], lunge: [0, 0, -1, 0][i],
  })),
  hurt: anim('hurt', [70, 100, 120], false, (i) => ({
    dx: [-1, -1, 0][i], lean: [-1, -1, 0][i], hbob: [1, 0, 0][i], hurt: i < 2, lunge: [-2, -1, 0][i], bob: [0, 1, 0][i],
  })),
  die: anim('die', [70, 90, 90, 70, 100, 140, 240], false, (i) => ({ die: i, hurt: true, lunge: -1 })),
  cast: anim('cast', [90, 100, 140, 170], false, (i) => ({ cast: i + 1, hbob: [0, 0, -1, 0][i], bob: [1, 0, 0, 0][i] })),
  // ---- postawy
  crouch: anim('crouch', [420, 360, 420, 300, 520], true, (i) => ({
    crouch: 3, arm: 'ready', hbob: [0, 1, 0, -1][i], lean: [0, 0, 0, 1][i], blink: i === 2,
  }), [0, 1, 0, 1, 3]),
  sneak: anim('sneak', [115, 115, 115, 115, 115, 115, 115, 115], true, (i) => {
    const l = WALK_LEGS[i];
    const legs = [Math.sign(l[0]) * Math.min(1, Math.abs(l[0])), l[1], Math.sign(l[2]) * Math.min(1, Math.abs(l[2])), l[3]] as const;
    return { crouch: 2, lean: 1, arm: 'ready', legs, stride: legs[0], hbob: [0, 0, 1, 0, 0, 0, 1, 0][i] };
  }),
  hide: anim('hide', [80, 130], false, (i) => ({ crouch: [1, 3][i], lean: [-1, 0][i], hbob: [0, 1][i], arm: 'ready' })),
  prone: anim('prone', [520, 420, 640], true, (i) => ({ prone: [86, 86, 80][i], blink: i === 1 })),
  drop: anim('drop', [90, 90, 110], false, (i) => (i === 0 ? { kneel: true, lean: 1, arm: 'ready' } : { prone: [0, 45, 78][i] })),
  // ---- czynności (klęk)
  hack: anim('hack', [170, 120, 170, 230], true, (i) => ({ kneel: true, work: 'hack', hbob: [0, 0, 1, 0][i], lean: 1 })),
  pick: anim('pick', [150, 190, 130, 240], true, (i) => ({ kneel: true, work: 'pick', hbob: [1, 1, 1, 0][i], lean: 1 })),
  heal: anim('heal', [180, 160, 190, 220], true, (i) => ({ kneel: true, work: 'heal', hbob: [1, 1, 0, 1][i], lean: 1, bob: [0, 0, 0, 0][i] })),
};
/** Animacje wspólne dla wszystkich arkuszy (także bestii). */
export const BASE_ANIMS: readonly AnimName[] = ['idle', 'walk', 'attack', 'shoot', 'hurt', 'die', 'cast'];
/** Komplet animacji postaci humanoidalnej. */
export const ANIM_ORDER: readonly AnimName[] = [...BASE_ANIMS, 'crouch', 'sneak', 'hide', 'prone', 'drop', 'hack', 'pick', 'heal'];

/** Wszystkie klatki: { nazwa ('idle0', 'die6', ...) -> poza }. */
export const POSES: Readonly<Record<string, Pose>> = Object.fromEntries(
  ANIM_ORDER.flatMap((a) => ANIMS[a].poses.map((p) => [`${a}${p.i}`, p] as const)),
);
const framesOf = (anims: readonly AnimName[]): string[] => anims.flatMap((a) => ANIMS[a].poses.map((p) => `${a}${p.i}`));
export const UNIT_FRAMES = framesOf(ANIM_ORDER);
/** Klatek w wierszu arkusza (arkusz zawija się w bloki, żeby tekstura HiRes nie była zbyt szeroka). */
const SHEET_COLS = 17;
/** Klatka "leżący" (powalony, przed kałużą) i "zwłoki". */
export const FRAME_DOWN = 'die4';
export const FRAME_CORPSE = 'die6';
/** Aliasy dla starszego kodu ('f_attack' / 'f_hurt'). */
const FRAME_ALIASES: Record<string, string> = { attack: 'attack2', hurt: 'hurt0' };

export interface UnitSheet {
  pc: PixelCanvas;
  frames: { name: string; x: number; y: number; w: number; h: number }[];
  /** Pikseli płótna na piksel projektowy (sprite'y z obrazów: 2); brak = 1. */
  density?: number;
}

/**
 * Składa arkusz 'f_idle0' ... 'b_heal3' z klatek 24x32 rysowanych osobno (przycięte do klatki, obrys per klatka).
 * Klatki idą w blokach po SHEET_COLS: w każdym bloku wiersz przodem, potem tyłem. `post` maluje po obrysie
 * (kałuże, iskry, dym - bez czarnej obwódki). `anims` = które animacje malować (bestie: tylko BASE_ANIMS).
 * `density` > 1: klatki 24x32 projektowych malowane w gęstszej siatce (np. 2 = 48x64 px, bestie HD).
 */
export function buildUnitSheet(
  draw: (pc: PixelCanvas, front: boolean, pose: Pose) => void,
  post?: (pc: PixelCanvas, front: boolean, pose: Pose) => void,
  anims: readonly AnimName[] = ANIM_ORDER,
  density = 1,
): UnitSheet {
  const names = framesOf(anims);
  const cols = Math.min(SHEET_COLS, names.length);
  const blocks = Math.ceil(names.length / cols);
  const FW = UNIT_FW * density, FH = UNIT_FH * density;
  const pc = new PixelCanvas(FW * cols, FH * 2 * blocks);
  const frames: UnitSheet['frames'] = [];
  const at = (i: number, row: number) => ({ x: (i % cols) * FW, y: (Math.floor(i / cols) * 2 + row) * FH });
  (['f', 'b'] as const).forEach((facing, row) => {
    names.forEach((name, i) => {
      const pose = POSES[name];
      const fpc = new PixelCanvas(FW, FH);
      draw(fpc, facing === 'f', pose);
      fpc.outline(0.32, 0x0e080c);
      post?.(fpc, facing === 'f', pose);
      const { x, y } = at(i, row);
      for (let yy = 0; yy < FH; yy++) pc.data.set(fpc.data.subarray(yy * FW * 4, (yy + 1) * FW * 4), ((y + yy) * pc.w + x) * 4);
      frames.push({ name: `${facing}_${name}`, x, y, w: FW, h: FH });
    });
    for (const [alias, src] of Object.entries(FRAME_ALIASES)) {
      const { x, y } = at(names.indexOf(src), row);
      frames.push({ name: `${facing}_${alias}`, x, y, w: FW, h: FH });
    }
  });
  return density === 1 ? { pc, frames } : { pc, frames, density };
}

// ================================================================== pomocnicze

/** Prostokąt cieniowany jak bryła oświetlona z lewej-góry. */
function part(pc: PixelCanvas, x: number, y: number, w: number, h: number, r: readonly RGB[], base = 0.5, seed = 0): void {
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      let L = base + (hash2(x + xx, y + yy, seed) - 0.5) * 0.12;
      if (xx === 0 && w > 1) L += 0.22;
      if (xx === w - 1 && w > 1) L -= 0.24;
      if (yy === 0) L += 0.12;
      pc.set(x + xx, y + yy, pick(r, L, x + xx, y + yy));
    }
}

/** Kończyna o grubości w (linia z cieniowaniem: lewa / górna krawędź jaśniejsza). */
function limb(pc: PixelCanvas, x0: number, y0: number, x1: number, y1: number, w: number, r: readonly RGB[], base = 0.5): void {
  const vertical = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
  for (let k = 0; k < w; k++) {
    const L = base + (w > 1 ? (k === 0 ? 0.2 : k === w - 1 ? -0.2 : 0) : 0);
    const ox = vertical ? k : 0, oy = vertical ? 0 : k;
    pc.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, (x, y) => pick(r, L, x, y));
  }
}

/** Maluje tylko na przezroczystych pikselach (kałuża pod ciałem). */
function under(pc: PixelCanvas, x: number, y: number, c: RGB, a = 255): void {
  if (pc.alpha(x, y) === 0) pc.set(x, y, c, a);
}

const INK = 0x1a1012;
const FLASH = [0xfff0a0, 0xffe070, 0xff9a2a] as const;
const BRASS = 0xc8a048;
const BLOOD = [0x3a0808, 0x5a0e0c, 0x7a1812, 0x9a2a1c] as const;
const D2R = Math.PI / 180;

interface Ctx {
  pc: PixelCanvas;
  look: UnitLook;
  front: boolean;
  pose: Pose;
  /** x w klatce dla tułowia / głowy / ramion (z pochyleniem i odrzutem). */
  X: (x: number) => number;
  /** x broni: współrzędne zapisane dla budowy medium, przesunięte do dłoni danej budowy. */
  W: (x: number) => number;
  ty: number;
  tx: number;
  tw: number;
  aw: number;
  /** y przedniej dłoni w spoczynku. */
  fhY: number;
  P: Record<'skin' | 'cloth' | 'pants' | 'boots' | 'accent' | 'hair' | 'pack' | 'metal' | 'steel' | 'wood' | 'chrome' | 'rust' | 'bone' | 'mut' | 'cloak' | 'lea', RGB[]>;
}

// ================================================================== broń palna

const GUN_LEN: Partial<Record<WeaponKind, number>> = { rifle: 9, smg: 6, mg: 10, longgun: 12, shotgun: 8, laser: 9, flamer: 8 };

function drawGun(c: Ctx, kind: WeaponKind, len: number): void {
  const { pc, W, ty, P, pose, front } = c;
  const body = kind === 'laser' ? P.chrome : kind === 'flamer' ? ramp(0x4a4038, 5, 0.4) : P.metal;
  const barrel = (x0: number, y0: number, x1: number, y1: number) => {
    pc.line(W(x0), y0, W(x1), y1, body[1]);
    pc.line(W(x0), y0 - 1, W(x1), y1 - 1, body[3]);
    if (kind === 'shotgun' || kind === 'mg') pc.line(W(x0), y0 + 1, W(x1 - 2), y1 + 1, body[0]);
  };
  const stock = (x0: number, y0: number, x1: number, y1: number) => {
    const col = kind === 'smg' || kind === 'laser' || kind === 'mg' ? P.metal[2] : kind === 'flamer' ? 0x2a2420 : kind === 'longgun' ? P.wood[1] : P.wood[2];
    pc.line(W(kind === 'smg' ? x0 + 2 : x0), y0, W(x1), y1, col);
    if (kind === 'longgun' || kind === 'rifle') pc.line(W(x0), y0 + 1, W(x0 + 2), y0 + 1, P.wood[1]);
  };
  const aimed = pose.arm === 'aim' || pose.arm === 'strike' || pose.arm === 'follow' || pose.arm === 'ready';
  if (aimed) {
    const y = ty + 1, x1 = 10 + len + 1;
    barrel(10, y, x1, y);
    stock(7, y + 1, 11, y + 1);
    if (kind === 'shotgun') pc.line(W(13), y + 1, W(15), y + 1, P.wood[3]);
    if (kind === 'longgun') {
      // luneta: tuba z obiektywem i oczkiem
      pc.line(W(11), y - 3, W(15), y - 3, 0x22282c); pc.line(W(11), y - 2, W(15), y - 2, 0x3a4248);
      pc.set(W(16), y - 3, 0x9ad8ff); pc.set(W(13), y - 2, P.metal[1]);
    }
    if (kind === 'mg') {
      // skrzynka z amunicją, perforowana osłona lufy, dwójnóg
      part(pc, W(11), y + 1, 3, 3, ramp(0x4a5232, 5, 0.38), 0.5, 4);
      for (let x = 15; x <= x1 - 2; x += 2) pc.set(W(x), y - 1, P.metal[0]);
      pc.set(W(x1 - 2), y + 1, P.metal[2]); pc.set(W(x1 - 3), y + 2, P.metal[1]);
      pc.set(W(10), y + 2, BRASS); pc.set(W(9), y + 3, BRASS); pc.set(W(10), y + 4, shade(BRASS, 0.7));
    }
    if (kind === 'laser') pc.line(W(13), y - 1, W(16), y - 1, P.accent[4]);
    const fx = W(x1 + 1);
    if (pose.flash === 1) {
      if (kind === 'laser') {
        for (let x = fx; x < UNIT_FW; x++) { pc.set(x, y - 1, 0xffffff); pc.set(x, y - 2, P.accent[4], 170); pc.set(x, y, P.accent[4], 170); }
      } else if (kind === 'flamer') {
        const fl = [0xfff6c0, 0xffd860, 0xff9a2a, 0xff6a1a, 0xc8361e, 0x8a2a1a];
        for (let i = 0; i < 8; i++) {
          const spread = Math.floor(i / 2);
          for (let s = -spread; s <= spread; s++) pc.set(fx + i, y - 1 + s, fl[Math.min(5, Math.abs(s) + Math.floor(i / 2))], i > 5 ? 190 : 255);
        }
      } else {
        pc.set(fx, y - 1, 0xffffff); pc.set(fx, y, FLASH[1]); pc.set(fx + 1, y - 1, FLASH[0]); pc.set(fx, y - 2, FLASH[2]); pc.set(fx + 2, y - 1, FLASH[2]);
        if (kind !== 'smg') { pc.set(fx + 1, y - 2, FLASH[1]); pc.set(fx + 1, y, FLASH[2]); pc.set(fx + 3, y - 1, FLASH[2], 170); }
        if (kind === 'shotgun' || kind === 'mg') { pc.set(fx + 2, y - 3, FLASH[2], 150); pc.set(fx + 2, y + 1, FLASH[2], 150); }
      }
    } else if (pose.flash === 2) {
      if (kind === 'laser') { pc.set(fx, y - 1, P.accent[4]); pc.set(fx + 1, y - 1, P.accent[3], 140); }
      else if (kind === 'flamer') {
        const fl = [0xffd860, 0xff9a2a, 0xff6a1a, 0xc8361e];
        for (let i = 0; i < 5; i++) for (let s = -(i >> 1); s <= i >> 1; s++) pc.set(fx + i, y - 1 + s - (i > 2 ? 1 : 0), fl[Math.min(3, Math.abs(s) + (i >> 1))], 220);
      } else {
        pc.set(fx, y - 1, FLASH[2]); pc.set(fx + 1, y - 2, 0xb8b0a4, 150); pc.set(fx + 2, y - 3, 0xa8a094, 110);
        pc.set(W(12), y - 3, BRASS); pc.set(W(11), y - 4, shade(BRASS, 0.7)); // łuska
      }
    } else if (pose.anim === 'shoot' && pose.i === 3 && kind !== 'laser' && kind !== 'flamer') {
      pc.set(fx, y - 2, 0xa8a094, 120); pc.set(fx + 1, y - 3, 0x989084, 90); pc.set(fx, y - 4, 0x989084, 70);
    }
  } else if (front) {
    const x1 = 12 + len - 1, y1 = ty + 3 + Math.round((len - 1) * 0.37);
    barrel(12, ty + 3, x1, y1);
    stock(8, ty + 1, 12, ty + 3);
    if (kind === 'shotgun') pc.set(W(15), ty + 4, P.wood[3]);
    if (kind === 'laser') pc.set(W(14), ty + 2, P.accent[4]);
    if (kind === 'flamer') pc.set(W(x1 + 1), y1, 0x5ab0ff);
    if (kind === 'longgun') { pc.line(W(12), ty + 1, W(15), ty + 2, 0x22282c); pc.set(W(16), ty + 2, 0x9ad8ff); }
    if (kind === 'mg') { part(pc, W(13), ty + 5, 3, 2, ramp(0x4a5232, 5, 0.38), 0.5, 4); pc.set(W(12), ty + 6, BRASS); pc.set(W(12), ty + 7, BRASS); }
  } else {
    const r = Math.round(len * 0.6);
    barrel(14, ty + 3, 14 + r, ty + 3 - r);
    if (kind === 'laser') pc.set(W(15 + (r >> 1)), ty + 2 - (r >> 1), P.accent[4]);
    if (kind === 'longgun') pc.line(W(15), ty + 1, W(17), ty - 1, 0x22282c);
  }
}

// ================================================================== broń biała (rysowana pod kątem od dłoni)

/**
 * Broń biała z chwytem w (gx, gy), skierowana pod kątem `ang` (0 = w prawo, -90 = w górę).
 * o > 0 = krawędź prowadząca (dół, gdy broń poziomo; przód, gdy uniesiona) - tam ostrze siekiery / kosy.
 */
function drawMelee(c: Ctx, kind: WeaponKind, gx: number, gy: number, ang: number): void {
  const { pc, P } = c;
  const ca = Math.cos(ang * D2R), sa = Math.sin(ang * D2R);
  const T = (a: number, o: number): [number, number] => [Math.round(gx + a * ca - o * sa), Math.round(gy + a * sa + o * ca)];
  const seg = (a0: number, o0: number, a1: number, o1: number, col: RGB) => { const p = T(a0, o0), q = T(a1, o1); pc.line(p[0], p[1], q[0], q[1], col); };
  const dot = (a: number, o: number, col: RGB, al = 255) => { const p = T(a, o); pc.set(p[0], p[1], col, al); };
  switch (kind) {
    case 'knife':
      seg(-2, 0, 0, 0, P.wood[1]); dot(0, -1, P.metal[2]); dot(0, 1, P.metal[2]);
      seg(1, 0, 4, 0, P.steel[3]); dot(4, 0, P.steel[4]); dot(2, 1, P.steel[1]);
      break;
    case 'machete':
      seg(-2, 0, 0, 0, P.wood[1]); dot(0, -1, P.metal[1]); dot(0, 1, P.metal[1]);
      seg(1, 0, 7, 0, P.steel[3]); seg(1, 1, 7, 1, P.steel[2]); dot(8, 0, P.steel[4]); dot(8, 1, P.steel[3]); dot(4, 0, 0xffffff, 150);
      break;
    case 'pipe':
      seg(-2, 0, 0, 0, 0x2a2018); seg(1, 0, 9, 0, P.rust[2]); seg(5, 1, 9, 1, P.rust[1]); dot(10, 0, P.rust[3]);
      dot(6, -1, P.steel[4]); dot(8, -1, P.steel[4]); dot(7, 2, P.steel[3]); dot(9, 2, P.steel[3]);
      break;
    case 'axe':
      seg(-3, 0, 10, 0, P.wood[2]); seg(-3, 0, -1, 0, P.wood[0]);
      seg(7, 1, 10, 1, P.steel[1]); seg(7, 2, 10, 2, P.steel[2]); seg(7, 3, 10, 3, P.steel[3]); seg(8, 4, 9, 4, P.steel[4]);
      dot(8, -1, P.metal[1]); dot(9, -1, P.metal[2]);
      break;
    case 'sledge':
      seg(-3, 0, 9, 0, P.wood[2]); seg(-3, 0, -1, 0, P.wood[0]);
      for (let o = -2; o <= 2; o++) seg(9, o, 12, o, P.metal[o === -2 ? 4 : o === 2 ? 0 : 2 - (o > 0 ? 1 : 0)]);
      dot(9, -2, P.metal[3]); dot(12, 2, INK);
      break;
    case 'scythe':
      seg(-9, 0, 11, 0, P.wood[1]); seg(-9, 0, -6, 0, 0x5a1410); dot(11, 0, P.metal[2]);
      for (let k = 0; k <= 7; k++) {
        const a = 11 - k * k * 0.09, o = 1 + k;
        dot(a, o, k < 1 ? P.metal[1] : P.steel[3]);
        dot(a - 1, o, k < 2 ? P.metal[1] : P.steel[1]);
        if (k > 1 && k < 7) dot(a + 0.6, o, 0xf4f8fa, 200);
      }
      break;
    default:
      break;
  }
}

/** Kąt broni białej dla danego ułożenia ramienia. */
function meleeAngle(kind: WeaponKind, arm: ArmPose): number {
  if (kind === 'knife') return ({ rest: -60, ready: -20, wind: -10, strike: 0, follow: 15, aim: 0 } as const)[arm];
  const heavy = kind === 'sledge' || kind === 'axe';
  return ({ rest: -80, ready: -110, wind: heavy ? -170 : -150, strike: heavy ? 15 : -10, follow: heavy ? 75 : 55, aim: -10 } as const)[arm];
}

/** Smuga zamachu (za postacią). */
function drawSmear(c: Ctx, sx: number, sy: number, r: number, a0: number, a1: number): void {
  for (let a = a0; a <= a1; a += 4) {
    const t = (a - a0) / (a1 - a0);
    for (let k = 0; k <= Math.round(t * 2); k++) {
      const rr = r - k;
      c.pc.set(Math.round(sx + Math.cos(a * D2R) * rr), Math.round(sy + Math.sin(a * D2R) * rr), k === 0 ? 0xfff8e0 : 0xd8d0b8, k === 0 ? 200 : 120);
    }
  }
}

function drawBow(c: Ctx): void {
  const { pc, W, ty, fhY, P, pose, front } = c;
  const set = (x: number, y: number, col: RGB, a = 255) => pc.set(W(x), y, col, a);
  const line = (x0: number, y0: number, x1: number, y1: number, col: RGB) => pc.line(W(x0), y0, W(x1), y1, col);
  const string = 0xd8d0b8;
  if (pose.arm === 'aim') {
    set(20, ty - 5, P.wood[2]); line(21, ty - 4, 21, ty + 4, P.wood[3]); set(20, ty + 5, P.wood[2]);
    if (pose.flash === 0) {
      line(20, ty - 5, 15, ty, string); line(15, ty, 20, ty + 5, string);
      line(15, ty, 22, ty, P.wood[1]); set(23, ty, P.steel[4]); set(15, ty - 1, P.accent[3]);
    } else {
      line(20, ty - 5, 20 - (pose.flash === 1 ? 0 : 1), ty, string); line(20 - (pose.flash === 1 ? 0 : 1), ty, 20, ty + 5, string);
      if (pose.flash === 1) for (let x = 22; x < 24; x++) set(x, ty, 0xffffff, 160);
    }
  } else if (front) {
    const hy = pose.arm === 'rest' ? fhY : ty + 2;
    line(17, hy - 8, 17, hy + 2, string);
    set(17, hy - 8, P.wood[2]); set(18, hy - 7, P.wood[3]); line(19, hy - 6, 19, hy, P.wood[3]); set(18, hy + 1, P.wood[2]); set(17, hy + 2, P.wood[2]);
  } else {
    pc.line(c.X(8), ty - 2, c.X(15), ty + 6, P.wood[3]);
    pc.line(c.X(9), ty - 2, c.X(15), ty + 5, string);
  }
}

/** Broń w dłoni (hx, hy) dla bieżącej pozy. */
function drawWeapon(c: Ctx, hx: number, hy: number): void {
  const { pc, look, W, ty, fhY, P, pose, front } = c;
  const kind = look.weapon;
  const len = GUN_LEN[kind];
  if (len) { drawGun(c, kind, len); return; }
  if (kind === 'bow') { drawBow(c); return; }
  if (kind === 'none') return;
  if (kind === 'pistol') {
    const set = (x: number, y: number, col: RGB, a = 255) => pc.set(W(x), y, col, a);
    if (pose.arm !== 'rest' && pose.arm !== 'wind') {
      set(20, ty - 1, P.metal[3]); set(21, ty - 1, P.metal[3]); set(20, ty, P.metal[1]); set(21, ty, P.metal[0]);
      if (pose.flash === 1) { set(22, ty - 1, 0xffffff); set(23, ty - 1, FLASH[2]); set(22, ty - 2, FLASH[2]); set(22, ty, FLASH[1]); }
      else if (pose.flash === 2) { set(22, ty - 2, 0xb8b0a4, 150); set(23, ty - 3, 0xa8a094, 110); set(19, ty - 3, BRASS); }
    } else if (front) {
      set(17, fhY, P.metal[3]); set(18, fhY, P.metal[2]); set(17, fhY + 1, P.metal[0]);
    } else {
      set(15, ty + 6, P.metal[1]); set(15, ty + 7, P.wood[1]);
    }
    return;
  }
  if (kind === 'scythe' && pose.arm === 'rest') {
    const set = (x: number, y: number, col: RGB) => pc.set(W(x), y, col);
    const line = (x0: number, y0: number, x1: number, y1: number, col: RGB) => pc.line(W(x0), y0, W(x1), y1, col);
    line(17, fhY + 3, 17, 2, P.wood[1]); line(18, fhY + 3, 18, 2, P.wood[3]);
    line(17, 1, 13, 1, P.steel[4]); line(13, 1, 10, 2, P.steel[3]); line(10, 2, 8, 5, P.steel[3]);
    line(16, 2, 13, 2, P.steel[1]); line(12, 3, 10, 4, P.steel[1]);
    set(18, 1, P.metal[2]);
    return;
  }
  if (!front && pose.arm === 'rest') {
    // tyłem: broń uniesiona za barkiem
    drawMelee(c, kind, hx, hy, kind === 'knife' ? -70 : -95);
    return;
  }
  drawMelee(c, kind, hx, hy, meleeAngle(kind, pose.arm));
}

// ================================================================== głowa

function drawHair(c: Ctx, style: number, hx: number, hy: number): void {
  const { pc, front, P, look } = c;
  const set = (x: number, y: number, L: number) => pc.set(c.X(x + hx), y, pick(P.hair, L, c.X(x + hx), y));
  if (style === 1) {
    // łysy: połysk
    if (front) pc.set(c.X(11 + hx), hy, P.skin[4]);
    else { for (let x = 10; x < 14; x++) pc.set(c.X(x + hx), hy, P.skin[3]); pc.set(c.X(11 + hx), hy, P.skin[4]); }
    return;
  }
  if (style === 4) {
    // jeżyk: cienka, ciemna warstwa
    for (let x = 10; x <= 13; x++) set(x, hy - 1, 0.42);
    for (let x = 9; x <= 14; x++) if (front ? x < 14 : true) set(x, hy, 0.3 + ((x + hy) & 1) * 0.1);
    if (!front) for (let x = 9; x <= 14; x++) set(x, hy + 1, 0.26);
    return;
  }
  if (style === 2) {
    // irokez: grzebień (kolor dodatku u szabrowników, inaczej włosów)
    const crest = ramp(look.hair, 5, 0.42);
    for (let y = -4; y < 1; y++) for (const x of [11, 12]) pc.set(c.X(x + hx), hy + y, pick(crest, x === 11 ? 0.72 : 0.42, c.X(x + hx), hy + y));
    pc.set(c.X(11 + hx), hy - 5, crest[4]);
    pc.set(c.X((front ? 13 : 10) + hx), hy - 2, crest[2]);
    return;
  }
  if (style === 6) {
    // kolce
    for (let x = 9; x <= 14; x++) set(x, hy, 0.48 - (x - 9) * 0.05);
    for (const [x, y] of [[9, -2], [11, -3], [13, -3], [15, -1], [10, -1], [12, -1], [14, -1]] as const) set(x, hy + y, 0.7 - x * 0.02);
    return;
  }
  // 0 krótkie, 3 długie z grzywką, 5 kucyk
  if (front) {
    for (let x = 10; x <= 13; x++) set(x, hy - 1, 0.62 - (x - 10) * 0.06);
    for (let x = 9; x <= 14; x++) set(x, hy, 0.5 - (x - 9) * 0.05);
    set(9, hy + 1, 0.4); set(9, hy + 2, 0.34);
    if (style === 3) {
      for (let y = hy; y <= hy + 7; y++) { set(8, y, 0.3); set(9, y, 0.42); }
      set(7, hy + 5, 0.24); set(7, hy + 6, 0.24);
      set(13, hy + 1, 0.5); set(14, hy + 1, 0.36); set(12, hy + 1, 0.58); // grzywka
      set(11, hy - 2, 0.75);
    }
    if (style === 5) {
      set(8, hy + 1, 0.4); pc.set(c.X(8 + hx), hy + 2, c.P.accent[3]);
      set(7, hy + 3, 0.36); set(7, hy + 4, 0.3); set(6, hy + 5, 0.26); set(7, hy + 5, 0.3);
    }
  } else {
    for (let y = -1; y < 5; y++) for (let x = 0; x < 6; x++) if ((x > 0 && x < 5) || (y >= 0 && y < 3)) set(9 + x, hy + y, 0.48 - x * 0.04);
    if (style === 3) for (let y = hy + 5; y <= hy + 8; y++) for (let x = 9; x <= 14; x++) if (y < hy + 8 || (x > 9 && x < 14)) set(x, y, 0.4 - (x - 9) * 0.04 + ((x + y) % 3 === 0 ? 0.1 : 0));
    if (style === 5) { pc.set(c.X(11 + hx), hy + 5, c.P.accent[3]); set(11, hy + 6, 0.4); set(12, hy + 6, 0.34); set(11, hy + 7, 0.34); set(12, hy + 8, 0.3); }
  }
}

function drawHead(c: Ctx, hx: number, hy: number): void {
  const { pc, look, front, pose, P } = c;
  const X = (x: number) => c.X(x + hx);
  const set = (x: number, y: number, col: RGB, a = 255) => pc.set(X(x), y, col, a);
  const eyeGlow = look.eye ?? (look.mutation ? 0xb8ff4a : 0xff3a2a);
  const dead = pose.die >= 3;
  const eyesShut = pose.blink || dead || (pose.hurt && pose.i === 0 && pose.anim === 'hurt');
  const anc = look.ancestry;

  if (look.head === 'machine') {
    const box = P.chrome;
    part(pc, X(8), hy - 1, 8, 7, box, 0.55, 13);
    for (let x = 8; x < 16; x++) set(x, hy - 1, box[4]);
    set(9, hy - 3, P.metal[1]); set(9, hy - 2, P.metal[2]); set(9, hy - 4, dead ? P.metal[1] : look.accent);
    const eye = dead ? 0x3a1410 : eyeGlow;
    if (front) {
      for (let x = 10; x < 16; x++) set(x, hy + 2, 0x141010);
      set(13, hy + 2, eye); set(14, hy + 2, shade(eye, 0.6)); set(12, hy + 2, shade(eye, 0.35));
      set(11, hy + 4, INK); set(13, hy + 4, INK); set(15, hy + 4, INK);
    } else {
      for (const y of [hy + 1, hy + 3]) for (let x = 10; x < 14; x++) set(x, y, box[0]);
    }
    return;
  }

  // ---- za głową: długie włosy / kucyk / szpic kaptura (rysowane przez drawHair)
  // ---- uszy szczuraka (za czaszką, duże i okrągłe)
  if (anc === 'ratling') {
    const inner = mix(look.skin, 0xe89a9a, 0.5);
    for (const [ex, ey] of front ? [[9, hy - 2], [13, hy - 3]] as const : [[9, hy - 3], [13, hy - 2]] as const) {
      pc.ellipse(X(ex) + 0.5, ey + 0.5, 1.9, 1.9, (x, y) => pick(P.skin, 0.62 - (x - X(ex)) * 0.1, x, y));
      set(ex, ey, front ? inner : P.skin[1]);
    }
  }

  // szyja + twarz
  set(11, hy + 6, P.skin[1]);
  set(12, hy + 6, P.skin[1]);
  part(pc, X(9), hy, 6, 6, P.skin, 0.55, 11);
  if (anc === 'ogrin') {
    // szeroka żuchwa, wał brwiowy, kły
    part(pc, X(9), hy + 4, 7, 2, P.skin, 0.45, 12);
    if (front) {
      for (let x = 11; x <= 15; x++) set(x, hy + 2, P.skin[1]);
      set(12, hy + 5, P.bone[4]); set(15, hy + 5, P.bone[3]); set(12, hy + 4, P.bone[3]);
    }
  }
  if (front) {
    const eyeY = hy + 3;
    if (eyesShut) { set(12, eyeY, P.skin[1]); set(14, eyeY, P.skin[1]); }
    else {
      const ec = anc === 'humanoid' ? 0x6ad0f0 : look.ghillie || look.rags ? eyeGlow : INK;
      set(12, eyeY, ec); set(14, eyeY, ec);
      if (look.rags) { set(12, eyeY - 1, shade(eyeGlow, 0.5), 160); set(14, eyeY - 1, shade(eyeGlow, 0.5), 160); }
    }
    if (pose.hurt && !dead) { set(13, hy + 5, 0x5a1010); set(14, hy + 5, 0x9a1a14); }
    if (anc === 'ratling') {
      // ryjek z noskiem i wąsikami
      set(15, hy + 3, P.skin[2]); set(15, hy + 4, P.skin[1]); set(16, hy + 4, 0xc07070); set(16, hy + 3, P.skin[2]);
      set(16, hy + 5, 0xd8d0c0, 170); set(17, hy + 3, 0xd8d0c0, 140);
    }
    if (anc === 'humanoid') {
      // spiczaste, długie ucho
      set(9, hy + 2, P.skin[3]); set(8, hy + 1, P.skin[3]); set(7, hy, P.skin[2]);
    }
  } else {
    set(9, hy + 3, P.skin[2]); // ucho
    if (anc === 'humanoid') { set(8, hy + 2, P.skin[3]); set(7, hy + 1, P.skin[2]); set(15, hy + 2, P.skin[1]); set(16, hy + 1, P.skin[1]); }
  }

  // broda (przed nakryciem twarzy)
  if (look.beard && front) {
    const bd = ramp(look.hair, 5, 0.36);
    for (let y = hy + 4; y <= hy + 6; y++) for (let x = 10; x <= 14; x++) {
      if (y === hy + 6 && (x === 10 || x === 14)) continue;
      if (y === hy + 4 && x >= 12 && x <= 13) continue; // usta
      set(x, y, pick(bd, 0.55 - (x - 10) * 0.07, X(x), y));
    }
    set(9, hy + 3, bd[1]); set(9, hy + 4, bd[1]);
  }

  const style = look.hairStyle === 6 ? 6 : (look.hairStyle ?? 0) % 6;
  switch (look.head) {
    case 'helmet': {
      if (!front) drawHair(c, 0, hx, hy);
      const helm = ramp(look.cloth, 5, 0.44);
      const rows: [number, number][] = [[10, 13], [9, 14], [8, 15], [8, 15]];
      rows.forEach(([a, b], i) => { for (let x = a; x <= b; x++) set(x, hy - 3 + i, pick(helm, 0.65 - ((x - a) / (b - a)) * 0.4 + (i === 0 ? 0.15 : 0), X(x), hy - 3 + i)); });
      for (let x = 7; x <= 16; x++) set(x, hy + 1, pick(helm, x < 10 ? 0.45 : 0.25, X(x), hy + 1));
      set(10, hy - 2, P.accent[3]);
      if (front) { set(13, hy + 2, INK); set(14, hy + 2, P.accent[3]); }
      break;
    }
    case 'mohawk': {
      if (!front) for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) if (x > 0 || y < 3) set(9 + x, hy + y, pick(P.skin, 0.4 - x * 0.04, X(9 + x), hy + y));
      for (let y = -4; y < 1; y++) for (const x of [11, 12]) set(x, hy + y, pick(P.hair, x === 11 ? 0.7 : 0.4, X(x), hy + y));
      set(11, hy - 5, P.hair[4]);
      if (front && !look.mask && !look.beard) { pc.line(X(10), hy + 2, X(15), hy + 2, 0x2a2420); set(12, hy + 2, P.accent[4]); set(14, hy + 2, P.accent[4]); }
      break;
    }
    case 'hood': {
      const hood = look.ghillie ? ramp(0x4a5230, 5, 0.42) : ramp(shade(look.cloak ?? look.cloth, 0.85), 5, 0.42);
      for (let y = hy - 2; y <= hy + 6; y++)
        for (let x = 8; x <= 15; x++) {
          const top = y === hy - 2 ? x >= 10 && x <= 13 : y === hy - 1 ? x >= 9 && x <= 14 : y === hy ? x <= 15 : false;
          const side = front ? x <= 10 && y <= hy + 5 && y > hy : (x >= 9 && x <= 14 && y <= hy + 4) || ((x === 8 || x === 15) && y >= hy && y <= hy + 3);
          if (top || side) set(x, y, pick(hood, 0.62 - (x - 8) * 0.05 - (y - hy) * 0.02 + (look.ghillie && hash2(x, y, 3) < 0.3 ? -0.2 : 0), X(x), y));
        }
      if (front) set(15, hy + 1, hood[1]);
      else for (let x = 9; x <= 14; x++) set(x, hy + 5, hood[1]);
      if (look.ghillie) for (const [x, y] of [[9, hy - 3], [12, hy - 3], [15, hy - 1], [8, hy - 1]] as const) set(x, y, hash2(x, y, 9) < 0.5 ? 0x5a6a38 : 0x6a5a38);
      break;
    }
    case 'bare':
      drawHair(c, style, hx, hy);
      break;
    case 'headband': {
      drawHair(c, style === 2 ? 0 : style, hx, hy);
      const band = ramp(look.accent, 5, 0.4);
      for (let x = 9; x <= 14; x++) set(x, hy, pick(band, 0.6 - (x - 9) * 0.06, X(x), hy));
      if (front) { set(8, hy + 1, band[2]); set(7, hy + 2, band[1]); set(8, hy + 2, band[2]); }
      else { set(11, hy + 1, band[2]); set(12, hy + 2, band[1]); }
      break;
    }
    case 'mask':
    case 'skull': {
      drawHair(c, look.head === 'skull' ? 6 : style === 2 ? 6 : style, hx, hy);
      if (front) {
        const skull = look.head === 'skull';
        const plate = ramp(skull ? 0xe6dcc0 : 0xd8d2c0, 5, 0.3);
        for (let y = hy + 1; y <= hy + 5; y++) for (let x = 10; x <= 14; x++) if (!(y === hy + 5 && (x === 10 || x === 14))) set(x, y, pick(plate, 0.6 - (x - 10) * 0.06, X(x), y));
        if (skull) {
          set(11, hy + 2, INK); set(12, hy + 2, INK); set(14, hy + 2, INK); set(12, hy + 3, dead ? INK : 0xff3020); set(14, hy + 3, INK);
          set(13, hy + 4, 0x3a2a2a);
          for (let x = 11; x <= 14; x++) set(x, hy + 5, x % 2 ? 0x2a1a1a : plate[3]);
        } else {
          set(12, hy + 2, INK); set(14, hy + 2, INK); set(12, hy + 3, 0x3a2a2a);
          set(11, hy + 4, 0x5a4a44); set(13, hy + 4, 0x5a4a44);
          set(13, hy + 1, P.accent[3]); set(13, hy + 3, P.accent[2]);
        }
      } else for (let x = 9; x <= 14; x++) set(x, hy + 2, 0x2a2420);
      break;
    }
    case 'gas': {
      drawHair(c, 0, hx, hy);
      if (front) {
        const rub = ramp(0x3e3c34, 5, 0.34);
        for (let y = hy + 1; y <= hy + 5; y++) for (let x = 10; x <= 14; x++) set(x, y, pick(rub, 0.55 - (x - 10) * 0.05, X(x), y));
        set(12, hy + 2, 0x9ad0b0); set(14, hy + 2, 0x9ad0b0); set(12, hy + 3, 0x4a7a6a); set(14, hy + 3, 0x4a7a6a);
        set(14, hy + 5, P.metal[3]); set(15, hy + 5, P.metal[2]); set(15, hy + 4, P.metal[1]);
        set(9, hy + 2, 0x2a2420);
      } else { for (let x = 9; x <= 14; x++) set(x, hy + 2, 0x2a2420); set(11, hy + 2, P.metal[3]); }
      break;
    }
    case 'cap': {
      if (!front) drawHair(c, 0, hx, hy);
      const lea = ramp(0x2e2a2c, 5, 0.42);
      for (let x = 10; x <= 13; x++) set(x, hy - 3, pick(lea, 0.6 - (x - 10) * 0.07, X(x), hy - 3));
      for (let x = 9; x <= 14; x++) set(x, hy - 2, pick(lea, 0.55 - (x - 9) * 0.06, X(x), hy - 2));
      for (let x = 9; x <= 14; x++) set(x, hy - 1, P.accent[2]);
      for (let x = 7; x <= 16; x++) set(x, hy, pick(lea, x < 10 ? 0.5 : 0.28, X(x), hy));
      if (look.spikes) for (const x of [10, 12]) { set(x, hy - 4, P.steel[4]); set(x, hy - 5, P.steel[3]); }
      if (front) { set(12, hy + 1, shade(look.skin, 0.6)); set(13, hy + 1, shade(look.skin, 0.6)); set(14, hy + 1, shade(look.skin, 0.6)); }
      break;
    }
    case 'goggles': {
      drawHair(c, style === 3 ? 3 : style === 1 ? 1 : 0, hx, hy);
      for (let x = 9; x <= 14; x++) set(x, hy + 1, 0x2a2420);
      if (front) { set(11, hy + 1, 0xe0a030); set(12, hy + 1, 0xffd070); set(13, hy + 1, 0xe0a030); set(14, hy + 1, 0xffd070); set(15, hy + 1, 0x2a2420); }
      else set(11, hy + 1, P.metal[3]);
      break;
    }
    case 'reaper': {
      const white = ramp(look.hair, 5, 0.5);
      const hood = ramp(0x7a1c14, 5, 0.4);
      const hw = (x: number, y: number, L: number) => set(x, y, pick(white, L, X(x), y));
      if (front) {
        for (let x = 9; x <= 14; x++) hw(x, hy - 1, 0.7 - (x - 9) * 0.05);
        for (let x = 8; x <= 13; x++) hw(x, hy, 0.6 - (x - 8) * 0.05);
        for (let y = hy; y <= hy + 6; y++) { if (y <= hy + 4) hw(7, y, 0.3); hw(8, y, 0.42); if (y <= hy + 3) hw(9, y, 0.5); }
        // czaszka z płonącymi oczodołami
        for (let y = hy + 1; y <= hy + 5; y++) for (let x = 10; x <= 14; x++) set(x, y, pick(P.bone, 0.66 - (x - 10) * 0.06, X(x), y));
        set(11, hy + 2, INK); set(12, hy + 2, INK); set(14, hy + 2, INK);
        set(12, hy + 3, dead ? INK : 0xff2a1a); set(14, hy + 3, dead ? INK : 0xff6a4a); set(13, hy + 4, INK);
        for (let x = 11; x <= 14; x++) set(x, hy + 5, x % 2 ? 0xe8e0cc : 0x3a2a2a);
        // czerwony kaptur ze szpicem
        for (let x = 9; x <= 14; x++) set(x, hy - 2, pick(hood, 0.6 - (x - 9) * 0.06, X(x), hy - 2));
        set(8, hy - 1, hood[3]); set(7, hy - 2, hood[2]); set(6, hy - 3, hood[2]); set(15, hy - 1, hood[1]);
      } else {
        for (let y = hy - 1; y <= c.ty + 4; y++) {
          const a = y < hy ? 10 : y <= hy + 5 ? 9 : 10 + ((y - hy) & 1), e = y < hy ? 13 : y <= hy + 5 ? 14 : 13 - (y > c.ty + 2 ? 1 : 0);
          for (let x = a; x <= e; x++) hw(x, y, 0.66 - (x - 9) * 0.09 - Math.max(0, y - hy - 4) * 0.05 + ((x + y) % 3 === 0 ? -0.12 : 0));
        }
        for (let y = hy - 2; y <= hy + 3; y++) for (let x = 9; x <= 14; x++) if (y < hy + 1 || x === 9 || x === 14) set(x, y, pick(hood, 0.55 - (x - 9) * 0.06, X(x), y));
        set(10, hy - 3, hood[2]); set(9, hy - 4, hood[2]);
      }
      break;
    }
  }

  // chusta / szal na twarzy
  if (look.mask && front && (look.head === 'hood' || look.head === 'mohawk' || look.head === 'bare' || look.head === 'helmet' || look.head === 'goggles' || look.head === 'cap' || look.head === 'headband')) {
    const sc = ramp(look.scarf ?? mix(look.cloth, look.accent, 0.45), 5, 0.36);
    for (let y = hy + 4; y <= hy + 6; y++) for (let x = 10; x <= 15; x++) if (!(y === hy + 6 && x > 13)) set(x, y, pick(sc, 0.58 - (x - 10) * 0.05, X(x), y));
    if (anc === 'ratling') set(16, hy + 4, sc[1]);
  }
  // mutacja: narośl na czaszce, świecące oko
  if (look.mutation) {
    set(front ? 10 : 13, hy - 1, P.mut[3]); set(front ? 11 : 12, hy - 1, P.mut[2]); set(front ? 10 : 13, hy, P.mut[1]);
    if (front && !dead && look.head !== 'gas' && look.head !== 'mask' && look.head !== 'skull') { set(14, hy + 3, eyeGlow); set(15, hy + 3, eyeGlow, 110); set(14, hy + 2, eyeGlow, 90); set(10, hy + 4, P.mut[4]); }
  }
  if (look.pustules) for (const [x, y] of front ? [[10, hy + 1], [13, hy], [11, hy + 4]] as const : [[10, hy + 2], [13, hy + 1]] as const) { set(x, y, 0xd8e05a); set(x + 1, y, shade(look.skin, 0.65)); }
  // wszczepy: implant oka i płytka na skroni
  if (look.cyber) {
    if (front) {
      set(9, hy + 1, P.chrome[3]); set(10, hy + 1, P.chrome[2]); set(9, hy + 2, P.chrome[1]); set(10, hy + 2, P.chrome[4]);
      if (look.head !== 'gas' && look.head !== 'mask' && look.head !== 'skull' && !dead) { set(14, hy + 3, look.eye ?? 0xff3a2a); set(14, hy + 2, P.chrome[3]); set(15, hy + 2, P.chrome[2]); set(15, hy + 3, P.chrome[1]); }
    } else { set(10, hy + 1, P.chrome[3]); set(11, hy + 1, P.chrome[2]); set(10, hy + 2, P.chrome[1]); set(12, hy + 3, 0x2a2a30); }
  }
}

// ================================================================== tułów: dodatki

function drawTorsoExtras(c: Ctx, legTop: number): void {
  const { pc, look, front, X, ty, tx, tw, P } = c;
  const set = (x: number, y: number, col: RGB, a = 255) => pc.set(X(x), y, col, a);
  const right = tx + tw - 1;
  // żebra (ghul, Kostucha) - przez dziury w łachmanach / na nagiej piersi
  if (look.ribs && front) {
    for (let k = 0; k < 3; k++) { const y = ty + 2 + k * 2; for (let x = tx + 1; x < right; x++) if ((x + k) % 4 !== 0) set(x, y, k === 0 ? P.bone[4] : P.bone[3]); }
    set(tx + (tw >> 1), ty + 1, P.bone[2]);
  }
  // łachmany: postrzępiony dół, dziury
  if (look.rags) {
    for (let x = tx; x < tx + tw; x++) if (hash2(x, 3, 7) < 0.45) set(x, legTop, pick(P.cloth, 0.3, X(x), legTop));
    for (const [x, y] of [[tx + 1, ty + 4], [right - 1, ty + 2], [tx + 3, ty + 5]] as const) set(x, y, P.skin[1]);
  }
  // fartuch (podpalacz)
  if (look.apron !== undefined && front) {
    const ap = ramp(look.apron, 5, 0.36);
    for (let y = ty + 2; y <= legTop + 2; y++) for (let x = tx + 1; x < right; x++) set(x, y, pick(ap, 0.55 - (x - tx) * 0.04 + (y === ty + 2 ? 0.1 : 0), X(x), y));
    set(tx + 1, ty + 1, ap[1]); set(right - 1, ty + 1, ap[1]);
  }
  // kombinezon schronu: pionowy pas i kołnierz
  if (look.ancestry === 'vault') {
    const y0 = ty + 1;
    if (front) { for (let y = y0; y < legTop - 1; y++) set(tx + (tw >> 1), y, P.accent[3]); for (let x = tx + 1; x < right; x++) set(x, ty, P.accent[2]); }
    else { set(tx + 2, ty + 2, P.accent[3]); set(tx + 3, ty + 2, P.accent[4]); set(tx + 3, ty + 3, P.accent[3]); set(tx + 2, ty + 4, P.accent[3]); set(tx + 3, ty + 4, P.accent[3]); }
  }
  // szarfa
  if (look.sash !== undefined && front) { pc.line(X(tx), ty + 1, X(right), ty + 6, shade(look.sash, 1.1)); pc.line(X(tx), ty + 2, X(right), ty + 7, shade(look.sash, 0.75)); }
  // bandolier z nabojami
  if (look.bandolier !== undefined) {
    const x0 = front ? right : tx, x1 = front ? tx : right;
    pc.line(X(x0), ty, X(x1), legTop - 1, look.bandolier);
    const n = Math.max(2, tw >> 1);
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(ty + (legTop - 1 - ty) * t);
      if (k % 2 === 0 && front) set(x, y - 1, BRASS);
    }
  }
  // łańcuchy
  if (look.chains) {
    for (let x = tx; x <= right; x++) { const y = ty + 1 + Math.round(((x - tx) / tw) * 3); set(x, y, (x & 1) ? P.steel[4] : P.steel[1]); }
  }
  // pancerz z opony: pas bieżnika na brzuchu
  if (look.tire) {
    for (let x = tx; x <= right; x++) { set(x, legTop - 3, 0x1e1e20); set(x, legTop - 2, (x & 1) ? 0x3a3a3e : 0x26262a); }
  }
  // czaszki przy pasie
  if (look.skulls && front) for (const x of [tx + 1, right - 2]) { set(x, legTop, P.bone[4]); set(x + 1, legTop, P.bone[3]); set(x, legTop + 1, P.bone[1]); }
  // tatuaż / krosty na gołej piersi
  if (look.bareArms && look.tattoo !== undefined && front && !look.apron) { set(tx + 2, ty + 2, look.tattoo); set(tx + 3, ty + 3, look.tattoo); set(tx + 2, ty + 4, look.tattoo); }
  if (look.pustules) for (const [x, y] of [[tx + 1, ty + 3], [right - 1, ty + 5], [tx + 3, ty + 1]] as const) { set(x, y, 0xd8e05a); set(x, y + 1, shade(look.skin, 0.6)); }
  // futrzany kołnierz
  if (look.fur !== undefined) {
    const fr = ramp(look.fur, 5, 0.4);
    for (let x = tx - 1; x <= right + 1; x++) { set(x, ty, pick(fr, 0.65 - (x - tx) * 0.04, X(x), ty)); if (hash2(x, 1, 5) < 0.5) set(x, ty + 1, fr[1]); }
  }
}

/** Naramiennik bliższego barku (kolce / opona). */
function drawPauldron(c: Ctx): void {
  const { pc, look, front, X, ty, tx, tw, P } = c;
  const x = front ? tx + tw - 2 : tx - 1;
  if (look.tire) {
    for (let k = 0; k < 4; k++) pc.set(X(x + k), ty - 1 + (k === 0 || k === 3 ? 1 : 0), k & 1 ? 0x3a3a3e : 0x1e1e20);
    for (let k = 0; k < 4; k++) pc.set(X(x + k), ty + 1, 0x26262a);
    pc.set(X(x + 1), ty, 0x48484c); pc.set(X(x + 2), ty, 0x121214);
  }
  if (look.spikes) {
    if (!look.tire) part(pc, X(x), ty - 1, 3, 2, P.metal, 0.55);
    pc.set(X(x), ty - 2, P.steel[4]); pc.set(X(x + 2), ty - 2, P.steel[3]); pc.set(X(x + 1), ty - 3, P.steel[4]);
    if (look.chains || look.fur !== undefined || look.head === 'reaper') {
      // drugi naramiennik (szef / Kostucha)
      const x2 = front ? tx - 1 : tx + tw - 2;
      part(pc, X(x2), ty - 1, 3, 2, P.metal, 0.4);
      pc.set(X(x2 + 1), ty - 2, P.steel[3]);
    }
  }
}

// ================================================================== postać

function palette(look: UnitLook): Ctx['P'] {
  const robot = !!look.robot;
  return {
    skin: ramp(look.skin, 5, 0.34),
    cloth: robot ? ramp(mix(look.cloth, 0x9aa4ac, 0.35), 5, 0.5) : ramp(look.cloth, 5, 0.42),
    pants: robot ? ramp(shade(mix(look.cloth, 0x9aa4ac, 0.25), 0.7), 5, 0.45) : ramp(look.pants, 5, 0.36),
    boots: ramp(look.boots, 4, 0.3),
    accent: ramp(look.accent, 5, 0.4),
    hair: ramp(look.hair, 5, 0.4),
    pack: ramp(look.pack, 5, 0.38),
    metal: ramp(0x3a3f44, 5, 0.4),
    steel: ramp(0xa4acb2, 5, 0.36),
    wood: ramp(0x6a4a2a, 5, 0.4),
    chrome: ramp(robot ? mix(look.cloth, 0x9aa4ac, 0.5) : 0x8a949c, 5, 0.46),
    rust: ramp(0x6a625a, 5, 0.4),
    bone: ramp(0xd8ccb0, 5, 0.3),
    mut: ramp(mix(look.skin, 0x6a9a3a, 0.55), 5, 0.44),
    cloak: ramp(look.cloak ?? 0x1a1416, 5, 0.4),
    lea: ramp(0x3a2a1e, 5, 0.36),
  };
}

/** Postać żywa (albo bezwładna, gdy `limp`) - wszystkie pozy poza obrotem przy śmierci. */
function drawFigure(pc: PixelCanvas, look: UnitLook, front: boolean, pose: Pose, kneel = false): void {
  const body = look.body ?? 'medium';
  const robot = !!look.robot;
  const P = palette(look);
  const b = pose.bob;
  const hgt = look.height ?? (look.ancestry === 'vault' || look.ancestry === 'ratling' ? 1 : look.ancestry === 'humanoid' ? -1 : 0);
  kneel = kneel || pose.kneel;
  const kn = kneel ? 3 : pose.crouch;
  const crouched = !kneel && pose.crouch > 0;
  const fwd = pose.crouch >= 2 ? 2 : 1; // kolano wysunięte do przodu w przysiadzie
  const XL = (x: number) => x + pose.dx;
  const X = (x: number) => x + pose.dx + pose.lean;
  const big = !!look.bigArm;
  const tx = body === 'light' ? 9 : body === 'heavy' ? (big ? 6 : 7) : 8;
  const tw = body === 'light' ? 6 : body === 'heavy' ? (big ? 11 : 10) : 8;
  const aw = body === 'heavy' ? 2 : 1;
  const ty = (body === 'heavy' ? 13 : 14) + b + hgt + kn;
  const legTop = 21 + b + hgt + kn;
  const dxW = tx + tw + aw - 1 - 16;
  const W = (x: number) => X(x + dxW);
  const s = Math.sign(pose.legs[0]);
  const fhY = ty + 6 + Math.max(0, -s);
  const c: Ctx = { pc, look, front, pose, X, W, ty, tx, tw, aw, fhY, P };
  const metalLimb = robot;
  const sx = tx + tw; // bliższy bark (x)

  // ---- za postacią
  // płaszcz (widok z przodu): poły za ciałem; maskujący = strzępy
  if (look.cloak !== undefined && front) {
    const cl = look.ghillie ? ramp(0x4a5230, 5, 0.42) : P.cloak;
    for (let y = ty; y <= 26; y++) {
      const w = 2 + Math.floor((y - ty) / 5);
      for (let i = 0; i < w; i++) {
        if (y > 24 && hash2(i, y, 5) < 0.4) continue;
        const L = 0.5 - i * 0.12 + (look.ghillie && hash2(i, y, 11) < 0.3 ? 0.25 : 0);
        pc.set(XL(tx - 1 - i) + pose.lean, y, pick(cl, L, tx - 1 - i, y));
        if (i < w - 1) pc.set(XL(tx + tw + i) + pose.lean, y, pick(cl, L - 0.2, tx + tw + i, y));
      }
    }
  }
  if (look.coat !== undefined && front) {
    const ct = ramp(look.coat, 5, 0.4);
    for (let y = legTop; y <= legTop + 3; y++) { pc.set(X(tx - 1), y, ct[2]); pc.set(X(tx + tw), y, ct[1]); }
  }
  // ogon szczuraka
  if (look.ancestry === 'ratling') {
    const tail = mix(look.skin, 0xc89090, 0.5);
    const bx = front ? tx - 1 : tx + tw;
    const dir = front ? -1 : 1;
    pc.line(XL(bx), legTop, XL(bx + dir * 2), 24, tail);
    pc.line(XL(bx + dir * 2), 24, XL(bx + dir * 4), 26 - (pose.i & 1), tail);
    pc.set(XL(bx + dir * 5), 25 - (pose.i & 1), shade(tail, 0.8));
  }
  // smuga zamachu (za ciałem)
  if (pose.arm === 'strike' && !isGunKind(look.weapon)) {
    const heavy = look.weapon === 'sledge' || look.weapon === 'axe' || look.weapon === 'scythe';
    if (look.weapon === 'knife' || look.weapon === 'none') { for (let x = 1; x <= 3; x++) pc.set(X(sx + 4 + x), ty - 1 + (x & 1), 0xfff8e0, 130); }
    else drawSmear(c, X(sx), ty + 1, heavy ? 12 : 10, heavy ? -165 : -140, heavy ? 10 : -15);
  }
  // zbiornik miotacza wystający zza barku
  if (look.weapon === 'flamer' && front) part(pc, X(tx - 2), ty - 2, 2, 5, ramp(0x8a2a1a, 5, 0.4), 0.5);

  // ---- nogi + buty
  const legX: [number, number] = body === 'light' ? [12, 10] : body === 'heavy' ? [13, 8] : [13, 9];
  const lw = body === 'heavy' ? 3 : 2;
  const legDefs: [number, number, number][] = [[legX[1], pose.legs[2], pose.legs[3]], [legX[0], pose.legs[0], pose.legs[1]]];
  const legCol = look.rags ? P.pants : P.pants;
  for (const [lx, o, lift] of legDefs) {
    if (kneel) {
      // klęk: bliższa noga zgięta do przodu, dalsza goleń na ziemi
      if (lx === legX[0]) { part(pc, XL(lx + 1), legTop, lw + 1, 2, legCol, 0.5); part(pc, XL(lx + 2), legTop + 2, lw, 26 - legTop - 2, legCol, 0.45); part(pc, XL(lx + 2), 26, lw + 1, 2, P.boots, 0.5); }
      else { part(pc, XL(lx - 1), legTop, lw, 26 - legTop, legCol, 0.4); part(pc, XL(lx - 4), 26, lw + 3, 2, P.boots, 0.45); }
      continue;
    }
    const h = 26 - legTop - lift;
    let bo = 0; // przesunięcie stopy (przysiad: goleń pod wysuniętym kolanem)
    if (crouched) {
      // przysiad: udo poziomo do przodu, krótka goleń w dół
      part(pc, XL(lx + o), legTop, lw + fwd, Math.max(1, Math.min(2, h)), legCol, 0.5);
      bo = fwd - 1;
      if (h > 2) part(pc, XL(lx + o + bo), legTop + 2, lw, h - 2, legCol, 0.4);
    } else part(pc, XL(lx + o), legTop, lw, h, legCol, 0.45);
    if (look.boots >= 0 && !(look.claws && look.rags)) {
      part(pc, XL(lx + o + bo - (front ? 0 : 1)), 26 - lift, lw + 1, 2, robot ? P.metal : P.boots, 0.5);
      if (front) pc.set(XL(lx + o + bo + lw), 27 - lift, robot ? P.metal[1] : P.boots[1]);
    } else {
      // bose stopy z pazurami (ghul)
      part(pc, XL(lx + o + bo), 26 - lift, lw + 1, 2, P.skin, 0.4);
      pc.set(XL(lx + o + bo + lw + 1), 27 - lift, P.bone[3]);
    }
    if (robot) pc.set(XL(lx + o), legTop + 2, P.chrome[4]);
    if (look.rags && hash2(lx, 1, 3) < 0.6) pc.set(XL(lx + o), legTop + 3, P.skin[1]); // dziura w nogawce
  }

  // ---- tułów
  const torsoR = look.bareArms && !look.robot && (look.rags !== true) && look.apron === undefined && (look.ribs || look.pustules || look.tattoo !== undefined || look.bigArm) ? P.skin : P.cloth;
  part(pc, X(tx), ty, tw, legTop - ty, torsoR, 0.52, 3);
  const beltY = legTop - 1;
  if (!robot) {
    for (let x = tx; x < tx + tw; x++) pc.set(X(x), beltY, pick(ramp(0x2a2018, 4, 0.3), x === tx ? 0.7 : 0.4, x, beltY));
    if (front) pc.set(X(tx + 3), beltY, P.accent[3]);
  }
  if (robot) {
    if (front) {
      part(pc, X(tx + 1), ty + 1, tw - 2, 3, ramp(shade(look.cloth, 0.85), 5, 0.4), 0.45, 5);
      const cx = tx + (tw >> 1);
      const core = pose.die >= 3 ? 0x3a3a40 : look.accent;
      pc.set(X(cx - 1), ty + 2, core); pc.set(X(cx), ty + 2, pose.die >= 3 ? 0x4a4a50 : 0xffffff); pc.set(X(cx), ty + 3, core);
      for (const x of [tx + 1, tx + tw - 2]) { pc.set(X(x), ty + 1, P.chrome[4]); pc.set(X(x), ty + 5, P.chrome[4]); }
    } else for (let y = ty + 1; y < ty + 5; y += 2) for (let x = tx + 2; x < tx + tw - 2; x++) pc.set(X(x), y, P.cloth[0]);
    for (let x = tx; x < tx + tw; x++) pc.set(X(x), beltY, P.metal[1]);
  } else if (look.head === 'helmet') {
    part(pc, X(tx + 1), ty + 1, tw - 2, 4, ramp(0x4a5232, 5, 0.38), 0.5, 5);
    if (front) { pc.set(X(tx + 2), ty + 2, P.accent[2]); pc.set(X(tx + tw - 3), ty + 2, P.accent[2]); }
  } else if (look.cloak !== undefined) {
    if (front && look.sash === undefined) pc.line(X(tx), ty + 1, X(tx + tw - 1), ty + 5, P.accent[2]);
  } else if (look.bareArms) {
    if (!look.ribs && !look.bigArm) {
      pc.line(X(tx), ty, X(tx + tw - 1), ty + 5, 0x3a2a1e);
      pc.line(X(tx + 1), ty, X(tx + tw - 1), ty + 4, 0x5a4230);
    }
  } else if (look.head === 'headband') {
    // kitel medyka: czerwony krzyż na opasce ramienia, kieszeń
    if (front) { pc.set(X(tx + tw - 3), ty + 2, P.accent[3]); pc.set(X(tx + tw - 3), ty + 3, P.accent[2]); pc.set(X(tx + tw - 4), ty + 3, P.accent[3]); pc.set(X(tx + tw - 2), ty + 3, P.accent[3]); pc.set(X(tx + tw - 3), ty + 4, P.accent[2]); }
  } else if (look.bandolier === undefined && look.apron === undefined && !look.rags && look.ancestry !== 'vault') {
    // kurtka: ćwieki i naramiennik
    for (let i = 0; i < 3; i++) pc.set(X(tx + 2 + i * 2), ty + 2, P.accent[3]);
    if (!look.spikes && !look.tire) {
      part(pc, X(front ? tx + tw - 2 : tx - 1), ty - 1, 3, 2, P.accent, 0.5);
      pc.set(X(front ? tx + tw - 1 : tx), ty - 2, P.accent[4]);
    }
  }
  drawTorsoExtras(c, legTop);
  // szal na szyi
  if (look.scarf !== undefined && !look.mask) {
    const sc = ramp(look.scarf, 5, 0.36);
    for (let x = tx + 1; x < tx + tw - 1; x++) pc.set(X(x), ty, pick(sc, 0.6 - (x - tx) * 0.05, X(x), ty));
    pc.set(X(front ? tx : tx + tw - 1), ty + 1, sc[2]); pc.set(X(front ? tx : tx + tw - 1), ty + 2, sc[1]); pc.set(X(front ? tx - 1 : tx + tw), ty + 3, sc[1]);
  }
  // mutacja: narośl na barku
  if (look.mutation) {
    const gx = X(tx + (front ? 0 : tw - 2));
    const rx = big ? 3.2 : 2.2;
    pc.ellipse(gx + 1, ty + 0.5, rx, rx * 0.8, (x, y) => pick(P.mut, 0.6 - (x - gx) * 0.08 - (y - ty) * 0.1, x, y));
    pc.set(gx + 1, ty - 1, pose.die >= 3 ? P.mut[1] : look.eye ?? 0xb8ff4a);
    pc.set(X(tx + (front ? tw - 2 : 1)), ty + 4, P.mut[4]);
  }

  if (!front) {
    if (look.cloak !== undefined) {
      const cl = look.ghillie ? ramp(0x4a5230, 5, 0.42) : P.cloak;
      for (let y = ty - 1; y <= 25; y++) {
        const ext = Math.floor((y - ty) / 5);
        for (let x = tx - 1 - ext; x <= tx + tw + ext; x++) {
          if (y >= 24 && hash2(x, y, 7) < 0.35) continue;
          const fold = (x - tx) % 3 === 0 ? -0.12 : 0;
          const leaf = look.ghillie ? (hash2(x, y, 13) < 0.25 ? 0.3 : hash2(x, y, 17) < 0.2 ? -0.25 : 0) : 0;
          pc.set(X(x), y, pick(cl, 0.55 - (x - tx + 1) * 0.035 + fold + leaf, X(x), y));
        }
      }
      if (look.chains) for (let y = ty + 1; y < 24; y += 2) pc.set(X(tx + 2 + ((y >> 1) & 1)), y, P.steel[3]);
    } else if (look.weapon === 'flamer') {
      const tank = ramp(0x8a2a1a, 5, 0.4);
      part(pc, X(tx + 1), ty - 1, 2, 6, tank, 0.55, 7);
      part(pc, X(tx + tw - 3), ty - 1, 2, 6, tank, 0.45, 8);
      pc.set(X(tx + 3), ty + 2, P.metal[3]);
    } else if (!robot && !look.bareArms && !look.rags) {
      part(pc, X(tx + 1), ty, tw - 2, 5, P.pack, 0.5, 7);
      pc.set(X(tx + 2), ty + 1, P.accent[2]);
      if (look.ancestry === 'vault') { pc.set(X(tx + 2), ty + 1, P.accent[4]); pc.set(X(tx + 3), ty + 1, P.accent[3]); }
    }
    if (look.shield !== undefined) drawShield(c, X(tx + 1), ty, tw - 2, 6);
  }

  // ---- dalsze ramię (bez broni; przy rzucaniu unosi przedmiot)
  const bare = look.bareArms ? P.skin : P.cloth;
  const backArm = metalLimb || look.cyber ? P.chrome : bare;
  const frontArm = metalLimb ? P.chrome : bare;
  const hand = (arm: readonly RGB[]) => (arm === P.chrome ? P.metal[2] : look.claws ? P.skin[1] : P.skin[2]);
  const bx = tx - aw;
  const bsw = Math.max(0, s);
  if (pose.work) {
    // czynność: dalsze ramię sięga do przodu (przedramię schowane za tułowiem)
    part(pc, X(bx), ty + 1, aw, 3, backArm, 0.62);
  } else if (pose.cast >= 2 && pose.cast <= 3) {
    // ramię w górze z przedmiotem
    const top = pose.cast === 3 ? ty - 6 : ty - 3;
    part(pc, X(bx), top + 1, aw, ty + 1 - top, backArm, 0.62);
    pc.rect(X(bx), top, aw, 1, hand(backArm));
    const ix = X(bx) + (aw > 1 ? 0 : 0), iy = top - 2;
    pc.rect(ix, iy, 2, 2, P.accent[3]); pc.set(ix, iy, 0xffffff);
  } else if (pose.cast === 1) {
    part(pc, X(bx + 1), ty + 2, aw, 4, backArm, 0.62);
    pc.rect(X(bx + 1), ty + 6, aw, 1, hand(backArm));
    pc.set(X(bx + 1), ty + 7, P.accent[3]);
  } else {
    part(pc, X(bx), ty + 1 + bsw, aw, 5, backArm, 0.62);
    pc.rect(X(bx), ty + 6 + bsw, aw, 1, hand(backArm));
    if (look.claws) pc.set(X(bx), ty + 7 + bsw, P.bone[3]);
  }
  if (look.cyber && !robot) pc.set(X(tx - 1), ty + 3 + bsw, look.eye ?? 0xff3a2a);
  if (look.ancestry === 'vault' && pose.cast < 2) { pc.set(X(bx), ty + 4 + bsw, 0x2a3a2a); pc.set(X(bx), ty + 5 + bsw, 0x7aff8a); } // komputer na nadgarstku
  if (look.chains && pose.cast === 0) pc.set(X(bx), ty + 7 + bsw, P.steel[3]);

  // ---- bliższe ramię + broń
  const fw = big ? 3 : aw;
  let hx = X(sx), hy = fhY; // dłoń
  let armDraw: (() => void) | null = null;
  const gun = isGunKind(look.weapon) && look.weapon !== 'bow';
  const arm = pose.arm;
  const aimArm = arm === 'aim' || (gun && arm !== 'rest' && arm !== 'wind') || (look.weapon === 'bow' && arm !== 'rest');
  if (aimArm || arm === 'strike') {
    const len = 3 + (aw - 1);
    hx = X(sx + len); hy = ty;
    armDraw = () => {
      part(pc, X(sx), ty, len, fw, frontArm, 0.4);
      if (look.weapon === 'none') {
        const fs = big ? 3 : 2;
        part(pc, X(sx + len), ty - 1, fs, fs + (aw - 1), robot ? P.metal : P.skin, 0.55);
        if (look.claws) { pc.set(X(sx + len + fs), ty - 1, P.bone[4]); pc.set(X(sx + len + fs), ty + 1, P.bone[3]); }
        if (pose.attack && arm === 'strike') { pc.set(X(sx + len + fs), ty - 2, 0xffffff, 140); pc.set(X(sx + len + fs + 1), ty, 0xffffff, 140); }
      } else pc.rect(X(sx + len), ty, 1, aw, hand(frontArm));
    };
  } else if (arm === 'wind') {
    hx = X(sx - 1); hy = ty - 5;
    armDraw = () => { limb(pc, X(sx - 1), ty - 4, X(sx), ty + 1, fw, frontArm, 0.45); pc.rect(X(sx - 1), ty - 5, fw, 1, hand(frontArm)); };
  } else if (arm === 'follow') {
    hx = X(sx + 3); hy = ty + 6;
    armDraw = () => { limb(pc, X(sx), ty + 1, X(sx + 2), ty + 5, fw, frontArm, 0.4); pc.rect(X(sx + 3), ty + 6, fw, 1, hand(frontArm)); if (look.weapon === 'none') part(pc, X(sx + 2), ty + 5, 2, 2, P.skin, 0.5); };
  } else if (arm === 'ready') {
    hx = X(sx + 2); hy = ty + 3;
    armDraw = () => { limb(pc, X(sx), ty + 1, X(sx + 1), ty + 3, fw, frontArm, 0.35); pc.rect(X(sx + 2), ty + 3, fw, 1, hand(frontArm)); if (look.weapon === 'none') part(pc, X(sx + 1), ty + 2, 2, 2, P.skin, 0.5); };
  } else {
    const fsw = Math.max(0, -s);
    hx = X(sx); hy = ty + 6 + fsw;
    armDraw = () => {
      part(pc, X(sx), ty + 1 + fsw, fw, big ? 7 : 5, frontArm, 0.3);
      if (big) part(pc, X(sx), ty + 8 + fsw, 3, 3, P.skin, 0.45);
      else pc.rect(X(sx), ty + 6 + fsw, fw, 1, hand(frontArm));
      if (look.claws) pc.set(X(sx + fw), ty + (big ? 10 : 7) + fsw, P.bone[3]);
      if (look.tattoo !== undefined && look.bareArms) pc.set(X(sx), ty + 3 + fsw, look.tattoo);
      if (look.pustules && big) { pc.set(X(sx + 1), ty + 3 + fsw, 0xd8e05a); pc.set(X(sx + 2), ty + 6 + fsw, 0xd8e05a); }
      if (look.chains && big) for (let k = 0; k < 3; k++) pc.set(X(sx + k), ty + 5 + fsw + (k & 1), P.steel[k & 1 ? 1 : 4]);
    };
  }
  if (big && arm !== 'rest') {
    // ogromne ramię mutanta: grubszy biceps przy barku
    const pre = armDraw;
    armDraw = () => { part(pc, X(sx - 1), ty - 1, 3, 3, P.skin, 0.55); pre(); };
  }

  if (pose.work) armDraw = () => drawWork(c, frontArm, fw, hand(frontArm), hand(backArm));
  else drawWeapon(c, hx, hy);
  if (arm !== 'wind') armDraw();
  if (front && look.shield !== undefined) drawShield(c, X(tx - aw - 2), ty + 1 + bsw, 3, 6);
  drawPauldron(c);

  // ---- głowa
  const hunch = look.hunch ? 1 : 0;
  const hyHead = 8 + b + hgt + kn + pose.hbob + hunch + (body === 'heavy' && big ? 1 : 0);
  drawHead(c, hunch, hyHead);
  if (arm === 'wind') armDraw();

  // ---- efekty rzucania
  if (pose.cast >= 3) {
    const cx = X(bx) + 0.5, cy = (pose.cast === 3 ? ty - 7 : ty - 2);
    const glow = P.accent[4];
    if (pose.cast === 3) {
      for (let a = 0; a < 360; a += 45) pc.set(Math.round(cx + Math.cos(a * D2R) * 3), Math.round(cy + Math.sin(a * D2R) * 3), glow, 170);
      pc.set(Math.round(cx), cy - 4, 0xffffff, 200);
    } else {
      for (let k = 0; k < 9; k++) {
        const a = k * 40 + 10, r = 6 + (k % 3) * 2;
        pc.set(Math.round(12 + Math.cos(a * D2R) * r * 0.8), Math.round(ty + 2 + Math.sin(a * D2R) * r), k % 2 ? glow : 0xffffff, 190);
      }
    }
  }
}

/**
 * Ręce przy czynności (klęk, broń przewieszona): terminal z migającym ekranem, wytrych z napinaczem w zamku,
 * opatrunek ze świecącymi krzyżykami. Klatka (pose.i) porusza palcami / wytrychem i zapala efekty.
 */
function drawWork(c: Ctx, armR: readonly RGB[], fw: number, handC: RGB, backHandC: RGB): void {
  const { pc, pose, X, ty, tx, tw } = c;
  const sx = tx + tw;
  const i = pose.i;
  const reach = (hx: number, hy: number) => {
    limb(pc, X(sx), ty + 1, X(hx - 1), hy, fw, armR, 0.4);
    pc.rect(X(hx), hy, fw, 1, handC);
  };
  if (pose.work === 'hack') {
    // przenośny terminal w dalszej dłoni, bliższa stuka w klawisze
    const dx = sx + 2, dy = ty + 3;
    part(pc, X(dx), dy, 4, 3, ramp(0x30363a, 5, 0.38), 0.45, 21);
    const scr = [0x5aff6a, 0x9affa8, 0x3ad04a, 0xc8ffd0][i];
    pc.set(X(dx + 1), dy + 1, scr); pc.set(X(dx + 2), dy + 1, i & 1 ? 0x2a8a3a : scr);
    pc.set(X(dx), dy + 2, backHandC);
    reach(dx + 1 + (i & 1), dy - 1 + (i === 2 ? 1 : 0));
    pc.set(X(dx + 3), dy + 2, i === 3 ? 0xff4a3a : 0x7aff8a); // dioda
    // kabel do urządzenia przed postacią
    pc.line(X(dx + 4), dy + 2, X(dx + 6), dy + 4, 0x1a1a1e);
    // strzępy danych nad ekranem
    for (let k = 0; k < 3; k++) {
      const yy = dy - 2 - ((i + k * 2) % 4);
      if ((i + k) % 3 !== 0) pc.set(X(dx + 1 + k), yy, k === 1 ? 0xc8ffd0 : 0x6aff7a, 120 + k * 40);
    }
  } else if (pose.work === 'pick') {
    // napinacz w dalszej dłoni, wytrych w bliższej - ruch w górę / w dół w zamku
    const ly = ty + 2;
    const j = [0, 1, 0, -1][i];
    pc.set(X(sx + 3), ly + 2, backHandC);
    pc.line(X(sx + 4), ly + 2, X(sx + 5), ly + 2, c.P.steel[2]);
    reach(sx + 3, ly + j);
    pc.line(X(sx + 4), ly + j, X(sx + 6), ly - 1 + j, c.P.steel[4]);
    pc.set(X(sx + 6), ly + j, c.P.steel[3]);
    if (i === 3) { pc.set(X(sx + 7), ly - 2, 0xffffff, 220); pc.set(X(sx + 7), ly, 0xfff0a0, 160); pc.set(X(sx + 6), ly - 3, 0xfff0a0, 140); }
  } else if (pose.work === 'heal') {
    // obie dłonie nisko przy rannym, bandaż i apteczka
    const hy = ty + 6;
    part(pc, X(sx + 1), hy + 1, 3, 2, ramp(0xd8d0c0, 5, 0.42), 0.55, 23); // apteczka
    pc.set(X(sx + 2), hy + 1, 0xc82a2a); pc.set(X(sx + 2), hy + 2, 0xa01a1a);
    reach(sx + 3 + (i === 1 ? 1 : 0), hy - (i === 2 ? 1 : 0));
    pc.rect(X(sx + 4), hy - 1 + (i & 1), 2, 2, 0xf0ece0); // rolka bandaża
    pc.set(X(sx + 5), hy + (i & 1), 0xc8c0b0);
    if (i >= 1) {
      // zielone krzyżyki unoszące się nad opatrunkiem
      const gy = hy - 3 - i;
      const gx = sx + 4 + (i === 2 ? 1 : 0);
      for (const [ox, oy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) pc.set(X(gx + ox), gy + oy, ox || oy ? 0x5ad04a : 0xd8ffc8, 200);
    }
  }
}

/** Leżenie żywej postaci: obrót na brzuch głową do przodu (+ kąt), broń wysunięta przed głowę. */
function drawProne(pc: PixelCanvas, look: UnitLook, front: boolean, pose: Pose): void {
  const tmp = new PixelCanvas(UNIT_FW, UNIT_FH);
  drawFigure(tmp, { ...look, weapon: 'none' }, front, { ...BASE, anim: pose.anim, i: pose.i, blink: pose.blink });
  const ang = pose.prone;
  const [bx0, , bx1, by1] = rotatedBox(tmp, ang, 12, 27);
  const t = Math.min(1, ang / 60);
  const fx = 12 - Math.round((bx0 + bx1) / 2), fy = 28 - by1;
  blitRotated(pc, tmp, ang, 12, 27, Math.round(fx * t), fy);
  if (ang < 60 || look.weapon === 'none') return;
  // broń trzymana przed sobą na ziemi (jak porzucona, ale w dłoniach: dłoń na łożu)
  const P = palette(look);
  drawDroppedWeapon(pc, look, P);
  pc.set(16, 27, P.skin[2]);
  pc.set(19, 26, P.skin[3]);
}

function drawShield(c: Ctx, x: number, y: number, w: number, h: number): void {
  const r = ramp(c.look.shield ?? 0x6a5a4a, 5, 0.4);
  part(c.pc, x, y, w, h, r, 0.5, 9);
  for (let i = 0; i < w; i++) { c.pc.set(x + i, y, c.P.metal[3]); c.pc.set(x + i, y + h - 1, c.P.metal[1]); }
  c.pc.set(x + (w >> 1), y + (h >> 1), c.P.accent[3]);
  c.pc.set(x + (w >> 1), y + (h >> 1) - 1, c.P.accent[2]);
}

// ================================================================== śmierć

/** Kopiuje `src` obrócone o `deg` (- = przeciwnie do wskazówek: głowa w lewo) wokół (px, py) i przesunięte o (ox, oy). */
export function blitRotated(dst: PixelCanvas, src: PixelCanvas, deg: number, px: number, py: number, ox: number, oy: number): void {
  const ca = Math.cos(deg * D2R), sa = Math.sin(deg * D2R);
  for (let y = 0; y < dst.h; y++)
    for (let x = 0; x < dst.w; x++) {
      const rx = x + 0.5 - px - ox, ry = y + 0.5 - py - oy;
      const sx = Math.floor(px + rx * ca + ry * sa), sy = Math.floor(py - rx * sa + ry * ca);
      if (src.alpha(sx, sy) < 128) continue;
      const i = (sy * src.w + sx) * 4;
      dst.set(x, y, (src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2]);
    }
}

/** Ramka nieprzezroczystych pikseli obróconego bufora (do wyśrodkowania leżącego ciała). */
function rotatedBox(src: PixelCanvas, deg: number, px: number, py: number): [number, number, number, number] {
  const big = new PixelCanvas(64, 64);
  blitRotated(big, src, deg, px, py, 20, 20);
  let x0 = 99, x1 = -99, y0 = 99, y1 = -99;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (big.alpha(x, y) > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0 - 20, y0 - 20, x1 - 20, y1 - 20];
}

const isMachine = (look: UnitLook): boolean => !!look.robot || look.head === 'machine';

/** Broń porzucona na ziemi obok zwłok. */
function drawDroppedWeapon(pc: PixelCanvas, look: UnitLook, P: Ctx['P']): void {
  const k = look.weapon;
  if (k === 'none') return;
  const y = 27;
  const len = GUN_LEN[k] ?? (k === 'pistol' ? 3 : k === 'knife' ? 4 : k === 'scythe' ? 14 : k === 'bow' ? 9 : 8);
  const x0 = 23 - len;
  if (GUN_LEN[k] || k === 'pistol') {
    pc.line(x0, y, 22, y, P.metal[1]); pc.line(x0 + 1, y - 1, 21, y - 1, P.metal[3]);
    if (k !== 'pistol' && k !== 'smg') pc.line(x0 - 3, y, x0, y, P.wood[2]);
  } else if (k === 'bow') {
    pc.line(x0, y, 22, y, 0xd8d0b8); pc.line(x0, y - 1, 22, y - 1, P.wood[3]);
  } else {
    const head = k === 'pipe' ? P.rust : P.steel;
    const handleLen = k === 'knife' || k === 'machete' ? 2 : len - 3;
    pc.line(x0, y, x0 + handleLen, y, k === 'pipe' ? P.rust[1] : P.wood[2]);
    pc.line(x0 + handleLen + 1, y, 22, y, head[3]);
    if (k === 'axe' || k === 'sledge') { pc.rect(20, y - 2, 2, 2, P.steel[2]); }
    if (k === 'scythe') { pc.line(22, y, 20, y - 3, P.steel[3]); pc.line(20, y - 3, 17, y - 4, P.steel[4]); }
  }
}

function drawDeath(pc: PixelCanvas, look: UnitLook, front: boolean, pose: Pose): void {
  const d = pose.die;
  const P = palette(look);
  const machine = isMachine(look);
  const limpLook: UnitLook = d >= 2 ? { ...look, weapon: 'none' } : look;
  const tmp = new PixelCanvas(UNIT_FW, UNIT_FH);
  if (d === 0) {
    drawFigure(pc, look, front, { ...pose, dx: -1, lean: -2, hbob: 1, hurt: true, arm: 'rest', die: 0 });
    return;
  }
  if (d === 1) {
    drawFigure(pc, look, front, { ...pose, lean: -1, hurt: true, arm: 'rest', die: 1 }, true);
    return;
  }
  const limp: Pose = { ...BASE, anim: 'die', i: d, die: d, hurt: true, blink: true };
  if (d === 2) drawFigure(tmp, limpLook, front, limp, true);
  else drawFigure(tmp, limpLook, front, limp);
  const angle = [0, 0, -35, -84, -90, -90, -90][d];
  const [bx0, , bx1, by1] = rotatedBox(tmp, -90, 12, 27);
  const fx = 12 - Math.round((bx0 + bx1) / 2), fy = 28 - by1;
  const t = Math.abs(angle) / 90;
  const bounce = d === 3 ? -2 : 0;
  if (d >= 3) drawDroppedWeapon(pc, look, P);
  blitRotated(pc, tmp, angle, 12, 27, Math.round(fx * t), Math.round(fy * t) + bounce);
  // maszyny: przygaszony korpus
  if (machine && d >= 4) for (let y = 0; y < UNIT_FH; y++) for (let x = 0; x < UNIT_FW; x++) if (pc.alpha(x, y) > 0 && hash2(x, y, d) < 0.12) pc.darken(x, y, 0.7);
}

/** Po obrysie: kałuża krwi / oleju, iskry, dym. */
function deathPost(pc: PixelCanvas, look: UnitLook, pose: Pose): void {
  const d = pose.die;
  if (d < 0) return;
  const machine = isMachine(look);
  if (machine) {
    // iskry i dym zamiast krwi
    if (d <= 4) for (let k = 0; k < 5; k++) {
      const x = 5 + Math.floor(hash2(k, d, 31) * 14), y = 8 + Math.floor(hash2(k, d, 37) * (d >= 3 ? 14 : 12)) + (d >= 3 ? 6 : 0);
      pc.set(x, Math.min(29, y), k % 2 ? 0xfff6c0 : 0xffc040);
      if (k === 0) { pc.set(x + 1, Math.min(29, y), 0xffffff, 200); pc.set(x, Math.min(29, y) - 1, 0xffd060, 160); }
    }
    if (d >= 3) for (let k = 0; k < 2 + (d >> 1); k++) {
      const x = 8 + Math.floor(hash2(k, 7, d) * 9), y = 20 - k * 3 - (d - 3);
      pc.set(x, y, 0x8a8a8a, 110); pc.set(x + 1, y, 0x7a7a7a, 90); pc.set(x, y - 1, 0x9a9a9a, 70);
    }
    if (d >= 5) {
      const r = d === 5 ? 3 : 5;
      for (let x = 12 - r; x <= 12 + r; x++) for (let y = 28; y <= 29; y++) if (hash2(x, y, 3) < 0.8) under(pc, x, y, (x + y) % 5 === 0 ? 0x3a3a5a : 0x141418, 220);
    }
    return;
  }
  if (d < 5) return;
  // kałuża krwi rozlewająca się spod tułowia (lewa strona - tam leży głowa / tułów)
  const r = d === 5 ? 3.2 : 5.2;
  const cx = 9, cy = 28.5;
  for (let y = 26; y <= 30; y++)
    for (let x = 0; x < UNIT_FW; x++) {
      const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / (r * 0.42);
      const q = dx * dx + dy * dy + (hash2(x, y, 11) - 0.5) * 0.35;
      if (q > 1) continue;
      under(pc, x, y, q < 0.35 ? BLOOD[2] : q < 0.7 ? BLOOD[1] : BLOOD[0], 230);
    }
  if (d === 6) { under(pc, Math.round(cx - r * 0.4), 28, BLOOD[3], 230); }
}

/** Arkusz klatek: 'f_idle0' ... 'b_heal3'. */
export function paintUnitSheet(look: UnitLook): UnitSheet {
  return buildUnitSheet(
    (pc, front, pose) => (pose.die >= 0 ? drawDeath(pc, look, front, pose) : pose.prone > 0 ? drawProne(pc, look, front, pose) : drawFigure(pc, look, front, pose)),
    (pc, _front, pose) => deathPost(pc, look, pose),
  );
}
