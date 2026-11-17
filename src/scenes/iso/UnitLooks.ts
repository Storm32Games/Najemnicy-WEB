import Phaser from 'phaser';
import type { EnemyShape } from '../../core/data/types';
import { classDef, enemyDef, itemDef } from '../../core/rules/lookup';
import { parseColor } from '../ui/Kit';
import { type CreatureSpecies, creatureSpecies, paintCreatureSheet } from './CreatureArt';
import { ArtBook } from './IsoArt';
import { mix, shade } from './Pixel';
import { RECRUITS } from '../../core/data/recruits';
import { hashStr } from './Pixel';
import { addHiRes } from './HiRes';
import { enemySpriteId, hasSprite, paintSpriteSheet, spriteIdOf, spriteVariantId, type SheetAnim } from './SpriteUnits';
import {
  ANIMS, ANIM_ORDER, type AncestryLook, type BodyBuild, type HeadKind, LOOK_RAIDER, LOOK_SOLDIER, UNIT_FH, UNIT_FOOT_X, UNIT_FOOT_Y, UNIT_FW,
  type UnitLook, type UnitSheet, type WeaponKind, paintUnitSheet,
} from './UnitArt';

// Wygląd najemnika (kolory z RECRUITS / createCharacter: look.skin, hair, cloth, accent, body) -> paleta sprite'a 24x32.
// Odpowiednik Oldgame/src/gfx/look.js: klasa decyduje o nakryciu głowy, budowie i domyślnej broni, kolory z postaci,
// broń z ekwipunku (equipment.weapon), cechy pochodzenia (mutant / cyborg) i tarcza z equipment.shield.

export interface LookSource {
  classId: string;
  ancestry?: string;
  /** Id rekruta (płeć z RECRUITS -> broda tylko u mężczyzn) i imię (ziarno cech losowych). */
  recruitId?: string;
  name?: string;
  gender?: 'm' | 'f';
  look?: {
    skin?: string; hair?: string; cloth?: string; accent?: string; mask?: boolean; hairStyle?: number;
    body?: string; mutation?: boolean; cyber?: boolean;
  };
  /** Ekwipunek postaci (Character.equipment). Brak = broń startowa klasy (np. rekrut z RECRUITS). */
  equipment?: { weapon?: { id: string } | null; shield?: { id: string } | null } | null;
}

const HELMET = new Set(['soldier', 'champion']);
const HOOD = new Set(['scout', 'scavenger', 'herald']);
const GOGGLES = new Set(['techie', 'hacker']);
const CAP = new Set(['gunslinger']);
const HEAVY = new Set(['brute', 'monk', 'champion']);
const LIGHT = new Set(['scout', 'techie', 'scavenger', 'hacker']);
const MELEE = new Set(['brute', 'monk', 'scavenger', 'champion']);

const norm = (s: string): string =>
  s.toLowerCase().replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z');
const has = (s: string, ...keys: string[]) => keys.some((k) => s.includes(k));

/** Rodzaj broni z dowolnego opisu (id przedmiotu, ikona, nazwa ataku, sfx). Port weaponKind z Oldgame/src/gfx/look.js. */
export function weaponKindOf(str: string | null | undefined): WeaponKind | null {
  const s = norm(String(str ?? ''));
  if (!s) return null;
  if (has(s, 'laser', 'plazm', 'plasma', 'lasgun', 'beam')) return 'laser';
  if (has(s, 'flame', 'miotacz', 'plomien', 'burner')) return 'flamer';
  if (has(s, 'sniper', 'snajper', 'scope', 'long', 'sztucer', 'hunting')) return 'longgun';
  if (has(s, 'shotgun', 'strzelb', 'dubelt', 'sawedoff')) return 'shotgun';
  if (has(s, 'smg', 'uzi', 'maszynow', 'machinegun', 'subm')) return 'smg';
  if (has(s, 'rifle', 'karabin', 'ak47', 'ak_', 'assault')) return 'rifle';
  if (has(s, 'pistol', 'rewolw', 'revolver', 'handgun', 'glock', 'gun')) return 'pistol';
  if (has(s, 'bow', 'luk', 'kusz')) return 'bow';
  if (has(s, 'scythe', 'kosa')) return 'scythe';
  if (has(s, 'machete', 'maczet', 'sword', 'miecz', 'blade', 'katan', 'tasak')) return 'machete';
  if (has(s, 'knife', 'noz', 'dagger', 'shiv', 'sztylet')) return 'knife';
  if (has(s, 'sledge', 'hammer', 'mlot', 'maul')) return 'sledge';
  if (has(s, 'axe', 'topor', 'siekier')) return 'axe';
  if (has(s, 'pipe', 'rura', 'club', 'palka', 'bat', 'kij', 'wrench', 'klucz', 'crowbar', 'lom')) return 'pipe';
  if (has(s, 'fist', 'pies', 'unarm', 'knuck')) return 'none';
  return null;
}

/** Rodzaj broni przedmiotu (ItemId) wg id, ikony i grupy z tabeli przedmiotów. */
export function weaponKindOfItem(id: string | null | undefined): WeaponKind | null {
  const def = itemDef(id);
  if (!def || def.type !== 'weapon') return id ? weaponKindOf(id) : null;
  const k = weaponKindOf(`${def.id} ${def.icon}`);
  if (k) return k;
  const g = def.weapon.group;
  return g === 'laser' ? 'laser' : g === 'bow' ? 'bow' : g === 'unarmed' ? 'none' : g === 'firearm' ? 'pistol' : 'pipe';
}

const SHIELD_COLORS: Record<string, number> = { riot_shield: 0x5a6a78, scrap_shield: 0x6a5a48 };

function defaultWeapon(cls: string): WeaponKind {
  const gear = classDef(cls)?.startGear ?? [];
  for (const id of gear) {
    const d = itemDef(id);
    if (d?.type === 'weapon') return weaponKindOfItem(id) ?? 'pipe';
  }
  return MELEE.has(cls) ? 'pipe' : 'rifle';
}

/**
 * Grupa broni dla wariantów sprite'ów PixelLab (katalogi <id>~<grupa>): sylwetki broni w obrębie grupy są podobne,
 * więc wystarcza jeden wariant na grupę.
 */
export type WeaponGroup = 'rifle' | 'shotgun' | 'pistol' | 'bow' | 'blade' | 'blunt' | 'none';
export const WEAPON_GROUPS: readonly WeaponGroup[] = ['rifle', 'shotgun', 'pistol', 'bow', 'blade', 'blunt', 'none'];
export function weaponGroupOf(k: WeaponKind, itemId?: string): WeaponGroup {
  if (itemId === 'laser_pistol') return 'pistol';
  switch (k) {
    case 'rifle': case 'longgun': case 'smg': case 'mg': case 'laser': case 'flamer': return 'rifle';
    case 'shotgun': case 'pistol': case 'bow': case 'none': return k;
    case 'knife': case 'machete': case 'scythe': return 'blade';
    default: return 'blunt'; // pipe, sledge, axe
  }
}

/** Grupa broni wpalonej w bazowy sprite rekruta (broń startowa klasy). */
export const bakedWeaponGroup = (cls: string): WeaponGroup => weaponGroupOf(defaultWeapon(cls));

/** Sprite postaci z bronią `weapon`: bazowy, gdy to broń startowa; inaczej wariant grupy (o ile wygenerowany). */
export function weaponSpriteId(sprite: string, cls: string, weapon: WeaponKind, itemId?: string): string {
  const g = weaponGroupOf(weapon, itemId);
  if (g === bakedWeaponGroup(cls)) return sprite;
  return spriteVariantId(sprite, weapon) ?? spriteVariantId(sprite, g) ?? sprite;
}

const asBody = (s: string | undefined): BodyBuild | undefined => (s === 'light' || s === 'medium' || s === 'heavy' ? s : undefined);

export function unitLookOf(src: LookSource): UnitLook {
  const cls = src.classId;
  const lk = src.look ?? {};
  const anc = norm(src.ancestry ?? '');
  const mutation = !!lk.mutation || anc === 'mutant';
  const cyber = !!lk.cyber || anc === 'cyborg';
  const cloth = parseColor(lk.cloth, LOOK_SOLDIER.cloth);
  const skin = parseColor(lk.skin, mutation ? 0xa9c27a : LOOK_SOLDIER.skin);
  // fryzury jak w hero.js: 0 krótkie, 1 łysy, 2 irokez, 3 długie z grzywką, 4 jeżyk, 5 kucyk
  const hairStyle = ((lk.hairStyle ?? 0) % 6 + 6) % 6;
  const medic = cls === 'medic' || cls === 'alchemist';

  let head: HeadKind = HELMET.has(cls) ? 'helmet' : HOOD.has(cls) ? 'hood' : GOGGLES.has(cls) ? 'goggles' : CAP.has(cls) ? 'cap' : medic ? 'headband' : 'bare';
  if (lk.mask && head === 'bare') head = 'hood';
  if (anc === 'nomad' && head === 'bare') head = 'goggles';
  // szczurak / humanoid: uszy muszą być widoczne - bez hełmu i kaptura
  if ((anc === 'ratling' || anc === 'humanoid') && (head === 'hood' || head === 'helmet' || head === 'cap')) head = 'bare';

  const body = asBody(lk.body) ?? (anc === 'ogrin' ? 'heavy' : anc === 'ratling' ? 'light' : HEAVY.has(cls) ? 'heavy' : LIGHT.has(cls) ? 'light' : 'medium');

  const eq = src.equipment;
  let weapon: WeaponKind;
  if (eq) weapon = eq.weapon ? weaponKindOfItem(eq.weapon.id) ?? 'pipe' : 'none';
  else weapon = defaultWeapon(cls);

  const look: UnitLook = {
    skin,
    cloth,
    pants: shade(cloth, 0.62),
    boots: 0x2a221c,
    accent: parseColor(lk.accent, LOOK_SOLDIER.accent),
    hair: parseColor(lk.hair, LOOK_SOLDIER.hair),
    head,
    weapon,
    pack: shade(cloth, 0.78),
    body,
    hairStyle,
  };
  if (lk.mask) look.mask = true;
  if (cls === 'brute' || cls === 'monk') look.bareArms = true;
  if (mutation) { look.mutation = true; look.eye = 0xb8ff4a; look.pustules = true; look.claws = true; }
  if (anc === 'ratling' || anc === 'ogrin' || anc === 'vault' || anc === 'humanoid') look.ancestry = anc as AncestryLook;
  // dodatki klas (outfit w hero.js): szal zwiadowcy / nomady, chusta szabrownika, bandolier, kitel, tatuaż, broda
  const rec = src.recruitId ? RECRUITS.find((r) => r.id === src.recruitId) : undefined;
  const gender = src.gender ?? rec?.gender;
  const seed = hashStr(`${src.recruitId ?? src.name ?? ''}|${cls}|${lk.skin ?? ''}|${lk.hair ?? ''}`);
  if (cls === 'scout' || cls === 'gunslinger') { look.scarf = 0x9a8a62; look.bandolier = 0x5a3a1e; }
  if (cls === 'scavenger' || cls === 'herald') look.scarf = cls === 'herald' ? look.accent : 0x5a4a32;
  if (anc === 'nomad') look.scarf = 0xc9a468;
  if (cls === 'soldier' || cls === 'champion') look.bandolier = seed % 2 ? 0x4a3a22 : undefined;
  if (look.bandolier === undefined) delete look.bandolier;
  if (medic) look.coat = shade(cloth, 0.9);
  if (cls === 'brute' || cls === 'monk') look.tattoo = mix(look.accent, 0x1a2a3a, 0.5);
  if (anc === 'ogrin') look.spikes = true;
  const beardOk = gender === 'm' || (gender === undefined && (cls === 'brute' || cls === 'monk'));
  if (beardOk && anc !== 'ratling' && anc !== 'humanoid' && anc !== 'vault' && !medic && (seed % 3 === 0 || cls === 'brute' || cls === 'monk' || anc === 'ogrin') && hairStyle !== 4) look.beard = true;
  if (cyber) { look.cyber = true; look.eye = 0xff3a2a; }
  const sh = eq?.shield?.id;
  if (sh) look.shield = SHIELD_COLORS[sh] ?? 0x6a5a48;
  const sprite = spriteIdOf(src as { recruitId?: string; id?: string });
  if (sprite) look.sprite = weaponSpriteId(sprite, cls, weapon, eq?.weapon?.id);
  return look;
}

/** Szabrownik do scen fabularnych (wariant palety LOOK_RAIDER). */
export function raiderLook(i: number): UnitLook {
  const cloths = [0x6a3a2a, 0x2a2a2e, 0x5a4a28, 0x3a2a3a, 0x40382a];
  const accents = [0xc43d2f, 0xb4532a, 0xc9a23a, 0xc43d2f, 0x8fd14f];
  const weapons: WeaponKind[] = ['pipe', 'axe', 'rifle', 'machete', 'shotgun'];
  return {
    ...LOOK_RAIDER, cloth: cloths[i % 5], accent: accents[i % 5], head: i % 2 ? 'hood' : 'mohawk', weapon: weapons[i % 5],
    body: i % 3 === 1 ? 'heavy' : i % 3 === 2 ? 'light' : 'medium', mask: i % 2 === 1,
  };
}

// ================================================================== wrogowie

/** Opis bestii (wróg nie-humanoidalny) dla paintCreatureSheet. */
export interface CreatureLook {
  /** Gatunek (malarz) albo kształt, gdy gatunek nieznany. */
  readonly creature: CreatureSpecies | EnemyShape;
  readonly shape: EnemyShape;
  readonly skin: number;
  readonly accent: number;
  /** Gotowa bestia PixelLab (src/assets/units/<templateId>/) zamiast klatek malowanych kodem. */
  readonly sprite?: string;
}

/** Wygląd wroga tak jak trzyma go Character.look / EnemyDef.look. */
export interface EnemyLookSource {
  shape?: string; skin?: string; accent?: string; cloth?: string; hair?: string; body?: string;
  mask?: boolean; mutation?: boolean; cyber?: boolean;
}

export function isCreatureLook(l: UnitLook | CreatureLook): l is CreatureLook {
  return 'creature' in l;
}

const SHAPES: readonly EnemyShape[] = ['quad', 'swarm', 'big', 'humanoid', 'drone', 'turret'];

/** Broń wroga z pierwszego ataku (nazwa + sfx), jak w Oldgame/src/gfx/look.js. */
function enemyWeapon(templateId: string): WeaponKind | null {
  const atk = enemyDef(templateId)?.attacks ?? [];
  for (const a of atk) {
    const k = weaponKindOf(`${a.name} ${a.sfx}`);
    if (k) return k;
    if (a === atk[0] && a.sfx === 'melee') return null;
  }
  return null;
}

/**
 * Wygląd wroga z szablonu: humanoid -> UnitLook (budowa, maska, wszczepy, mutacja, broń z pierwszego ataku,
 * warianty specjalne: robot, Kostucha), reszta -> CreatureLook (gatunek po templateId, w razie braku kształt).
 * `look` domyślnie z ENEMIES[templateId].look.
 */
export function enemyUnitLook(templateId: string | undefined | null, look?: EnemyLookSource | null): UnitLook | CreatureLook {
  const tid = norm(String(templateId ?? ''));
  const def = enemyDef(templateId);
  const lk: EnemyLookSource = look ?? (def?.look as EnemyLookSource | undefined) ?? {};
  const shape: EnemyShape = SHAPES.includes(lk.shape as EnemyShape) ? (lk.shape as EnemyShape) : 'humanoid';
  const traits: readonly string[] = def?.traits ?? [];
  const faction = def?.faction ?? '';
  const robot = faction === 'machine' || has(tid, 'robot', 'android', 'mech');
  const boss = tid === 'kostucha' || has(tid, 'kostuch', 'reaper');

  if (shape !== 'humanoid' && !boss) {
    const skin = parseColor(lk.skin, 0x8a6a4a), accent = parseColor(lk.accent, 0xff3a2a);
    const sprite = enemySpriteId(templateId ? String(templateId) : null);
    return { creature: creatureSpecies(tid) ?? shape, shape, skin, accent, ...(sprite ? { sprite } : {}) };
  }

  const skinC = parseColor(lk.skin, LOOK_RAIDER.skin);
  const cloth = parseColor(lk.cloth, LOOK_RAIDER.cloth);
  const accent = parseColor(lk.accent, LOOK_RAIDER.accent);
  const mutation = !!lk.mutation || traits.includes('mutant') || faction === 'mutant';
  const cyber = !!lk.cyber && !robot;
  let body: BodyBuild = asBody(lk.body) ?? 'medium';
  let weapon = enemyWeapon(tid);
  let head: HeadKind = 'mohawk';
  let hairStyle = 0;
  let mask = false;
  let hair = parseColor(lk.hair, LOOK_RAIDER.hair);
  const out: Partial<UnitLook> = {};

  const ghoul = has(tid, 'ghoul', 'ghul', 'zombi');
  const brute = has(tid, 'brute', 'kolos', 'hulk', 'abomin');
  if (boss) {
    // Kostucha: białe włosy, czaszka w czerwonym kapturze, postrzępiony płaszcz, łańcuchy, czaszki u pasa, kosa
    head = 'reaper';
    weapon = 'scythe';
    hair = parseColor(lk.hair, 0xeeeeee);
    body = 'heavy';
    Object.assign(out, { cloak: 0x2a1a18, hunch: false, chains: true, skulls: true, spikes: true, ribs: true, sash: 0xb02018, height: -1, eye: 0xff2a1a } satisfies Partial<UnitLook>);
  } else if (robot) {
    head = 'machine';
    weapon = weapon ?? 'none';
    out.robot = true;
    out.eye = 0xff2a1a;
  } else if (mutation) {
    head = 'bare';
    hairStyle = 1;
    weapon = weapon ?? 'none';
    out.eye = parseColor(lk.accent, 0xb8ff4a);
    out.bareArms = true;
    out.claws = true;
    if (brute || body === 'heavy') {
      // mutant-kolos: ogromne asymetryczne ramię, krosty, łańcuchy, kolce
      Object.assign(out, { hunch: false, bigArm: true, pustules: true, chains: true, spikes: true } satisfies Partial<UnitLook>);
    } else {
      // ghul: wychudzony, przygarbiony, w łachmanach, z odsłoniętymi żebrami
      Object.assign(out, { hunch: true, rags: true, ribs: true, pustules: !ghoul } satisfies Partial<UnitLook>);
      body = 'light';
    }
  } else if (has(tid, 'burner', 'podpal', 'flame')) {
    head = 'gas';
    out.apron = 0x4a3a2c;
  } else if (has(tid, 'psycho', 'szalen', 'berserk')) {
    head = 'skull';
    hairStyle = 6;
    Object.assign(out, { bareArms: true, chains: true, tattoo: accent } satisfies Partial<UnitLook>);
  } else if (has(tid, 'chief', 'boss', 'herszt', 'warlord', 'leader')) {
    head = 'cap';
    body = 'heavy';
    Object.assign(out, { fur: 0x8a7a62, sash: accent, spikes: true, beard: true, coat: 0x24201e } satisfies Partial<UnitLook>);
  } else if (has(tid, 'sniper', 'snajper', 'marksman')) {
    // snajper: płaszcz maskujący z kapturem, długi sztucer z lunetą
    head = 'hood';
    mask = !!lk.mask;
    weapon = 'longgun';
    Object.assign(out, { cloak: 0x4a5230, ghillie: true, scarf: 0x5a5a3a } satisfies Partial<UnitLook>);
  } else if (has(tid, 'gunner', 'shooter', 'strzel')) {
    // strzelec: ciężki karabin maszynowy, bandolier, chusta, jeżyk
    head = 'bare';
    hairStyle = 4;
    mask = !!lk.mask;
    weapon = 'mg';
    Object.assign(out, { bandolier: 0x6a4a24, scarf: accent, spikes: true } satisfies Partial<UnitLook>);
  } else {
    // zbir: gołe ramiona, pancerz z opony, kolce, tatuaż, broda, irokez
    head = 'mohawk';
    Object.assign(out, { bareArms: true, tire: true, spikes: true, tattoo: accent, beard: true } satisfies Partial<UnitLook>);
  }
  if (!weapon) weapon = def?.ai === 'beast' ? 'none' : 'pipe';
  if (!lk.hair && !boss && head !== 'mohawk' && head !== 'skull') hair = 0x2a2018;

  const result: UnitLook = {
    skin: skinC,
    cloth,
    pants: robot ? shade(cloth, 0.7) : mix(shade(cloth, 0.55), 0x2a2420, 0.4),
    boots: robot ? 0x3a3f44 : 0x1c1612,
    accent,
    hair,
    head,
    weapon,
    pack: shade(cloth, 0.78),
    body,
    hairStyle,
    ...out,
  };
  if (mask) result.mask = true;
  if (mutation) result.mutation = true;
  if (cyber) { result.cyber = true; result.eye = result.eye ?? 0xff3a2a; }
  // gotowa postać PixelLab dla szablonu (szabrownicy: src/assets/units/raider_*/) zamiast klatek malowanych kodem
  const sprite = enemySpriteId(templateId);
  if (sprite) result.sprite = sprite;
  return result;
}

/** Arkusz klatek wroga (24x32, te same nazwy klatek co paintUnitSheet) - humanoid albo bestia. */
export function enemySheet(templateId: string | undefined | null, look?: EnemyLookSource | null): UnitSheet {
  const l = enemyUnitLook(templateId, look);
  return isCreatureLook(l) ? paintCreatureSheet(l.shape, l.skin, l.accent, l.creature) : paintUnitSheet(l);
}

// ================================================================== tekstury + animacje

/** Podpis wyglądu, z którym namalowano teksturę (żeby po zmianie broni / ekwipunku odświeżyć arkusz). */
const painted = new WeakMap<Phaser.Textures.Texture, string>();
/** Tekstura, z której są zbudowane animacje `<name>_*` (sprite PixelLab: osobna tekstura na wariant broni). */
const animTex = new Map<string, string>();

/**
 * Buduje (raz) arkusz klatek i animacje idle/walk dla danego wyglądu. Zwraca klucz tekstury.
 * Gdy tekstura już istnieje, a wygląd się zmienił (np. inna broń w ekwipunku), arkusz jest przemalowany w miejscu
 * (te same klatki, więc działające sprite'y i animacje od razu pokazują nowy wygląd).
 * `build` (opcjonalnie) zastępuje paintUnitSheet(look), np. () => enemySheet(templateId, look).
 */
export function ensureUnit(scene: Phaser.Scene, name: string, look: UnitLook | CreatureLook, build?: () => UnitSheet): string {
  const sprite = !build && look.sprite && hasSprite(scene, look.sprite) ? look.sprite : null;
  // sprite PixelLab: tekstura na wariant (zmiana broni = inny obraz i inny układ klatek, nie przemalowanie w miejscu)
  const tex = sprite ? `unit_${name}|${sprite}` : `unit_${name}`;
  const sig = JSON.stringify(look);
  const prev = animTex.get(name);
  if (prev !== tex) {
    // animacje tej postaci wskazywały na inną teksturę (poprzedni wariant broni) - zbudować od nowa
    if (prev) {
      const all = (scene.anims as unknown as { anims: Phaser.Structs.Map<string, Phaser.Animations.Animation> }).anims;
      for (const key of all.keys()) if (key.startsWith(`${name}_`) && all.get(key)?.frames[0]?.textureKey === prev) scene.anims.remove(key);
    }
    animTex.set(name, tex);
  }
  const paint = (): UnitSheet =>
    sprite ? paintSpriteSheet(scene, sprite, isCreatureLook(look))
    : build ? build() : isCreatureLook(look) ? paintCreatureSheet(look.shape, look.skin, look.accent, look.creature) : paintUnitSheet(look);
  if (!scene.textures.exists(tex)) {
    const sheet = paint();
    const d = sheet.density ?? 1;
    if (d !== 1) {
      // obraz gęstszy niż piksele projektowe: ramki i rozmiar projektowy / d, powiększenie najbliższym sąsiadem
      const frames = sheet.frames.map((f) => ({ name: f.name, x: f.x / d, y: f.y / d, w: f.w / d, h: f.h / d }));
      addHiRes(scene, tex, sheet.pc, { w: sheet.pc.w / d, h: sheet.pc.h / d, smooth: false }, frames);
    } else new ArtBook(scene).sheet(tex, sheet.pc, sheet.frames);
    painted.set(scene.textures.get(tex), sig);
    // animacje z pasków PixelLab / 8 kierunków (paintSpriteSheet) - zastępują te z ANIMS o tej samej nazwie
    if ('anims' in sheet) (scene.textures.get(tex).customData as { anims?: SheetAnim[] }).anims = sheet.anims as SheetAnim[];
  } else if (!sprite) {
    const t = scene.textures.get(tex);
    if (painted.get(t) !== sig && t instanceof Phaser.Textures.CanvasTexture) {
      const sheet = paint();
      if (t.width === sheet.pc.w && t.height === sheet.pc.h) {
        t.context.putImageData(new ImageData(new Uint8ClampedArray(sheet.pc.data), sheet.pc.w, sheet.pc.h), 0, 0);
        t.refresh();
      }
      painted.set(t, sig);
    }
  }
  const own = (scene.textures.get(tex).customData as { anims?: SheetAnim[] }).anims ?? [];
  for (const a of own) {
    const key = `${name}_${a.suffix}`;
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: a.frames.map((frame, k) => ({ key: tex, frame, duration: a.durs[k] })),
      frameRate: 10,
      repeat: a.loop ? -1 : 0,
      yoyo: !!a.yoyo,
    });
  }
  for (const f of ['f', 'b'] as const) {
    for (const a of ANIM_ORDER) {
      const key = `${name}_${f}_${a}`;
      if (scene.anims.exists(key)) continue;
      // arkusze bestii nie mają postaw / czynności (iso/CreatureArt maluje tylko BASE_ANIMS)
      if (!scene.textures.get(tex).has(`${f}_${a}0`)) continue;
      const def = ANIMS[a];
      const seq = def.seq ?? def.poses.map((_, i) => i);
      scene.anims.create({
        key,
        frames: seq.map((i, k) => ({ key: tex, frame: `${f}_${a}${i}`, duration: def.durs[k] ?? def.durs[def.durs.length - 1] })),
        frameRate: 10,
        repeat: def.loop ? -1 : 0,
      });
    }
    // powalenie: upadek bez kałuży (klatki die0..die4)
    const downKey = `${name}_${f}_down`;
    if (!scene.anims.exists(downKey))
      scene.anims.create({ key: downKey, frames: [0, 1, 2, 3, 4].map((i) => ({ key: tex, frame: `${f}_die${i}`, duration: ANIMS.die.durs[i] })), frameRate: 10, repeat: 0 });
  }
  return tex;
}

/** Sprite postaci stojącej stopami w (x, y), z animacją oddychania lub chodu. */
export function addUnit(scene: Phaser.Scene, x: number, y: number, name: string, look: UnitLook | CreatureLook, anim: 'idle' | 'walk' = 'idle', scale = 1): Phaser.GameObjects.Sprite {
  const tex = ensureUnit(scene, name, look);
  const s = scene.add.sprite(x, y, tex, 'f_idle0').setOrigin(UNIT_FOOT_X / UNIT_FW, UNIT_FOOT_Y / UNIT_FH).setScale(scale);
  s.play({ key: `${name}_f_${anim}`, startFrame: anim === 'idle' ? Math.abs(Math.round(x)) % 4 : 0 });
  return s;
}
