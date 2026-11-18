import Phaser from 'phaser';
import { type SfxName, SoundManager } from '../audio/SoundManager';
import { campaign } from '../core/campaign/session';
import { type Contract, freshState } from '../core/campaign/state';
import type { EnemyId } from '../core/data/ids';
import type { AbilityDef, AbilityId, ClassId, EnemyLook, SkillId } from '../core/data/types';
import { GAMEOVER_LINES } from '../core/data/story';
import { SKILLS } from '../core/data/rules';
import { type ActionButton, type HudCommand, type InitEntry, type PromptOption, HudState } from '../core/HudState';
import { usesLeft } from '../core/rules/abilities';
import { createCharacter } from '../core/rules/character';
import { useConsumable } from '../core/rules/consumables';
import { fmtDamage, fmtMod, hitChances } from '../core/rules/dice';
import { swapWeapons } from '../core/rules/equipment';
import { abilityDef, conditionDef, enemyDef, itemDef } from '../core/rules/lookup';
import { getStat, getWeapon, hasCondition, normWeapon } from '../core/rules/stats';
import type { CheckResult, DamageRoll } from '../core/rules/dice';
import { HACK_SKILLS, hasLockpick, IMPROVISED_PENALTY, LOCK_SKILLS, type LockAttempt } from '../core/rules/locks';
import type { ActionResult, Character, GridPos } from '../core/rules/types';
import { aiStep } from '../core/tactical/ai';
import { type ActionOutcome, type Actor, type ActorState, type CombatSignal, type StrikeInfo, type TurnInfo, Combat, exploreAbilityOk, exploreItemOk } from '../core/tactical/combat';
import { CellKind, type SearchResult, UNREACHABLE, cheb, strideActions } from '../core/tactical/grid';
import { WRECK_TYPES, type Biome, type MapProp, type PropType, type TacticalMap } from '../core/tactical/mapgen';
import { CRATE_SKILLS, SALVAGE_ACTIONS, type MissionContract, type MissionFind, type MissionResult, type MissionSignal, type MissionThing, Mission } from '../core/tactical/mission';
import { TurnPhase } from '../core/TurnManager';
import { MAX_ACTION_POINTS } from '../core/TurnState';
import {
  ArtBook, type ArtInfo, BIOME_STYLE, type DecalType, FLOOR_SPILL, paintAO, paintBlend, paintBlobShadow, paintBlock, paintCursor, paintDecal, paintEdge, paintFlames,
  paintExtractPost, paintFloor, paintGlow, paintLootCrate, paintLootCrateOpen, paintNest, paintObjective, paintSupplies, paintPathDot, paintProp, paintSparkle, paintText,
  paintVignette, paintWall,
} from './iso/IsoArt';
import { PixelCanvas, hash2, rng } from './iso/Pixel';
import { Atmosphere, type MoodName, type WorldLight, asMood, fogMemoryTint } from './fx/Atmosphere';
import { WorldFx, tracerStyleFor } from './fx/WorldFx';
import { paintScorch } from './iso/FxArt';
import { type CreatureLook, enemySheet, enemyUnitLook, ensureUnit, isCreatureLook, unitLookOf } from './iso/UnitLooks';
import { spriteIdOf } from './iso/SpriteUnits';
import { BASE_H, BASE_W, SX0, SY0, VH, VW, ZOOM, PAL, fitViewport, goto, label } from './ui/Kit';
import { type MissionResume, Save, enterLoaded, modalOpen, openSaveSlots } from './ui/Widgets';
import { FRAME_CORPSE, FRAME_DOWN, LOOK_RAIDER, LOOK_SOLDIER, UNIT_FH, UNIT_FOOT_X, UNIT_FOOT_Y, UNIT_FW, type UnitLook, paintUnitSheet } from './iso/UnitArt';

// Pełna walka PF2e z src/core/tactical (Mission + Combat + AI): drużyna 3 najemników, grupy wrogów,
// wykrywanie w eksploracji, inicjatywa, 3 akcje na turę, PWA, flankowanie, osłona, dołączanie grup.
// Logika żyje w src/core; ta scena tylko animuje sygnały (combat.on / mission.on) i zbiera kliknięcia.

// ------------------------------------------------------------------ rzut izometryczny (tylko warstwa renderowania)

const TILE_W = 32;
/** Barwy zmutowanej fauny (Oldgame/src/scenes/mission.js:153-154). */
const FAUNA_SKINS = ['#8a6a4a', '#5a5a62', '#7a8a4a', '#9a4a5a', '#4a7a8a', '#b89a5a', '#6a4a8a', '#c8c0b0'];
const FAUNA_EYES = ['#ff3a2a', '#ffe040', '#40ffc0', '#ff60ff', '#8fff40'];
const hashStr = (t: string): number => {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
};
const TILE_H = 16;
/**
 * Obrót widoku (Q/E co 90°, Oldgame/src/scenes/mission.js:644) - wyłącznie warstwa renderowania.
 * Logika zostaje w (gx, gy); pole siatki -> pole widoku (vx, vy) obrotem wokół środka mapy W x H,
 * a dopiero widok trafia do rzutu izo. Głębia i maski sąsiedztwa grafik liczone są w widoku.
 */
const VIEW = { r: 0, w: 32, h: 32 };

/** Obiekt sceny przesuwany w animacji obrotu widoku. */
type SpinObj = Phaser.GameObjects.GameObject & {
  x: number; y: number; alpha: number; visible: boolean; scrollFactorX: number;
  setAlpha(a: number): unknown; setVisible(v: boolean): unknown;
};
/** Kotwica obiektu względem osi obrotu w przestrzeni siatki (y x2 = odwrócony rzut 2:1) + przesunięcie obrazka od kotwicy. */
interface SpinEntry { o: SpinObj; rx: number; ry: number; dx: number; dy: number; a: number }
interface Spin {
  t: number; dur: number; full: number; px: number; py: number;
  /** przewijanie kamery: start (bez granic) -> cel (w granicach) */
  cam: { sx: number; sy: number; tx: number; ty: number };
  old: SpinEntry[]; fresh: SpinEntry[]; moved: SpinEntry[]; hidden: { o: SpinObj; vis: boolean }[];
}
/** Pole siatki -> pole widoku (liniowe, działa też dla współrzędnych ułamkowych "pola"). */
const toView = (gx: number, gy: number): [number, number] => {
  switch (VIEW.r) {
    case 1: return [VIEW.h - 1 - gy, gx];
    case 2: return [VIEW.w - 1 - gx, VIEW.h - 1 - gy];
    case 3: return [gy, VIEW.w - 1 - gx];
    default: return [gx, gy];
  }
};
/** Pole widoku -> pole siatki. */
const fromView = (vx: number, vy: number): GridPos => {
  switch (VIEW.r) {
    case 1: return { gx: vy, gy: VIEW.h - 1 - vx };
    case 2: return { gx: VIEW.w - 1 - vx, gy: VIEW.h - 1 - vy };
    case 3: return { gx: VIEW.w - 1 - vy, gy: vx };
    default: return { gx: vx, gy: vy };
  }
};
/** Wektor siatki -> wektor widoku. */
const viewDir = (dx: number, dy: number): [number, number] =>
  VIEW.r === 1 ? [-dy, dx] : VIEW.r === 2 ? [-dx, -dy] : VIEW.r === 3 ? [dy, -dx] : [dx, dy];
/** Sąsiad pola (gx, gy) przesunięty o (vdx, vdy) w przestrzeni WIDOKU - zwraca pole siatki. */
const viewNb = (gx: number, gy: number, vdx: number, vdy: number): GridPos => {
  const [dx, dy] = VIEW.r === 1 ? [vdy, -vdx] : VIEW.r === 2 ? [-vdx, -vdy] : VIEW.r === 3 ? [-vdy, vdx] : [vdx, vdy];
  return { gx: gx + dx, gy: gy + dy };
};
/** Wymiary mapy w widoku (W x H zamienione przy obrocie o 90° / 270°). */
const viewSize = (): { w: number; h: number } => (VIEW.r % 2 ? { w: VIEW.h, h: VIEW.w } : { w: VIEW.w, h: VIEW.h });
/** Górny wierzchołek rombu pola (gx, gy) w świecie. */
const isoX = (gx: number, gy: number): number => {
  const [vx, vy] = toView(gx, gy);
  return (vx - vy) * (TILE_W / 2);
};
const isoY = (gx: number, gy: number): number => {
  const [vx, vy] = toView(gx, gy);
  return (vx + vy) * (TILE_H / 2);
};
/** Środek pola - tu stoją stopy postaci. */
const tileCenter = (p: GridPos): { x: number; y: number } => ({ x: isoX(p.gx, p.gy), y: isoY(p.gx, p.gy) + TILE_H / 2 });
/** Punkt ciągłej przestrzeni siatki (np. róg pola) -> świat. */
const gridPoint = (x: number, y: number): { x: number; y: number } => tileCenter({ gx: x - 0.5, gy: y - 0.5 });
/** Odwrotność rzutu: punkt świata -> pole siatki. */
const worldToGrid = (wx: number, wy: number): GridPos => {
  const a = wx / (TILE_W / 2), b = wy / (TILE_H / 2);
  return fromView(Math.floor((b + a) / 2), Math.floor((b - a) / 2));
};

// ------------------------------------------------------------------ warstwy głębi

const D_EDGE = 0;
const D_GROUND = 1;
const D_DECAL = 2;
const D_AO = 3;
const D_GROUND_GLOW = 4;
const D_CURSOR = 5;
const D_PATH = 6;
const D_UNIT_SHADOW = 7;
/** Obiekty sortowane po vx+vy (suma w widoku): D_OBJ + suma * 4 + warstwa. */
const D_OBJ = 10;
const L_PROP = 1;
const L_UNIT = 2;
const L_FX = 3;
const D_TEXT = 9000;
const D_SCREEN = 9500;
const objDepth = (gx: number, gy: number, layer: number): number => {
  const [vx, vy] = toView(gx, gy);
  return D_OBJ + (vx + vy) * 4 + layer;
};

// ------------------------------------------------------------------ rozgrywka

const STEP_DURATION = 130;
const ATTACK_SFX: readonly SfxName[] = ['shot_pistol', 'shot_rifle', 'shot_shotgun', 'shot_smg', 'shot_laser', 'melee', 'explosion'];
const isAttackSfx = (s: string): s is SfxName => (ATTACK_SFX as readonly string[]).includes(s);

const TINT_VISIBLE = 0xffffff;
const COLOR_OK = 0x9ad84a;
/** Kolory linii strzału (drawShotLine). */
const LASER_OK = 0x48ff5a;
const LASER_FAR = 0xff3a2e;
const LASER_NO_LOS = 0xffa020;
const COLOR_FAR = 0xd84a3a;
const COLOR_HOSTILE = 0xff5040;

type Facing = 'f' | 'b';
type CellState = 0 | 1 | 2; // nieodkryte / zapamiętane / widoczne

interface CellView {
  /** Wszystko, co ma przyciemnienie mgły (podłoga, kalkomanie, rekwizyty). */
  imgs: Phaser.GameObjects.Image[];
  state: CellState;
  reveal: number;
}

interface TallView {
  img: Phaser.GameObjects.Image;
  gx: number;
  gy: number;
  /** Ile pól "przed" obiektem może on zasłonić. */
  reach: number;
  fade: number;
}

interface LightView {
  img: Phaser.GameObjects.Image;
  cell: number;
  base: number;
  kind: 'steady' | 'flicker' | 'pulse' | 'blink';
  phase: number;
}

interface Unit {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  /** Pozycja na ekranie (nadąża za actor.gx/gy w trakcie animacji). */
  pos: GridPos;
  facing: Facing;
  /** Ostatni kierunek patrzenia w siatce (do odświeżenia odbicia po obrocie widoku). */
  dir?: GridPos;
  /** Zwrócona w lewo (SW / NW): klatki przód / tył odbite, chyba że postać ma własny obrót (left()). */
  left?: boolean;
  name: string;
  actor: Actor;
}

type Signal = CombatSignal | MissionSignal;

/** Tryb celowania w turze najemnika (port t.mode ze starego combat.js). null = Marsz / atak klikiem. */
type Mode = { type: 'stride' } | { type: 'step' } | { type: 'strike' } | { type: 'ability'; id: AbilityId } | { type: 'item'; uid: string };

const BIOME_MUSIC: Record<Biome, 'ruins' | 'wastes'> = { ruins: 'ruins', wastes: 'wastes', industrial: 'ruins', bunker: 'ruins' };
const SPEEDS = [1, 2, 4] as const;
/** Kolory zasięgu ruchu wg kosztu w akcjach (niebieski / żółty / pomarańczowy) i Kroku (zielony). */
const MOVE_COL: Record<string, [number, number, number]> = {
  1: [0x468cff, 0.3, 0x8cbeff], 2: [0xf0c832, 0.26, 0xffe15a], 3: [0xf07828, 0.24, 0xff9646], s: [0x46c88c, 0.32, 0x78ffbe],
};
/** Kontury postaci (port OL). */
const OL = { foe: 0xff3b2b, ally: 0x4dff88, hover: 0xffe95a, blast: 0xff9a1a, blastAlly: 0xffe95a, off: 0x8c8c8c } as const;
const C_CRIT = 0xffe060;
const C_COND = 0xe0a0ff;
const C_LOOT = 0xffd040;
const C_COVER = 0x7fb8ff;

declare global {
  interface Window {
    __mission?: unknown;
  }
}

const COLOR_ALLY = 0xe0b040;

/** Wygląd drużyny demonstracyjnej wg klasy (w kampanii kolory pochodzą z postaci: unitLookOf). */
const DEMO_LOOKS: Partial<Record<ClassId, UnitLook>> = {
  soldier: LOOK_SOLDIER,
  scout: { ...LOOK_SOLDIER, cloth: 0x6a5a3a, pants: 0x3a3a30, accent: 0x8aa070, hair: 0x6a4424, head: 'hood', pack: 0x5a4a30 },
  medic: { ...LOOK_SOLDIER, cloth: 0xb0ac9c, pants: 0x5a5a52, accent: 0xc83a2a, hair: 0x2a1a10, head: 'hood', pack: 0x8a2a20 },
};
const LOOK_CAPTIVE: UnitLook = { ...LOOK_SOLDIER, skin: 0xc9a27c, cloth: 0x7a6a50, pants: 0x4a4038, accent: 0xc0a030, hair: 0x4a3a2a, head: 'hood', weapon: 'pipe', pack: 0x5a4a3a };
const LOOK_GUNNER: UnitLook = { ...LOOK_RAIDER, cloth: 0x4a3a2e, accent: 0x8a8a7a, head: 'hood', weapon: 'rifle' };

/** Drużyna i zlecenie demonstracyjne (tylko przy starcie sceny bez kampanii: ?scene=WorldScene). */
/** Drużyna misji demonstracyjnej; `recruit` = postać PixelLab (iso/SpriteUnits) tego najemnika. */
const PARTY: readonly { name: string; acc: string; classId: ClassId; recruit: string }[] = [
  { name: 'Kruk', acc: 'Kruka', classId: 'soldier', recruit: 'kruk' },
  { name: 'Sowa', acc: 'Sowę', classId: 'scout', recruit: 'sowa' },
  { name: 'Igła', acc: 'Igłę', classId: 'medic', recruit: 'igla' },
];
const ENEMIES = ['raider_thug', 'raider_gunner', 'raider_thug', 'raider_thug', 'raider_gunner'] as EnemyId[];

export interface WorldSceneData {
  contract?: Contract;
  /** Wczytany zapis z misji w toku (Widgets.enterLoaded). */
  resume?: MissionResume;
}

export class WorldScene extends Phaser.Scene {
  /** Zlecenie z tablicy (null = tryb demonstracyjny). */
  private job: Contract | null = null;
  /** Misja wczytywana z zapisu (tylko w create()). */
  private resume: MissionResume | null = null;
  /** Stan kampanii z chwili wejścia na teren (do "Zapisz i wyjdź" - misja i jej nagrody przepadają). */
  private entrySnapshot: string | null = null;
  private map!: TacticalMap;
  private biome: Biome = 'ruins';
  private art!: ArtBook;
  /** Misja z src/core/tactical: drużyna, wrogowie, mgła, wykrywanie; w środku walka (Combat). */
  private mission!: Mission;
  /** Stan HUD-u (src/core) - współdzielony z UIScene. */
  private hud!: HudState;

  private cells: CellView[] = [];
  private tall: TallView[] = [];
  private glows: LightView[] = [];
  private revealing = new Set<number>();
  private sparkles = new Map<number, Phaser.GameObjects.Sprite>();

  private units = new Map<Actor, Unit>();
  /** Postać śledzona przez kamerę (i odsłaniana z wysokich obiektów). */
  private focus!: Unit;
  private cursor!: Phaser.GameObjects.Image;
  private pathDots: Phaser.GameObjects.Image[] = [];
  private costLabel: Phaser.GameObjects.Image | null = null;
  /** Efekty walki (src/scenes/fx/WorldFx) i nastrój misji (src/scenes/fx/Atmosphere). */
  private fx!: WorldFx;
  private atmo: Atmosphere | null = null;
  private mood: MoodName = 'dusk';
  /** Przypalenia po wybuchach (odtwarzane po obrocie widoku). */
  private scorches: { gx: number; gy: number; seed: number }[] = [];
  private burning = new Map<Actor, { setPosition(x: number, y: number): void; destroy(): void }>();
  /** Skażone pola i beczki (licznik Geigera). */
  private toxicCells: GridPos[] = [];
  private geigerAt = 0;
  private geigerIdle = 4;
  private objDone = false;
  private panKeys: Record<string, Phaser.Input.Keyboard.Key> = {};

  /** Sygnały z logiki czekające na animację (odtwarzane po kolei w flush()). */
  private signals: Signal[] = [];
  /** Tura najemnika sterowanego przez gracza (null = tura wroga / eksploracja). */
  private playerTurn: TurnInfo | null = null;
  private turnDone: (() => void) | null = null;
  private reachCache: { res: SearchResult; sp: number } | null = null;
  private combatRunning = false;
  private over = false;
  private seenGroups = new Set<number>();
  private following = false;
  private elapsed = 0;
  /** Tempo animacji (x1/x2/x4) = timeScale zegara i tweenów sceny. */
  private speed = 1;
  /** Przybliżenie kamery względem ZOOM (0.5 - 2). */
  private camZoom = 1;
  /** Warstwa ekranowa (winieta, nastrój, pył) - skalowana razem z przybliżeniem. */
  private overlay!: Phaser.GameObjects.Container;
  private rangeGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;
  /** Linia strzału (laser) od aktywnej postaci do wroga pod kursorem. */
  private laserGfx!: Phaser.GameObjects.Graphics;
  private ringGfx!: Phaser.GameObjects.Graphics;
  private barGfx!: Phaser.GameObjects.Graphics;
  private barMarks = new Map<Actor, Phaser.GameObjects.Image>();
  private outline = new Map<Actor, number>();
  private hoverOutline = new Map<Actor, number>();
  private mode: Mode | null = null;
  private sub: 'items' | null = null;
  /** Podpowiedź trybu celowania (gdy kursor nic nie wskazuje). */
  private modeHint: string | null = null;
  private extractAsked = false;
  private crates = new Map<number, { img: Phaser.GameObjects.Image; sparkle: Phaser.GameObjects.Sprite | null }>();
  /** Wraki pojazdów (obraz do podmiany po rozebraniu / wybuchu, płomienie wysadzonych). */
  private wrecks = new Map<number, { img: Phaser.GameObjects.Image; prop: MapProp; rot: number; flames: Phaser.GameObjects.Sprite | null }>();
  private objMarker: { imgs: Phaser.GameObjects.Image[]; light: LightView | null } | null = null;
  /** Obiekty celów zlecenia na mapie: serwer (włamanie) i gniazda (oczyszczanie). */
  private thingMarks = new Map<MissionThing, { imgs: Phaser.GameObjects.Image[]; light: LightView | null }>();
  /** Cel wykonany - pytanie o dalsze przeszukiwanie / ewakuację przy najbliższym powrocie do eksploracji. */
  private completeAsk = false;
  private extract: { caps: Phaser.GameObjects.Image[]; posts: Phaser.GameObjects.Image[]; beacon: Phaser.GameObjects.Container } | null = null;
  private floatStack = new Map<Actor, { t: number; n: number }>();
  private drag: { x: number; y: number; moved: boolean; btn: number } | null = null;
  /** Trwająca animacja obrotu widoku (Q/E) - patrz rotateView / updateSpin. */
  private spin: Spin | null = null;

  private get combat(): Combat {
    return this.mission.combat;
  }

  /** Aktor wybrany w HUD-zie (lider w eksploracji / postać w turze). */
  private get selected(): Actor | null {
    const ch = this.hud.active;
    return this.mission.pcs.find((p) => p.ch === ch) ?? null;
  }

  /** Kto działa z paska akcji: najemnik w turze walki albo wybrany najemnik w eksploracji. */
  private actorNow(): Actor | null {
    if (this.playerTurn) return this.playerTurn.actor;
    if (this.hud.inCombat || this.over || this.mission.mode !== 'explore') return null;
    const s = this.selected;
    return s && s.state === 'up' ? s : null;
  }

  constructor() {
    super('WorldScene');
  }

  init(data: WorldSceneData): void {
    this.job = data?.contract ?? null;
    this.resume = data?.resume ?? null;
  }

  create(): void {
    // Pola klasy nie są resetowane przy scene.restart(), więc ustawiamy je tutaj.
    // To samo dotyczy scene.data: flaga 'leaving' z goto() przeżywa restart i blokowałaby
    // kolejne wyjście do ekranu tytułowego (czarny ekran z muzyką misji). Kit.enter() robi to samo,
    // ale WorldScene ma własne wejście kamery.
    this.data.set('leaving', false);
    this.input.enabled = true;
    this.elapsed = 0;
    this.cells = [];
    this.tall = [];
    this.glows = [];
    this.pathDots = [];
    this.costLabel = null;
    this.scorches = [];
    this.spin = null;
    this.burning = new Map();
    this.geigerAt = 0;
    this.objDone = false;
    this.completeAsk = false;
    this.thingMarks = new Map();
    this.atmo = null;
    this.revealing = new Set();
    this.sparkles = new Map();
    this.units = new Map();
    this.signals = [];
    this.playerTurn = null;
    this.turnDone = null;
    this.reachCache = null;
    this.combatRunning = false;
    this.over = false;
    this.seenGroups = new Set();
    this.barMarks = new Map();
    this.outline = new Map();
    this.hoverOutline = new Map();
    this.mode = null;
    this.sub = null;
    this.modeHint = null;
    this.extractAsked = false;
    this.crates = new Map();
    this.wrecks = new Map();
    this.objMarker = null;
    this.extract = null;
    this.floatStack = new Map();
    this.drag = null;
    this.camZoom = 1;

    // Zlecenie z tablicy + drużyna kampanii; bez nich (start deweloperski) - zlecenie demonstracyjne.
    // Demo: ?biome=ruins|wastes|industrial|bunker&seed=abc
    let party: Character[];
    let contract: MissionContract;
    this.entrySnapshot = null;
    const resume = this.resume && this.job && this.resume.snap.contractId === this.job.id ? this.resume : null;
    this.resume = null;
    Save.pending = null;
    if (this.job && campaign.state.party.length) {
      this.entrySnapshot = resume ? resume.entry : JSON.stringify(campaign.state);
      party = campaign.state.party;
      contract = this.job;
      this.biome = this.job.biome;
      // bez nastroju w zleceniu: zmierzch (Oldgame/src/scenes/mission.js:79)
      this.mood = asMood(this.job.mood);
    } else {
      this.job = null;
      const params = new URLSearchParams(window.location.search);
      const biomeParam = params.get('biome');
      this.biome = biomeParam === 'wastes' || biomeParam === 'industrial' || biomeParam === 'bunker' ? biomeParam : 'ruins';
      const seed = params.get('seed') ?? `demo-${Math.floor(Math.random() * 1e6)}`;
      // demo: ?mood=day|dusk|night|storm|toxic  &enemies=drone,raider_burner,...
      this.mood = asMood(params.get('mood'));
      const foes = (params.get('enemies') ?? '').split(',').filter((id) => !!enemyDef(id as EnemyId)) as EnemyId[];
      party = PARTY.map((p) => {
        const ch = createCharacter({ name: p.name, classId: p.classId, ancestry: 'human', recruitId: p.recruit });
        ch.nameAcc = p.acc;
        return ch;
      });
      // demo: ?type=retrieve|rescue|hunt|eliminate|hack|liberate|purge|defend|forage
      const titles = {
        eliminate: 'Oczyść teren', retrieve: 'Odzyskaj ładunek', rescue: 'Uwolnij jeńca', hunt: 'Polowanie',
        hack: 'Włamanie do serwera', liberate: 'Uwolnić osadę Nomadów', purge: 'Oczyścić dzielnicę', defend: 'Obrona Przystani',
        forage: 'Pusty spichrz',
      } as const;
      const tp = params.get('type') ?? '';
      const type: keyof typeof titles = tp in titles ? (tp as keyof typeof titles) : 'eliminate';
      contract = { id: seed, title: titles[type], type, level: 1, biome: this.biome, enemies: foes.length ? foes : ENEMIES, objective: { type, itemId: type === 'retrieve' ? 'radio_part' : null } };
    }
    this.mission = new Mission(contract, party, Math.random, resume?.snap);
    this.objDone = !!resume && this.mission.objectiveDone();
    this.map = this.mission.map;
    this.mission.on((s) => this.signals.push(s));
    this.combat.on((s) => this.signals.push(s));

    this.hud = new HudState();
    this.hud.party = party;
    this.hud.maxAp = MAX_ACTION_POINTS;
    this.hud.ap = MAX_ACTION_POINTS;
    this.hud.setPhase(TurnPhase.EXPLORATION, 1);
    let sp = 1;
    try {
      sp = Number(window.localStorage.getItem('pir-speed')) || 1;
    } catch {
      sp = 1;
    }
    this.applySpeed((SPEEDS as readonly number[]).includes(sp) ? sp : 1);
    this.hud.setObjectives(contract.title ?? 'Zlecenie', this.mission.objectives().map((l) => ({ text: l.text, done: l.done, go: l.go, dim: l.tone === 'dim' })));

    this.art = new ArtBook(this);
    VIEW.r = 0;
    VIEW.w = this.map.width;
    VIEW.h = this.map.height;
    this.cameras.main.setBackgroundColor(BIOME_STYLE[this.biome].bg);
    this.createSharedTextures();
    this.fx = new WorldFx(this, { ground: D_UNIT_SHADOW + 0.6, air: D_TEXT - 2, smoke: D_TEXT - 4 });
    this.toxicCells = [];
    this.map.floor.forEach((f, i) => { if (f === 'toxic') this.toxicCells.push({ gx: i % this.map.width, gy: Math.floor(i / this.map.width) }); });
    for (const p of [...this.map.props, ...this.map.deco, ...this.map.decor]) if (p.type === 'barrel_toxic') this.toxicCells.push({ gx: p.gx, gy: p.gy });
    this.buildWorld();
    for (const cell of this.cells) for (const img of cell.imgs) img.setVisible(false); // wszystko zaczyna w mgle
    this.createUnits();
    if (resume) this.restoreUnitStates();
    this.createOverlays();
    this.setupCamera();
    this.updateFogOfWar();

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (d && pointer.isDown && (d.btn === 2 || d.btn === 1)) {
        const dx = pointer.x - d.x, dy = pointer.y - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 0) {
          d.moved = true;
          const cam = this.cameras.main;
          cam.stopFollow();
          this.following = false;
          cam.scrollX -= dx / cam.zoom;
          cam.scrollY -= dy / cam.zoom;
          d.x = pointer.x;
          d.y = pointer.y;
        }
        return;
      }
      this.refreshPathPreview();
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 2 || pointer.button === 1) {
        this.drag = { x: pointer.x, y: pointer.y, moved: false, btn: pointer.button };
        return;
      }
      if (!this.hud.canAct || pointer.button !== 0 || this.hud.prompt) return;
      const cell = this.pointerCell();
      if (!this.inMap(cell.gx, cell.gy)) return;
      if (this.cells[this.idx(cell.gx, cell.gy)].state === 0) {
        // Oldgame mission.js:636-637: nieodkryty teren - komunikat i ruch w tamtą stronę (w eksploracji)
        if (this.hud.inCombat) return;
        this.hud.pushLog('Nieodkryty teren.');
      }
      if (this.hud.inCombat) void this.combatClick(cell);
      else void this.exploreClick(cell);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const d = this.drag;
      this.drag = null;
      if (d && d.btn === 2 && !d.moved && pointer.button === 2 && !this.cancelMode()) this.turnToPointer();
    });
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.overUi(pointer)) return;
      this.zoomBy(dy < 0 ? 1.15 : 1 / 1.15);
    });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (this.hud.prompt || this.hud.helpOpen) return;
      if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.25);
      else if (e.key === '0') this.setZoom(1);
      else if (e.key === 'q' || e.key === 'Q') this.rotateView(-1);
      else if (e.key === 'e' || e.key === 'E') this.rotateView(1);
    });

    // Polecenia z HUD-u (UIScene) -> logika
    const offCmd = this.hud.onCommand((c) => this.onHudCommand(c));
    // zapis gry w trakcie misji dołącza stan planszy (Save.missionProvider)
    const provider = (): MissionResume | null => this.missionResume();
    Save.missionProvider = provider;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (Save.missionProvider === provider) Save.missionProvider = null;
      offCmd();
      this.hud.answer(null);
      this.finishPlayerTurn();
      if (import.meta.env.DEV) window.__mission = undefined;
      this.tweens.timeScale = 1;
      this.time.timeScale = 1;
      this.scene.stop('UIScene');
    });

    this.scene.launch('UIScene', { hud: this.hud });
    this.refreshActions();
    // zlecenie (tytuł i cele) widać w panelu ZLECENIE - dziennik go nie powtarza
    if (resume) this.hud.pushLog('Wczytano zapis misji.', 'amber');
    if (!resume && this.mission.objType === 'defend') this.hud.pushLog('Zajmijcie pozycje — za chwilę nadciągnie pierwsza fala napastników.', 'bad');
    this.hud.pushLog('Klikaj pola, by się poruszać; klik na skrzynię / cel = interakcja. Wrogowie czyhają w ciemności. [H] sterowanie.');
    this.updateFoes();
    this.refreshOverlay();
    try {
      SoundManager.music(BIOME_MUSIC[this.biome] ?? 'ruins');
      // tło: burza zawsze wyje wiatrem; ruiny / przemysł / bunkier - 'ruins', pustkowia - 'wind'
      SoundManager.ambience(this.mood === 'storm' || this.biome === 'wastes' ? 'wind' : 'ruins');
    } catch {
      // dźwięk opcjonalny
    }
    if (import.meta.env.DEV) this.devApi();
  }

  /** DEV: window.__mission (port Oldgame/src/scenes/mission.js:39-44, combat.js:592-597). */
  private devApi(): void {
    const self = this;
    window.__mission = {
      state: this.mission,
      scene: this,
      winNow: async () => {
        self.mission.finish('success');
        await self.flush();
      },
      loseNow: async () => {
        for (const p of self.mission.pcs) p.ch.conditions.dead = 1;
        self.combat.syncAll();
        self.mission.finish('fail');
        await self.flush();
      },
      autoTurn: () => self.autoTurn(),
      walkTo: (x: number, y: number) => self.exploreClick({ gx: x, gy: y }),
      get mode() {
        return self.mission.mode;
      },
    };
  }

  /** DEV: tura najemnika rozegrana przez AI. */
  private async autoTurn(): Promise<boolean> {
    const t = this.playerTurn;
    if (!t || !this.hud.canAct) return false;
    this.hud.setBusy(true);
    for (let g = 0; g < 10; g++) {
      if (!aiStep(this.combat, t.actor)) break;
      await this.flush();
      this.updateFogOfWar();
    }
    if (this.over) return true;
    this.finishPlayerTurn();
    return true;
  }

  private onHudCommand(c: HudCommand): void {
    if (this.over) return;
    switch (c.kind) {
      case 'endTurn':
        if (this.playerTurn && this.hud.canAct) this.finishPlayerTurn();
        else if (!this.hud.inCombat) {
          this.following = false;
          this.refollow();
        }
        break;
      case 'action':
        void this.onAction(c.id);
        break;
      case 'cancel':
        this.cancelMode();
        break;
      case 'retreat':
        void this.askRetreat();
        break;
      case 'quit':
        void this.askQuit();
        break;
      case 'save':
        void this.saveLoadSlots('save');
        break;
      case 'load':
        void this.saveLoadSlots('load');
        break;
      case 'zoom':
        this.zoomBy(c.f);
        break;
      case 'toggleGroup':
        this.hud.setGroupMove(!this.hud.groupMove);
        this.hud.pushLog(this.hud.groupMove ? 'Ruch: cała drużyna.' : 'Ruch: jeden najemnik.');
        this.refreshOverlay();
        this.refreshPathPreview();
        break;
      case 'cycleSpeed': {
        const i = (SPEEDS as readonly number[]).indexOf(this.speed);
        this.applySpeed(SPEEDS[(i + 1) % SPEEDS.length]);
        try {
          window.localStorage.setItem('pir-speed', String(this.speed));
        } catch {
          // brak pamięci przeglądarki
        }
        break;
      }
      case 'cycleMember': {
        if (this.hud.inCombat) {
          const a = this.combat.turn?.actor;
          const u = a && this.units.get(a);
          if (u) this.focusOn(u);
          break;
        }
        const ups = this.mission.pcs.filter((p) => p.state === 'up');
        const cur = this.selected;
        const next = ups[(ups.indexOf(cur as Actor) + 1) % ups.length];
        if (next) void this.selectMember(next);
        break;
      }
      case 'useItem':
        void this.playerUseItem(c.uid);
        break;
      case 'swapWeapons':
        void this.playerSwapWeapons();
        break;
      case 'selectMember': {
        const ch = this.hud.party[c.index];
        const a = this.mission.pcs.find((p) => p.ch === ch);
        if (a) void this.selectMember(a);
        break;
      }
    }
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    this.elapsed += dt;
    this.updateReveal(dt);
    this.updateCutaway(dt);
    this.updateLights();
    this.updateDust(dt);
    this.updateCameraPan(dt);
    this.updateMarkers();
    this.updateExtraction();
    this.updateSpin(delta / 1000);
  }

  private applySpeed(s: number): void {
    this.speed = s;
    this.tweens.timeScale = s;
    this.time.timeScale = s;
    this.hud.setSpeed(s);
  }

  // ================================================================== budowa świata

  private createSharedTextures(): void {
    const plain = (key: string, pc: PixelCanvas) => this.art.get(key, () => ({ pc, ax: 0, ay: 0 }));
    plain('fx_shadow', paintBlobShadow());
    plain('fx_glow', paintGlow(96, 48));
    plain('fx_halo', paintGlow(20, 20));
    plain('fx_cursor', paintCursor());
    plain('fx_dot', paintPathDot());
    const px = new PixelCanvas(2, 2);
    px.rect(0, 0, 2, 2, 0xffffff);
    plain('fx_px', px);
    const flames = paintFlames();
    this.art.sheet('fx_flames', flames.pc, flames.frames);
    WorldFx.textures(this.art);
    const sparkle = paintSparkle();
    this.art.sheet('fx_sparkle', sparkle.pc, sparkle.frames);
    if (!this.anims.exists('flames')) {
      this.anims.create({ key: 'flames', frames: flames.frames.map((f) => ({ key: 'fx_flames', frame: f.name })), frameRate: 9, repeat: -1 });
      this.anims.create({
        key: 'sparkle',
        frames: [...sparkle.frames, ...sparkle.frames.slice().reverse()].map((f) => ({ key: 'fx_sparkle', frame: f.name })),
        frameRate: 10,
        repeat: -1,
        repeatDelay: 1400,
      });
    }
  }

  private idx(gx: number, gy: number): number {
    return gy * this.map.width + gx;
  }

  private inMap(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.map.width && gy < this.map.height;
  }

  /** Dodaje obraz zakotwiczony wierzchołkiem rombu w polu (gx, gy). */
  private place(gx: number, gy: number, key: string, ax: number, ay: number, depth: number, dx = 0, dy = 0): Phaser.GameObjects.Image {
    const img = this.add.image(isoX(gx, gy) - ax + dx, isoY(gx, gy) - ay + dy, key).setOrigin(0, 0).setDepth(depth);
    this.cells[this.idx(gx, gy)].imgs.push(img);
    return img;
  }

  private buildWorld(): void {
    const m = this.map;
    const W = m.width, H = m.height;
    const style = BIOME_STYLE[this.biome];
    for (let i = 0; i < W * H; i++) this.cells.push({ imgs: [], state: 0, reveal: 0 });

    // --- podłoga, skarpy na krawędziach, okluzja przy wysokich przeszkodach
    const high = (gx: number, gy: number) => this.inMap(gx, gy) && m.grid.kind(gx, gy) === CellKind.HIGH;
    const vs = viewSize();
    for (let gy = 0; gy < H; gy++)
      for (let gx = 0; gx < W; gx++) {
        const type = m.floor[this.idx(gx, gy)];
        const h = Math.floor(hash2(gx, gy, m.seed) * 1000);
        const variant = type === 'metal' && h % 9 === 0 ? 3 : h % 3; // wariant 3 (pasy ostrzegawcze) rzadko
        const key = `floor_${type}_${variant}`;
        this.art.get(key, () => ({ pc: paintFloor(type, variant), ax: 16, ay: 0 }));
        this.place(gx, gy, key, 16, 0, D_GROUND);

        // przejścia terenu: miękki materiał sąsiada wchodzi na to pole
        const mine = FLOOR_SPILL[type] ?? 0;
        const spill = new Map<string, number>();
        ([[-1, 0, 1], [0, -1, 2], [1, 0, 4], [0, 1, 8]] as const).forEach(([dx, dy, bit]) => {
          const n = viewNb(gx, gy, dx, dy); // krawędzie grafiki są w przestrzeni widoku
          if (!this.inMap(n.gx, n.gy)) return;
          const other = m.floor[this.idx(n.gx, n.gy)];
          if ((FLOOR_SPILL[other] ?? 0) > mine) spill.set(other, (spill.get(other) ?? 0) | bit);
        });
        [...spill.entries()]
          .sort((a, b) => (FLOOR_SPILL[a[0] as keyof typeof FLOOR_SPILL] ?? 0) - (FLOOR_SPILL[b[0] as keyof typeof FLOOR_SPILL] ?? 0))
          .forEach(([other, edges]) => {
            const bv = h % 2;
            const k = `blend_${other}_${edges}_${bv}`;
            this.art.get(k, () => ({ pc: paintBlend(other as typeof type, edges, bv * 13 + edges), ax: 16, ay: 0 }));
            this.place(gx, gy, k, 16, 0, D_GROUND);
          });

        const [vx, vy] = toView(gx, gy);
        if (vy === vs.h - 1) {
          const k = `edge_l_${this.biome}`;
          this.art.get(k, () => ({ pc: paintEdge('l', this.biome), ax: 16, ay: 0 }));
          this.place(gx, gy, k, 16, 0, D_EDGE);
        }
        if (vx === vs.w - 1) {
          const k = `edge_r_${this.biome}`;
          this.art.get(k, () => ({ pc: paintEdge('r', this.biome), ax: 16, ay: 0 }));
          this.place(gx, gy, k, 16, 0, D_EDGE);
        }

        if (!high(gx, gy)) {
          const hv = (dx: number, dy: number) => {
            const n = viewNb(gx, gy, dx, dy);
            return high(n.gx, n.gy);
          };
          let mask = (hv(-1, 0) ? 1 : 0) | (hv(0, -1) ? 2 : 0) | (hv(1, 0) ? 4 : 0) | (hv(0, 1) ? 8 : 0);
          if (!(mask & 3) && hv(-1, -1)) mask |= 16;
          if (mask) {
            const k = `ao_${mask}`;
            this.art.get(k, () => ({ pc: paintAO(mask), ax: 16, ay: 0 }));
            this.place(gx, gy, k, 16, 0, D_AO);
          }
        }
        if (type === 'toxic') this.addLight(gx, gy, 0x6ad030, 0.5, 0.5, 0, 0.55, 'pulse', 0.6, D_GROUND_GLOW);
      }

    // --- kalkomanie: plamy, przypalenia, nawiany piasek - rozbijają powtarzalność siatki
    const R = rng(m.seed ^ 0x5eed);
    const decals: Record<Biome, DecalType[]> = {
      ruins: ['scorch', 'oil', 'stain', 'stain', 'moss', 'sand'],
      wastes: ['stain', 'stain', 'scorch', 'scorch', 'moss', 'stain', 'blood'],
      industrial: ['oil', 'oil', 'stain', 'scorch', 'moss'],
      bunker: ['oil', 'stain', 'stain', 'blood', 'moss'],
    };
    const nDecals = Math.round((W * H) / 11);
    for (let i = 0; i < nDecals; i++) {
      const gx = Math.floor(R() * W), gy = Math.floor(R() * H);
      if (m.grid.kind(gx, gy) === CellKind.HIGH) continue;
      const list = decals[this.biome];
      const type = list[Math.floor(R() * list.length)];
      const v = Math.floor(R() * 5);
      const k = `decal_${type}_${v}`;
      this.art.get(k, () => ({ pc: paintDecal(type, v * 97 + type.length), ax: 24, ay: 4 }));
      this.place(gx, gy, k, 24, 4, D_DECAL, Math.round((R() - 0.5) * 12), Math.round((R() - 0.5) * 6)).setFlipX(R() < 0.5);
    }

    // --- budynki (bloki pięter) i lite ściany bunkra
    const buildingAt = new Int16Array(W * H).fill(-1);
    m.buildings.forEach((b, bi) => {
      for (let y = b.gy; y < b.gy + b.d; y++) for (let x = b.gx; x < b.gx + b.w; x++) if (this.inMap(x, y)) buildingAt[this.idx(x, y)] = bi;
    });
    const sameB = (x: number, y: number, bi: number, vdx: number, vdy: number) => {
      const n = viewNb(x, y, vdx, vdy); // ściany bloku wg sąsiadów w widoku
      return this.inMap(n.gx, n.gy) && buildingAt[this.idx(n.gx, n.gy)] === bi;
    };
    m.buildings.forEach((b, bi) => {
      const color = style.facade[b.seed % style.facade.length];
      for (let y = b.gy; y < b.gy + b.d; y++)
        for (let x = b.gx; x < b.gx + b.w; x++) {
          if (!this.inMap(x, y)) continue;
          const open = (sameB(x, y, bi, 0, 1) ? 0 : 1) | (sameB(x, y, bi, 1, 0) ? 0 : 2) | (sameB(x, y, bi, -1, 0) ? 0 : 4) | (sameB(x, y, bi, 0, -1) ? 0 : 8);
          const seed = b.seed * 131 + x * 31 + y * 17;
          const k = `bld_${b.h}_${open}_${color.toString(16)}_${seed}`;
          const info = this.art.get(k, () => paintBlock('building', b.h, open, color, seed));
          this.addTall(x, y, this.place(x, y, k, info.ax, info.ay, objDepth(x, y, L_PROP)), info.ay);
        }
    });
    const solid = new Uint8Array(W * H);
    for (const s of m.solids) solid[this.idx(s.gx, s.gy)] = 1;
    const isSolid = (p: GridPos) => !this.inMap(p.gx, p.gy) || solid[this.idx(p.gx, p.gy)] === 1;
    for (const s of m.solids) {
      const open = (isSolid(viewNb(s.gx, s.gy, 0, 1)) ? 0 : 1) | (isSolid(viewNb(s.gx, s.gy, 1, 0)) ? 0 : 2);
      const variant = Math.floor(hash2(s.gx, s.gy, 3) * 4);
      const k = `bunker_${open}_${variant}`;
      const info = this.art.get(k, () => paintBlock('bunker', 0, open, style.wall, variant * 977 + 5));
      const img = this.place(s.gx, s.gy, k, info.ax, info.ay, objDepth(s.gx, s.gy, L_PROP));
      if (open) this.addTall(s.gx, s.gy, img, info.ay);
    }

    // --- rekwizyty blokujące, dekoracje, drzwi
    const wallLike = new Set<PropType>(['wall', 'wall_broken', 'door']);
    const propAt = new Map<number, PropType>();
    for (const p of m.props) propAt.set(this.idx(p.gx, p.gy), p.type);
    for (const d of m.decor) propAt.set(this.idx(d.gx, d.gy), d.type);
    const isWall = (x: number, y: number) => this.inMap(x, y) && wallLike.has(propAt.get(this.idx(x, y)) ?? 'crate');
    /** Ściana obok w przestrzeni widoku (łączenia grafik muszą iść wg ekranu, nie siatki). */
    const wallV = (x: number, y: number, vdx: number, vdy: number) => {
      const n = viewNb(x, y, vdx, vdy);
      return isWall(n.gx, n.gy);
    };

    const drawProp = (p: MapProp) => {
      const { gx, gy, type } = p;
      if (type === 'wall' || type === 'wall_broken') {
        const conn = (wallV(gx, gy, -1, 0) ? 1 : 0) | (wallV(gx, gy, 1, 0) ? 2 : 0) | (wallV(gx, gy, 0, -1) ? 4 : 0) | (wallV(gx, gy, 0, 1) ? 8 : 0);
        const broken = type === 'wall_broken';
        const v = p.seed % 3;
        const shape = conn || ((p.rot + VIEW.r) % 2 ? 12 : 3); // samotny segment: wg orientacji w widoku
        const k = `wall_${this.biome}_${conn}_${shape}_${broken ? 1 : 0}_${v}`;
        const info = this.art.get(k, () => paintWall(shape, broken, style.wall, this.biome, v * 71 + conn));
        const img = this.place(gx, gy, k, info.ax, info.ay, objDepth(gx, gy, L_PROP));
        if (!broken) this.addTall(gx, gy, img, info.ay);
        return;
      }
      // orientacja w widoku: przy obrocie o 90° / 270° oś rekwizytu zamienia się
      const rot = type === 'door' ? (wallV(gx, gy, -1, 0) || wallV(gx, gy, 1, 0) ? 0 : 1) : p.rot + VIEW.r;
      const wreck = WRECK_TYPES.has(type) ? this.wreckAt(gx, gy) : undefined;
      const { key: k, ax, ay } = this.propArt(p, rot, wreck);
      const flat = type === 'skeleton';
      const img = this.place(gx, gy, k, ax, ay, flat ? D_DECAL : objDepth(gx, gy, L_PROP));
      if (ay > 34) this.addTall(gx, gy, img, ay);
      if (wreck) {
        this.wrecks.set(this.idx(gx, gy), { img, prop: p, rot, flames: null });
        if (wreck.exploded) this.wreckFlames(wreck);
      }

      // światła i efekty rekwizytów
      switch (type) {
        case 'lamp':
          this.addLight(gx, gy, 0xffb050, 0.95, 0.5, 0, 0.7, 'steady', 1.25);
          this.addLight(gx, gy, 0xffd890, 0.86, 0.5, 37, 1, 'flicker', 0.5, objDepth(gx, gy, L_FX), 'fx_halo');
          break;
        case 'campfire': {
          this.addLight(gx, gy, 0xff7a30, 0.5, 0.5, 0, 0.85, 'flicker', 1.4);
          const { x, y } = tileCenter({ gx, gy });
          const fire = this.add.sprite(x, y + 1, 'fx_flames', 'f0').setOrigin(0.5, 1).setDepth(objDepth(gx, gy, L_FX)).setBlendMode(Phaser.BlendModes.ADD);
          fire.play({ key: 'flames', startFrame: Math.floor(hash2(gx, gy, 1) * 4) });
          this.cells[this.idx(gx, gy)].imgs.push(fire as unknown as Phaser.GameObjects.Image);
          break;
        }
        case 'terminal':
          this.addLight(gx, gy, 0x46f2c8, 0.5, 0.75, 0, 0.5, 'flicker', 0.55);
          break;
        case 'barrel_toxic':
          this.addLight(gx, gy, 0x7aff50, 0.5, 0.5, 0, 0.5, 'pulse', 0.5);
          break;
        case 'antenna':
          this.addLight(gx, gy, 0xff3020, 0.5, 0.5, 62, 1, 'blink', 0.35, objDepth(gx, gy, L_FX), 'fx_halo');
          break;
        default:
          break;
      }
    };
    for (const p of m.props) drawProp(p);
    for (const p of m.deco) drawProp(p);
    for (const d of m.decor) drawProp({ ...d, rot: 0, seed: d.gx * 7 + d.gy });

    // --- skrzynie z łupem, znaleziska, cel misji
    for (const c of m.crates) {
      // stan z misji (ważne po wczytaniu zapisu): przeszukana skrzynia bez błysku, otwarta (nie zacięta) - z otwartym wiekiem
      const th = this.mission.things.find((t) => t.kind === 'crate' && t.gx === c.gx && t.gy === c.gy);
      const open = !!th?.done && (th.tries ?? 0) < 2;
      const info = open ? this.art.get('loot_crate_open', paintLootCrateOpen) : this.art.get('loot_crate', paintLootCrate);
      const img = this.place(c.gx, c.gy, info.key, info.ax, info.ay, objDepth(c.gx, c.gy, L_PROP));
      const sparkle = th?.done ? null : this.addSparkle(c.gx, c.gy, -12);
      this.crates.set(this.idx(c.gx, c.gy), { img, sparkle });
    }
    for (const f of this.mission.finds) if (f.found && !f.taken) this.addFindSparkle(f);
    // znacznik celu tylko dla "odzyskaj" (jeniec jest postacią - Oldgame/src/scenes/mission.js:210-221)
    if (m.objCell && this.mission.itemThing && !this.mission.itemThing.done) {
      const { gx, gy } = m.objCell;
      const info = this.art.get('objective', paintObjective);
      const img = this.place(gx, gy, info.key, info.ax, info.ay, objDepth(gx, gy, L_PROP));
      this.addLight(gx, gy, 0x60ff80, 0.66, 0.4, 20, 1, 'blink', 0.3, objDepth(gx, gy, L_FX), 'fx_halo');
      const light = this.glows[this.glows.length - 1];
      const sparkle = this.addSparkle(gx, gy, -10);
      this.objMarker = { imgs: [img, sparkle as unknown as Phaser.GameObjects.Image], light };
    }
    for (const th of this.mission.things) this.addThingMark(th);
    this.buildExtraction();
  }

  /** Wrak pojazdu w polu (także rozebrany / wysadzony). */
  private wreckAt(gx: number, gy: number): MissionThing | undefined {
    return this.mission.things.find((t) => t.kind === 'wreck' && t.gx === gx && t.gy === gy);
  }

  /** Tekstura rekwizytu; wrak wg stanu z misji (spalony / wysadzony, rozebrany). */
  private propArt(p: MapProp, rot: number, wreck?: MissionThing): ArtInfo {
    const v = p.seed % (p.type === 'car' || p.type === 'scrap_pile' ? 7 : 3);
    const look = wreck ? { burnt: !!wreck.burnt, stripped: wreck.done && !wreck.exploded } : {};
    const lk = wreck ? `_w${look.burnt ? 1 : 0}${look.stripped ? 1 : 0}` : '';
    const k = `prop_${p.type}_${rot % 2}_${v}_${this.biome}${lk}`;
    return this.art.get(k, () => paintProp(p.type, rot, v * 1009 + 1, this.biome, look));
  }

  /** Podmiana obrazu wraku po rozebraniu / wybuchu. */
  private refreshWreck(th: MissionThing): void {
    const w = this.wrecks.get(this.idx(th.gx, th.gy));
    if (!w) return;
    const info = this.propArt(w.prop, w.rot, th);
    w.img.setTexture(info.key).setPosition(isoX(th.gx, th.gy) - info.ax, isoY(th.gx, th.gy) - info.ay);
    if (th.exploded) this.wreckFlames(th);
  }

  /** Dopalający się wrak: płomienie i migoczące światło. */
  private wreckFlames(th: MissionThing): void {
    const w = this.wrecks.get(this.idx(th.gx, th.gy));
    if (!w || w.flames) return;
    const { gx, gy } = th;
    this.addLight(gx, gy, 0xff7a30, 0.5, 0.5, 4, 0.7, 'flicker', 1.1);
    const { x, y } = tileCenter({ gx, gy });
    const fire = this.add.sprite(x + 2, y - 3, 'fx_flames', 'f0').setOrigin(0.5, 1).setDepth(objDepth(gx, gy, L_FX)).setBlendMode(Phaser.BlendModes.ADD);
    fire.play({ key: 'flames', startFrame: Math.floor(hash2(gx, gy, 3) * 4) });
    const cell = this.cells[this.idx(gx, gy)];
    fire.setVisible(cell.state !== 0);
    cell.imgs.push(fire as unknown as Phaser.GameObjects.Image);
    w.flames = fire;
  }

  /** Serwer (zostaje po zhakowaniu, gaśnie światło) albo gniazdo mutantów (znika po zniszczeniu). */
  private addThingMark(th: MissionThing): void {
    if (th.objective && th.kind === 'item') {
      // zapasy żywności (zaopatrzenie): skrzynia z workami, ciepłe światło i błysk do zebrania
      if (th.done) return;
      const { gx, gy } = th;
      const v = (gx * 7 + gy * 13) % 3;
      const info = this.art.get(`mission_supplies_${v}`, () => paintSupplies(v));
      const img = this.place(gx, gy, info.key, info.ax, info.ay, objDepth(gx, gy, L_PROP));
      this.addLight(gx, gy, 0xffc060, 0.5, 0.5, 8, 0.8, 'blink', 0.4, objDepth(gx, gy, L_FX), 'fx_halo');
      const light = this.glows[this.glows.length - 1];
      const sparkle = this.addSparkle(gx, gy, -10) as unknown as Phaser.GameObjects.Image;
      this.thingMarks.set(th, { imgs: [img, sparkle], light });
      return;
    }
    if (!th.objective || (th.kind !== 'device' && th.kind !== 'nest') || (th.kind === 'nest' && th.done)) return;
    const { gx, gy } = th;
    const v = (gx * 7 + gy * 13) % 3;
    const k = th.kind === 'device' ? `prop_terminal_${VIEW.r % 2}_0_${this.biome}` : `mission_nest_${v}`;
    const info = th.kind === 'device' ? this.art.get(k, () => paintProp('terminal', VIEW.r, 1, this.biome)) : this.art.get(k, () => paintNest(v + 1));
    const img = this.place(gx, gy, k, info.ax, info.ay, objDepth(gx, gy, L_PROP));
    let light: LightView | null = null;
    if (!th.done) {
      this.addLight(gx, gy, th.kind === 'device' ? 0x40e0d0 : 0xc060ff, 0.5, 0.5, 6, 0.8, 'blink', 0.5, objDepth(gx, gy, L_FX), 'fx_halo');
      light = this.glows[this.glows.length - 1];
    }
    this.thingMarks.set(th, { imgs: [img], light });
  }
  /** Gaszenie / usuwanie znacznika obiektu po wykonaniu. */
  private clearThingMark(th: MissionThing): void {
    const m = this.thingMarks.get(th);
    if (!m) return;
    if (m.light) {
      m.light.img.destroy();
      this.glows.splice(this.glows.indexOf(m.light), 1);
      m.light = null;
    }
    if (th.kind === 'nest' || th.kind === 'item') {
      for (const img of m.imgs) this.dropCellImg(this.idx(th.gx, th.gy), img);
      this.thingMarks.delete(th);
    }
  }

  /**
   * Strefa ewakuacji: cztery zielone słupki w rogach strefy wejścia; po wykonaniu celu nad strefą
   * pojawia się świetlna kolumna z migającym napisem "EWAKUACJA" (Oldgame/src/scenes/mission.js:107-130, 587-591).
   */
  private buildExtraction(): void {
    const e = this.map.entry;
    const post = this.art.get('extract_post', paintExtractPost);
    const posts: Phaser.GameObjects.Image[] = [];
    const caps: Phaser.GameObjects.Image[] = [];
    for (const [px, py] of [[e.x0, e.y0], [e.x1, e.y0], [e.x0, e.y1], [e.x1, e.y1]] as const) {
      // punkt słupka (ciągłe współrzędne siatki), lekko na zewnątrz rogu strefy
      const cx = px + 0.5 + (px === e.x0 ? -0.42 : 0.42);
      const cy = py + 0.5 + (py === e.y0 ? -0.42 : 0.42);
      const tx = cx - 0.5, ty = cy - 0.5;
      const depth = objDepth(Math.floor(cx), Math.floor(cy), L_PROP);
      posts.push(this.add.image(isoX(tx, ty) - post.ax, isoY(tx, ty) - post.ay, post.key).setOrigin(0, 0).setDepth(depth));
      const gp = gridPoint(cx, cy);
      const top = { x: gp.x, y: gp.y - 19 };
      caps.push(this.add.image(top.x, top.y, 'fx_px').setScale(1.5).setTint(0x9dff8a).setDepth(depth + 0.5));
      caps.push(this.add.image(top.x, top.y, 'fx_halo').setBlendMode(Phaser.BlendModes.ADD).setTint(0x8fff7a).setAlpha(0.6).setScale(0.6).setDepth(depth + 0.5));
    }
    const cx = (e.x0 + e.x1) / 2 + 0.5, cy = (e.y0 + e.y1) / 2 + 0.5;
    const bp = gridPoint(cx, cy);
    const beacon = this.add.container(bp.x, bp.y).setDepth(D_TEXT - 10).setVisible(false);
    const column = this.add.image(0, 0, 'fx_px').setOrigin(0.5, 1).setScale(2, 40).setTint(0x8fff7a).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD);
    const key = 'txt_EWAKUACJA';
    if (!this.textures.exists(key)) this.art.get(key, () => ({ pc: paintText('EWAKUACJA'), ax: 0, ay: 0 }));
    const sign = this.add.container(0, -58);
    const txt = this.add.image(0, 0, key).setTint(0xb8ff9a);
    const box = this.add.rectangle(0, 0, txt.width + 4, txt.height + 2, 0x0b1a0c, 0.92).setStrokeStyle(1, 0x8fff7a);
    const arrow = this.add.triangle(0, Math.ceil(box.height / 2) + 1, -4, 0, 4, 0, 0, 5, 0x8fff7a).setOrigin(0.5, 0);
    sign.add([box, txt, arrow]);
    beacon.add([column, sign]);
    beacon.setData('sign', sign);
    this.extract = { caps, posts, beacon };
  }

  /** Pulsowanie słupków i kołysanie napisu ewakuacji po wykonaniu celu. */
  private updateExtraction(): void {
    const ex = this.extract;
    if (!ex) return;
    const done = this.mission.objectiveDone() && !this.over;
    const t = this.elapsed;
    ex.beacon.setVisible(done);
    if (done) {
      const sign = ex.beacon.getData('sign') as Phaser.GameObjects.Container;
      sign.y = -58 + Math.sin(t * 3) * 2;
      sign.setAlpha(Math.sin(t * 6) > -0.4 ? 1 : 0.35);
    }
    const k = done ? 0.6 + 0.4 * Math.sin(t * 5) : 0.55;
    for (let i = 1; i < ex.caps.length; i += 2) ex.caps[i].setAlpha(k);
    for (const p of ex.posts) p.setTint(done ? 0xb8ffb0 : 0xffffff);
  }

  private addTall(gx: number, gy: number, img: Phaser.GameObjects.Image, height: number): void {
    this.tall.push({ img, gx, gy, reach: Math.max(1.5, height / 8), fade: 1 });
  }

  /**
   * Poświata (mieszanie ADD). (u, v, z) = miejsce w polu, scale = rozmiar względem 96x48.
   * Domyślnie leży na ziemi pod obiektami; halo żarówek dostaje głębię obiektu.
   */
  private addLight(
    gx: number, gy: number, color: number, u: number, v: number, z: number, alpha: number,
    kind: LightView['kind'], scale: number, depth = D_GROUND_GLOW, key = 'fx_glow',
  ): void {
    const x = isoX(gx, gy) + (u - v) * 16;
    const y = isoY(gx, gy) + (u + v) * 8 - z;
    const img = this.add.image(x, y, key).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).setTint(color).setScale(scale).setAlpha(0);
    this.glows.push({ img, cell: this.idx(gx, gy), base: alpha, kind, phase: hash2(gx, gy, 77) * 10 });
  }

  private addSparkle(gx: number, gy: number, dz: number): Phaser.GameObjects.Sprite {
    const { x, y } = tileCenter({ gx, gy });
    const s = this.add.sprite(x, y + dz, 'fx_sparkle', 's0').setDepth(objDepth(gx, gy, L_FX)).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff0c0);
    s.play({ key: 'sparkle', delay: Math.floor(hash2(gx, gy, 9) * 1500) });
    this.cells[this.idx(gx, gy)].imgs.push(s as unknown as Phaser.GameObjects.Image);
    return s;
  }

  // ================================================================== postacie

  private createUnits(): void {
    const entry = this.map.entry.cells[5] ?? this.map.entry.cells[0];
    for (const a of this.mission.actors) {
      if (a.side === 'neutral') {
        // jeniec (Oldgame/src/scenes/mission.js:217): cywil w łachmanach, widoczny w zasięgu wzroku lub gdy idzie za drużyną
        const u = this.makeUnit('captive', LOOK_CAPTIVE, a);
        this.face(u, { gx: entry.gx - a.gx, gy: entry.gy - a.gy });
        this.idle(u);
        this.setUnitVisible(u, false);
        this.units.set(a, u);
        continue;
      }
      let key: string;
      let look: UnitLook | CreatureLook;
      let sheet: (() => ReturnType<typeof paintUnitSheet>) | undefined;
      let faunaScale = 1;
      if (a.side === 'pc') {
        key = `pc_${a.ch.recruitId ?? a.ch.id}`;
        look = this.job || spriteIdOf(a.ch) ? unitLookOf(a.ch) : (DEMO_LOOKS[a.ch.classId as ClassId] ?? LOOK_SOLDIER);
      } else {
        const ranged = normWeapon(getWeapon(a.ch)).range > 0;
        const lk = a.ch.look as Partial<EnemyLook>;
        key = ranged ? 'en_gunner' : 'en_raider';
        look = ranged ? LOOK_GUNNER : LOOK_RAIDER;
        if (a.ch.templateId) {
          // wygląd z szablonu wroga (iso/UnitLooks: broń z ataku, maski, robot, Kostucha; bestie - własny gatunek),
          // także w misji demonstracyjnej (bez zlecenia) - inaczej szabrownicy mieliby stare klatki zamiast PixelLab
          key = `en_${a.ch.templateId}`;
          const el = enemyUnitLook(a.ch.templateId, lk);
          if (isCreatureLook(el) && el.sprite) {
            // bestia PixelLab (src/assets/units/<templateId>/): gotowy wygląd, losowy tylko rozmiar
            look = el;
            faunaScale = 0.92 + (((hashStr(a.id + this.mission.contract.id) >>> 4) % 1000) / 1000) * 0.24;
          } else if (isCreatureLook(el)) {
            // Oldgame mission.js:151-158: zmutowana fauna - losowa barwa skóry / ślepi i rozmiar (75%, kosmetyka)
            const h = hashStr(a.id + this.mission.contract.id);
            if (h % 100 < 75) {
              const si = (h >>> 8) % FAUNA_SKINS.length, ai = (h >>> 16) % FAUNA_EYES.length;
              const ml = { ...lk, skin: FAUNA_SKINS[si], accent: FAUNA_EYES[ai] };
              key = `en_${a.ch.templateId}_m${si}_${ai}`;
              faunaScale = 0.92 + (((h >>> 4) % 1000) / 1000) * 0.24;
              sheet = () => enemySheet(a.ch.templateId!, ml);
            } else sheet = () => enemySheet(a.ch.templateId!, lk);
          } else look = el;
        }
      }
      const u = this.makeUnit(key, look, a, sheet);
      let scale = faunaScale;
      if (a.side === 'enemy' && (a.ch.look as Partial<EnemyLook>).scale) scale *= Math.min(1.5, Math.max(0.8, (a.ch.look as Partial<EnemyLook>).scale ?? 1));
      // skala do pełnych pikseli płótna na piksel projektowy (x1.1 przy ZOOM 4 dawałoby piksele 4 i 5 px na przemian)
      if (scale !== 1) u.sprite.setScale(Math.max(1, Math.round(scale * ZOOM)) / ZOOM);
      if (a.side === 'enemy') {
        this.face(u, { gx: entry.gx - a.gx, gy: entry.gy - a.gy });
        this.idle(u);
      }
      this.units.set(a, u);
    }
    this.focus = this.units.get(this.selected ?? this.mission.pcs[0])!;
  }

  /** Górna krawędź postaci (pasek PW, napisy): klatki bestii PixelLab są wyższe niż sylwetka - najwyżej 32 px nad stopami. */
  private unitTop(u: Unit): number {
    return u.sprite.y - Math.min(u.sprite.displayHeight * u.sprite.originY, 32 * Math.abs(u.sprite.scaleY));
  }

  private makeUnit(name: string, look: UnitLook | CreatureLook, actor: Actor, build?: () => ReturnType<typeof paintUnitSheet>): Unit {
    // ensureUnit przemalowuje arkusz, gdy wygląd się zmienił (np. inna broń po wizycie u handlarza)
    const tex = ensureUnit(this, name, look, build);
    const pos = { gx: actor.gx, gy: actor.gy };
    const { x, y } = tileCenter(pos);
    const shadow = this.add.image(x, y, 'fx_shadow').setDepth(D_UNIT_SHADOW);
    const sprite = this.add
      .sprite(x, y, tex, 'f_idle0')
      .setOrigin(UNIT_FOOT_X / UNIT_FW, UNIT_FOOT_Y / UNIT_FH)
      .setDepth(objDepth(pos.gx, pos.gy, L_UNIT));
    const unit: Unit = { sprite, shadow, pos, facing: 'f', name, actor };
    // drobne przesunięcie fazy, żeby drużyna nie oddychała równo
    sprite.play({ key: `${name}_f_idle`, startFrame: Math.floor(hash2(pos.gx, pos.gy, 5) * 4) });
    return unit;
  }

  /** Wygląd najemnika po zmianie broni: arkusz z nową bronią (sprite PixelLab - wariant broni, osobna tekstura). */
  private refreshLook(a: Actor): void {
    const u = this.units.get(a);
    if (!u || a.side !== 'pc' || !(this.job || spriteIdOf(a.ch))) return;
    const tex = ensureUnit(this, u.name, unitLookOf(a.ch));
    if (u.sprite.texture.key !== tex) u.sprite.setTexture(tex, 'f_idle0');
    if (a.state === 'up') this.idle(u);
  }

  private unitOfCh(ch: Character): Unit | null {
    for (const u of this.units.values()) if (u.actor.ch === ch) return u;
    return null;
  }

  /** Spoczynek po akcji: stojący wracają do oddychania, powaleni zostają na ziemi. */
  private rest(u: Unit): void {
    if (u.actor.state === 'up') this.idle(u);
    else this.lie(u);
  }

  /** Powalony / martwy leży: trwająca animacja upadku gra do końca, inaczej od razu klatka leżącego ciała / zwłok. */
  private lie(u: Unit): void {
    const key = u.sprite.anims.currentAnim?.key ?? '';
    if (u.sprite.anims.isPlaying && (key.endsWith('_die') || key.endsWith('_down'))) return;
    u.sprite.stop();
    this.mirror(u);
    u.sprite.setFrame(`${u.facing}_${u.actor.state === 'dead' ? FRAME_CORPSE : FRAME_DOWN}`);
  }

  /** Kierunek ruchu siatki -> kierunek sprite'a (przód/tył + odbicie). */
  private face(u: Unit, d: GridPos): void {
    if (d.gx === 0 && d.gy === 0) return;
    u.dir = { gx: d.gx, gy: d.gy };
    const [vx, vy] = viewDir(d.gx, d.gy); // kierunek w widoku (po obrocie kamery)
    const alongX = Math.abs(vx) >= Math.abs(vy);
    if (alongX) {
      u.facing = vx > 0 ? 'f' : 'b'; // +vx = SE (przodem), -vx = NW (tyłem, odbity)
      u.left = vx < 0;
    } else {
      u.facing = vy > 0 ? 'f' : 'b'; // +vy = SW (przodem, odbity), -vy = NE (tyłem)
      u.left = vy > 0;
    }
    u.sprite.setFlipX(u.left);
    // trwa animacja własnego obrotu SW / NW (bez odbicia): spoczynek dostaje obrót nowego kierunku, chód zmieni krok
    const cur = u.sprite.anims.currentAnim?.key ?? '';
    if (u.sprite.anims.isPlaying && /_(south|north)-west_/.test(cur)) {
      if (/_(idle|crouch)$/.test(cur) && u.actor.state === 'up') this.idle(u);
      else u.sprite.setFlipX(false);
    }
  }

  /**
   * Animacja zwróconej w lewo postaci PixelLab we własnym obrocie SW / NW (iso/SpriteUnits, `<nazwa>_<kierunek>_<anim>`)
   * zamiast lustrzanego odbicia SE / NE (broń w drugiej ręce, inne światło). null = brak - odbicie klatek przód / tył.
   */
  private leftAnim(u: Unit, anim: string): string | null {
    if (!u.left) return null;
    const key = `${u.name}_${u.facing === 'f' ? 'south-west' : 'north-west'}_${anim}`;
    return this.anims.exists(key) ? key : null;
  }

  /**
   * Klucz animacji w kierunku postaci i ustawione odbicie: własny obrót w lewo, jeśli jest, inaczej przód / tył
   * (`<nazwa>_f_<anim>`, w lewo odbite). `prefix` - do łańcuchów w tym samym obrocie (np. '<prefix>crouch').
   */
  private animKey(u: Unit, anim: string): { key: string; prefix: string } {
    const own = this.leftAnim(u, anim);
    if (own) {
      u.sprite.setFlipX(false);
      return { key: own, prefix: own.slice(0, own.length - anim.length) };
    }
    this.mirror(u);
    const prefix = `${u.name}_${u.facing}_`;
    return { key: prefix + anim, prefix };
  }

  /** Klatki przód / tył (z odbiciem w lewo) - przed animacją bez własnych obrotów. */
  private mirror(u: Unit): void {
    u.sprite.setFlipX(!!u.left);
  }

  /** Spoczynek zgodny z postawą: leży (powalony na ziemię, ale przytomny), kuca (w osłonie / skrada się) albo stoi. */
  private idle(u: Unit): void {
    const cur = u.sprite.anims.currentAnim?.key ?? '';
    // przejście (przypadnięcie do osłony / padnięcie) kończy się samo - chain() przełącza na postawę
    if (u.sprite.anims.isPlaying && (cur.endsWith('_hide') || cur.endsWith('_drop'))) return;
    const st = this.stance(u);
    const key = `${u.name}_${u.facing}_${st}`;
    u.sprite.chain(); // bez zaległego łańcucha (np. pętli hakowania po przerwanym przyklęku)
    if (this.leftAnim(u, st) || this.anims.exists(key)) u.sprite.play(this.animKey(u, st).key, true);
    else u.sprite.play(this.animKey(u, 'idle').key, true);
  }

  /** Postawa spoczynkowa postaci (iso/UnitArt: 'prone' / 'crouch' / 'idle'). */
  private stance(u: Unit): 'idle' | 'crouch' | 'prone' {
    const a = u.actor;
    if (a.state !== 'up') return 'idle';
    if (hasCondition(a.ch, 'prone')) return 'prone';
    if (hasCondition(a.ch, 'in_cover') || this.sneaking(u)) return 'crouch';
    return 'idle';
  }

  /**
   * Skradanie: poza walką najemnik porusza się w przysiadzie, gdy w zasięgu wzroku drużyny jest nieświadomy wróg
   * (Mission.checkSpotting - wrogowie wypatrują na ≤11 pól, wtedy liczy się Skradanie).
   */
  private sneaking(u: Unit): boolean {
    const a = u.actor;
    const m = this.mission;
    if (a.side !== 'pc' || a.state !== 'up' || !m || m.mode !== 'explore') return false;
    for (const g of m.groups) {
      if (g.alerted) continue;
      for (const e of g.actors) if (e.state !== 'dead' && m.isVisible(e) && Math.max(Math.abs(e.gx - u.pos.gx), Math.abs(e.gy - u.pos.gy)) <= 12) return true;
    }
    return false;
  }

  /** Po zmianie widoczności / stanów: stojące, kucające i leżące postacie przechodzą do właściwej postawy. */
  private refreshStances(): void {
    for (const u of this.units.values()) {
      if (u.actor.state !== 'up') continue;
      const cur = u.sprite.anims.currentAnim?.key ?? '';
      const resting = cur.endsWith('_idle') || cur.endsWith('_crouch') || cur.endsWith('_prone');
      if (resting && u.sprite.anims.isPlaying && !cur.endsWith(`_${this.stance(u)}`)) this.idle(u);
    }
  }

  /** Jednorazowa animacja postaci (iso/UnitArt ANIMS): cios, strzał, trafienie, użycie, upadek; zostaje na ostatniej klatce. */
  private pose(u: Unit, anim: 'attack' | 'shoot' | 'hurt' | 'cast' | 'die' | 'down'): void {
    u.sprite.chain();
    u.sprite.play(this.animKey(u, anim).key);
  }

  /**
   * Postawa / czynność z iso/UnitArt (bestie ich nie mają - wtedy `fallback`): kucnięcie za osłoną ('hide' -> 'crouch'),
   * padnięcie ('drop' -> 'prone'), wstawanie ('drop' od tyłu), hakowanie, wytrych, opatrywanie (pętle do rest()).
   */
  private act(u: Unit, anim: 'hide' | 'drop' | 'getup' | 'hack' | 'pick' | 'heal', fallback: 'cast' | 'idle' = 'cast'): void {
    const base = `${u.name}_${u.facing}_`;
    const key = base + (anim === 'getup' ? 'drop' : anim);
    if (!this.anims.exists(key)) {
      if (fallback === 'cast') this.pose(u, 'cast');
      else this.idle(u);
      return;
    }
    u.sprite.chain();
    // drop / getup / prone tylko przód / tył (składane z obrotu), reszta także we własnym obrocie w lewo
    const { key: k, prefix } = anim === 'getup' || anim === 'drop' ? { key, prefix: base } : this.animKey(u, anim);
    if (anim === 'getup' || anim === 'drop') this.mirror(u);
    if (anim === 'getup') u.sprite.playReverse(k);
    else u.sprite.play(k);
    if (anim === 'hide') u.sprite.chain(this.anims.exists(prefix + 'crouch') ? prefix + 'crouch' : base + 'crouch');
    else if (anim === 'drop') u.sprite.chain(base + 'prone');
    // postacie PixelLab: przyklęk raz, potem pętla pracy rąk (iso/SpriteUnits STRIP_USES)
    else if (anim !== 'getup' && this.anims.exists(k + '_loop')) u.sprite.chain(k + '_loop');
  }

  /** Krok o jedno pole z animacją chodu; głębia = większa z sum pól, by nie wejść "pod" ściany. */
  private stepUnit(u: Unit, to: GridPos): Promise<void> {
    const from = u.pos;
    this.face(u, { gx: to.gx - from.gx, gy: to.gy - from.gy });
    const sneak = this.sneaking(u) && this.anims.exists(`${u.name}_${u.facing}_sneak`);
    u.sprite.play(this.animKey(u, sneak ? 'sneak' : 'walk').key, true);
    u.sprite.setDepth(Math.max(objDepth(from.gx, from.gy, L_UNIT), objDepth(to.gx, to.gy, L_UNIT)));
    u.pos = { ...to };
    if (u.sprite.visible && (u === this.focus || u.actor.side !== 'pc')) SoundManager.sfx('step', { vol: 0.35 });
    if (u.sprite.visible) {
      // pył spod butów (co drugi krok; w biegu walki każdy)
      if ((to.gx + to.gy) % 2 === 0 || this.hud.inCombat) this.fx.dust(u.sprite.x, u.sprite.y, this.biome === 'bunker' ? 0x8a9098 : 0xb09a78, 2, 5);
      if (u.actor.side === 'pc') this.geiger(to);
    }
    const { x, y } = tileCenter(to);
    return new Promise((resolve) =>
      this.tweens.add({
        targets: [u.sprite, u.shadow],
        x,
        y,
        duration: STEP_DURATION,
        ease: 'Linear',
        onComplete: () => {
          u.sprite.setDepth(objDepth(to.gx, to.gy, L_UNIT));
          resolve();
        },
      }),
    );
  }

  private setUnitVisible(u: Unit, v: boolean): void {
    u.sprite.setVisible(v);
    u.shadow.setVisible(v);
  }

  // ================================================================== nakładki, kamera, atmosfera

  private createOverlays(): void {
    this.cursor = this.add.image(0, 0, 'fx_cursor').setOrigin(0.5, 0).setDepth(D_CURSOR).setVisible(false);
    this.tweens.add({ targets: this.cursor, alpha: { from: 1, to: 0.55 }, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.rangeGfx = this.add.graphics().setDepth(D_CURSOR - 0.5);
    this.aimGfx = this.add.graphics().setDepth(D_PATH + 0.5);
    this.laserGfx = this.add.graphics().setDepth(D_TEXT - 6);
    this.ringGfx = this.add.graphics().setDepth(D_UNIT_SHADOW + 0.5);
    this.barGfx = this.add.graphics().setDepth(D_TEXT - 5);

    // warstwa ekranowa: dzieci w pikselach projektowych (0..BASE_W), kontener skalowany przy zmianie przybliżenia
    const width = BASE_W, height = BASE_H;
    this.overlay = this.add.container(SX0, SY0).setScrollFactor(0).setDepth(D_SCREEN);
    this.art.get(`fx_vignette_${width}x${height}`, () => ({ pc: paintVignette(width, height), ax: 0, ay: 0 }));
    const vignette = this.add.image(0, 0, `fx_vignette_${width}x${height}`).setOrigin(0);

    // pora dnia / pogoda ze zlecenia (port Oldgame/src/gfx/atmosphere.js): mapa światła, mgły, deszcz, zarodniki
    const dustColor = this.biome === 'bunker' ? 0x9aa4b0 : this.biome === 'wastes' ? 0xd8b880 : 0xc8b89a;
    this.atmo = new Atmosphere(this, this.overlay, this.mood, {
      art: this.art, seed: this.map.seed, width, height, dustColor, lamps: () => this.lampLights(), fx: this.fx.lights,
    });
    // zmierzch: długie cienie postaci (niskie słońce)
    if (this.mood === 'dusk') for (const u of this.units.values()) u.shadow.setOrigin(0.24, 0.5).setScale(1.9, 1);
    this.overlay.add(vignette);
  }

  // ---------- przybliżenie kamery (kółko, +/-, 0) - Oldgame/src/scenes/mission.js:639-645

  /**
   * Przybliżenie o krok: zoom kamery (ZOOM * camZoom) przeskakuje na następną liczbę całkowitą, więc piksel
   * projektowy ma zawsze tyle samo pikseli płótna (przy ułamkowym zoomie najbliższy sąsiad daje nierówne, poszarpane
   * piksele). Wyjątek: camZoom = 1 (klawisz 0 / start) - wtedy zoom = ZOOM, nawet ułamkowy (HD, QHD).
   */
  private zoomBy(f: number): void {
    const cur = ZOOM * this.camZoom, target = cur * f;
    const lo = Math.max(1, Math.ceil(ZOOM * 0.4)), hi = Math.max(lo, Math.floor(ZOOM * 2.5));
    let e = f > 1 ? Math.max(Math.floor(cur + 1e-6) + 1, Math.round(target)) : Math.min(Math.ceil(cur - 1e-6) - 1, Math.round(target));
    e = Math.max(lo, Math.min(hi, e));
    // powrót do domyślnego zoomu, gdy krok go "przeskakuje"
    if ((cur < ZOOM && e > ZOOM) || (cur > ZOOM && e < ZOOM)) e = ZOOM;
    this.setZoom(e / ZOOM);
  }

  private setZoom(z: number): void {
    this.camZoom = Math.max(0.4, Math.min(2.5, z)); // Oldgame: 0.3-2.4
    const cam = this.cameras.main;
    cam.setZoom(ZOOM * this.camZoom);
    // kontener ekranowy: świat = środek + (px * ZOOM - środek) / zoom kamery
    const k = 1 / this.camZoom;
    this.overlay.setScale(k).setPosition((VW / 2) * (1 - k / ZOOM), (VH / 2) * (1 - k / ZOOM));
    this.refreshPathPreview();
  }

  /** Kursor nad panelem HUD-u (wtedy kółko przewija dziennik, nie przybliża mapy). */
  private overUi(pointer: Phaser.Input.Pointer): boolean {
    const ui = this.scene.get('UIScene');
    if (!ui || !this.scene.isActive('UIScene')) return false;
    return ui.input.hitTestPointer(pointer).length > 0;
  }

  private setupCamera(): void {
    const cam = fitViewport(this.cameras.main);
    this.setCameraBounds();
    cam.setZoom(ZOOM);
    cam.setRoundPixels(true);
    this.following = false;
    this.refollow();
    cam.fadeIn(500, 0, 0, 0);

    const kb = this.input.keyboard;
    if (kb) this.panKeys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
  }

  /**
   * Q/E: obrót widoku o 90° (Oldgame/src/scenes/mission.js:644) - żeby zajrzeć za budynki i ściany.
   * Statyczny świat budowany jest od nowa dla nowego obrotu (tekstury z ArtBook są w pamięci), postacie
   * i znaczniki przestawiane; stan misji, mgła i skrzynie zostają. Kamera wraca na ten sam punkt siatki.
   */
  private rotateView(dir: 1 | -1): void {
    if (this.over || !this.cells.length) return;
    this.finishSpin();
    // w trakcie animacji ruchu tweeny mają cele w starym rzucie - obracamy dopiero w spoczynku
    for (const u of this.units.values()) if (this.tweens.isTweening(u.sprite)) return;
    const cam = this.cameras.main;
    const W = this.map.width;

    // punkt siatki (ciągły) w środku ekranu
    const mid = cam.midPoint;
    const a = mid.x / (TILE_W / 2), b = mid.y / (TILE_H / 2);
    const pvx = (b + a) / 2, pvy = (b - a) / 2;
    const [cgx, cgy] =
      VIEW.r === 1 ? [pvy, VIEW.h - pvx] : VIEW.r === 2 ? [VIEW.w - pvx, VIEW.h - pvy] : VIEW.r === 3 ? [VIEW.w - pvy, pvx] : [pvx, pvy];
    // kierunek osi gx w starym rzucie (do wyznaczenia kąta obrotu animacji)
    const o0 = gridPoint(cgx, cgy), o1 = gridPoint(cgx + 1, cgy);
    const ox = mid.x, oy = mid.y;

    // migawka sceny: co było przed przebudową (i gdzie), żeby potem odróżnić nowe / przesunięte / stare obiekty
    const before = new Map<Phaser.GameObjects.GameObject, { x: number; y: number }>();
    for (const o of this.children.list) {
      const t = o as Partial<SpinObj>;
      before.set(o, { x: t.x ?? 0, y: t.y ?? 0 });
    }
    const old: Phaser.GameObjects.GameObject[] = [];

    // stan zależny od rozgrywki, który trzeba odtworzyć po przebudowie
    const saved = this.cells.map((c) => ({ state: c.state, reveal: c.reveal }));
    const crateState = new Map<number, { key: string; sparkle: boolean }>();
    for (const [i, c] of this.crates) crateState.set(i, { key: c.img.texture.key, sparkle: !!c.sparkle });
    const finds = new Set(this.sparkles.keys());
    const hadObj = !!this.objMarker;

    // stary świat nie znika od razu - odjeżdża po łuku i gaśnie (updateSpin), potem jest niszczony
    for (const c of this.cells) old.push(...c.imgs);
    for (const l of this.glows) old.push(l.img);
    if (this.extract) old.push(...this.extract.caps, ...this.extract.posts, this.extract.beacon);
    this.cells = [];
    this.tall = [];
    this.glows = [];
    this.sparkles = new Map();
    this.crates = new Map();
    this.wrecks = new Map();
    this.objMarker = null;
    this.thingMarks = new Map();
    this.extract = null;

    VIEW.r = (VIEW.r + dir + 4) % 4;
    this.buildWorld();
    for (const sc of this.scorches) this.placeScorch(sc);

    // skrzynie (otwarte / bez błysku), znaleziska, zabrany cel
    for (const [i, c] of this.crates) {
      const st = crateState.get(i);
      if (!st) continue;
      if (!st.sparkle && c.sparkle) {
        this.dropCellImg(i, c.sparkle);
        c.sparkle = null;
      }
      if (st.key !== c.img.texture.key && st.key === 'loot_crate_open') {
        const info = this.art.get('loot_crate_open', paintLootCrateOpen);
        const gx = i % W, gy = Math.floor(i / W);
        c.img.setTexture(info.key).setPosition(isoX(gx, gy) - info.ax, isoY(gx, gy) - info.ay);
      }
    }
    for (const [i, sp] of [...this.sparkles]) {
      if (finds.has(i)) continue;
      this.dropCellImg(i, sp);
      this.sparkles.delete(i);
    }
    for (const i of finds) if (!this.sparkles.has(i)) this.sparkles.set(i, this.addSparkle(i % W, Math.floor(i / W), -2));
    if (!hadObj && this.objMarker) {
      const om = this.objMarker as { imgs: Phaser.GameObjects.Image[]; light: LightView | null };
      const oc = this.map.objCell;
      if (oc) for (const img of om.imgs) this.dropCellImg(this.idx(oc.gx, oc.gy), img);
      if (om.light) {
        om.light.img.destroy();
        this.glows.splice(this.glows.indexOf(om.light), 1);
      }
      this.objMarker = null;
    }

    // mgła: przywrócenie stanu pól
    const memory = this.memoryTint();
    this.cells.forEach((cell, i) => {
      cell.state = saved[i].state;
      cell.reveal = saved[i].reveal;
      const tint = cell.state === 2 ? TINT_VISIBLE : memory;
      for (const img of cell.imgs) {
        img.setVisible(cell.state !== 0).setAlpha(cell.reveal);
        if (img.blendMode !== Phaser.BlendModes.ADD) img.setTint(tint);
      }
    });

    // postacie: pozycja, głębia, kierunek patrzenia w nowym widoku
    for (const u of this.units.values()) {
      const c = tileCenter(u.pos);
      u.sprite.setPosition(c.x, c.y).setDepth(objDepth(u.pos.gx, u.pos.gy, L_UNIT));
      u.shadow.setPosition(c.x, c.y);
      const before = u.facing, wasLeft = u.left;
      this.face(u, u.dir ?? { gx: 1, gy: 0 });
      if (u.facing === before && u.left === wasLeft) continue;
      const cur = u.sprite.anims.currentAnim?.key;
      // spoczynek (także własne obroty SW / NW): od nowa wg nowego kierunku
      if (u.actor.state === 'up' && u.sprite.anims.isPlaying && cur && /_(idle|crouch|prone)$/.test(cur)) {
        this.idle(u);
        continue;
      }
      const pre = `${u.name}_${before}_`;
      if (u.sprite.anims.isPlaying && cur?.startsWith(pre)) {
        const next = `${u.name}_${u.facing}_${cur.slice(pre.length)}`;
        if (this.anims.exists(next)) u.sprite.play(next, true);
      } else {
        const fr = String(u.sprite.frame.name);
        const alt = `${u.facing}${fr.slice(1)}`;
        if (fr.startsWith(before) && u.sprite.texture.has(alt)) u.sprite.setFrame(alt);
      }
    }

    this.setCameraBounds();
    // środek ekranu zostaje na tym samym punkcie siatki (przy śledzeniu kamera dociągnie do postaci sama)
    const n0 = gridPoint(cgx, cgy), n1 = gridPoint(cgx + 1, cgy);
    // docelowe położenie kamery (z granicami); w trakcie obrotu kamera jest bez granic i płynnie tam dojeżdża
    cam.stopFollow();
    if (this.following) cam.centerOn(this.focus.sprite.x, this.focus.sprite.y - 8);
    else cam.centerOn(n0.x, n0.y);
    const tx = cam.scrollX, ty = cam.scrollY;
    cam.removeBounds();
    cam.centerOn(n0.x, n0.y);
    this.startSpin({ sx: cam.scrollX, sy: cam.scrollY, tx, ty }, old, before, { x: ox, y: oy }, n0, Math.atan2((n1.y - n0.y) * 2, n1.x - n0.x) - Math.atan2((o1.y - o0.y) * 2, o1.x - o0.x));
    SoundManager.sfx('click', { vol: 0.3 });
  }

  /**
   * Animacja obrotu: obrót siatki o kąt `full` wokół środka ekranu, rzutowany izometrycznie (elipsa 2:1).
   * Stary świat jedzie od 0 do `full` i gaśnie, nowy od `-full` do 0 i się pojawia; postacie jadą po łuku
   * z dawnej pozycji do nowej. Grafiki bez pozycji (podgląd ścieżki, nakładki) są ukryte na czas obrotu.
   */
  private startSpin(
    cam: Spin['cam'], oldObjs: Phaser.GameObjects.GameObject[], before: Map<Phaser.GameObjects.GameObject, { x: number; y: number }>,
    oldPivot: { x: number; y: number }, pivot: { x: number; y: number }, full: number,
  ): void {
    full = Math.atan2(Math.sin(full), Math.cos(full));
    const isOld = new Set(oldObjs);
    const entry = (o: SpinObj, px: number, py: number): SpinEntry => {
      // kotwica = środek podstawy (dół obrazka - pół kafla); dla obiektów bez rozmiaru sama pozycja
      let ax = o.x, ay = o.y;
      if (o instanceof Phaser.GameObjects.Image) {
        const w = o.displayWidth, h = o.displayHeight;
        ax = o.x - o.originX * w + w / 2;
        ay = o.y - o.originY * h + h - TILE_H / 2;
      }
      return { o, dx: o.x - ax, dy: o.y - ay, rx: ax - px, ry: (ay - py) * 2, a: o.alpha };
    };
    const spin: Spin = { t: 0, dur: 0.34, full, cam, px: pivot.x, py: pivot.y, old: [], moved: [], fresh: [], hidden: [] };
    const movable = (o: Phaser.GameObjects.GameObject): o is SpinObj =>
      !(o instanceof Phaser.GameObjects.Graphics) && typeof (o as Partial<SpinObj>).x === 'number' && (o as Partial<SpinObj>).scrollFactorX === 1;
    for (const o of oldObjs) if (movable(o) && o.active) spin.old.push(entry(o, oldPivot.x, oldPivot.y));
      else o.destroy();
    for (const o of this.children.list) {
      if (isOld.has(o) || (o as Partial<SpinObj>).scrollFactorX !== 1) continue;
      const t = o as SpinObj;
      if (!t.visible) continue;
      const was = before.get(o);
      if (!movable(o)) spin.hidden.push({ o: t, vis: true });
      else if (!was) spin.fresh.push(entry(o, pivot.x, pivot.y));
      else if (was.x !== o.x || was.y !== o.y) spin.moved.push(entry(o, pivot.x, pivot.y));
      else spin.hidden.push({ o: t, vis: true });
    }
    this.spin = spin;
    this.applySpin(0);
  }

  private updateSpin(dt: number): void {
    const s = this.spin;
    if (!s) return;
    s.t += dt;
    if (s.t >= s.dur) this.finishSpin();
    else this.applySpin(Phaser.Math.Easing.Sine.InOut(s.t / s.dur));
  }

  private applySpin(k: number): void {
    const s = this.spin;
    if (!s) return;
    // nowy widok pojawia się wcześniej, niż gaśnie stary - teren nie prześwituje w połowie obrotu
    const fadeIn = Phaser.Math.Clamp(k / 0.55, 0, 1), fadeOut = Phaser.Math.Clamp((k - 0.45) / 0.55, 0, 1);
    const put = (e: SpinEntry, ang: number, alpha: number): void => {
      const c = Math.cos(ang), sn = Math.sin(ang);
      e.o.x = s.px + e.rx * c - e.ry * sn + e.dx;
      e.o.y = s.py + (e.rx * sn + e.ry * c) / 2 + e.dy;
      if (alpha >= 0) e.o.setAlpha(e.a * alpha);
    };
    for (const e of s.old) put(e, s.full * k, 1 - fadeOut);
    for (const e of s.fresh) put(e, s.full * (k - 1), fadeIn);
    for (const e of s.moved) if (!this.tweens.isTweening(e.o)) put(e, s.full * (k - 1), -1);
    for (const h of s.hidden) h.o.setVisible(false);
    this.cameras.main.setScroll(s.cam.sx + (s.cam.tx - s.cam.sx) * k, s.cam.sy + (s.cam.ty - s.cam.sy) * k);
  }

  /** Koniec obrotu (także przerwany kolejnym Q/E): wszystko na docelowych miejscach, stary świat usunięty. */
  private finishSpin(): void {
    const s = this.spin;
    if (!s) return;
    this.spin = null;
    for (const e of s.old) e.o.destroy();
    const home = (e: SpinEntry): void => {
      e.o.x = s.px + e.rx + e.dx;
      e.o.y = s.py + e.ry / 2 + e.dy;
    };
    for (const e of s.fresh) {
      if (!e.o.active) continue;
      home(e);
      e.o.setAlpha(e.a);
    }
    for (const e of s.moved) if (e.o.active && !this.tweens.isTweening(e.o)) home(e);
    for (const h of s.hidden) if (h.o.active) h.o.setVisible(h.vis);
    this.cameras.main.setScroll(s.cam.tx, s.cam.ty);
    this.setCameraBounds();
    if (this.following) this.focusOn(this.focus);
    this.refreshOverlay();
    this.refreshPathPreview();
  }

  /** Granice kamery w przestrzeni widoku (po obrocie W i H mogą się zamienić). */
  private setCameraBounds(): void {
    const { w: W, h: H } = viewSize();
    const left = -H * (TILE_W / 2) - 48, right = W * (TILE_W / 2) + 48;
    const top = -96, bottom = (W + H) * (TILE_H / 2) + 48;
    this.cameras.main.setBounds(left, top, right - left, bottom - top);
  }

  /** WASD / strzałki przesuwają kamerę; ruch gracza ponownie ją przypina. */
  private updateCameraPan(dt: number): void {
    const k = this.panKeys;
    if (!k.W) return;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (!dx && !dy) return;
    const cam = this.cameras.main;
    cam.stopFollow();
    this.following = false;
    cam.scrollX += dx * 180 * dt;
    cam.scrollY += dy * 180 * dt;
    this.refreshPathPreview();
  }

  /** Kamera płynnie śledzi wskazaną postać. */
  private focusOn(u: Unit): void {
    this.focus = u;
    this.following = true;
    this.cameras.main.startFollow(u.sprite, true, 0.14, 0.14, 0, 8);
  }

  private refollow(): void {
    if (!this.following) this.focusOn(this.focus);
  }

  /** Efekty, nastrój, płonące postacie, tło licznika Geigera. */
  private updateDust(dt: number): void {
    this.fx.update(dt);
    this.atmo?.update(dt);
    for (const u of this.units.values()) {
      const a = u.actor;
      const on = a.state !== 'dead' && u.sprite.visible && hasCondition(a.ch, 'burning');
      const h = this.burning.get(a);
      if (on) {
        if (h) h.setPosition(u.sprite.x, u.sprite.y - 3);
        else this.burning.set(a, this.fx.fire(u.sprite.x, u.sprite.y - 3, Infinity, 0.8));
      } else if (h) {
        h.destroy();
        this.burning.delete(a);
      }
    }
    if (this.mood === 'toxic' && !this.over) {
      this.geigerIdle -= dt;
      if (this.geigerIdle <= 0) {
        this.geigerIdle = 5 + Math.random() * 7;
        SoundManager.sfx('geiger', { vol: 0.25 });
      }
    }
  }

  /** Światła mapy oświetlenia: lampy / ogniska / terminale (widoczne poświaty) + latarki drużyny. */
  private lampLights(): WorldLight[] {
    const out: WorldLight[] = [];
    for (const l of this.glows) {
      if (!l.img.visible) continue;
      const big = l.img.texture.key === 'fx_glow';
      out.push({ x: l.img.x, y: l.img.y, color: l.img.tintTopLeft, r: big ? 78 * l.img.scaleX : 18, a: Math.min(1, l.img.alpha * 1.4) });
    }
    for (const u of this.units.values())
      if (u.actor.side === 'pc' && u.actor.state !== 'dead') out.push({ x: u.sprite.x, y: u.sprite.y - 4, color: 0xfff0d8, r: 52, a: 0.62 });
    return out;
  }

  /** Licznik Geigera: trzeszczy, gdy najemnik idzie przy skażeniu (albo w toksycznej mgle). */
  private geiger(at: GridPos): void {
    if (this.time.now - this.geigerAt < 450) return;
    let best = 99;
    for (const c of this.toxicCells) best = Math.min(best, cheb(at, c));
    if (best > 3 && !(this.mood === 'toxic' && Math.random() < 0.3)) return;
    this.geigerAt = this.time.now;
    SoundManager.sfx('geiger', { vol: best <= 1 ? 0.7 : best <= 3 ? 0.45 : 0.25 });
  }

  private updateLights(): void {
    const t = this.elapsed;
    for (const l of this.glows) {
      const cell = this.cells[l.cell];
      const vis = cell.state === 2 ? 1 : cell.state === 1 ? 0.12 : 0;
      if (vis === 0) {
        l.img.setVisible(false);
        continue;
      }
      let k = 1;
      switch (l.kind) {
        case 'flicker':
          k = 0.78 + Math.sin(t * 11 + l.phase) * 0.08 + Math.sin(t * 23.7 + l.phase * 2) * 0.06 + (hash2(Math.floor(t * 12), 0, l.phase | 0) - 0.5) * 0.12;
          break;
        case 'pulse':
          k = 0.65 + Math.sin(t * 2.2 + l.phase) * 0.35;
          break;
        case 'blink':
          k = (t + l.phase) % 1.6 < 0.5 ? 1 : 0.1;
          break;
        default:
          break;
      }
      l.img.setVisible(true).setAlpha(l.base * k * vis * cell.reveal);
    }
  }

  // ================================================================== mgła wojny

  /** Mgła z Mission (widok wszystkich najemników): widoczne = pełny kolor, zapamiętane = zimny półmrok, reszta ukryta. */
  /** Tint pól odkrytych, ale poza zasięgiem wzroku: ciemny i neutralny (bez brązu) w każdym nastroju. */
  private memoryTint(): number {
    return fogMemoryTint(BIOME_STYLE[this.biome].memory, this.mood);
  }

  private updateFogOfWar(): void {
    const m = this.mission;
    const memory = this.memoryTint();
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const next: CellState = m.vis[i] ? 2 : m.explored[i] ? 1 : 0;
      if (next === cell.state) continue;
      if (cell.state === 0) {
        this.revealing.add(i);
        for (const img of cell.imgs) img.setVisible(true).setAlpha(0);
      }
      cell.state = next;
      const tint = next === 2 ? TINT_VISIBLE : memory;
      for (const img of cell.imgs) if (img.blendMode !== Phaser.BlendModes.ADD) img.setTint(tint);
    }
    for (const u of this.units.values()) {
      if (u.actor.side === 'enemy') this.setUnitVisible(u, this.enemyShown(u.actor, u.pos));
      else if (u.actor.side === 'neutral') this.setUnitVisible(u, this.mission.isVisible(u.pos) || !!u.actor.following);
    }
    this.updateFoes();
    this.refreshStances();
  }

  /** Wróg jest widoczny na polu w zasięgu wzroku drużyny; ciało zostaje na odkrytym terenie. */
  private enemyShown(a: Actor, p: GridPos): boolean {
    return a.state === 'dead' ? this.mission.isExplored(p) : this.mission.isVisible(p);
  }

  /** Płynne odsłanianie nowo odkrytych pól. */
  private updateReveal(dt: number): void {
    if (this.revealing.size === 0) return;
    for (const i of this.revealing) {
      const cell = this.cells[i];
      cell.reveal = Math.min(1, cell.reveal + dt * 4);
      for (const img of cell.imgs) img.setAlpha(cell.reveal);
      if (cell.reveal >= 1) this.revealing.delete(i);
    }
  }

  /** Wysokie obiekty przed graczem stają się półprzezroczyste, żeby nie zasłaniały postaci. */
  private updateCutaway(dt: number): void {
    const s = this.focus.sprite;
    const pu = (s.y / 8 + s.x / 16) / 2 - 0.5;
    const pv = (s.y / 8 - s.x / 16) / 2 - 0.5;
    const psum = pu + pv, pdiff = pu - pv;
    const k = Math.min(1, dt * 10);
    for (const t of this.tall) {
      const [tvx, tvy] = toView(t.gx, t.gy); // pu/pv liczone z ekranu = współrzędne widoku
      const d = tvx + tvy - psum;
      const occludes = d > 0.5 && d < t.reach && Math.abs(tvx - tvy - pdiff) < 1.6;
      const target = occludes ? 0.38 : 1;
      if (Math.abs(t.fade - target) < 0.01 && !this.revealing.has(this.idx(t.gx, t.gy))) continue;
      t.fade += (target - t.fade) * k;
      t.img.setAlpha(t.fade * this.cells[this.idx(t.gx, t.gy)].reveal);
    }
  }

  // ================================================================== eksploracja

  /** Klik poza walką: wybór lidera, interakcja z obiektem, zasadzka na wroga albo ruch drużyny (Mission.exploreMove). */
  private async exploreClick(cell: GridPos): Promise<void> {
    const sel = this.selected;
    if (!sel || this.over || !this.hud.canAct || this.hud.inCombat) return;
    const who = this.visibleActorAt(cell);
    const mode = this.mode;
    if (mode?.type === 'ability') return this.abilityClick(sel, mode.id, cell, who);
    if (mode?.type === 'item') return this.itemClick(sel, mode.uid, cell, who);
    if (who?.side === 'pc') {
      // Oldgame hud.js:247: klik na wybranego najemnika otwiera kartę postaci
      if (who === sel) this.hud.toggleInventory(true);
      else void this.selectMember(who);
      return;
    }
    const th = this.mission.thingAt(cell.gx, cell.gy);
    if (th && !who && this.mission.isExplored(cell)) return this.exploreInteract(th);
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.hud.setHover(null);
    if (who?.side === 'enemy' && who.group) {
      // atak z ukrycia: test Skradania decyduje, czy to zasadzka (drużyna pierwsza, wrogowie odsłonięci)
      this.hud.pushLog(`${sel.ch.name} próbuje zaatakować z ukrycia...`, 'amber');
      const su = this.units.get(sel);
      if (su) {
        this.face(su, { gx: who.gx - sel.gx, gy: who.gy - sel.gy });
        this.act(su, 'hide', 'idle');
      }
      const roll = this.mission.ambushAttack(sel, who.group);
      await this.dice(roll, 'Skradanie', sel);
    } else {
      const r = this.mission.exploreMove(sel, cell, { group: this.hud.groupMove });
      if (!r.ok) {
        if (r.reason) this.hud.pushLog(r.reason);
        SoundManager.sfx('error', { vol: 0.5 });
        this.hud.setBusy(false);
        this.refreshOverlay();
        return;
      }
      this.refollow();
      this.updateFogOfWar();
      await Promise.all([...r.paths].map(([a, path]) => this.walk(a, path)));
    }
    await this.afterExplore();
  }

  /** Po ruchu / interakcji w eksploracji: sygnały, walka albo powrót sterowania (i pytanie o ewakuację). */
  private async afterExplore(): Promise<void> {
    await this.flush();
    this.updateFogOfWar();
    if (this.over) return;
    if (this.mission.inCombat()) {
      await this.runCombat();
      return;
    }
    this.hud.setBusy(false);
    this.refreshActions();
    this.refreshOverlay();
    this.refreshPathPreview();
    if (await this.askAfterObjective()) return;
    await this.checkExtraction();
  }

  /**
   * Cel wykonany: bez potrzeby powrotu (eliminacja, polowanie, obrona...) - gdy nic nie zostało, misja kończy się
   * od razu; gdy zostały łupy / ukryte znaleziska / wrogowie - wybór: przeszukać teren dalej albo ewakuacja.
   * Zwraca true, gdy misja się zakończyła.
   */
  private async askAfterObjective(): Promise<boolean> {
    if (!this.completeAsk || this.over || this.mission.mode !== 'explore') return false;
    this.completeAsk = false;
    if (this.mission.needsExtraction()) return false;
    const left = this.mission.leftovers();
    if (!left.length) {
      this.mission.finish('success');
      await this.flush();
      return true;
    }
    this.hud.setBusy(true);
    SoundManager.sfx('radio', { vol: 0.6 });
    const v = await this.hud.ask({
      title: 'Cel wykonany',
      body: `Zlecenie zaliczone. Na terenie zostało jeszcze:\n- ${left.join('\n- ')}\n\nMożecie dalej przeszukiwać okolicę, a potem wrócić do strefy ewakuacji albo użyć przycisku Powrót - nagroda za zlecenie zostaje.`,
      options: [{ label: 'Przeszukaj teren', value: null, primary: true }, { label: 'Ewakuacja teraz', value: 'go' }],
      w: 360,
    });
    if (this.over) return true;
    if (v === 'go') {
      this.mission.finish('success');
      await this.flush();
      return true;
    }
    this.hud.setBusy(false);
    this.refreshOverlay();
    return false;
  }

  /** Interakcja w eksploracji: podejście (jeden ruch) do pola obok obiektu, potem skrzynia / cel / jeniec. */
  private async exploreInteract(th: MissionThing): Promise<void> {
    const sel = this.selected;
    if (!sel || sel.state !== 'up') return;
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.hud.setHover(null);
    const cell = this.mission.interactCell(sel, th);
    if (!cell) {
      this.hud.pushLog('Nie można dojść.');
      SoundManager.sfx('error', { vol: 0.5 });
      this.hud.setBusy(false);
      this.refreshOverlay();
      return;
    }
    if (cell.gx !== sel.gx || cell.gy !== sel.gy) {
      // Oldgame mission.js:507: do obiektu podchodzi tylko wybrany najemnik
      const r = this.mission.exploreMove(sel, cell, { group: false });
      if (r.ok) {
        this.refollow();
        this.updateFogOfWar();
        await Promise.all([...r.paths].map(([a, path]) => this.walk(a, path)));
      }
      await this.flush();
      this.updateFogOfWar();
      if (this.mission.inCombat() || this.over) return this.afterExplore();
      if (cheb(sel, th) > 1) {
        this.hud.pushLog(r.ok ? 'Za daleko na jeden ruch — podejdź bliżej.' : (r.reason ?? 'Nie można dojść.'));
        return this.afterExplore();
      }
    }
    this.face(this.units.get(sel)!, { gx: th.gx - sel.gx, gy: th.gy - sel.gy });
    let skill: SkillId | undefined;
    if (th.kind === 'crate' || th.kind === 'door' || th.kind === 'device') {
      skill = (await this.pickThingSkill(sel, th)) ?? undefined;
      this.lastCrateSkill = skill ?? null;
      if (!skill) return this.afterExplore();
    }
    this.mission.interact(sel, th, skill);
    await this.flush();
    const np = this.mission.followNeutral(sel);
    if (np && this.mission.captive?.actor) await this.walk(this.mission.captive.actor, np);
    await this.afterExplore();
  }

  /** Wybór umiejętności do obiektu: skrzynia, drzwi (wytrych / wyważenie) albo urządzenie (hakowanie). */
  private pickThingSkill(a: Actor, th: MissionThing): Promise<SkillId | null> {
    if (th.kind === 'door') return this.pickLockSkill(a, th);
    if (th.kind === 'device') return this.pickHackSkill(a, th);
    return this.pickCrateSkill(a);
  }

  /** Opcje wyboru umiejętności z szansą (%) - najlepsza wyróżniona. */
  private skillOptions(list: readonly SkillId[], dcOf: (id: SkillId) => number, modOf: (id: SkillId) => number, note: (id: SkillId) => string = () => '') {
    const opts = list.map((id) => {
      const m = modOf(id);
      const pct = Math.round(hitChances(m, dcOf(id)).hit * 100);
      return { label: `${note(id) || SKILLS[id].name} ${fmtMod(m)} (${pct}%)`, value: id as string, primary: false, pct };
    });
    const best = opts.reduce((x, y) => (y.pct > x.pct ? y : x));
    best.primary = true;
    return opts.map(({ pct: _p, ...o }) => o);
  }

  /** Drzwi: Otwieranie zamka (PF2e Pick a Lock, kilka sukcesów) albo Wyważenie (Force Open). */
  private async pickLockSkill(a: Actor, th: MissionThing): Promise<SkillId | null> {
    const lock = th.lock;
    if (!lock) return null;
    const tools = hasLockpick(a.ch);
    const opts = this.skillOptions(
      LOCK_SKILLS,
      (id) => (id === 'athletics' ? lock.dc + 5 : lock.dc),
      (id) => getStat(a.ch, id) + (id === 'athletics' ? IMPROVISED_PENALTY + lock.forcePenalty : tools ? 0 : IMPROVISED_PENALTY),
      (id) => (id === 'athletics' ? 'Wyważenie (Atletyka)' : 'Wytrych (Złodziejstwo)'),
    );
    const v = await this.hud.ask({
      title: th.name,
      body:
        `${a.ch.name} ogląda zamek: ST ${lock.dc}, postęp ${lock.progress}/${lock.needed} sukcesów.
` +
        `Wytrych: sukces = 1, kryt. sukces = 2 sukcesy; kryt. porażka łamie wytrych${tools ? '' : ' (brak wytrychów: kara -2)'}. 2 akcje w walce.
` +
        `Wyważenie: ST ${lock.dc + 5}, kara -2 bez łomu; sukces otwiera, ale niszczy zamek.`,
      options: [{ label: 'Zostaw', value: null }, ...opts],
      w: 380,
    });
    return (v as SkillId | null) ?? null;
  }

  /** Urządzenie: hakowanie (Technika) albo obejście sprzętowe (Złodziejstwo). */
  private async pickHackSkill(a: Actor, th: MissionThing): Promise<SkillId | null> {
    const dev = th.lock;
    if (!dev) return null;
    const opts = this.skillOptions(HACK_SKILLS, () => dev.dc, (id) => getStat(a.ch, id), (id) => (id === 'crafting' ? 'Hakowanie (Technika)' : 'Obejście (Złodziejstwo)'));
    const v = await this.hud.ask({
      title: th.name,
      body:
        `${a.ch.name} podłącza się do urządzenia: ST ${dev.dc}, zabezpieczenia ${dev.progress}/${dev.needed}.
` +
        `Sukces łamie 1 warstwę, kryt. sukces 2. Kryt. porażka blokuje urządzenie i włącza alarm. 2 akcje w walce.`,
      options: [{ label: 'Zostaw', value: null }, ...opts],
      w: 380,
    });
    return (v as SkillId | null) ?? null;
  }

  /** Wybór sposobu otwarcia skrzyni (Oldgame/src/scenes/mission.js:532-549): premia najemnika i szansa vs KT. */
  private async pickCrateSkill(a: Actor): Promise<SkillId | null> {
    const dc = this.mission.crateDC();
    const opts = CRATE_SKILLS.map((id) => {
      const m = getStat(a.ch, id);
      const pct = Math.round(hitChances(m, dc).hit * 100);
      return { label: `${SKILLS[id].name} ${fmtMod(m)} (${pct}%)`, value: id as string, primary: false };
    });
    const best = opts.reduce((x, y) => (Number(/\((\d+)%/.exec(y.label)?.[1]) > Number(/\((\d+)%/.exec(x.label)?.[1]) ? y : x));
    best.primary = true;
    const v = await this.hud.ask({
      title: 'Zamknięta skrzynia',
      body: `${a.ch.name} przygląda się zamkowi. Jak go otworzyć? (KT ${dc})\nKrytyczna porażka uruchamia pułapkę; zwykła porażka - zamek się zacina (2 próby).`,
      options: [{ label: 'Zostaw', value: null }, ...opts],
      w: 360,
    });
    return (v as SkillId | null) ?? null;
  }

  /** Cel wykonany i wszyscy w strefie ewakuacji: pytanie o opuszczenie terenu (Oldgame/src/scenes/mission.js:481-492). */
  private async checkExtraction(): Promise<void> {
    if (!this.mission.canExtract()) {
      this.extractAsked = false;
      return;
    }
    if (this.extractAsked || this.over) return;
    this.extractAsked = true;
    this.hud.setBusy(true);
    SoundManager.sfx('radio', { vol: 0.6 });
    const v = await this.hud.ask({
      title: 'Strefa ewakuacji',
      body: 'Cel zlecenia wykonany, drużyna jest w strefie ewakuacji. Opuścić teren?',
      options: [{ label: 'Jeszcze nie', value: null }, { label: 'Ewakuacja', value: 'go', primary: true }],
    });
    if (this.over) return;
    if (v === 'go') {
      this.mission.finish('success');
      await this.flush();
      return;
    }
    this.hud.setBusy(false);
    this.refreshOverlay();
  }

  /** Odwrót z potwierdzeniem (eksploracja i walka) - Oldgame/src/scenes/mission.js:357-361. */
  private async askRetreat(): Promise<void> {
    if (this.over || (!this.hud.canAct && !this.hud.inCombat)) return;
    const done = this.mission.objectiveDone() && this.mission.objType !== 'rescue';
    if (this.hud.inCombat && !this.playerTurn) {
      this.hud.pushLog('Odwrót możliwy w turze najemnika.');
      SoundManager.sfx('error', { vol: 0.4 });
      return;
    }
    const wasBusy = this.hud.busy;
    this.hud.setBusy(true);
    const v = await this.hud.ask({
      title: done ? 'Powrót?' : 'Odwrót?',
      body: done
        ? 'Cel zlecenia jest wykonany — wracacie z nagrodą. Czego nie zabraliście, zostaje na miejscu.'
        : 'Wycofujecie się ze zlecenia. Nagroda za cel przepada, ale zachowujecie łupy i doświadczenie za pokonanych wrogów.',
      options: [{ label: 'Zostań', value: null }, done ? { label: 'Powrót', value: 'go', primary: true } : { label: 'Odwrót', value: 'go', danger: true }],
    });
    if (this.over) return;
    if (v === 'go') {
      this.mission.retreat();
      await this.flush();
      return;
    }
    this.hud.setBusy(wasBusy);
    this.refreshOverlay();
  }

  /** Stan misji do zapisu gry (Save.missionProvider); null poza zleceniem kampanii, w walce i po końcu misji. */
  private missionResume(): MissionResume | null {
    if (!this.job || !this.entrySnapshot || this.over) return null;
    const snap = this.mission.snapshot();
    return snap ? { contract: this.job, snap, entry: this.entrySnapshot } : null;
  }

  /** Czy można teraz zapisać grę (eksploracja, nic się nie dzieje); inaczej komunikat w dzienniku. */
  private canSaveNow(): boolean {
    if (!this.entrySnapshot) {
      this.hud.pushLog('W trybie demonstracyjnym nie ma zapisu gry.');
    } else if (this.mission.inCombat()) {
      this.hud.pushLog('Nie można zapisać gry w trakcie walki.', 'bad');
    } else if (this.over || this.hud.busy || !this.hud.canAct) {
      this.hud.pushLog('Poczekaj, aż drużyna skończy ruch.');
    } else return true;
    SoundManager.sfx('error', { vol: 0.4 });
    return false;
  }

  /** Okno slotów zapisu / wczytania nad HUD-em misji. */
  private async saveLoadSlots(mode: 'save' | 'load'): Promise<void> {
    if (mode === 'save' && !this.canSaveNow()) return;
    if (mode === 'load' && (this.over || this.hud.busy || (this.hud.inCombat && !this.playerTurn))) {
      SoundManager.sfx('error', { vol: 0.4 });
      return;
    }
    const ui = this.scene.get('UIScene');
    if (!ui || modalOpen(ui)) return;
    const wasBusy = this.hud.busy;
    this.hud.setBusy(true);
    const slot = await openSaveSlots(ui, mode);
    if (mode === 'load' && slot !== null) {
      this.over = true;
      this.scene.get('UIScene')?.cameras.main?.fadeOut(400, 0, 0, 0);
      enterLoaded(this);
      return;
    }
    if (mode === 'save' && slot !== null) this.hud.pushLog(`Gra zapisana w slocie ${slot}.`, 'good');
    this.hud.setBusy(wasBusy);
    this.refreshOverlay();
  }

  /**
   * Wyjście do ekranu tytułowego. "Zapisz i wyjdź" zapisuje bieżący stan misji (Kontynuuj wraca na tę mapę);
   * "Wyjdź bez zapisu" wraca do ostatniego zapisu. W walce zapis jest niedostępny.
   */
  private async askQuit(): Promise<void> {
    if (this.over || (!this.hud.canAct && !this.hud.inCombat)) return;
    if (this.hud.inCombat && !this.playerTurn) {
      this.hud.pushLog('Wyjście możliwe w turze najemnika.');
      SoundManager.sfx('error', { vol: 0.4 });
      return;
    }
    const wasBusy = this.hud.busy;
    this.hud.setBusy(true);
    const canSave = !!this.entrySnapshot && !this.mission.inCombat();
    const options: PromptOption[] = [{ label: 'Zostań', value: null }];
    if (canSave) options.push({ label: 'Zapisz i wyjdź', value: 'save' });
    options.push({ label: this.entrySnapshot ? 'Wyjdź bez zapisu' : 'Wyjdź', value: 'quit', danger: true });
    const v = await this.hud.ask({
      title: 'Wyjść z gry?',
      body: !this.entrySnapshot
        ? 'Wracacie do ekranu tytułowego.'
        : canSave
          ? 'Wracacie do ekranu tytułowego.\n\n"Zapisz i wyjdź" zapisze grę razem z bieżącym stanem misji - "Kontynuuj" wróci na tę mapę. "Wyjdź bez zapisu" wraca do ostatniego zapisu.'
          : 'Trwa walka - nie można teraz zapisać gry. Wyjście wraca do ostatniego zapisu; postęp tej misji od tamtej chwili przepada.',
      options,
    });
    if (this.over) return;
    if (v === 'save' || v === 'quit') {
      if (v === 'save' && !Save.write()) {
        this.hud.pushLog('Zapis nie powiódł się!', 'bad');
        this.hud.setBusy(wasBusy);
        this.refreshOverlay();
        return;
      }
      this.over = true;
      if (v === 'quit' && this.entrySnapshot) {
        // porzucony stan z misji (rany, zużyte przedmioty) nie może zostać w pamięci
        if (!Save.load()) campaign.state = freshState();
      }
      this.scene.get('UIScene')?.cameras.main?.fadeOut(600, 0, 0, 0);
      goto(this, 'TitleScene', undefined, 600);
      return;
    }
    this.hud.setBusy(wasBusy);
    this.refreshOverlay();
  }

  /** Po wczytaniu zapisu: powaleni i polegli od razu leżą (bez animacji upadku). */
  private restoreUnitStates(): void {
    for (const [a, u] of this.units) {
      if (a.state === 'up') continue;
      this.lie(u);
      this.tintFor(u);
      if (a.state === 'dead') u.shadow.setAlpha(0.3);
    }
  }

  /** Wybór najemnika: w eksploracji zmienia lidera, w walce - kolejność tury (Combat.switchTo). */
  private async selectMember(a: Actor): Promise<void> {
    if (!this.hud.canAct || a.state !== 'up') {
      if (a.state !== 'up') SoundManager.sfx('error', { vol: 0.4 });
      return;
    }
    if (!this.hud.inCombat) {
      this.hud.setActive(a.ch);
      this.focusOn(this.units.get(a)!);
      SoundManager.sfx('click');
      this.mode = null;
      this.modeHint = null;
      this.refreshActions();
      this.refreshOverlay();
      this.refreshPathPreview();
      return;
    }
    const t = this.playerTurn;
    if (!t || t.actor === a) return;
    const r = this.combat.switchTo(a);
    if (r.message) this.hud.pushLog(r.message, r.ok ? 'dim' : 'bad');
    if (!r.ok) SoundManager.sfx('error', { vol: 0.4 });
    await this.flush();
    this.updateInitiative();
    if (r.ok && r.immediate) this.finishPlayerTurn();
  }

  // ================================================================== walka (tactical/combat.ts)

  /** Pętla walki: kolejne tury wg inicjatywy, aż Combat ogłosi koniec. */
  private async runCombat(): Promise<void> {
    if (this.combatRunning) return;
    this.combatRunning = true;
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.refreshOverlay();
    let stall = 0;
    while (this.mission.inCombat() && this.combat.active && !this.over) {
      const t = this.combat.nextTurn();
      await this.flush();
      this.updateFogOfWar();
      this.updateInitiative();
      if (!t) {
        if (++stall > 5) break;
        continue;
      }
      stall = 0;
      if (t.actor.side === 'pc') await this.playerCombatTurn(t);
      else await this.aiTurn(t.actor);
    }
    await this.flush();
    this.combatRunning = false;
    this.playerTurn = null;
    this.mode = null;
    this.sub = null;
    this.hud.setActions(null, []);
    this.hud.setInitiative([]);
    if (this.over) return;
    // powrót do eksploracji (Oldgame/src/mission/combat.js:316-324)
    SoundManager.music(BIOME_MUSIC[this.biome] ?? 'ruins');
    const lead = this.selected?.state === 'up' ? this.selected : this.mission.pcs.find((p) => p.state === 'up');
    if (lead) {
      this.hud.setActive(lead.ch);
      this.focusOn(this.units.get(lead)!);
    }
    this.hud.ap = MAX_ACTION_POINTS;
    this.hud.maxAp = MAX_ACTION_POINTS;
    this.hud.attacksMade = 0;
    this.hud.setPhase(TurnPhase.EXPLORATION, this.combat.round);
    const allDead = this.mission.enemies.every((e) => e.state === 'dead');
    this.hud.showBanner(allDead ? 'TEREN CZYSTY' : 'WALKA ZAKOŃCZONA', 'good');
    this.updateFogOfWar();
    this.hud.setBusy(false);
    this.refreshActions();
    this.refreshOverlay();
    this.refreshPathPreview();
    if (await this.askAfterObjective()) return;
    await this.checkExtraction();
  }

  /** Tura najemnika: czeka na polecenia gracza, aż skończą się akcje lub gracz zakończy turę. */
  private async playerCombatTurn(t: TurnInfo): Promise<void> {
    this.playerTurn = t;
    this.reachCache = null;
    this.mode = null;
    this.sub = null;
    this.hud.setActive(t.actor.ch);
    this.hud.attacksMade = t.actor.mapN;
    this.hud.maxAp = Math.max(MAX_ACTION_POINTS, t.full);
    this.hud.setAp(t.actions);
    this.hud.setPhase(TurnPhase.PLAYER_TURN, this.combat.round);
    this.hud.showBanner(`TURA: ${t.actor.ch.name.toUpperCase()}`, 'good', `${t.actions} ${t.actions === 1 ? 'akcja' : 'akcje'}`);
    SoundManager.sfx('turn');
    this.focusOn(this.units.get(t.actor)!);
    await new Promise<void>((resolve) => {
      this.turnDone = resolve;
      this.hud.setBusy(false);
      this.refreshActions();
      this.refreshOverlay();
      this.refreshPathPreview();
    });
    this.turnDone = null;
    this.playerTurn = null;
    this.mode = null;
    this.sub = null;
    this.modeHint = null;
    this.hud.setActions(null, []);
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.refreshOverlay();
    this.hud.setHover(null);
  }

  private finishPlayerTurn(): void {
    const done = this.turnDone;
    this.turnDone = null;
    done?.();
  }

  /** Jedno polecenie gracza w jego turze: logika -> animacja sygnałów -> odświeżenie HUD-u. */
  private async combatAct(fn: (a: Actor) => ActionOutcome): Promise<void> {
    const t = this.playerTurn;
    if (!t) return this.exploreAct(fn);
    if (!this.hud.canAct) return;
    this.hud.setBusy(true);
    this.mode = null;
    this.modeHint = null;
    this.clearPathPreview();
    this.refreshOverlay();
    this.hud.setHover(null);
    const out = fn(t.actor);
    if (!out.ok && out.reason) {
      this.hud.pushLog(out.reason);
      SoundManager.sfx('error', { vol: 0.5 });
    }
    await this.flush();
    this.updateFogOfWar();
    this.updateInitiative();
    this.reachCache = null;
    this.hud.attacksMade = t.actor.mapN;
    this.hud.setAp(this.combat.turn === t ? t.actions : 0);
    this.hud.notify('inventory');
    if (this.over) return;
    if (this.sub === 'items' && !this.combat.consumables(t.actor).length) this.sub = null;
    if (!this.combat.active || this.combat.turn !== t || t.actions <= 0 || t.actor.state !== 'up') {
      this.hud.setActions(null, []);
      await this.wait(300);
      this.finishPlayerTurn();
      return;
    }
    this.hud.setBusy(false);
    this.refreshActions();
    this.refreshOverlay();
    this.refreshPathPreview();
  }

  /** Zdolność / przedmiot w eksploracji: bez tury i kosztu akcji (limity użyć obowiązują jak w walce). */
  private async exploreAct(fn: (a: Actor) => ActionOutcome): Promise<void> {
    const a = this.actorNow();
    if (!a || !this.hud.canAct) return;
    this.hud.setBusy(true);
    this.mode = null;
    this.modeHint = null;
    this.clearPathPreview();
    this.refreshOverlay();
    this.hud.setHover(null);
    const out = fn(a);
    if (!out.ok && out.reason) this.deny(out.reason);
    await this.flush();
    this.hud.notify('stats');
    this.hud.notify('inventory');
    if (this.sub === 'items' && !this.combat.consumables(a).length) this.sub = null;
    await this.afterExplore();
  }

  private async combatClick(cell: GridPos): Promise<void> {
    const t = this.playerTurn;
    if (!t) return;
    const a = t.actor;
    const who = this.visibleActorAt(cell);
    const mode = this.mode;
    if (mode?.type === 'step') return this.combatAct((x) => this.combat.step(x, cell));
    if (mode?.type === 'ability') return this.abilityClick(a, mode.id, cell, who);
    if (mode?.type === 'item') return this.itemClick(a, mode.uid, cell, who);
    if (who?.side === 'enemy') {
      if (t.actions < 1) return this.deny('Brak akcji.');
      return this.combatAct((x) => this.combat.attackTarget(x, who));
    }
    if (mode?.type === 'strike') return this.deny('Wskaż wroga z czerwonym konturem.');
    if (who?.side === 'pc') {
      if (who !== a) await this.selectMember(who);
      return;
    }
    const th = this.mission.thingAt(cell.gx, cell.gy);
    if (th) return this.playerInteract(th);
    return this.combatAct((x) => this.combat.stride(x, cell));
  }

  private deny(msg: string): void {
    this.hud.pushLog(msg);
    SoundManager.sfx('error', { vol: 0.5 });
  }

  /** Interakcja w walce: obiekt obok, kosztuje 1 akcję (Oldgame/src/mission/combat.js:447-451). */
  private async playerInteract(th: MissionThing): Promise<void> {
    const t = this.playerTurn;
    if (!t || !this.hud.canAct) return;
    const a = t.actor;
    if (cheb(a, th) > 1) return this.deny('Podejdź bliżej (obok obiektu).');
    if (t.actions < 1) return this.deny('Brak akcji.');
    if (th.kind === 'wreck' && t.actions < SALVAGE_ACTIONS) return this.deny(`Rozbieranie wraku zajmuje całą turę (${SALVAGE_ACTIONS} akcje).`);
    let skill: SkillId | undefined;
    if (th.kind === 'crate' || th.kind === 'door' || th.kind === 'device') {
      this.hud.setBusy(true);
      skill = (await this.pickThingSkill(a, th)) ?? undefined;
      this.lastCrateSkill = skill ?? null;
      this.hud.setBusy(false);
      if (!skill || this.playerTurn !== t) return;
      // PF2e: wytrych i hakowanie = 2 akcje
      if ((th.kind === 'device' || (th.kind === 'door' && skill !== 'athletics')) && t.actions < 2) return this.deny('Potrzeba 2 akcji.');
    }
    return this.combatAct((x) => (this.mission.interact(x, th, skill) ? { ok: true } : { ok: false, reason: 'Nic się nie stało.' }));
  }

  // ---------- pasek akcji (port C.refreshBar)

  private refreshActions(): void {
    const t = this.playerTurn;
    const a = this.actorNow();
    if (!a || this.over || a.state !== 'up' || (t && this.combat.turn !== t)) {
      this.hud.setActions(null, []);
      return;
    }
    // eksploracja: te same zdolności i przedmioty co w walce, bez kosztu akcji (np. leczenie po walce)
    const free = !t;
    const n = t ? t.actions : Infinity, mode = this.mode;
    const ONLY_COMBAT = ' — tylko w walce';
    const list: ActionButton[] = [];
    const add = (id: string, label: string, cost: number | 'r' | null, o: { enabled?: boolean; active?: boolean; tip?: string } = {}): void => {
      const enabled = (o.enabled ?? true) && (typeof cost !== 'number' || cost <= n);
      list.push({ id, label, cost: free ? null : cost, enabled, active: o.active, tip: o.tip });
    };
    if (this.sub === 'items') {
      for (const it of this.combat.consumables(a)) {
        const def = itemDef(it.id);
        const c = def?.type === 'consumable' ? def.consumable : null;
        if (!def || !c) continue;
        const ok = !free || exploreItemOk(c);
        add(`item:${it.uid}`, `${def.name}${it.qty > 1 ? ' x' + it.qty : ''}`, c.actions, { enabled: ok, active: mode?.type === 'item' && mode.uid === it.uid, tip: `${def.name}: ${def.desc}${ok ? '' : ONLY_COMBAT}` });
      }
      add('back', 'Wróć', null, { tip: 'Powrót do akcji [Esc].' });
      if (!free) add('end', 'Koniec tury', null, { tip: 'Zakończ turę [Spacja].' });
      this.hud.setActions(`PRZEDMIOTY — ${a.ch.name}`, list);
      return;
    }
    if (free) {
      for (const id of a.ch.abilities) {
        const ab = abilityDef(id);
        if (!ab || id === 'strike' || id === 'stand') continue;
        const ok = exploreAbilityOk(ab);
        const left = ab.uses ? usesLeft(a.ch, id as AbilityId) : Infinity;
        add(`ab:${id}`, ab.name + (ab.uses ? ` (${left})` : ''), null, {
          enabled: ok && left > 0,
          active: mode?.type === 'ability' && mode.id === id,
          tip: `${ab.name}: ${ab.desc}${ok ? '' : ONLY_COMBAT}`,
        });
      }
      const cons = this.combat.consumables(a);
      if (cons.length) add('items', `Przedmioty (${cons.reduce((s, x) => s + x.qty, 0)})`, null, { tip: 'Użyj przedmiotu z plecaka (na siebie lub sojusznika).' });
      const th = this.mission.things.find((x) => !x.done && cheb(a, x) <= 1);
      if (th) {
        const INTERACT: Partial<Record<MissionThing['kind'], string>> = { crate: 'Otwórz skrzynię', item: 'Zabierz cel', nest: 'Zniszcz gniazdo', door: 'Otwórz drzwi', device: 'Hakuj' };
        add('interact', INTERACT[th.kind] ?? 'Uwolnij', null, { tip: 'Interakcja z obiektem obok.' });
      }
      this.hud.setActions(`${a.ch.name} — EKSPLORACJA`, list);
      return;
    }
    const w = normWeapon(getWeapon(a.ch));
    const mapIdx = Math.min(2, a.mapN);
    const agile = w.traits.includes('agile');
    add('stride', 'Marsz', 1, { active: mode?.type === 'stride', tip: 'Marsz — przejdź do swojej Prędkości za 1 akcję (niebieskie pola 1 akcja, żółte 2, pomarańczowe 3).' });
    add('step', 'Krok', 1, { active: mode?.type === 'step', tip: 'Krok — przesuń się o 1 pole.' });
    add('strike', `Atak: ${w.name}${mapIdx ? ` (-${(agile ? 4 : 5) * mapIdx})` : ''}`, 1, {
      active: mode?.type === 'strike',
      tip: `Atak: ${w.name}, ${w.range ? 'zasięg ' + w.range : 'wręcz'}. Wrogowie w zasięgu mają czerwony kontur. Kolejne ataki: kara PWA.`,
    });
    for (const id of a.ch.abilities) {
      const ab = abilityDef(id);
      if (!ab || id === 'strike') continue;
      if (id === 'stand' && !hasCondition(a.ch, 'prone')) continue;
      if (id === 'raise_shield' && !a.ch.equipment.shield) continue;
      const reaction = ab.actions === 'reaction';
      const cost = reaction ? 'r' : (ab.actions as number);
      const left = ab.uses ? usesLeft(a.ch, id as AbilityId) : Infinity;
      const dis = reaction || left <= 0 || (cost === 0 && !!a.used['_free_' + id]);
      const extra = ab.actions === 0 ? ' (akcja darmowa)' : reaction ? ' (reakcja)' : '';
      add(`ab:${id}`, ab.name + (ab.uses ? ` (${left})` : ''), cost, { enabled: !dis, active: mode?.type === 'ability' && mode.id === id, tip: `${ab.name}${extra}: ${ab.desc}` });
    }
    const cons = this.combat.consumables(a);
    if (cons.length) add('items', `Przedmioty (${cons.reduce((s, x) => s + x.qty, 0)})`, null, { tip: 'Użyj przedmiotu z plecaka.' });
    const th = this.mission.things.find((x) => !x.done && cheb(a, x) <= 1);
    if (th) {
      const INTERACT: Partial<Record<MissionThing['kind'], string>> = { crate: 'Otwórz skrzynię', item: 'Zabierz cel', nest: 'Zniszcz gniazdo', door: 'Otwórz drzwi', device: 'Hakuj' };
      add('interact', INTERACT[th.kind] ?? 'Uwolnij', 1, { tip: 'Interakcja z obiektem obok (1 akcja).' });
    }
    add('delay', 'Odłóż turę', null, { tip: 'Przesuń swoją turę na koniec rundy.' });
    add('end', 'Koniec tury', null, { tip: 'Zakończ turę [Spacja].' });
    this.hud.setActions(a.ch.name, list);
  }

  private setMode(m: Mode | null, hint: string | null = null): void {
    const same = (x: Mode | null, y: Mode | null): boolean => !!x && !!y && JSON.stringify(x) === JSON.stringify(y);
    this.mode = same(this.mode, m) ? null : m;
    this.modeHint = this.mode ? hint : null;
    this.refreshActions();
    this.refreshOverlay();
    this.refreshPathPreview();
  }

  /** Esc / PPM: anuluj tryb celowania, potem podmenu przedmiotów. */
  /** Anuluje tryb celowania / podmenu; false, gdy nie było czego anulować. */
  private cancelMode(): boolean {
    if (!this.actorNow()) return false;
    if (this.mode) this.mode = null;
    else if (this.sub) this.sub = null;
    else return false;
    this.modeHint = null;
    this.hud.setHover(null);
    this.refreshActions();
    this.refreshOverlay();
    this.refreshPathPreview();
    return true;
  }

  /**
   * Prawy klik na polu (bez przeciągania): wybrana postać obraca się w stronę tego pola (tylko wygląd). W eksploracji
   * z ruchem całej drużyny (hud.groupMove) obracają się wszyscy stojący najemnicy - każdy w stronę klikniętego pola.
   */
  private turnToPointer(): void {
    const a = this.actorNow();
    if (!a || this.hud.busy || !this.hud.canAct || this.hud.prompt) return;
    const c = this.pointerCell();
    if (!this.inMap(c.gx, c.gy)) return;
    const team = !this.hud.inCombat && this.hud.groupMove ? this.mission.pcs.filter((p) => p.state === 'up') : [a];
    for (const p of team) {
      const u = this.units.get(p);
      if (!u || u.sprite.anims.currentAnim?.key.endsWith('_walk')) continue;
      const d = { gx: c.gx - u.pos.gx, gy: c.gy - u.pos.gy };
      if (!d.gx && !d.gy) continue;
      this.face(u, d);
      this.idle(u);
    }
  }

  private async onAction(id: string): Promise<void> {
    const t = this.playerTurn;
    const a = this.actorNow();
    if (!a || !this.hud.canAct) return;
    if (!t) {
      // eksploracja: tylko zdolności, przedmioty, broń i interakcja
      if (id === 'interact') {
        const th = this.mission.things.find((x) => !x.done && cheb(a, x) <= 1);
        return th ? this.exploreInteract(th) : undefined;
      }
      if (id !== 'items' && id !== 'back' && id !== 'swap' && !id.startsWith('ab:') && !id.startsWith('item:')) return;
    }
    if (id === 'stride') return this.setMode({ type: 'stride' }, 'Marsz: kliknij podświetlone pole. [Esc = anuluj]');
    if (id === 'step') return this.setMode({ type: 'step' }, 'Krok: kliknij zielone pole obok. [Esc = anuluj]');
    if (id === 'strike') return this.setMode({ type: 'strike' }, 'Atak: kliknij wroga z czerwonym konturem. [Esc = anuluj]');
    if (id === 'items') {
      this.sub = 'items';
      this.mode = null;
      this.modeHint = null;
      this.refreshActions();
      this.refreshOverlay();
      return;
    }
    if (id === 'back') {
      this.sub = null;
      this.mode = null;
      this.modeHint = null;
      this.refreshActions();
      this.refreshOverlay();
      this.refreshPathPreview();
      return;
    }
    if (id === 'end') return this.finishPlayerTurn();
    if (id === 'delay') {
      this.combat.delay();
      return this.finishPlayerTurn();
    }
    if (id === 'swap') return this.playerSwapWeapons();
    if (id === 'interact') {
      const th = this.mission.things.find((x) => !x.done && cheb(a, x) <= 1);
      return th ? this.playerInteract(th) : undefined;
    }
    if (id.startsWith('ab:')) return this.abilityPick(a, id.slice(3) as AbilityId);
    if (id.startsWith('item:')) return this.itemPick(a, id.slice(5));
  }

  /** Wybór zdolności (port abilityPick): bez celu - od razu, z celem - tryb celowania. */
  private async abilityPick(a: Actor, id: AbilityId): Promise<void> {
    const ab = abilityDef(id);
    const t = this.playerTurn;
    if (!ab) return;
    if (t && this.combat.abilityCost(ab) > t.actions) return this.deny('Za mało akcji.');
    if (!t && !exploreAbilityOk(ab)) return this.deny('Tego można użyć tylko w walce.');
    if (ab.target === 'area' && !(ab.range > 0)) return this.combatAct((x) => this.combat.useAbility(x, id));
    if (ab.target === 'self' || ab.target === 'none' || !ab.target) return this.combatAct((x) => this.combat.useAbility(x, id));
    if ((ab.target === 'enemy' || ab.target === 'ally') && !this.combat.abilityTargets(a, ab).length) return this.deny('Brak celów w zasięgu.');
    const hint =
      ab.target === 'area'
        ? `${ab.name}: wskaż pole (promień ${ab.radius || 1}, zasięg ${ab.range}). [Esc = anuluj]`
        : `${ab.name}: wskaż cel z ${ab.target === 'ally' ? 'zielonym' : 'czerwonym'} konturem. [Esc = anuluj]`;
    this.setMode({ type: 'ability', id }, hint);
  }

  private async abilityClick(a: Actor, id: AbilityId, cell: GridPos, who: Actor | null): Promise<void> {
    const ab = abilityDef(id);
    if (!ab) return;
    if (ab.target === 'enemy' || ab.target === 'ally') {
      if (!who || !this.combat.abilityTargets(a, ab).includes(who)) return this.deny(ab.target === 'ally' ? 'Wskaż sojusznika w zasięgu.' : 'Wskaż wroga w zasięgu i na linii strzału.');
      return this.combatAct((x) => this.combat.useAbility(x, id, [who]));
    }
    if (ab.target === 'area') {
      if (!this.combat.areaCellOk(a, cell, ab.range)) return this.deny('Poza zasięgiem / brak linii.');
      return this.combatAct((x) => this.combat.useAbility(x, id, [], cell));
    }
    return this.combatAct((x) => this.combat.useAbility(x, id));
  }

  /** Wybór przedmiotu w walce (port itemPick): na siebie od razu, inaczej celowanie. */
  private async itemPick(a: Actor, uid: string): Promise<void> {
    const t = this.playerTurn;
    const inst = a.ch.inventory.find((i) => i.uid === uid);
    const c = inst ? this.combat.consumableOf(inst) : null;
    if (!inst || !c) return;
    if (t && c.actions > t.actions) return this.deny('Za mało akcji.');
    if (!t && !exploreItemOk(c)) return this.deny('Tego można użyć tylko w walce.');
    if (c.target === 'self') return this.combatAct((x) => this.combat.useItem(x, inst));
    const name = itemDef(inst.id)?.name ?? 'Przedmiot';
    const hint =
      c.target === 'area'
        ? `${name}: wskaż pole (promień ${c.radius || 1}, zasięg ${c.range || 6}). [Esc = anuluj]`
        : `${name}: wskaż cel z ${c.target === 'enemy' ? 'czerwonym' : 'zielonym'} konturem. [Esc = anuluj]`;
    this.setMode({ type: 'item', uid }, hint);
  }

  private async itemClick(a: Actor, uid: string, cell: GridPos, who: Actor | null): Promise<void> {
    const inst = a.ch.inventory.find((i) => i.uid === uid);
    const c = inst ? this.combat.consumableOf(inst) : null;
    if (!inst || !c) {
      this.cancelMode();
      return;
    }
    if (c.target === 'area') {
      if (!this.combat.areaCellOk(a, cell, c.range || 6)) return this.deny('Poza zasięgiem.');
      return this.combatAct((x) => this.combat.useItem(x, inst, null, cell));
    }
    if (!who) return this.deny('Wskaż cel.');
    return this.combatAct((x) => this.combat.useItem(x, inst, who === x ? null : who));
  }

  /** Tura wroga sterowana przez AI (tactical/ai.ts), decyzja po decyzji z animacją każdej. */
  private async aiTurn(a: Actor): Promise<void> {
    if (this.hud.phase !== TurnPhase.ENEMY_TURN) {
      this.hud.showBanner('TURA WROGA', 'bad');
      SoundManager.sfx('turn');
    }
    this.hud.setPhase(TurnPhase.ENEMY_TURN, this.combat.round);
    const u = this.units.get(a);
    const seen = !!u?.sprite.visible;
    if (u && seen) this.focusOn(u);
    await this.wait(seen ? 320 : 120);
    for (let guard = 0; guard < 10; guard++) {
      const step = aiStep(this.combat, a);
      if (!step) break;
      await this.flush();
      this.updateFogOfWar();
      this.updateInitiative();
      await this.wait(u?.sprite.visible ? 160 : 40);
    }
    if (this.combat.turn?.actor === a) this.combat.turn.actions = 0;
  }

  /** Pasek inicjatywy (port H.initBar): pełna kolejność z najemnikami, bieżący, runda. */
  private updateInitiative(): void {
    const c = this.combat;
    if (!c.active || this.over) {
      if (this.hud.initiative.length) this.hud.setInitiative([]);
      return;
    }
    const cur = c.turn?.actor ?? null;
    const list: InitEntry[] = [];
    c.order.forEach((a, i) => {
      if (a.state === 'dead' || (a.side === 'enemy' && !a.engaged) || a.side === 'neutral') return;
      list.push({ ch: a.ch, side: a.side === 'pc' ? 'pc' : 'enemy', init: a.init, current: a === cur, done: a !== cur && i < c.idx, down: a.state === 'down' });
    });
    this.hud.round = c.round;
    this.hud.setInitiative(list);
  }

  // ================================================================== przedmioty i broń

  /** Przedmiot z plecaka (klik w ekwipunku). W walce: jak z paska akcji (celowanie). */
  private async playerUseItem(uid: string): Promise<void> {
    const sel = this.selected;
    if (!sel || !this.hud.canAct) return;
    const inst = sel.ch.inventory.find((i) => i.uid === uid);
    const def = inst && itemDef(inst.id);
    if (!inst || def?.type !== 'consumable') return;
    const c = def.consumable;
    if (!this.hud.inCombat) {
      if (c.target === 'enemy' || c.target === 'area') return this.deny('Tego można użyć tylko w walce.');
      if (c.target !== 'self' && this.mission.pcs.some((p) => p !== sel && p.state !== 'dead' && cheb(sel, p) <= Math.max(1, c.range || 1))) {
        // sojusznik w zasięgu: wybór celu (siebie lub kolegę) jak w walce
        this.hud.toggleInventory(false);
        return this.itemPick(sel, uid);
      }
      if (c.effect === 'heal' && sel.ch.hp >= sel.ch.maxHp) return this.deny(`${sel.ch.name} ma pełne PW.`);
      const r = useConsumable(sel.ch, inst, [sel.ch]);
      this.hud.pushLines(r.log, 'amber');
      SoundManager.sfx('heal');
      const su = this.units.get(sel);
      if (su && sel.state === 'up') {
        if (c.effect === 'heal') this.act(su, 'heal');
        else this.pose(su, 'cast');
        this.time.delayedCall(c.effect === 'heal' ? 900 : 520, () => this.rest(su));
      }
      this.showEvents(r);
      this.hud.notify('inventory');
      return;
    }
    if (!this.playerTurn || this.playerTurn.actor !== sel) return;
    this.hud.toggleInventory(false);
    return this.itemPick(sel, uid);
  }

  private async playerSwapWeapons(): Promise<void> {
    const sel = this.selected;
    if (!sel || !this.hud.canAct || !sel.ch.equipment.weapon2) return;
    if (this.hud.inCombat) {
      SoundManager.sfx('pickup');
      // nowy wygląd od razu po zmianie (nie po turze wrogów, gdy zmiana zużyła ostatnią akcję) i dla postaci w turze
      await this.combatAct((a) => {
        const out = this.combat.swapWeapon(a);
        if (out.ok) this.refreshLook(a);
        return out;
      });
      return;
    }
    swapWeapons(sel.ch);
    this.refreshLook(sel);
    this.hud.pushLog(`${sel.ch.name} dobywa: ${normWeapon(getWeapon(sel.ch)).name}.`);
    SoundManager.sfx('pickup');
    this.hud.notify('stats');
    this.refreshPathPreview();
  }

  // ================================================================== animacja sygnałów

  /** Odtwarza po kolei sygnały zebrane z logiki (dziennik, ruch, ataki, stany). */
  private async flush(): Promise<void> {
    for (let s = this.signals.shift(); s; s = this.signals.shift()) await this.play(s);
  }

  private async play(s: Signal): Promise<void> {
    switch (s.kind) {
      case 'log':
        this.hud.pushLog(s.text, s.tone);
        break;
      case 'combatStart': {
        this.hud.setPhase(TurnPhase.PLAYER_TURN, 1);
        this.hud.showBanner(s.ambush ? 'ZASADZKA!' : 'WALKA!', s.ambush ? 'amber' : 'bad', s.boss ? 'BOSS' : `${s.order.length} uczestników`);
        SoundManager.sfx('alarm', { vol: 0.6 });
        const boss = this.combat.enemies.some((e) => e.engaged && e.state !== 'dead' && (e.ch.ai === 'boss' || enemyDef(e.ch.templateId)?.ai === 'boss'));
        SoundManager.music(s.boss || boss ? 'boss' : 'combat');
        this.updateFogOfWar();
        this.updateInitiative();
        await this.wait(450);
        break;
      }
      case 'join':
        SoundManager.sfx('alarm', { vol: 0.4 });
        if (s.actors.some((e) => e.ch.ai === 'boss' || enemyDef(e.ch.templateId)?.ai === 'boss')) SoundManager.music('boss');
        this.updateFogOfWar();
        this.updateInitiative();
        break;
      case 'round':
        this.hud.setPhase(this.hud.phase, s.round);
        this.updateInitiative();
        break;
      case 'turnStart':
        this.updateInitiative();
        this.refreshStances(); // wygasła osłona / powalenie - powrót do właściwej postawy
        break;
      case 'move':
        await this.walk(s.actor, s.path);
        break;
      case 'strike':
        if (s.result.d20) await this.dice(s.result.d20, `Atak: ${s.info.weapon.name}`, s.attacker, s.result.dmg);
        await this.animateAttack(s.attacker, s.defender, s.info.ranged ? 'shot' : 'melee', s.info.weapon.sfx, s.result);
        break;
      case 'ability':
        await this.animateAbility(s.actor, s.ability, s.targets, s.cell, s.result);
        break;
      case 'item': {
        const def = itemDef(s.item.id);
        const c = def?.type === 'consumable' ? def.consumable : null;
        const foe = s.targets.find((x) => x.side !== s.actor.side);
        if (s.result.d20 || s.result.heal) await this.dice(s.result.d20, def?.name ?? 'Przedmiot', s.actor, s.result.dmg, s.result.heal);
        if (c?.target === 'area' && s.cell)
          await this.animateBlast(s.actor, s.cell, s.result, c.effect === 'smoke' ? 'smoke' : c.dmgType === 'fire' ? 'fire' : c.dmgType === 'elec' ? 'elec' : 'frag', c.radius ?? 1.5);
        else if (c?.target === 'enemy' && foe) await this.animateAttack(s.actor, foe, 'shot', 'explosion', s.result);
        else {
          const u = this.units.get(s.actor);
          const tgt = s.targets.find((x) => x !== s.actor);
          if (u && s.actor.state === 'up') {
            if (tgt) this.face(u, { gx: tgt.gx - s.actor.gx, gy: tgt.gy - s.actor.gy });
            if (c?.effect === 'heal') this.act(u, 'heal');
            else this.pose(u, 'cast');
            await this.wait(c?.effect === 'heal' ? 420 : 190);
          }
          if (c?.effect === 'buff' || c?.effect === 'smoke') for (const x of s.targets) this.sparks(x, 0xffd060);
          SoundManager.sfx('heal');
          this.showEvents(s.result);
          await this.wait(240);
          if (u) this.rest(u);
        }
        this.hud.notify('inventory');
        break;
      }
      case 'rules':
        if (s.result.events.length) {
          this.showEvents(s.result);
          await this.wait(220);
        }
        break;
      case 'state':
        this.showState(s.actor, s.from, s.to);
        this.updateInitiative();
        break;
      case 'spotted': {
        const u = this.units.get(s.by);
        if (u && this.mission.isVisible(s.by)) {
          this.setUnitVisible(u, true);
          this.floatAbove(s.by, '!', COLOR_HOSTILE);
          this.growl(s.by, 0.6);
        }
        break;
      }
      case 'discover':
        this.addFindSparkle(s.find);
        this.floatAbove(s.by, '!', C_LOOT);
        SoundManager.sfx('pickup', { vol: 0.5 });
        break;
      case 'pickup': {
        const i = this.idx(s.find.gx, s.find.gy);
        const sp = this.sparkles.get(i);
        if (sp) {
          this.dropCellImg(i, sp);
          this.sparkles.delete(i);
        }
        this.floatAbove(s.by, `+${s.scrap} Złomu`, C_LOOT);
        SoundManager.sfx('coin');
        break;
      }
      case 'crate':
        await this.onCrate(s.thing, s.by, s.roll, s.trapDamage);
        break;
      case 'interact':
        this.onInteract(s.thing, s.by);
        break;
      case 'salvage':
        await this.onSalvage(s);
        break;
      case 'wreckBlast':
        await this.onWreckBlast(s.thing, s.hits);
        break;
      case 'lock':
        await this.onLock(s.thing, s.by, s.attempt, s.hack);
        break;
      case 'objective':
        if (this.mission.objectiveDone() && !this.objDone) {
          this.objDone = true;
          SoundManager.sfx('radio', { vol: 0.7 });
        }
        this.hud.contractDone = this.mission.objectiveDone() && this.mission.objType !== 'rescue';
        this.hud.setObjectives(this.mission.contract.title ?? 'Zlecenie', s.lines.map((l) => ({ text: l.text, done: l.done, go: l.go, dim: l.tone === 'dim' })));
        break;
      case 'complete':
        this.completeAsk = true;
        if (!this.mission.needsExtraction()) this.hud.showBanner('CEL WYKONANY', 'good', s.leftovers.length ? 'Teren można dalej przeszukać' : undefined);
        break;
      case 'finish':
        this.onMissionFinish(s.result);
        break;
      default:
        break;
    }
  }

  /** Rzut k20 w HUD-zie (port G.showD20Roll): wrogowie tylko widoczni; tempo x2 pomija rzuty wrogów, x4 wszystkie. */
  private async dice(r: CheckResult | undefined, label: string, by: Actor, dmg?: DamageRoll, heal?: DamageRoll): Promise<void> {
    if (by.side !== 'pc' && !this.units.get(by)?.sprite.visible) return;
    const mine = by.side === 'pc';
    const ms = r ? this.hud.showRoll({ label, d20: r.d20, mod: r.mod, total: r.total, dc: r.dc, degree: r.degree, mine }) : 0;
    if (ms) await this.wait(1100);
    const hms = heal ? this.hud.showDamage({ label: 'Leczenie', dice: heal.dice, post: heal.post, text: fmtDamage(heal), mine, heal: true }) : 0;
    if (hms) await this.wait(hms);
    // kości obrażeń PF2e (k4..k12) - zielone najemników, czerwone wrogów
    const dms = dmg ? this.hud.showDamage({ label: 'Obrażenia', dice: dmg.dice, post: dmg.post, text: fmtDamage(dmg), mine }) : 0;
    if (dms) await this.wait(dms);
  }

  /** Usuwa obraz z listy pola (mgła) i niszczy go. */
  private dropCellImg(i: number, o: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    const imgs = this.cells[i].imgs;
    const k = imgs.indexOf(o as Phaser.GameObjects.Image);
    if (k >= 0) imgs.splice(k, 1);
    o.destroy();
  }

  /** Wynik otwierania skrzyni: kość, pułapka / łup, otwarta skrzynia. */
  private async onCrate(th: MissionThing, by: Actor, r: CheckResult, trap: number): Promise<void> {
    const skill = this.lastCrateSkill;
    const bu = this.units.get(by);
    if (bu) {
      this.face(bu, { gx: th.gx - by.gx, gy: th.gy - by.gy });
      // wytrych / majsterkowanie przy mechanizmie / podważenie łomem (cios)
      if (skill === 'athletics') this.pose(bu, 'attack');
      else this.act(bu, skill === 'crafting' ? 'hack' : 'pick');
      await this.wait(skill === 'athletics' ? 260 : 520);
    }
    await this.dice(r, skill ? `Skrzynia: ${SKILLS[skill].name}` : 'Skrzynia', by);
    const i = this.idx(th.gx, th.gy);
    const view = this.crates.get(i);
    if (r.degree === 0) {
      SoundManager.sfx('explosion');
      this.cameras.main.shake(140, 0.007);
      const c = tileCenter(th);
      this.fx.explosion(c.x, c.y, 0.7);
      this.addScorch(th);
      this.floatAbove(by, `-${trap}`, COLOR_HOSTILE);
      const u = this.units.get(by);
      if (u) {
        this.pose(u, 'hurt');
        this.time.delayedCall(280, () => this.rest(u));
      }
    } else if (r.degree === 1) {
      SoundManager.sfx('error', { vol: 0.5 });
      this.floatAbove(by, th.done ? 'ZACIĘTA' : 'ZAMKNIĘTA', 0xbbbbbb);
    } else {
      SoundManager.sfx('pickup');
      SoundManager.sfx('coin');
      this.floatAbove(by, 'Łup!', C_LOOT);
    }
    if (bu && r.degree !== 0) this.time.delayedCall(240, () => this.rest(bu));
    if (view && th.done) {
      if (view.sparkle) {
        this.dropCellImg(i, view.sparkle);
        view.sparkle = null;
      }
      if (r.degree !== 1) {
        const info = this.art.get('loot_crate_open', paintLootCrateOpen);
        view.img.setTexture(info.key).setPosition(isoX(th.gx, th.gy) - info.ax, isoY(th.gx, th.gy) - info.ay);
      }
    }
    this.hud.notify('stats');
    await this.wait(250);
  }
  private lastCrateSkill: SkillId | null = null;

  /** Rozbieranie wraku: majsterkowanie przy blasze, kość, złom / rana, hałas; wrak traci koła, drzwi i maskę. */
  private async onSalvage(s: Extract<MissionSignal, { kind: 'salvage' }>): Promise<void> {
    const { thing: th, by, roll: r } = s;
    const bu = this.units.get(by);
    if (bu) {
      this.face(bu, { gx: th.gx - by.gx, gy: th.gy - by.gy });
      this.act(bu, 'hack');
      SoundManager.sfx('melee', { vol: 0.35, pitch: 0.6 });
      await this.wait(300);
      SoundManager.sfx('door', { vol: 0.4, pitch: 0.7 });
      await this.wait(260);
    }
    await this.dice(r, `${th.name}: Majsterkowanie`, by);
    if (r.degree === 0) {
      SoundManager.sfx('melee', { vol: 0.6, pitch: 0.5 });
      this.floatAbove(by, `-${s.hurt}`, COLOR_HOSTILE);
      if (bu) {
        this.pose(bu, 'hurt');
        this.time.delayedCall(280, () => this.rest(bu));
      }
    } else {
      SoundManager.sfx('coin');
      if (s.items.length) SoundManager.sfx('pickup');
      this.floatAbove(by, `+${s.scrap} Złomu`, C_LOOT);
      if (bu) this.time.delayedCall(240, () => this.rest(bu));
    }
    if (s.noise >= 8) this.floatAbove(by, 'HAŁAS!', COLOR_HOSTILE);
    this.refreshWreck(th);
    this.hud.notify('stats');
    await this.wait(250);
  }

  /** Wybuch baku wraku: ognista eksplozja, wstrząs, przypalenie, obrażenia w promieniu 1, wrak dopala się. */
  private async onWreckBlast(th: MissionThing, hits: { actor: Actor; dmg: number }[]): Promise<void> {
    const c = tileCenter(th);
    SoundManager.sfx('explosion', { vol: 1.1, pitch: 0.8 });
    this.cameras.main.shake(220, 0.012);
    this.fx.explosion(c.x, c.y - 4, 1.5, 'fire');
    this.refreshWreck(th);
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (hash2(th.gx + dx, th.gy + dy, 7) < 0.5 || (!dx && !dy)) this.addScorch({ gx: th.gx + dx, gy: th.gy + dy });
    for (const h of hits) {
      this.floatAbove(h.actor, `-${h.dmg}`, h.actor.side === 'pc' ? COLOR_HOSTILE : 0xffa040);
      const u = this.units.get(h.actor);
      if (u && h.actor.state === 'up') {
        this.pose(u, 'hurt');
        this.time.delayedCall(280, () => this.rest(u));
      }
    }
    this.hud.notify('stats');
    await this.wait(420);
  }

  /** Wynik próby wytrychem / wyważenia / hakowania: kość k20 z postępem, dźwięk i napis nad postacią. */
  private async onLock(th: MissionThing, by: Actor, at: LockAttempt, hack: boolean): Promise<void> {
    const lock = th.lock;
    const how = hack ? (at.skill === 'crafting' ? 'Hakowanie' : 'Obejście') : at.skill === 'athletics' ? 'Wyważenie' : 'Wytrych';
    const prog = lock && !at.opened && at.skill !== 'athletics' ? ` [${lock.progress}/${lock.needed}]` : '';
    const bu = this.units.get(by);
    if (bu) {
      this.face(bu, { gx: th.gx - by.gx, gy: th.gy - by.gy });
      // hakowanie terminala / wytrych w zamku / wyważenie barkiem (cios)
      if (at.skill === 'athletics') this.pose(bu, 'attack');
      else this.act(bu, hack ? 'hack' : 'pick');
      await this.wait(at.skill === 'athletics' ? 260 : 560);
    }
    await this.dice(at.roll, `${how}: ${th.name}${prog}`, by);
    if (at.opened) {
      SoundManager.sfx(hack ? 'radio' : 'door', { vol: 0.6 });
      this.floatAbove(by, hack ? 'DOSTĘP!' : at.broken ? 'WYWAŻONE' : 'OTWARTE', C_LOOT);
      if (th.objective) {
        this.clearThingMark(th);
        this.hud.showBanner('DANE POBRANE', 'amber', 'Wróć do strefy ewakuacji');
      }
    } else if (at.alarm) {
      SoundManager.sfx('alarm', { vol: 0.5 });
      this.floatAbove(by, 'ALARM!', COLOR_HOSTILE);
    } else if (at.brokeTool) {
      SoundManager.sfx('error', { vol: 0.5 });
      this.floatAbove(by, 'Wytrych pęka', COLOR_HOSTILE);
    } else if (at.jammed) {
      SoundManager.sfx('error', { vol: 0.5 });
      this.floatAbove(by, 'ZACIĘTE', 0xbbbbbb);
    } else if (at.gained) {
      SoundManager.sfx('click', { vol: 0.6 });
      this.floatAbove(by, `+${at.gained} (${lock?.progress}/${lock?.needed})`, 0x9ad0ff);
    } else {
      SoundManager.sfx('error', { vol: 0.4 });
      this.floatAbove(by, 'Bez postępu', 0xbbbbbb);
    }
    if (bu) this.time.delayedCall(260, () => this.rest(bu));
    this.hud.notify('stats');
    await this.wait(250);
  }

  /** Zabrany cel / uwolniony jeniec (Oldgame/src/scenes/mission.js:520-528). */
  private onInteract(th: MissionThing, by: Actor): void {
    if (th.kind === 'item' && th.objective) {
      SoundManager.sfx('pickup');
      const got = this.mission.supplies.filter((x) => x.done).length, all = this.mission.supplies.length;
      this.floatAbove(by, `Zapasy ${got}/${all}`, C_LOOT);
      this.clearThingMark(th);
      if (got === all) this.hud.showBanner('ZAPASY ZEBRANE', 'amber', 'Wróć do strefy ewakuacji');
    } else if (th.kind === 'item') {
      SoundManager.sfx('pickup');
      this.floatAbove(by, 'Zdobyto!', C_LOOT);
      this.hud.showBanner('CEL ZDOBYTY', 'amber', 'Wróć do strefy ewakuacji');
      const m = this.objMarker;
      if (m) {
        const i = this.idx(th.gx, th.gy);
        for (const img of m.imgs) this.dropCellImg(i, img);
        if (m.light) {
          m.light.img.destroy();
          this.glows.splice(this.glows.indexOf(m.light), 1);
        }
        this.objMarker = null;
      }
    } else if (th.kind === 'nest') {
      SoundManager.sfx('explosion', { vol: 0.5 });
      this.floatAbove(by, 'Gniazdo zniszczone', C_LOOT);
      this.clearThingMark(th);
    } else if (th.kind === 'captive' && th.objective && th.actor) {
      SoundManager.sfx('door');
      const u = this.units.get(th.actor);
      if (u) this.setUnitVisible(u, true);
      this.floatAbove(th.actor, 'Wolny!', 0x7fc46a);
    } else if (th.kind === 'captive' && th.actor) {
      SoundManager.sfx('door');
      const u = this.units.get(th.actor);
      if (u) this.setUnitVisible(u, true);
      this.floatAbove(th.actor, 'Wolny!', 0x7fc46a);
      this.hud.showBanner('JENIEC UWOLNIONY', 'good', 'Wyprowadź go do strefy ewakuacji');
    }
  }

  /** Przejście ścieżką krok po kroku (wróg w mgle pojawia się tylko na widocznych polach). */
  private async walk(a: Actor, path: readonly GridPos[]): Promise<void> {
    const u = this.units.get(a);
    if (!u || !path.length) return;
    const enemy = a.side === 'enemy' || (a.side === 'neutral' && !a.following);
    if (enemy && !this.mission.isVisible(u.pos) && !path.some((p) => this.mission.isVisible(p))) {
      // ruch w mgle wojny: bez animacji (wędrowcy / zaalarmowani wrogowie poza polem widzenia)
      const end = path[path.length - 1];
      u.pos = { ...end };
      const { x, y } = tileCenter(end);
      u.sprite.setPosition(x, y).setDepth(objDepth(end.gx, end.gy, L_UNIT));
      u.shadow.setPosition(x, y);
      this.setUnitVisible(u, false);
      return;
    }
    for (const step of path) {
      if (enemy) this.setUnitVisible(u, this.mission.isVisible(u.pos) || this.mission.isVisible(step));
      await this.stepUnit(u, step);
    }
    if (enemy) this.setUnitVisible(u, this.mission.isVisible(u.pos));
    this.rest(u);
  }

  /** Atak wręcz (wypad) albo strzał (smuga) z wynikiem nad celem. */
  private async animateAttack(att: Actor, def: Actor, kind: 'shot' | 'melee', sfx: string, r: ActionResult): Promise<void> {
    const a = this.units.get(att), d = this.units.get(def);
    if (!a || !d) return;
    this.face(a, { gx: d.pos.gx - a.pos.gx, gy: d.pos.gy - a.pos.gy });
    if (isAttackSfx(sfx)) SoundManager.sfx(sfx);
    if (kind === 'melee') this.growl(att, 0.45);
    const show = (): void => this.showEvents(r);
    if (kind === 'shot') {
      this.pose(a, 'shoot');
      await this.wait(90); // klatka błysku wylotowego
      const w = normWeapon(getWeapon(att.ch));
      const fire = r.events.some((e) => e.type === 'damage' && e.dmgType === 'fire') || (sfx === w.sfx && w.type === 'fire');
      const style = tracerStyleFor(sfx, fire ? 'fire' : sfx === w.sfx ? w.type : undefined, w.id);
      // wylot lufy: przed postacią w stronę celu
      const dx = d.sprite.x - a.sprite.x, dy = d.sprite.y - a.sprite.y;
      const mx = a.sprite.x + Math.sign(dx || 1) * 7, my = a.sprite.y - 13;
      const tx = d.sprite.x, ty = d.sprite.y - 12;
      const seen = a.sprite.visible || d.sprite.visible;
      if (seen) {
        if (style !== 'lob' && style !== 'flame') this.fx.muzzle(mx, my, dx, dy, style === 'laser' ? 0xff4040 : style === 'plasma' ? 0x46f2ff : 0xffc060);
        await this.fx.tracer(mx, my, tx, ty, style);
        if (style === 'lob') {
          this.fx.explosion(d.sprite.x, d.sprite.y, 0.8, fire ? 'fire' : 'frag');
          this.cameras.main.shake(120, 0.006);
        } else if (r.events.some((e) => e.type === 'miss')) this.fx.ricochet(d.sprite.x + (Math.random() - 0.5) * 16, d.sprite.y + 2 + Math.random() * 5);
      } else await this.wait(120);
      show();
    } else await this.lunge(a, d, show);
    this.rest(a);
    await this.wait(300);
  }

  /** Warczenie bestii / mutantów (dostrzeżenie drużyny, atak). */
  private growl(a: Actor, vol: number): void {
    if (a.side !== 'enemy') return;
    const fac = a.ch.faction ?? enemyDef(a.ch.templateId)?.faction;
    if (fac === 'beast') SoundManager.sfx('growl', { vol, pitch: 1.1 });
    else if (fac === 'mutant') SoundManager.sfx('growl', { vol, pitch: 0.75 });
  }

  /** Trwałe przypalenie podłogi po wybuchu. */
  private addScorch(cell: GridPos): void {
    if (!this.inMap(cell.gx, cell.gy) || this.scorches.some((s) => s.gx === cell.gx && s.gy === cell.gy)) return;
    const sc = { gx: cell.gx, gy: cell.gy, seed: this.scorches.length % 4 };
    this.scorches.push(sc);
    this.placeScorch(sc);
  }

  private placeScorch(sc: { gx: number; gy: number; seed: number }): void {
    const k = `fxa_scorch_${sc.seed}`;
    this.art.get(k, () => ({ pc: paintScorch(sc.seed * 53 + 11), ax: 22, ay: 3 }));
    const img = this.place(sc.gx, sc.gy, k, 22, 3, D_DECAL + 0.5);
    const cell = this.cells[this.idx(sc.gx, sc.gy)];
    img.setVisible(cell.state !== 0).setAlpha(cell.reveal || 1);
    if (cell.state === 1) img.setTint(this.memoryTint());
  }

  /** Granat / wybuch w polu `cell`. */
  private async animateBlast(att: Actor, cell: GridPos, r: ActionResult, kind: 'frag' | 'fire' | 'elec' | 'smoke' = 'frag', radius = 1.5): Promise<void> {
    const a = this.units.get(att);
    const c = tileCenter(cell);
    if (a) {
      this.face(a, { gx: cell.gx - a.pos.gx, gy: cell.gy - a.pos.gy });
      this.pose(a, 'attack');
      await this.fx.tracer(a.sprite.x, a.sprite.y - 14, c.x, c.y - 2, 'lob');
    }
    if (kind === 'smoke') {
      // granat dymny: syk i chmura zalegająca nad obszarem
      SoundManager.sfx('explosion', { vol: 0.22, pitch: 1.9 });
      this.fx.smokeCloud(c.x, c.y, (radius + 0.5) * 22, 7000);
    } else {
      SoundManager.sfx('explosion');
      this.cameras.main.shake(kind === 'elec' ? 90 : 180, kind === 'elec' ? 0.004 : 0.01);
      this.fx.explosion(c.x, c.y, radius, kind);
      if (kind !== 'elec') this.addScorch(cell);
    }
    this.showEvents(r);
    if (a) this.rest(a);
    await this.wait(340);
  }

  /** Efekt zdolności (port useAbility w Oldgame/src/mission/combat.js:177-188): animacja i dźwięk wg fx. */
  private async animateAbility(a: Actor, ab: AbilityDef, targets: Actor[], cell: GridPos | undefined, r: ActionResult): Promise<void> {
    const target = targets.find((x) => x !== a) ?? null;
    const fx = ab.fx;
    if (r.d20 || r.heal) await this.dice(r.d20, ab.name, a, r.dmg, r.heal);
    const u = this.units.get(a);
    if (u && target) this.face(u, { gx: target.gx - a.gx, gy: target.gy - a.gy });
    if (fx === 'explosion' && (cell || target)) {
      await this.animateBlast(a, cell ?? { gx: target!.gx, gy: target!.gy }, r);
      return;
    }
    if ((fx === 'shot' || fx === 'melee') && target) {
      // atak z ukrycia / kradzież: najpierw przyczajenie
      if (u && (ab.id === 'sneak_attack' || ab.id === 'steal')) {
        this.act(u, 'hide', 'idle');
        await this.wait(220);
      }
      await this.animateAttack(a, target, fx, fx === 'shot' ? 'shot_rifle' : 'melee', r);
      return;
    }
    if (ab.id === 'take_cover') {
      this.floatAbove(a, 'W OSŁONIE', C_COVER);
      SoundManager.sfx('step');
    } else if (fx === 'buff' || fx === 'shout') {
      for (const x of targets.length ? targets : [a]) this.sparks(x, fx === 'shout' ? 0xff9a40 : 0xffd060);
      SoundManager.sfx(fx === 'shout' ? 'alarm' : 'heal', { vol: 0.6 });
    } else if (fx === 'heal') {
      SoundManager.sfx('heal');
    }
    const medic = ab.id === 'first_aid' || ab.id === 'field_dressing' || ab.id === 'field_clinic';
    if (u) {
      if (ab.id === 'take_cover') this.act(u, 'hide');
      else if (ab.id === 'stand') this.act(u, 'getup');
      else if (medic) this.act(u, 'heal');
      else this.pose(u, 'cast');
    }
    await this.wait(medic ? 420 : 190); // opatrywanie / uniesienie przedmiotu / gest
    this.showEvents(r);
    await this.wait(330);
    if (u) this.rest(u);
  }

  /** Liczby nad celami + krew / iskry na podstawie zdarzeń z ActionResult (port applyEvents). */
  private showEvents(r: Pick<ActionResult, 'events'>): void {
    for (const ev of r.events) {
      if (!('target' in ev)) continue;
      const u = this.unitOfCh(ev.target);
      if (!u) continue;
      const { x, y } = u.sprite;
      const a = u.actor;
      if (ev.type === 'damage' && ev.amount > 0) {
        const crit = ev.degree === 3;
        if (a.state === 'up') this.pose(u, 'hurt');
        u.sprite.setTint(0xff6a5a);
        this.time.delayedCall(110, () => this.tintFor(u));
        this.time.delayedCall(300, () => this.rest(u));
        if (u.sprite.visible) this.bloodBurst(a, x, y - 12);
        this.floatAbove(a, crit ? `-${ev.amount}!` : `-${ev.amount}`, a.side === 'pc' ? COLOR_HOSTILE : crit ? C_CRIT : COLOR_OK);
        if (a.side === 'pc') this.cameras.main.shake(110, 0.005);
        SoundManager.sfx(crit ? 'crit' : 'hit', { vol: 0.7 });
      } else if (ev.type === 'miss') {
        this.floatAbove(a, 'PUDŁO', 0xbbbbbb);
        SoundManager.sfx('miss', { vol: 0.6 });
      } else if (ev.type === 'heal' && ev.amount > 0) {
        this.floatAbove(a, `+${ev.amount}`, 0x7fe05a);
        this.sparks(a, 0x7fe05a);
      } else if (ev.type === 'condition') {
        // powalony na ziemię (ale przytomny): padnięcie i leżenie z bronią do czasu "Wstań"
        if (ev.condition === 'prone' && a.state === 'up') {
          this.time.delayedCall(130, () => {
            if (a.state === 'up' && hasCondition(a.ch, 'prone')) this.act(u, 'drop', 'idle');
          });
        }
        const name = ev.condition === 'stable' ? 'Stabilny' : conditionDef(ev.condition)?.name;
        if (name && ev.condition !== 'dead' && ev.condition !== 'dying') this.floatAbove(a, name, C_COND);
      }
    }
    this.hud.notify('stats');
  }

  /** Efekt nad postacią: leczenie (zielone krzyżyki) albo wzmocnienie (złoty krąg i szewrony). */
  private sparks(a: Actor, color: number): void {
    const u = this.units.get(a);
    if (!u || !u.sprite.visible) return;
    if (color === 0x7fe05a) this.fx.heal(u.sprite.x, u.sprite.y);
    else this.fx.buff(u.sprite.x, u.sprite.y, color);
  }

  /** Kolor sprite'a zależny od stanu (powalony / martwy). */
  private tintFor(u: Unit): void {
    if (u.actor.state === 'dead') u.sprite.setTint(0xa09090);
    else if (u.actor.state === 'down') u.sprite.setTint(0x9a7a7a);
    else u.sprite.clearTint();
  }

  private showState(a: Actor, from: ActorState, to: ActorState): void {
    const u = this.units.get(a);
    if (!u) return;
    this.tweens.killTweensOf(u.shadow);
    // upadek wzbija pył
    if ((to === 'dead' || to === 'down') && u.sprite.visible) this.fx.dust(u.sprite.x, u.sprite.y, 0xb09a78, 6, 11);
    if (to === 'dead') {
      // upadek i zwłoki zostające na polu (maszyny: zwarcie i wrak - klatki die w iso/UnitArt, CreatureArt)
      if (from === 'down') this.lie(u);
      else this.pose(u, 'die');
      this.tweens.add({ targets: u.shadow, alpha: 0.3, duration: 500 });
      this.time.delayedCall(560, () => this.tintFor(u));
      if (a.side === 'enemy') {
        const fac = a.ch.faction ?? enemyDef(a.ch.templateId)?.faction;
        if (fac === 'machine') {
          // maszyna: zwarcie i iskry zamiast krzyku
          if (u.sprite.visible) this.fx.sparks(u.sprite.x, u.sprite.y - 10, 18);
          SoundManager.sfx('explosion', { vol: 0.35, pitch: 1.6 });
        } else SoundManager.sfx(fac === 'beast' || fac === 'mutant' ? 'scream' : 'death', { vol: 0.7, pitch: fac === 'beast' ? 1.25 : 1 });
      } else {
        this.floatAbove(a, 'ZGINĄŁ', COLOR_HOSTILE);
        SoundManager.sfx('death');
      }
    } else if (to === 'down') {
      this.pose(u, 'down');
      this.time.delayedCall(420, () => this.tintFor(u));
      this.floatAbove(a, 'POWALONY!', COLOR_HOSTILE);
      SoundManager.sfx('scream');
    } else if (from !== 'up') {
      u.sprite.setAlpha(1);
      u.shadow.setAlpha(1);
      this.tintFor(u);
      this.idle(u);
    }
    this.hud.notify('stats');
  }

  private onMissionFinish(result: MissionResult): void {
    this.over = true;
    this.playerTurn = null;
    this.turnDone = null;
    this.hud.setBusy(true);
    this.clearPathPreview();
    this.hud.answer(null);
    this.hud.setActions(null, []);
    this.hud.setInitiative([]);
    this.rangeGfx.clear();
    this.aimGfx.clear();
    this.laserGfx.clear();
    this.outline.clear();
    this.hoverOutline.clear();
    this.finishPlayerTurn();
    if (result.result === 'fail') {
      this.missionFailed(result);
      return;
    }
    const retreat = result.result === 'retreat';
    SoundManager.music(retreat ? null : 'victory');
    this.hud.setPhase(TurnPhase.EXPLORATION, this.combat.round);
    this.hud.showBanner(retreat ? 'ODWRÓT' : 'ZLECENIE WYKONANE', retreat ? 'amber' : 'good', `+${result.xp} PD · ${result.scrap} złomu`);
    this.hud.pushLog(`${retreat ? 'Odwrót' : 'Zlecenie wykonane'}: +${result.xp} PD, ${result.scrap} złomu, łupy: ${result.loot.length}.`, retreat ? 'amber' : 'good');
    if (result.casualties.length) this.hud.pushLog(`Polegli: ${result.casualties.join(', ')}.`, 'bad');
    this.hud.pushLog(this.job ? 'Powrót do Przystani...' : 'Nowe zlecenie za chwilę...', 'dim');
    this.time.delayedCall(retreat ? 2200 : 4500, () => this.cameras.main.fadeOut(900, 0, 0, 0));
    this.time.delayedCall(retreat ? 3200 : 5500, () => this.leave(result));
  }

  /** Koniec misji: podsumowanie (rozliczenie robi DebriefScene przez src/core/campaign/debrief). */
  private leave(result: MissionResult): void {
    if (!this.job) {
      this.scene.restart();
      return;
    }
    if (result.result === 'fail') {
      // Oldgame mission.js:565-568: wybicie drużyny = od razu ekran końca drogi (bez rozliczenia i zapisu)
      const fallen = result.casualties.length ? result.casualties : this.mission.pcs.map((a) => a.ch.name);
      this.scene.start('GameOverScene', { fallen });
      return;
    }
    this.scene.start('DebriefScene', { result, contract: this.job });
  }

  private missionFailed(result: MissionResult): void {
    this.hud.pushLog('Drużyna pada. Sygnał utracony.', 'bad');
    if (result.casualties.length) this.hud.pushLog(`Polegli: ${result.casualties.join(', ')}.`, 'bad');
    SoundManager.music('defeat');
    this.hud.showBanner('DRUŻYNA POLEGŁA', 'bad');
    const lost = label(this, BASE_W / 2, BASE_H / 2 - 8, 'SYGNAŁ UTRACONY', { size: 14, bold: true, color: PAL.bad }).setOrigin(0.5);
    this.overlay.add([this.add.rectangle(BASE_W / 2, BASE_H / 2 - 8, lost.width + 12, lost.height + 8, PAL.panel, 1).setStrokeStyle(1, PAL.blood), lost]);
    if (this.job)
      this.overlay.add(label(this, BASE_W / 2, BASE_H / 2 + 14, GAMEOVER_LINES[0], { size: 7, color: 0xc8b8a0, wrap: 300, align: 'center' }).setOrigin(0.5, 0));
    const hold = this.job ? 3600 : 100;
    this.time.delayedCall(hold, () => this.cameras.main.fadeOut(1700, 0, 0, 0));
    this.time.delayedCall(hold + 1800, () => this.leave(result));
  }

  private addFindSparkle(f: MissionFind): void {
    const i = this.idx(f.gx, f.gy);
    if (!this.sparkles.has(i)) this.sparkles.set(i, this.addSparkle(f.gx, f.gy, -2));
  }

  // ================================================================== podgląd pod kursorem

  private clearPathPreview(): void {
    for (const d of this.pathDots) d.setVisible(false);
    this.costLabel?.setVisible(false);
    this.cursor?.setVisible(false);
  }

  /** Zasięg Marszu aktywnej postaci (liczony raz na stan tury). */
  private reach(t: TurnInfo): { res: SearchResult; sp: number } {
    if (!this.reachCache) this.reachCache = this.combat.reachFor(t.actor, t.actions);
    return this.reachCache;
  }

  private refreshPathPreview(): void {
    if (this.spin) return;
    const sel = this.selected;
    this.aimGfx?.clear();
    this.laserGfx?.clear();
    this.hoverOutline.clear();
    if (!this.hud.canAct || !sel || this.over || this.hud.prompt) {
      this.clearPathPreview();
      return;
    }
    const target = this.pointerCell();
    if (!this.inMap(target.gx, target.gy) || this.cells[this.idx(target.gx, target.gy)].state === 0) {
      this.clearPathPreview();
      this.hud.setHover(this.modeHint);
      return;
    }
    this.cursor.setPosition(isoX(target.gx, target.gy), isoY(target.gx, target.gy)).setVisible(true);
    const who = this.visibleActorAt(target);
    const t = this.playerTurn;
    const mode = this.mode;
    /** Kto celuje (tura walki albo tryb celowania w eksploracji). */
    const ma = t ? t.actor : mode ? this.actorNow() : null;

    // celowanie obszarowe (granaty, zdolności): okrąg wybuchu, trafieni, ostrzeżenie o swoich (combat.js:383-391)
    const area = ma ? this.areaSpec(ma) : null;
    if (ma && area) {
      const a = ma;
      const ok = this.combat.areaCellOk(a, target, area.range);
      const hit = ok ? area.targets(target) : [];
      for (const x of hit) this.hoverOutline.set(x, x.side === a.side ? OL.blastAlly : OL.blast);
      const nf = hit.filter((x) => x.side !== a.side).length, na = hit.filter((x) => x.side === a.side).length;
      this.drawAim(target, area.r, ok);
      this.drawPath([], () => COLOR_OK);
      this.setCostLabel(null, target, 0);
      this.cursor.setTint(ok ? 0xffa028 : 0x8a8a9a);
      this.hud.setHover(
        `${area.name} (promień ${area.r}, zasięg ${area.range}) · ` +
          (ok ? `Trafi: ${nf} ${nf === 1 ? 'wroga' : 'wrogów'}${na ? ` · UWAGA: w tym sojusznicy: ${na}!` : ''}` : 'Poza zasięgiem lub brak linii strzału.'),
      );
      return;
    }

    if (who) {
      this.drawPath([], () => COLOR_OK);
      this.setCostLabel(null, target, 0);
      this.cursor.setTint(who.side === 'enemy' ? COLOR_HOSTILE : COLOR_ALLY);
      if (ma && mode && (mode.type === 'ability' || mode.type === 'item')) {
        const ok = (this.outline.get(who) ?? OL.off) !== OL.off && this.outline.has(who);
        if (ok) this.hoverOutline.set(who, OL.hover);
        const name = mode.type === 'ability' ? abilityDef(mode.id)?.name : itemDef(ma.ch.inventory.find((i) => i.uid === mode.uid)?.id)?.name;
        this.hud.setHover(`${name ?? ''} → ${who.ch.name} · PW ${Math.max(0, who.ch.hp)}/${who.ch.maxHp} · ${ok ? 'kliknij, by użyć' : 'nieprawidłowy cel (zasięg / linia strzału)'}`);
        return;
      }
      if (who.side === 'enemy') {
        const i = this.combat.strikeInfo(sel, who);
        if (i.ok || i.melee) this.hoverOutline.set(who, OL.hover);
        this.drawShotLine(sel, who, i);
      }
      this.hud.setHover(who.side === 'enemy' ? this.enemyHoverText(sel, who) : this.allyHoverText(who));
      return;
    }
    const th = this.mission.thingAt(target.gx, target.gy);
    if (th && this.mission.isExplored(target)) {
      this.drawPath([], () => COLOR_OK);
      this.setCostLabel(null, target, 0);
      this.cursor.setTint(C_LOOT);
      const what = th.kind === 'crate' ? `Skrzynia (KT ${this.mission.crateDC()}) — kliknij, by otworzyć`
        : th.kind === 'door' ? `${th.name} (ST ${th.lock?.dc}, ${th.lock?.progress}/${th.lock?.needed}) — kliknij: wytrych / wyważenie`
        : th.kind === 'device' ? `${th.name} (ST ${th.lock?.dc}, ${th.lock?.progress}/${th.lock?.needed})${th.lock?.jammed ? ' — ZABLOKOWANY' : ' — kliknij, by zhakować'}`
        : th.kind === 'item' ? `${th.name} — kliknij, by zabrać`
        : th.kind === 'nest' ? `${th.name} — kliknij, by zniszczyć`
        : th.kind === 'wreck' ? `${th.name}${th.burnt ? ' (spalony)' : ''} — kliknij, by rozebrać na złom (Majsterkowanie, KT ${this.mission.wreckDC(th)}; hałas!)`
        : `${th.name} — kliknij, by uwolnić`;
      this.hud.setHover(`${what}${t ? (th.kind === 'wreck' ? ' (obok, cała tura)' : ' (obok, 1 akcja)') : ''}`);
      return;
    }
    this.hud.setHover(this.modeHint);

    if (t) {
      if (mode?.type === 'step') {
        const ok = this.combat.stepOptions(t.actor).some((p) => p.gx === target.gx && p.gy === target.gy);
        this.drawPath([], () => COLOR_OK);
        this.cursor.setTint(ok ? MOVE_COL.s[2] : 0x8a8a9a);
        this.setCostLabel(ok ? '1AP' : null, target, MOVE_COL.s[2]);
        if (ok) this.hud.setHover('Krok na to pole (1 akcja)');
        return;
      }
      if (mode && mode.type !== 'stride') {
        this.drawPath([], () => COLOR_OK);
        this.setCostLabel(null, target, 0);
        this.cursor.setTint(0x8a8a9a);
        return;
      }
      // walka: Marsz - koszt w akcjach z drogi (przekątna 1.5)
      const { res, sp } = this.reach(t);
      const g = this.combat.grid;
      const c = g.costAt(res, target);
      const ok = c > 0 && c < UNREACHABLE && !this.combat.occupied(target.gx, target.gy);
      const path = ok ? (g.pathFrom(res, target) ?? []) : [];
      const band = (p: GridPos): number => MOVE_COL[String(Math.min(3, strideActions(g.costAt(res, p), sp)))][2];
      this.drawPath(path, band);
      this.cursor.setTint(ok ? band(target) : g.isFree(target.gx, target.gy) ? COLOR_FAR : 0x8a8a9a);
      this.setCostLabel(ok ? `${strideActions(c, sp)}AP` : null, target, ok ? band(target) : COLOR_FAR);
      if (ok) {
        const n = strideActions(c, sp);
        this.hud.setHover(`Marsz: ${path.length} ${path.length === 1 ? 'pole' : path.length < 5 ? 'pola' : 'pól'} — ${n} ${n === 1 ? 'akcja' : 'akcje'}`);
      }
      return;
    }

    if (mode) {
      // eksploracja w trybie celowania: bez drogi (klik w pole nie rusza drużyny)
      this.drawPath([], () => COLOR_OK);
      this.setCostLabel(null, target, 0);
      this.cursor.setTint(0x8a8a9a);
      return;
    }

    // eksploracja: droga lidera, w zasięgu jednego ruchu na zielono
    const group = this.hud.groupMove;
    const range = this.mission.moveRange(sel, group);
    const pass = (gx: number, gy: number): boolean => {
      const o = this.combat.actorAt(gx, gy);
      return !o || o.side === 'pc';
    };
    const path = this.combat.grid.findPath(sel, target, pass, 80) ?? [];
    const within = new Set<GridPos>();
    let cost = 0;
    let prev: GridPos = sel;
    for (const p of path) {
      cost += p.gx !== prev.gx && p.gy !== prev.gy ? 1.5 : 1;
      if (cost <= range + 1e-6) within.add(p);
      prev = p;
    }
    this.drawPath(path, (p) => (within.has(p) ? COLOR_OK : COLOR_FAR));
    const last = path[path.length - 1];
    this.cursor.setTint(!last ? 0x8a8a9a : within.has(last) ? COLOR_OK : COLOR_FAR);
    this.setCostLabel(null, target, 0);
    if (last && within.has(last)) this.hud.setHover(`Ruch — ${Math.ceil(cost)} / ${range} pól${group ? ' (drużyna: najwolniejszy)' : ' (solo)'}`);
    else if (last) this.hud.setHover('Za daleko na jeden ruch — drużyna dojdzie do granicy zasięgu.');
  }

  /** Parametry celowania obszarowego aktywnego trybu (port areaSpec). */
  private areaSpec(a: Actor): { r: number; range: number; name: string; targets: (c: GridPos) => Actor[] } | null {
    const m = this.mode;
    if (m?.type === 'ability') {
      const ab = abilityDef(m.id);
      if (ab?.target === 'area' && ab.range > 0) return { r: ab.radius || 1, range: ab.range, name: ab.name, targets: (c) => this.combat.areaTargetsFor(a, ab, c) };
    }
    if (m?.type === 'item') {
      const inst = a.ch.inventory.find((i) => i.uid === m.uid);
      const c = inst ? this.combat.consumableOf(inst) : null;
      if (inst && c?.target === 'area') return { r: c.radius || 1, range: c.range || 6, name: itemDef(inst.id)?.name ?? 'Wybuch', targets: (cell) => this.combat.areaTargets(cell, c.radius || 1) };
    }
    return null;
  }

  /** Okrąg wybuchu (w rzucie izometrycznym - elipsa) + krzyżyk w środku. */
  private drawAim(cell: GridPos, r: number, ok: boolean): void {
    const g = this.aimGfx.clear();
    const c = tileCenter(cell);
    const R = (r + 0.45) * Math.SQRT2;
    const col = ok ? 0xffa028 : 0xaaaaaa;
    g.lineStyle(1, col, ok ? 0.95 : 0.6).strokeEllipse(c.x, c.y, R * TILE_W, R * TILE_H);
    g.lineStyle(1, col, 0.4).strokeEllipse(c.x, c.y, R * TILE_W - 6, R * TILE_H - 3);
    g.fillStyle(ok ? 0xffd27a : 0xaaaaaa, 1).fillRect(c.x - 4, c.y, 8, 1).fillRect(c.x, c.y - 2, 1, 5);
  }

  /**
   * Nakładka na ziemi: zasięg ruchu wg kosztu (walka: niebieski 1 / żółty 2 / pomarańczowy 3 akcje; Krok: zielony;
   * eksploracja: jeden ruch) + kontury atakowalnych wrogów / prawidłowych celów (Oldgame/src/mission/combat.js:339-361).
   */
  private refreshOverlay(): void {
    const g = this.rangeGfx;
    if (!g) return;
    g.clear();
    this.outline.clear();
    if (this.over || !this.hud.canAct || this.hud.prompt) return;
    const tiles: { gx: number; gy: number; n: string }[] = [];
    const t = this.playerTurn;
    const ma = t ? t.actor : this.mode ? this.actorNow() : null;
    if (ma) {
      const a = ma, mode = this.mode;
      const foes = this.combat.foesOf(a).filter((f) => this.units.get(f)?.sprite.visible);
      if (!mode || mode.type === 'stride') {
        for (const o of this.combat.moveOptions(a)) if (this.mission.thingAt(o.gx, o.gy)?.kind !== 'crate') tiles.push({ gx: o.gx, gy: o.gy, n: String(Math.min(3, o.actions)) });
        if (t && t.actions > 0) for (const f of foes) if (this.combat.strikeInfo(a, f).ok) this.outline.set(f, OL.foe);
      } else if (mode.type === 'step') {
        for (const p of this.combat.stepOptions(a)) tiles.push({ ...p, n: 's' });
      } else if (mode.type === 'strike') {
        for (const f of foes) this.outline.set(f, this.combat.strikeInfo(a, f).ok ? OL.foe : OL.off);
      } else if (mode.type === 'ability') {
        const ab = abilityDef(mode.id);
        // eksploracja: bez celów, które już dostały tę zdolność (bez limitu użyć) po ostatniej walce
        const spent = (x: Actor): boolean => !t && !ab?.uses && this.combat.restSpent(mode.id, x);
        if (ab && (ab.target === 'enemy' || ab.target === 'ally')) for (const x of this.combat.abilityTargets(a, ab)) if (!spent(x)) this.outline.set(x, ab.target === 'ally' ? OL.ally : OL.foe);
      } else if (mode.type === 'item') {
        const inst = a.ch.inventory.find((i) => i.uid === mode.uid);
        const c = inst ? this.combat.consumableOf(inst) : null;
        if (c?.target === 'enemy') for (const f of foes.filter((f) => cheb(a, f) <= Math.max(1, c.range || 1))) this.outline.set(f, OL.foe);
        else if (c && c.target !== 'area') for (const x of this.mission.pcs.filter((p) => p.state !== 'dead' && cheb(a, p) <= Math.max(1, c.range || 1))) this.outline.set(x, OL.ally);
      }
    } else if (!this.hud.inCombat) {
      const sel = this.selected;
      if (sel) for (const p of this.mission.exploreReach(sel, this.hud.groupMove)) tiles.push({ ...p, n: '1' });
    }
    if (!tiles.length) return;
    const band = new Map(tiles.map((p) => [this.idx(p.gx, p.gy), p.n]));
    const nb = (x: number, y: number): string | undefined => (this.inMap(x, y) ? band.get(this.idx(x, y)) : undefined);
    for (const p of tiles) {
      const [fill, alpha, edge] = MOVE_COL[p.n];
      const T = { x: isoX(p.gx, p.gy), y: isoY(p.gx, p.gy) };
      const Rt = { x: T.x + TILE_W / 2, y: T.y + TILE_H / 2 }, B = { x: T.x, y: T.y + TILE_H }, L = { x: T.x - TILE_W / 2, y: T.y + TILE_H / 2 };
      g.fillStyle(fill, alpha).beginPath().moveTo(T.x, T.y).lineTo(Rt.x, Rt.y).lineTo(B.x, B.y).lineTo(L.x, L.y).closePath().fillPath();
      g.lineStyle(1, edge, 0.75);
      const nv = (vdx: number, vdy: number) => {
        const q = viewNb(p.gx, p.gy, vdx, vdy); // krawędzie rombu na ekranie = sąsiedzi w widoku
        return nb(q.gx, q.gy);
      };
      if (nv(0, -1) !== p.n) g.lineBetween(T.x, T.y, Rt.x, Rt.y);
      if (nv(1, 0) !== p.n) g.lineBetween(Rt.x, Rt.y, B.x, B.y);
      if (nv(0, 1) !== p.n) g.lineBetween(B.x, B.y, L.x, L.y);
      if (nv(-1, 0) !== p.n) g.lineBetween(L.x, L.y, T.x, T.y);
    }
  }

  /** Co klatkę: kontury (pierścienie pod stopami), znacznik aktywnej postaci, paski PW nad głowami. */
  private updateMarkers(): void {
    const rg = this.ringGfx, bg = this.barGfx;
    if (!rg || !bg) return;
    rg.clear();
    bg.clear();
    // aktywna postać: narożniki pola (bursztyn = drużyna, czerwień = tura wroga)
    const cur = this.over ? null : this.hud.inCombat ? (this.combat.turn?.actor ?? null) : this.selected;
    const cu = cur && this.units.get(cur);
    if (cu && cu.sprite.visible) {
      const col = cur!.side === 'pc' ? 0xffc040 : 0xff4a3a;
      const x = cu.sprite.x, y = cu.sprite.y;
      rg.fillStyle(col, 0.18).beginPath().moveTo(x, y - 7).lineTo(x + 14, y).lineTo(x, y + 7).lineTo(x - 14, y).closePath().fillPath();
      rg.lineStyle(1, col, 0.9);
      for (const [dx, dy] of [[0, -8], [16, 0], [0, 8], [-16, 0]] as const) {
        const px = x + dx, py = y + dy;
        const sx = dx ? -Math.sign(dx) : 1, sy = dy ? -Math.sign(dy) : 1;
        if (dx) rg.lineBetween(px, py, px + sx * 4, py - 2).lineBetween(px, py, px + sx * 4, py + 2);
        else rg.lineBetween(px, py, px - 4, py + sy * 2).lineBetween(px, py, px + 4, py + sy * 2);
      }
    }
    for (const [a, u] of this.units) {
      if (!u.sprite.visible) {
        this.barMarks.get(a)?.setVisible(false);
        continue;
      }
      const col = this.hoverOutline.get(a) ?? this.outline.get(a);
      if (col !== undefined && a.state !== 'dead') {
        rg.lineStyle(1, col, 1).strokeEllipse(u.sprite.x, u.sprite.y, 18, 9);
        rg.lineStyle(1, col, 0.45).strokeEllipse(u.sprite.x, u.sprite.y, 22, 11);
      }
      // pasek PW (Oldgame/src/scenes/mission.js:167-173): wrogowie odwrotna paleta; ! = powalony, X = poległy
      if (a.side === 'neutral' || (a.side === 'enemy' && a.state === 'dead')) {
        this.barMarks.get(a)?.setVisible(false);
        continue;
      }
      const top = this.unitTop(u) + 2;
      const p = Math.max(0, Math.min(1, a.ch.maxHp > 0 ? a.ch.hp / a.ch.maxHp : 0));
      const fill = a.side === 'pc' ? (p > 0.5 ? 0x6fd04a : p > 0.25 ? 0xf2a93b : 0xe0553f) : p > 0.5 ? 0xd9473a : p > 0.25 ? 0xe0803a : 0xf0c040;
      const x0 = Math.round(u.sprite.x - 8), y0 = Math.round(top);
      bg.fillStyle(0x000000, 0.85).fillRect(x0 - 1, y0 - 1, 18, 4);
      bg.fillStyle(0x301010, 1).fillRect(x0, y0, 16, 2);
      bg.fillStyle(fill, 1).fillRect(x0, y0, Math.round(16 * p), 2);
      const markTxt = a.state === 'dead' ? 'X' : a.state === 'down' ? '!' : null;
      let mark = this.barMarks.get(a);
      if (markTxt) {
        const key = `txt_${markTxt}`;
        if (!this.textures.exists(key)) this.art.get(key, () => ({ pc: paintText(markTxt), ax: 0, ay: 0 }));
        if (!mark) {
          mark = this.add.image(0, 0, key).setDepth(D_TEXT - 4);
          this.barMarks.set(a, mark);
        }
        mark.setTexture(key).setTint(a.state === 'dead' ? 0xffffff : 0xff6a50).setPosition(u.sprite.x, y0 - 6).setVisible(true);
      } else mark?.setVisible(false);
    }
  }

  private drawPath(path: readonly GridPos[], tint: (p: GridPos) => number): void {
    while (this.pathDots.length < path.length) this.pathDots.push(this.add.image(0, 0, 'fx_dot').setDepth(D_PATH).setVisible(false));
    this.pathDots.forEach((dot, i) => {
      const step = path[i];
      if (!step || i === path.length - 1) {
        dot.setVisible(false);
        return;
      }
      const c = tileCenter(step);
      const col = tint(step);
      dot.setPosition(c.x, c.y).setTint(col).setAlpha(col === COLOR_FAR ? 0.6 : 0.9).setVisible(true);
    });
  }

  private setCostLabel(label: string | null, at: GridPos, color: number): void {
    if (!label) {
      this.costLabel?.setVisible(false);
      return;
    }
    const key = `txt_${label}`;
    if (!this.textures.exists(key)) this.art.get(key, () => ({ pc: paintText(label), ax: 0, ay: 0 }));
    if (!this.costLabel) this.costLabel = this.add.image(0, 0, key).setDepth(D_TEXT);
    const c = tileCenter(at);
    this.costLabel.setTexture(key).setPosition(c.x, c.y - 14).setTint(color).setVisible(true);
  }

  /**
   * Linia strzału: cienki laser od aktywnej postaci do celu + odległość w polach.
   * Zielony: cel osiągalny wybraną bronią; czerwony: poza zasięgiem; pomarańczowy: w zasięgu, ale brak linii strzału.
   */
  private drawShotLine(att: Actor, def: Actor, info: StrikeInfo): void {
    const g = this.laserGfx.clear();
    const a = this.units.get(att), d = this.units.get(def);
    if (!a || !d) return;
    const col = info.ok ? LASER_OK : info.reason === 'brak linii strzału' ? LASER_NO_LOS : LASER_FAR;
    this.aimFace(a, def);
    const x0 = a.sprite.x, y0 = a.sprite.y - 13;
    const x1 = d.sprite.x, y1 = d.sprite.y - 12;
    // grubość w pikselach ekranu (1 px rdzenia przy każdej rozdzielczości), niezależnie od przybliżenia kamery
    const px = 1 / this.cameras.main.zoom;
    g.lineStyle(3 * px, col, 0.15).lineBetween(x0, y0, x1, y1);
    g.lineStyle(px, col, 0.95).lineBetween(x0, y0, x1, y1);
    g.fillStyle(col, 0.95).fillCircle(x1, y1, 2 * px);
    g.fillStyle(col, 0.25).fillCircle(x1, y1, 5 * px);
    const dist = cheb(att, def);
    this.setCostLabel(String(dist), def, col);
    // etykieta w połowie linii, odsunięta prostopadle, żeby nie zasłaniała lasera ani postaci
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const side = x1 - x0 >= 0 ? 1 : -1;
    this.costLabel?.setPosition(Math.round((x0 + x1) / 2 + (side * (y1 - y0) * 8) / len), Math.round((y0 + y1) / 2 - (side * (x1 - x0) * 8) / len));
  }

  /** Celująca postać obraca się w stronę celu (tylko w spoczynku - nie przerywa chodu ani animacji akcji). */
  private aimFace(u: Unit, def: Actor): void {
    const cur = u.sprite.anims.currentAnim?.key ?? '';
    if (u.actor.state !== 'up' || (u.sprite.anims.isPlaying && !/_(idle|crouch|prone)$/.test(cur))) return;
    const { facing, left } = u;
    this.face(u, { gx: def.gx - u.actor.gx, gy: def.gy - u.actor.gy });
    if (u.facing !== facing || u.left !== left) this.idle(u);
  }

  /** Opis wroga pod kursorem: PW, KP, szansa trafienia z flankowaniem / osłoną / PWA (Combat.strikeInfo). */
  private enemyHoverText(sel: Actor, foe: Actor): string {
    const info = this.combat.strikeInfo(sel, foe);
    const r = info.weapon.range;
    const dist = `odl. ${cheb(sel, foe)} (${r ? `zasięg ${r}, maks. ${r * 6}` : 'wręcz'})`;
    const base = `${foe.ch.name} · PW ${Math.max(0, foe.ch.hp)}/${foe.ch.maxHp} · ${dist}`;
    const ambush = this.hud.inCombat ? '' : ' · klik = zasadzka (drużyna zaczyna, wróg odsłonięty)';
    if (!info.ok) {
      const approach = info.melee && this.playerTurn && this.playerTurn.actions >= 2 ? ' · podejście i cios (2+ AP)' : '';
      return `${base} · ${info.reason}${approach}${ambush}`;
    }
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const notes = [info.frightened && 'przerażony: kość ½', info.concealed && 'cel ukryty: kość ½', info.flank && 'flankowanie', info.geoCover && 'osłona', info.mapIdx && `PWA -${info.mapIdx * 5}`, info.inc && 'dystans']
      .filter(Boolean)
      .join(', ');
    return `${base} · KP ${info.ac} · trafienie ${pct(info.hit)} (kryt. ${pct(info.crit)})${notes ? ' · ' + notes : ''} · 1 AP${ambush}`;
  }

  private allyHoverText(a: Actor): string {
    const st = a.state === 'down' ? (a.ch.conditions.dying ? ` · UMIERA ${a.ch.conditions.dying}` : ' · nieprzytomny') : a.state === 'dead' ? ' · martwy' : '';
    return `${a.ch.name} · PW ${Math.max(0, a.ch.hp)}/${a.ch.maxHp}${st}`;
  }

  // ================================================================== pomocnicze

  private pointerCell(): GridPos {
    const p = this.input.activePointer;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return worldToGrid(w.x, w.y);
  }

  /** Postać na polu, którą gracz widzi (wrogowie w mgle są niewidoczni). */
  private visibleActorAt(p: GridPos): Actor | null {
    const a = this.combat.actorAt(p.gx, p.gy);
    if (!a) return null;
    return a.side === 'enemy' && !this.units.get(a)?.sprite.visible ? null : a;
  }

  /** Pasek wrogów w HUD-zie: widoczni (w walce w kolejności inicjatywy). */
  private updateFoes(): void {
    const m = this.mission;
    const inCombat = m.inCombat();
    let shown = m.enemies.filter((e) => this.units.get(e)?.sprite.visible && (e.state !== 'dead' || inCombat));
    if (inCombat) {
      const order = this.combat.order;
      shown = shown.sort((p, q) => (order.indexOf(p) + 1 || 999) - (order.indexOf(q) + 1 || 999));
    }
    for (const e of shown) {
      const g = e.group?.idx ?? -1;
      if (e.state === 'dead' || this.seenGroups.has(g)) continue;
      this.seenGroups.add(g);
      if (!inCombat) {
        this.hud.pushLog(`Wróg w zasięgu wzroku: ${e.ch.name}!`, 'bad');
        SoundManager.sfx('alarm', { vol: 0.4 });
      }
    }
    this.hud.setFoes(shown.map((e) => e.ch));
  }

  /** Wypad postaci `a` w stronę `b` z wywołaniem `onHit` w punkcie zwrotnym. */
  private lunge(a: Unit, b: Unit, onHit: () => void): Promise<void> {
    const pa = tileCenter(a.pos), pb = tileCenter(b.pos);
    this.pose(a, 'attack');
    // onYoyo odpala się osobno dla x i y - trafienie pokazujemy raz.
    let hit = false;
    const once = () => {
      if (hit) return;
      hit = true;
      onHit();
    };
    return new Promise<void>((resolve) =>
      this.tweens.add({
        targets: a.sprite,
        x: pa.x + (pb.x - pa.x) * 0.35,
        y: pa.y + (pb.y - pa.y) * 0.35,
        delay: 120, // zamach (klatki attack0-1), uderzenie w klatce attack2
        duration: 80,
        yoyo: true,
        hold: 60,
        ease: 'Quad.easeOut',
        onYoyo: once,
        onComplete: () => resolve(),
      }),
    );
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  /** Napis nad postacią; kolejne w ciągu 0.6 s piętrzą się wyżej (port M.float). */
  private floatAbove(a: Actor, text: string, color: number): void {
    const u = this.units.get(a);
    if (!u || (!u.sprite.visible && a.side !== 'pc')) return;
    const now = this.time.now;
    const f = this.floatStack.get(a) ?? { t: -1e9, n: 0 };
    f.n = now - f.t < 600 ? f.n + 1 : 0;
    f.t = now;
    this.floatStack.set(a, f);
    const top = this.unitTop(u);
    this.floatingText(u.sprite.x, top - 2 - Math.min(f.n, 4) * 9, text, color);
  }

  /**
   * Pikselowy napis (czcionka bitmapowa 6x8 z czarnym obrysem) nad postacią: wyskakuje w podwójnej skali
   * (całkowita krotność = ostre piksele), opada do 1:1, unosi się i gaśnie. Liczby obrażeń zostają większe dłużej.
   */
  private floatingText(x: number, y: number, text: string, color: number): void {
    const key = `txt_${text}`;
    if (!this.textures.exists(key)) this.art.get(key, () => ({ pc: paintText(text), ax: 0, ay: 0 }));
    x = Math.round(x);
    y = Math.round(y);
    const num = /^[-+]\d/.test(text);
    const crit = num && text.endsWith('!');
    const label = this.add.image(x, y, key).setTint(color).setDepth(D_TEXT + (num ? 1 : 0)).setScale(num ? 2 : 1);
    if (num) this.time.delayedCall(crit ? 320 : 150, () => label.active && label.setScale(1));
    if (crit) {
      const halo = this.add.image(x, y, 'fx_halo').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setDepth(D_TEXT).setScale(1.6);
      this.tweens.add({ targets: halo, alpha: 0, scale: 2.6, duration: 320, onComplete: () => halo.destroy() });
    }
    this.tweens.add({ targets: label, y: y - (num ? 16 : 12), duration: num ? 650 : 500, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: label, alpha: 0, delay: num ? 650 : 450, duration: 350, onComplete: () => label.destroy() });
  }

  /** Trafienie: krew u istot żywych, iskry i olej u maszyn (dron, wieżyczka, robot nie krwawią). */
  private bloodBurst(a: Actor, x: number, y: number): void {
    const fac = a.side === 'enemy' ? (a.ch.faction ?? enemyDef(a.ch.templateId)?.faction) : null;
    if (fac === 'machine') this.fx.sparks(x, y);
    else this.fx.blood(x, y, fac === 'mutant' || fac === 'beast' ? 14 : 11);
  }
}
