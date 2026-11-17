// Postacie z gotowych sprite'ów (PixelLab, 64x64 px, 8 kierunków) zamiast proceduralnych klatek 24x32.
//
// Każdy rekrut z RECRUITS ma katalog src/assets/units/<id>/ z ośmioma obrotami (south, south-east, ...) oraz
// portret src/assets/portraits/<id>.png (popiersie 64x64). Obrazy są wczytywane w BootScene (preloadSprites).
//
// Gra animuje postacie klatkami o stałych nazwach ('f_idle0' ... 'b_heal3', patrz UnitArt.ANIMS). Sprite'y PixelLab
// są statyczne, więc klatki animacji składamy z jednego obrotu, przekształcając go wg pozy: oddech (opadanie tułowia),
// chód (kołysanie nóg), wypad / odrzut, przysiad (ściśnięcie w pionie), upadek i leżenie (obrót wokół stóp),
// błysk wystrzału, czerwony błysk trafienia. Przód ('f', w prawo-w dół) = obrót south-east, tył ('b', w prawo-w górę)
// = north-east; lewe kierunki daje setFlipX w scenie, jak dla klatek proceduralnych.
//
// Klatki są w 2x gęstości projektowej (64 px obrazu = 32 px projektowe): klatka 32x36 px projektowych, stopy w
// (16, 31.5) - ten sam punkt zaczepienia (UNIT_FOOT_X / UNIT_FW, UNIT_FOOT_Y / UNIT_FH = 0.5, 0.875) co klatki 24x32.
import type Phaser from 'phaser';
import { RECRUITS } from '../../core/data/recruits';
import { PixelCanvas } from './Pixel';
import { ANIMS, ANIM_ORDER, BASE_ANIMS, type Pose, type UnitSheet } from './UnitArt';

export const SPRITE_DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'] as const;
export type SpriteDir = (typeof SPRITE_DIRS)[number];

const UNIT_URLS = import.meta.glob('../../assets/units/*/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const PORTRAIT_URLS = import.meta.glob('../../assets/portraits/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
/** Animacje szkieletowe PixelLab (skeleton-v3): src/assets/units/<id>/anims/<animacja>_<kierunek>.png, pasek kwadratowych klatek. */
const STRIP_URLS = import.meta.glob('../../assets/units/*/anims/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/**
 * Warianty broni: katalog src/assets/units/<id>~<rodzaj>/ (np. sowa~shotgun) - te same obroty postaci z inną bronią
 * w ręku (PixelLab create-character-state, tools/pixellab_weapons.py). Sprite bazowy ma broń wpaloną w obraz, więc po
 * zmianie broni w ekwipunku gra bierze wariant (UnitLooks.unitLookOf). Wariant ma tylko własne paski animacji
 * (paski bazowe pokazywałyby starą broń); bez nich klatki są składane z obrotów.
 */
export const VARIANT_SEP = '~';

/** Id postaci z kompletem obrotów. */
const UNITS = new Set<string>();
const PORTRAITS = new Set<string>();
for (const path of Object.keys(UNIT_URLS)) UNITS.add(path.split('/').slice(-2)[0]);
for (const path of Object.keys(PORTRAIT_URLS)) PORTRAITS.add(path.split('/').pop()!.replace('.png', ''));

/** Gęstość obrazu względem pikseli projektowych. */
export const SPRITE_DENSITY = 2;
/**
 * Klatka w pikselach obrazu (32x36 projektowych); bestie 96x104 (48x52), bo paski PixelLab czworonogów mają płótno
 * ~90 px (wypad, ciało leżące na boku). Ustawiane na czas paintSpriteSheet.
 */
let FW = 64, FH = 72;
/** Stopy w klatce (piksele obrazu): 0.5 i 0.875 rozmiaru, jak UNIT_FOOT_X / UNIT_FW i UNIT_FOOT_Y / UNIT_FH. */
let FOOT_X = 32, FOOT_Y = 63;
function cellSize(beast: boolean): void {
  [FW, FH] = beast ? [96, 104] : [64, 72];
  FOOT_X = FW / 2;
  FOOT_Y = FH * 0.875;
}

export const spriteTexKey = (id: string, dir: SpriteDir): string => `pl_${id}_${dir}`;
export const spritePortraitKey = (id: string): string => `plp_${id}`;
export const spriteStripKey = (id: string, anim: StripAnim, dir: SpriteDir): string => `pla_${id}_${anim}_${dir}`;

/** Paski animacji z PixelLab (nazwy plików). */
export type StripAnim = 'walk' | 'sneak' | 'crouch' | 'shoot' | 'hack' | 'pick' | 'bite' | 'die';

/** Wczytuje obroty i portrety (wywołać w preload pierwszej sceny). */
export function preloadSprites(scene: Phaser.Scene): void {
  for (const [path, url] of Object.entries(UNIT_URLS)) {
    const [id, file] = path.split('/').slice(-2);
    scene.load.image(spriteTexKey(id, file.replace('.png', '') as SpriteDir), url);
  }
  for (const [path, url] of Object.entries(PORTRAIT_URLS)) scene.load.image(spritePortraitKey(path.split('/').pop()!.replace('.png', '')), url);
  for (const [path, url] of Object.entries(STRIP_URLS)) {
    const parts = path.split('/');
    const [anim, dir] = parts[parts.length - 1].replace('.png', '').split(/_(.+)/);
    scene.load.image(spriteStripKey(parts[parts.length - 3], anim as StripAnim, dir as SpriteDir), url);
  }
}

/** Id sprite'a postaci: rekrut (Character.recruitId albo RecruitDef.id), o ile ma komplet obrotów. */
export function spriteIdOf(src: { recruitId?: string; id?: string } | null | undefined): string | null {
  if (!src) return null;
  const id = src.recruitId ?? (src.id && RECRUITS.some((r) => r.id === src.id) ? src.id : undefined);
  return id && UNITS.has(id) ? id : null;
}

/** Wariant sprite'a `id` z bronią `kind` (katalog <id>~<kind>), o ile istnieje. */
export function spriteVariantId(id: string, kind: string): string | null {
  const v = `${id}${VARIANT_SEP}${kind}`;
  return UNITS.has(v) ? v : null;
}

/** Id postaci bez wariantu broni (portret i karta rekruta są wspólne). */
export const spriteBaseId = (id: string): string => id.split(VARIANT_SEP)[0];

/** Id sprite'a wroga: szablon (EnemyId, np. raider_thug) z katalogiem src/assets/units/<templateId>/. */
export function enemySpriteId(templateId: string | null | undefined): string | null {
  return templateId && UNITS.has(templateId) ? templateId : null;
}

/** Czy postać ma wczytany sprite (obrazy są w menedżerze tekstur). */
export function hasSprite(scene: Phaser.Scene, id: string | null): id is string {
  return !!id && scene.textures.exists(spriteTexKey(id, 'south-east')) && scene.textures.exists(spriteTexKey(id, 'north-east'));
}

export function hasSpritePortrait(scene: Phaser.Scene, id: string | null): id is string {
  return !!id && PORTRAITS.has(id) && scene.textures.exists(spritePortraitKey(id));
}

/** Piksele wczytanego obrazu (RGBA). */
export function texturePixels(scene: Phaser.Scene, key: string): { w: number; h: number; data: Uint8ClampedArray } {
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data };
}

interface Src {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  /** Obrys postaci: górny i dolny wiersz, lewa i prawa kolumna z nieprzezroczystymi pikselami. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function measure(p: { w: number; h: number; data: Uint8ClampedArray }): Src {
  let top = p.h, bottom = -1, left = p.w, right = -1;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3]) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
  if (bottom < 0) return { ...p, top: 0, bottom: p.h - 1, left: 0, right: p.w - 1 };
  return { ...p, top, bottom, left, right };
}

/** Kąt obrotu (stopnie, + = głową do przodu) dla etapów śmierci: pada do tyłu. */
const DIE_ANGLE = [0, -8, -24, -48, -74, -90, -90];

/** Pikseli obrazu na jednostkę pozy (pozy z UnitArt.ANIMS są w pikselach projektowych). */
const PX = SPRITE_DENSITY;

/**
 * Kolumna rozdzielająca nogi w obrazie źródłowym: średnie x nieprzezroczystych pikseli w dolnej połowie nóg.
 * Lewa / prawa strona tej kolumny to dwie nogi (przód: bliższa po lewej, tył: bliższa po prawej).
 */
function legSplit(s: Src, hipRow: number): number {
  const y0 = Math.round(hipRow + (s.bottom - hipRow) * 0.4);
  let sum = 0, n = 0;
  for (let y = y0; y <= s.bottom; y++)
    for (let x = s.left; x <= s.right; x++)
      if (s.data[(y * s.w + x) * 4 + 3]) {
        sum += x;
        n++;
      }
  return n ? sum / n : (s.left + s.right + 1) / 2;
}

/**
 * Maluje jedną klatkę: obraz `s` przekształcony wg pozy, z tym samym ruchem co klatki malowane kodem (UnitArt):
 * nogi osobno (krok: przesunięcie stopy do przodu / tyłu i uniesienie - zgięcie w kolanie), tułów (oddech, pochylenie),
 * głowa z opóźnieniem (hbob), wypad / odrzut, przysiad, upadek i leżenie. `front` = obrót przodem (south-east).
 */
function poseFrame(s: Src, pose: Pose, front: boolean, beast = false): PixelCanvas {
  const pc = new PixelCanvas(FW, FH);
  const height = s.bottom - s.top + 1;
  // obraz ustawiony stopami w (FOOT_X, FOOT_Y)
  const ox = FOOT_X - Math.round((s.left + s.right + 1) / 2);
  const oy = FOOT_Y - s.bottom;
  const hip = FOOT_Y - Math.round(height * 0.42);
  const legH = Math.max(1, FOOT_Y - hip);
  /** Dół głowy (wiersze nad nim = głowa, ruch hbob). */
  const neck = FOOT_Y - height + 1 + Math.round(height * 0.26);
  const split = legSplit(s, hip - oy) + ox;

  const lying = pose.die >= 0 ? DIE_ANGLE[pose.die] : pose.prone;
  const angle = (lying * Math.PI) / 180;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  // przy leżeniu ciało przesuwa się tak, żeby środek leżał nad punktem stóp, a plecy na wysokości stóp
  // (obrócona sylwetka ma grubość ~ szerokości postaci, połowa poszłaby pod klatkę)
  const t = Math.abs(lying) / 90;
  const tx = -sin * height * 0.5;
  const ty = -t * Math.round((s.right - s.left + 1) * 0.38);

  // przysiad / klęk: ściśnięcie w pionie wokół stóp
  const squash = pose.kneel ? 0.8 : 1 - pose.crouch * 0.07;
  // wypad / odrzut całej postaci, pochylenie, oddech tułowia i głowa (piksele projektowe -> piksele obrazu)
  const shiftX = (pose.lunge + pose.dx) * PX;
  const lean = pose.lean * PX + (pose.kneel ? PX : 0);
  // spoczynek: oddech o 1 piksel obrazu (pół piksela projektowego), głowa razem z tułowiem - pełne piksele projektowe
  // i osobny ruch głowy wyglądały na obrazie 64x64 jak przesadne sapanie
  const idle = pose.anim === 'idle';
  const bob = idle ? Math.sign(pose.bob) : pose.bob * PX;
  const hbob = idle || beast ? 0 : pose.hbob * PX;
  // nogi: [bliższa przesunięcie, uniesienie, dalsza przesunięcie, uniesienie] (UnitArt.WALK_LEGS); przy leżeniu bez kroku
  // bestia (czworonóg, skorpion): bez rozdzielania nóg - chód z paska PixelLab albo kołysanie całej sylwetki
  const legs = lying || beast ? null : pose.legs.some((v) => v !== 0) ? pose.legs : null;
  // bliższa noga: przodem (patrzy w prawo-w dół) po lewej stronie obrazu, tyłem (w prawo-w górę) po prawej
  const legDefs = legs
    ? ([
        { left: front, shift: legs[0] * PX, lift: legs[1] * PX },
        { left: !front, shift: legs[2] * PX, lift: legs[3] * PX },
      ] as const)
    : null;

  /** Piksel źródła w punkcie klatki (px, py) lub -1. */
  const at = (px: number, py: number): number => {
    const sx = Math.round(px) - ox, sy = Math.round(py) - oy;
    if (sx < 0 || sy < 0 || sx >= s.w || sy >= s.h) return -1;
    const i = (sy * s.w + sx) * 4;
    return s.data[i + 3] ? i : -1;
  };

  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      // odwrotne przekształcenia: obrót wokół stóp -> ściśnięcie -> tułów / głowa / nogi -> obraz źródłowy
      let px = x - tx - shiftX, py = y - ty;
      if (lying) {
        const rx = px - FOOT_X, ry = py - FOOT_Y;
        px = FOOT_X + rx * cos + ry * sin;
        py = FOOT_Y - rx * sin + ry * cos;
      }
      py = FOOT_Y - (FOOT_Y - py) / squash;
      let i = -1;
      if (py < hip) {
        // tułów opada / unosi się o `bob`, głowa dodatkowo o `hbob` (oddech z opóźnieniem)
        px -= lean;
        py -= bob;
        if (py < neck + hbob) py -= hbob;
        i = at(px, py);
      } else if (legDefs) {
        // każda noga osobno: góra uda zostaje w biodrze, stopa przesuwa się o `shift` i unosi o `lift`
        // (bliższa noga rysowana na dalszej)
        for (const l of legDefs) {
          const c = l.lift / legH;
          const sy = (py - c * hip) / (1 - c);
          if (sy < hip - 0.5) continue;
          const sx = px - (l.shift * (sy - hip)) / legH;
          const j = at(sx, sy);
          if (j >= 0 && Math.round(sx) < split === l.left) {
            i = j;
            break;
          }
        }
      } else i = at(px, py);
      if (i < 0) continue;
      const o = (y * FW + x) * 4;
      pc.data[o] = s.data[i];
      pc.data[o + 1] = s.data[i + 1];
      pc.data[o + 2] = s.data[i + 2];
      pc.data[o + 3] = s.data[i + 3];
    }

  // trafienie: czerwony błysk (pierwsze klatki 'hurt' i początek upadku)
  if (pose.hurt && (pose.anim === 'hurt' || pose.die <= 1)) tint(pc, 0xff4a3a, pose.anim === 'hurt' && pose.i === 0 ? 0.38 : 0.2);
  // zwłoki ciemnieją
  if (pose.die >= 5) tint(pc, 0x1a0e0c, 0.18);
  // kałuża krwi pod zwłokami
  if (pose.die >= 5) puddle(pc, pose.die === 6 ? 1 : 0.6);
  if (beast) return pc;
  if (pose.flash) muzzle(pc, pose.flash, hip - Math.round(height * 0.12));
  if (pose.cast >= 3) glow(pc, FOOT_Y - height - 1, pose.cast);
  return pc;
}

/** Odbicie klatki w poziomie (w miejscu). */
function mirrorX(pc: PixelCanvas): void {
  const row = pc.w * 4;
  for (let y = 0; y < pc.h; y++)
    for (let x = 0; x < pc.w >> 1; x++) {
      const a = y * row + x * 4, b = y * row + (pc.w - 1 - x) * 4;
      for (let c = 0; c < 4; c++) {
        const t = pc.data[a + c];
        pc.data[a + c] = pc.data[b + c];
        pc.data[b + c] = t;
      }
    }
}

function tint(pc: PixelCanvas, c: number, k: number): void {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  for (let i = 0; i < pc.data.length; i += 4) {
    if (!pc.data[i + 3]) continue;
    pc.data[i] += (r - pc.data[i]) * k;
    pc.data[i + 1] += (g - pc.data[i + 1]) * k;
    pc.data[i + 2] += (b - pc.data[i + 2]) * k;
  }
}

/** Kałuża pod ciałem: elipsa z ditheringiem na krawędzi, rysowana pod istniejącymi pikselami. */
function puddle(pc: PixelCanvas, size: number): void {
  const rx = 20 * size, ry = 6 * size, cy = FOOT_Y + 3;
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(FOOT_X - rx); x <= FOOT_X + rx; x++) {
      const d = ((x - FOOT_X) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1 || pc.alpha(x, y)) continue;
      if (d > 0.7 && (x + y) % 2) continue;
      pc.set(x, y, d < 0.35 ? 0x6a0f0c : 0x4a0a0a);
    }
}

/** Błysk wylotowy (1) albo dym (2) przed najdalej wysuniętym pikselem na wysokości broni. */
function muzzle(pc: PixelCanvas, kind: number, y0: number): void {
  let tip = -1, ty = y0;
  for (let y = y0 - 5; y <= y0 + 5; y++)
    for (let x = FW - 1; x > tip; x--)
      if (pc.alpha(x, y)) {
        tip = x;
        ty = y;
        break;
      }
  if (tip < 0) return;
  const x = tip + 2;
  if (kind === 1) {
    pc.rect(x, ty - 1, 3, 3, 0xffe27a);
    pc.set(x + 1, ty, 0xffffff);
    pc.set(x + 3, ty, 0xffb03a);
    pc.set(x + 4, ty, 0xffb03a);
    pc.set(x + 1, ty - 2, 0xffb03a);
    pc.set(x + 1, ty + 2, 0xffb03a);
  } else {
    for (const [dx, dy] of [[1, -1], [3, 0], [2, -3], [5, -2], [4, 1]] as const) pc.set(x + dx, ty + dy, 0x9a948a, 170);
  }
}

/** Blask zdolności nad głową. */
function glow(pc: PixelCanvas, y: number, cast: number): void {
  const r = cast === 4 ? 4 : 2;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    pc.set(FOOT_X + Math.round(Math.cos(ang) * r * 1.6), y - 3 + Math.round(Math.sin(ang) * r), a % 2 ? 0x8fe8ff : 0xffffff);
  }
  pc.set(FOOT_X, y - 3, 0xffffff);
}

/**
 * Spoczynek sprite'ów: dwie pozy (wyprostowany / tułów o piksel niżej), wolny rytm oddechu. Zastępuje ANIMS.idle
 * (5 póz po ~0.3 s, pomyślanych dla klatek 24x32), także w 8 kierunkach mapy regionu. Pętla ma 4 klatki, bo sceny
 * rozsynchronizowują postacie losową klatką startową 0..3.
 */
const SPRITE_IDLE = { poses: [0, 1], frames: [0, 1, 0, 1], durs: [1500, 1300, 1400, 1200] } as const;

const FRAME_ALIASES: Record<string, string> = { attack: 'attack2', hurt: 'hurt0' };
const SHEET_COLS = 17;

/** Animacja z klatek arkusza (zamiast ANIMS z UnitArt): klucz `${nazwa jednostki}_${suffix}`. */
export interface SheetAnim {
  suffix: string;
  frames: string[];
  durs: number[];
  loop: boolean;
  yoyo?: boolean;
}

/**
 * Jak paski PixelLab zastępują animacje gry (przód 'f' = south-east, tył 'b' = north-east):
 * `frames` - indeksy klatek paska, `ms` - czasy klatek, `ground` - każda klatka stopami / kolanem na ziemi
 * (klęk i przysiad: model przesuwa sylwetkę w pionie), `flash` - klatka z błyskiem wylotowym (+1: dym).
 */
interface StripUse {
  anim: string;
  strip: StripAnim;
  frames?: (n: number) => number[];
  ms: number | number[];
  loop: boolean;
  yoyo?: boolean;
  ground?: boolean;
  flash?: number;
}
const range = (a: number, b: number): number[] => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const STRIP_USES: readonly StripUse[] = [
  { anim: 'walk', strip: 'walk', ms: 105, loop: true },
  { anim: 'sneak', strip: 'sneak', ms: 135, loop: true, ground: true },
  // przypadnięcie do osłony: cały pasek kucania, potem postawa 'crouch' = ostatnia klatka
  { anim: 'hide', strip: 'crouch', ms: 75, loop: false, ground: true },
  { anim: 'crouch', strip: 'crouch', frames: (n) => [n - 1], ms: 600, loop: true, ground: true },
  // strzał: od klatki składania się do strzału (WorldScene wypuszcza pocisk ~90 ms po starcie)
  { anim: 'shoot', strip: 'shoot', frames: (n) => range(Math.min(2, n - 2), n), ms: [50, 70, 110, 220], loop: false, flash: 1 },
  // czynności: przyklęk (cały pasek), potem pętla pracy rąk (WorldScene.act łańcuchem '<anim>_loop')
  { anim: 'hack', strip: 'hack', ms: 110, loop: false, ground: true },
  { anim: 'hack_loop', strip: 'hack', frames: (n) => range(Math.max(0, n - 4), n), ms: 170, loop: true, yoyo: true, ground: true },
  { anim: 'pick', strip: 'pick', ms: 110, loop: false, ground: true },
  { anim: 'pick_loop', strip: 'pick', frames: (n) => range(Math.max(0, n - 4), n), ms: 190, loop: true, yoyo: true, ground: true },
];

/**
 * Bestie PixelLab (tools/pixellab_fauna.py): atak = pasek 'bite' (rzut z kłapnięciem / cios kleszczami),
 * śmierć = pasek 'die' (upadek na bok), zwłoki ciemnieją i leżą w kałuży (dwie ostatnie klatki).
 */
const BEAST_STRIP_USES: readonly StripUse[] = [
  { anim: 'attack', strip: 'bite', ms: [70, 70, 60, 90, 110, 110, 120], loop: false },
  { anim: 'die', strip: 'die', ms: [70, 90, 90, 90, 110, 160, 260], loop: false },
];

/** Kierunek widoku (wektor ekranu) -> obrót sprite'a (8 kierunków, y w dół). */
export function dirOfVector(dx: number, dy: number): SpriteDir {
  const a = Math.atan2(dy, dx); // 0 = wschód, + = w dół ekranu
  const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8; // 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE
  return (['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'] as const)[k];
}

/** Paski PixelLab postaci: klatki (kwadratowe) i obrys pierwszej klatki. */
function stripFrames(scene: Phaser.Scene, id: string, anim: StripAnim, dir: SpriteDir): Src[] | null {
  const key = spriteStripKey(id, anim, dir);
  if (!scene.textures.exists(key)) return null;
  const p = texturePixels(scene, key);
  const fw = p.h, n = Math.floor(p.w / fw);
  const out: Src[] = [];
  for (let k = 0; k < n; k++) {
    const data = new Uint8ClampedArray(fw * fw * 4);
    for (let y = 0; y < fw; y++) data.set(p.data.subarray((y * p.w + k * fw) * 4, (y * p.w + (k + 1) * fw) * 4), y * fw * 4);
    out.push(measure({ w: fw, h: fw, data }));
  }
  return out;
}

/**
 * Klatka paska w komórce arkusza: sylwetka ustawiona tak, jak obrót spoczynkowy `rest` (środek i stopy w FOOT_X,
 * FOOT_Y) - przesunięcie z pierwszej klatki paska, wspólne dla wszystkich klatek (zostaje ruch w animacji);
 * przy `ground` każda klatka osobno stoi na ziemi.
 */
function stripCell(rest: Src, first: Src, f: Src, ground: boolean): PixelCanvas {
  const pc = new PixelCanvas(FW, FH);
  const ox = FOOT_X - Math.round((rest.left + rest.right + 1) / 2) + Math.round((rest.left + rest.right - first.left - first.right) / 2);
  const oy = FOOT_Y - (ground ? f.bottom : first.bottom);
  for (let y = 0; y < f.h; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= FH) continue;
    for (let x = 0; x < f.w; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= FW) continue;
      const i = (y * f.w + x) * 4;
      if (!f.data[i + 3]) continue;
      const o = (ty * FW + tx) * 4;
      pc.data[o] = f.data[i];
      pc.data[o + 1] = f.data[i + 1];
      pc.data[o + 2] = f.data[i + 2];
      pc.data[o + 3] = f.data[i + 3];
    }
  }
  return pc;
}

/**
 * Arkusz klatek (te same nazwy co paintUnitSheet) z obrotów south-east (przód) i north-east (tył).
 * Animacje, dla których są paski PixelLab (szkielet postaci), biorą klatki z pasków (`anims` - nowe definicje),
 * reszta jest składana z obrotu (poseFrame). Do tego chód i spoczynek w 8 kierunkach (`<nazwa>_<kierunek>_walk`
 * / `_idle`, mapa regionu). Płótno i ramki w pikselach obrazu; `density` - pikseli obrazu na piksel projektowy.
 */
export function paintSpriteSheet(scene: Phaser.Scene, id: string, beast = false): UnitSheet & { density: number; anims: SheetAnim[] } {
  cellSize(beast);
  try {
    return paintSheet(scene, id, beast);
  } finally {
    cellSize(false);
  }
}

function paintSheet(scene: Phaser.Scene, id: string, beast: boolean): UnitSheet & { density: number; anims: SheetAnim[] } {
  const uses = beast ? [...STRIP_USES.filter((u) => u.strip === 'walk'), ...BEAST_STRIP_USES] : STRIP_USES;
  // bestie: bez postaw i czynności (jak arkusze iso/CreatureArt)
  const names: string[] = (beast ? BASE_ANIMS : ANIM_ORDER).flatMap((a) => ANIMS[a].poses.map((p) => `${a}${p.i}`));
  const poses = new Map<string, Pose>(ANIM_ORDER.flatMap((a) => ANIMS[a].poses.map((p) => [`${a}${p.i}`, p] as const)));
  const cells: { name: string; pc: PixelCanvas }[] = [];
  const anims: SheetAnim[] = [];
  const rest = new Map<SpriteDir, Src>();
  const restOf = (dir: SpriteDir): Src => {
    let r = rest.get(dir);
    if (!r) rest.set(dir, (r = measure(texturePixels(scene, spriteTexKey(id, dir)))));
    return r;
  };
  const msOf = (u: StripUse, k: number): number => (typeof u.ms === 'number' ? u.ms : u.ms[Math.min(k, u.ms.length - 1)]);

  // przód / tył (klatki 'f_' / 'b_', w lewo odbite) oraz własne obroty w lewo (SW / NW, prefiks = kierunek)
  const sides = [['f', 'south-east'], ['b', 'north-east'], ['south-west', 'south-west'], ['north-west', 'north-west']] as const;
  for (const [facing, dir] of sides) {
    const src = restOf(dir);
    const own = facing !== 'f' && facing !== 'b';
    if (!own) for (const name of names) cells.push({ name: `${facing}_${name}`, pc: poseFrame(src, poses.get(name)!, facing === 'f', beast) });
    if (!own) anims.push({ suffix: `${facing}_idle`, frames: SPRITE_IDLE.frames.map((i) => `${facing}_idle${i}`), durs: [...SPRITE_IDLE.durs], loop: true });
    // paski PixelLab
    const strips = new Map<StripAnim, Src[] | null>();
    for (const u of uses) {
      if (own && u.strip === 'walk') continue; // chód SW / NW jest w animacjach 8 kierunków
      if (!strips.has(u.strip)) strips.set(u.strip, stripFrames(scene, id, u.strip, dir));
      const fr = strips.get(u.strip);
      if (!fr || !fr.length) continue;
      const idx = u.frames ? u.frames(fr.length) : range(0, fr.length);
      const frames = idx.map((k, j) => {
        const name = `${facing}_${u.anim}_x${j}`;
        const pc = stripCell(src, fr[0], fr[k], !!u.ground);
        if (u.strip === 'die' && j >= idx.length - 2) {
          // zwłoki: ciemniejsze, kałuża pod spodem (w lewo - na odbitej klatce jest symetryczna)
          tint(pc, 0x1a0e0c, 0.18);
          puddle(pc, j === idx.length - 1 ? 1 : 0.6);
        }
        if (u.flash !== undefined && (j === u.flash || j === u.flash + 1)) {
          const h = src.bottom - src.top + 1;
          // błysk przed lufą: w lewo (SW / NW) na odbitej klatce
          if (own) mirrorX(pc);
          muzzle(pc, j === u.flash ? 1 : 2, FOOT_Y - Math.round(h * 0.55));
          if (own) mirrorX(pc);
        }
        cells.push({ name, pc });
        return name;
      });
      anims.push({ suffix: `${facing}_${u.anim}`, frames, durs: idx.map((_, j) => msOf(u, j)), loop: u.loop, yoyo: u.yoyo });
    }
  }

  // mapa regionu: 8 kierunków (chód z paska albo kołysanie nóg na obrocie, spoczynek = oddech)
  const walkPoses = ANIMS.walk.poses, idleDef = ANIMS.idle;
  const walkUse = STRIP_USES[0];
  for (const dir of SPRITE_DIRS) {
    const src = restOf(dir);
    const front = dir.startsWith('south') || dir === 'east';
    for (const i of SPRITE_IDLE.poses) cells.push({ name: `d_${dir}_idle${i}`, pc: poseFrame(src, idleDef.poses[i], front, beast) });
    anims.push({ suffix: `${dir}_idle`, frames: SPRITE_IDLE.frames.map((i) => `d_${dir}_idle${i}`), durs: [...SPRITE_IDLE.durs], loop: true });
    const fr = stripFrames(scene, id, 'walk', dir);
    if (fr && fr.length) {
      fr.forEach((f, k) => cells.push({ name: `d_${dir}_walk${k}`, pc: stripCell(src, fr[0], f, false) }));
      anims.push({ suffix: `${dir}_walk`, frames: fr.map((_, k) => `d_${dir}_walk${k}`), durs: fr.map(() => msOf(walkUse, 0)), loop: true });
    } else {
      walkPoses.forEach((p) => cells.push({ name: `d_${dir}_walk${p.i}`, pc: poseFrame(src, p, front, beast) }));
      anims.push({ suffix: `${dir}_walk`, frames: walkPoses.map((p) => `d_${dir}_walk${p.i}`), durs: ANIMS.walk.durs.map((d) => d * 1.3), loop: true });
    }
  }

  const cols = SHEET_COLS;
  const pc = new PixelCanvas(FW * cols, FH * Math.ceil(cells.length / cols));
  const frames: UnitSheet['frames'] = [];
  const pos = new Map<string, { x: number; y: number }>();
  cells.forEach((c, i) => {
    const x = (i % cols) * FW, y = Math.floor(i / cols) * FH;
    for (let yy = 0; yy < FH; yy++) pc.data.set(c.pc.data.subarray(yy * FW * 4, (yy + 1) * FW * 4), ((y + yy) * pc.w + x) * 4);
    frames.push({ name: c.name, x, y, w: FW, h: FH });
    pos.set(c.name, { x, y });
  });
  for (const facing of ['f', 'b'] as const)
    for (const [alias, srcName] of Object.entries(FRAME_ALIASES)) {
      const p = pos.get(`${facing}_${srcName}`)!;
      frames.push({ name: `${facing}_${alias}`, x: p.x, y: p.y, w: FW, h: FH });
    }
  return { pc, frames, density: SPRITE_DENSITY, anims };
}

/**
 * Portret (popiersie 64x64) na ciemnym tle w paski z ditheringiem - obraz PixelLab ma przezroczyste tło,
 * a ramki kart (Widgets.portrait) zakładają pełny kwadrat.
 */
export function spritePortraitCanvas(scene: Phaser.Scene, id: string): HTMLCanvasElement {
  const p = texturePixels(scene, spritePortraitKey(id));
  const c = document.createElement('canvas');
  c.width = p.w;
  c.height = p.h;
  const ctx = c.getContext('2d')!;
  const bg = ctx.createImageData(p.w, p.h);
  const top = [0x3a, 0x2e, 0x26], bot = [0x16, 0x11, 0x0e];
  for (let y = 0; y < p.h; y++) {
    // 6 pasów jasności, granice pasów przeplatane szachownicą (dithering)
    const band = Math.min(5, Math.floor((y / p.h) * 6));
    for (let x = 0; x < p.w; x++) {
      const b = band + ((y / p.h) * 6 - band > 0.8 && (x + y) % 2 ? 1 : 0);
      const k = Math.min(5, b) / 5;
      const o = (y * p.w + x) * 4;
      for (let ch = 0; ch < 3; ch++) bg.data[o + ch] = top[ch] + (bot[ch] - top[ch]) * k;
      bg.data[o + 3] = 255;
      const a = p.data[o + 3] / 255;
      if (a) for (let ch = 0; ch < 3; ch++) bg.data[o + ch] = p.data[o + ch] * a + bg.data[o + ch] * (1 - a);
    }
  }
  ctx.putImageData(bg, 0, 0);
  return c;
}
