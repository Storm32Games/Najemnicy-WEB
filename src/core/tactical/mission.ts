// Misja taktyczna: rozstawienie, eksploracja (mgła wojny, ruch drużyny), wykrywanie przez wrogów,
// znaleziska, skrzynie, cele zlecenia, ewakuacja, podsumowanie.
// Migracja logiki z Oldgame/src/scenes/mission.js (bez kamery, sprite'ów, HUD-u i modali).
import { SKILLS } from '../data/rules.ts';
import type { EnemyId, ItemId, SkillId } from '../data/types.ts';
import { createCharacter, createEnemy, encounterXP, endEncounter, newItem, partyLevel, rollLoot } from '../rules/character.ts';
import { applyDamage, isAlive } from '../rules/damage.ts';
import { check, dcForLevel, roll, type CheckResult, type Rng } from '../rules/dice.ts';
import { allItems, itemDef } from '../rules/lookup.ts';
import { checkBy, getStat } from '../rules/stats.ts';
import { skillCheck } from '../rules/turn.ts';
import {
  DEVICES, deviceState, hackDevice, hasLockpick, IMPROVISED_PENALTY, LOCKPICK_ID, LOCKS, lockState, pickLock,
  type DeviceKind, type LockAttempt, type LockQuality, type LockState,
} from '../rules/locks.ts';
import type { Character, GridPos, ItemInstance } from '../rules/types.ts';
import { Combat, makeActor, type Actor, type ActorState, type CombatEnd, type EnemyGroup, type LogTone, type Side } from './combat.ts';
import { CellKind, cheb, dist, TacticalGrid, UNREACHABLE } from './grid.ts';
import { generateMap, inEntryZone, type Biome, type FindKind, type FindSpawn, type TacticalMap } from './mapgen.ts';

export type ObjectiveType = 'eliminate' | 'retrieve' | 'rescue' | 'hunt' | 'boss' | 'hack' | 'liberate' | 'purge' | 'defend' | 'forage';
/** Cele, po których trzeba wrócić do strefy ewakuacji (przedmiot, jeniec, dane z serwera, zapasy żywności). */
export const EXTRACTION_OBJECTIVES: readonly ObjectiveType[] = ['retrieve', 'rescue', 'hack', 'forage'];
/** Nazwa skrzyni z żywnością (zlecenie zaopatrzenia). */
export const SUPPLY_NAME = 'Zapasy żywności';
export type MissionOutcome = 'success' | 'fail' | 'retreat';

/** Minimum danych zlecenia potrzebne misji (pełny typ: campaign/contracts.ts). */
export interface MissionContract {
  id: string;
  title?: string;
  type: ObjectiveType;
  level: number;
  biome: Biome;
  enemies: readonly EnemyId[];
  objective?: { type: ObjectiveType; itemId?: ItemId | null };
}

/** door = zamknięte drzwi (wytrych / wyważenie), device = urządzenie elektroniczne (hakowanie). */
/** nest = gniazdo zmutowanej fauny (zlecenie oczyszczenia). */
export type ThingKind = 'crate' | 'item' | 'captive' | 'door' | 'device' | 'nest';
export interface MissionThing extends GridPos {
  kind: ThingKind;
  name: string;
  done: boolean;
  itemId?: ItemId;
  /** Nieudane próby otwarcia skrzyni. */
  tries?: number;
  freed?: boolean;
  actor?: Actor;
  /** Zamek drzwi / zabezpieczenie urządzenia (PF2e: kilka sukcesów). */
  lock?: LockState;
  quality?: LockQuality;
  device?: DeviceKind;
  /** Obiekt jest celem zlecenia (serwer, osadnik, gniazdo). */
  objective?: boolean;
}
export interface MissionFind extends FindSpawn {
  found: boolean;
  taken: boolean;
  tried: boolean;
}
export interface ObjectiveLine {
  text: string;
  done: boolean;
  /** Wskazówka "idź do ewakuacji". */
  go?: boolean;
  tone?: LogTone;
}

export interface MissionResult {
  contractId: string;
  result: MissionOutcome;
  xp: number;
  loot: ItemInstance[];
  scrap: number;
  casualties: string[];
  /** Zaopatrzenie: zebrane skrzynie z żywnością (odwrót = żywność proporcjonalnie). */
  supplies?: { got: number; total: number };
}

/** Postać w zapisie misji: najemnik jako indeks w drużynie kampanii (ten sam obiekt po wczytaniu), reszta z pełną kartą. */
export interface ActorSnapshot extends GridPos {
  pc?: number;
  ch?: Character;
  side: Side;
  state: ActorState;
  group: number | null;
  engaged: boolean;
  roam?: { home: GridPos; dest: GridPos | null } | null;
  isTarget?: boolean;
  following?: boolean;
}
export interface ThingSnapshot extends Omit<MissionThing, 'actor'> {
  actor?: number;
}
/** Stan misji w trakcie eksploracji (JSON) - zapis gry na mapie misji. Mapę odtwarza generator z id zlecenia. */
export interface MissionSnapshot {
  version: 1;
  contractId: string;
  cells: number[];
  actors: ActorSnapshot[];
  groups: { alerted: boolean; nextNotice: number; center: EnemyGroup['center'] }[];
  things: ThingSnapshot[];
  finds: MissionFind[];
  itemThing: number;
  captive: number;
  objDevice: number;
  settlers: number[];
  nests: number[];
  /** Skrzynie z żywnością (zaopatrzenie); brak w zapisach sprzed tego typu zlecenia. */
  supplies?: number[];
  wave: number;
  nextWave: number;
  stage: number;
  steps: number;
  scrap: number;
  loot: ItemInstance[];
  killed: number[];
  /** Odkryte pola: '0' / '1' na pole. */
  explored: string;
}

export type MissionSignal =
  | { kind: 'log'; text: string; tone: LogTone }
  | { kind: 'discover'; find: MissionFind; by: Actor; roll: CheckResult }
  | { kind: 'pickup'; find: MissionFind; by: Actor; scrap: number; items: ItemInstance[] }
  | { kind: 'spotted'; group: EnemyGroup; by: Actor; close: boolean }
  | { kind: 'crate'; thing: MissionThing; by: Actor; roll: CheckResult; scrap: number; items: ItemInstance[]; trapDamage: number }
  | { kind: 'interact'; thing: MissionThing; by: Actor }
  /** Próba otwarcia drzwi wytrychem / wyważenia albo hakowania urządzenia. */
  | { kind: 'lock'; thing: MissionThing; by: Actor; attempt: LockAttempt; hack: boolean }
  | { kind: 'objective'; lines: ObjectiveLine[] }
  /** Cel zlecenia wykonany; `leftovers` = co jeszcze zostało na terenie (łupy, wrogowie, ukryte znaleziska). */
  | { kind: 'complete'; leftovers: string[] }
  | { kind: 'visibility' }
  | { kind: 'finish'; result: MissionResult };

export const CRATE_SKILLS: readonly SkillId[] = ['thievery', 'crafting', 'athletics'];
const FIND_LOOT: Readonly<Record<FindKind, readonly (ItemId | '@any')[]>> = {
  scrap: [], cache: ['@any'], medical: ['bandage', 'stimpak', 'medkit'], tech: ['circuit', 'battery', 'memory_card', 'radio_part', 'vacuum_tube'],
  food: ['canned_food'], ammo: ['ammo_box'],
};
const FIND_NAMES: Readonly<Record<FindKind, string>> = {
  scrap: 'stertę złomu', cache: 'ukrytą skrytkę', medical: 'porzuconą apteczkę', tech: 'resztki elektroniki', food: 'zapasy jedzenia', ammo: 'skrzynkę amunicji',
};
/** Zasięg wzroku najemnika / jeńca (pola). */
export const SIGHT_PC = 9;
export const SIGHT_NEUTRAL = 5;

export class Mission {
  readonly contract: MissionContract;
  readonly objType: ObjectiveType;
  readonly map: TacticalMap;
  readonly grid: TacticalGrid;
  readonly rng: Rng;
  readonly actors: Actor[] = [];
  readonly pcs: Actor[] = [];
  readonly enemies: Actor[] = [];
  readonly neutral: Actor[] = [];
  readonly groups: EnemyGroup[] = [];
  readonly things: MissionThing[] = [];
  readonly finds: MissionFind[];
  readonly combat: Combat;
  readonly target: Actor | null = null;
  itemThing: MissionThing | null = null;
  captive: MissionThing | null = null;
  /** Serwer do włamania (zlecenie 'hack'). */
  objDevice: MissionThing | null = null;
  /** Osadnicy do uwolnienia (zlecenie 'liberate'). */
  readonly settlers: MissionThing[] = [];
  /** Gniazda do zniszczenia (zlecenie 'purge'). */
  readonly nests: MissionThing[] = [];
  /** Skrzynie z żywnością do zebrania (zlecenie 'forage'). */
  readonly supplies: MissionThing[] = [];
  /** Obrona: indeks następnej fali i krok, od którego nadciąga. */
  wave = 0;
  nextWave = 3;
  mode: 'explore' | 'combat' | 'over' = 'explore';
  /** 1 = cel zdobyty / jeniec uwolniony. */
  stage = 0;
  /** Licznik kroków eksploracji (rytm testów wypatrywania). */
  steps = 0;
  scrap = 0;
  loot: ItemInstance[] = [];
  killed: Character[] = [];
  readonly explored: Uint8Array;
  readonly vis: Uint8Array;
  result: MissionResult | null = null;
  private listeners = new Set<(s: MissionSignal) => void>();
  /** Drużyna kampanii z wejścia (indeksy najemników w zapisie). */
  private readonly party: readonly Character[];

  /** `snap` = odtworzenie zapisanej misji (Mission.snapshot) zamiast nowego rozstawienia. */
  constructor(contract: MissionContract, party: readonly Character[], rng: Rng = Math.random, snap?: MissionSnapshot) {
    this.contract = contract;
    this.objType = contract.objective?.type ?? contract.type ?? 'eliminate';
    this.rng = rng;
    this.party = party;
    this.map = generateMap(contract, contract.enemies);
    this.grid = this.map.grid;
    const N = this.map.width * this.map.height;
    this.explored = new Uint8Array(N);
    this.vis = new Uint8Array(N);

    this.finds = snap
      ? snap.finds.map((f) => ({ ...f }))
      : this.map.finds.map((f) => ({ ...f, found: !f.hidden, taken: false, tried: false }));
    this.target = snap ? this.restore(snap, party) : this.populate(contract, party);

    this.combat = new Combat(
      {
        grid: this.grid, actors: this.actors, groups: this.groups, target: this.target,
        isBlocked: (gx, gy) => this.neutral.some((n) => n.gx === gx && n.gy === gy),
        inSight: (a) => this.isVisible(a),
        freeActions: () => this.mode === 'explore',
      },
      rng,
    );
    this.combat.on((s) => {
      if (s.kind === 'state' && s.actor.side === 'enemy' && s.to === 'dead' && !this.killed.includes(s.actor.ch)) {
        this.killed.push(s.actor.ch);
        if (s.actor === this.target) this.log('CEL ELIMINOWANY', 'good');
        this.emitObjectives();
        this.checkObjective();
      } else if (s.kind === 'join' || s.kind === 'move') this.updateVisibility();
      else if (s.kind === 'round' && this.mode === 'combat') {
        // runda minęła także poza polem widzenia: wrogowie spoza walki idą dalej, widoczni dołączają
        this.advanceWorld();
        this.combat.engageVisible();
      }
      else if (s.kind === 'end') this.onCombatEnd(s.outcome);
    });
    this.updateVisibility();
  }

  /** Nowa misja: drużyna w strefie wejścia, wrogowie, skrzynie i cele zlecenia. Zwraca cel polowania (albo null). */
  private populate(contract: MissionContract, party: readonly Character[]): Actor | null {
    // drużyna w strefie wejścia
    const slots = [5, 6, 9, 10];
    party.filter(isAlive).slice(0, 4).forEach((ch, i) => {
      const a = makeActor(ch, 'pc', this.map.entry.cells[slots[i] ?? i]);
      this.pcs.push(a);
      this.actors.push(a);
    });
    // grupy wrogów
    this.map.groups.forEach((g, gi) => {
      const grp: EnemyGroup = { idx: gi, actors: [], alerted: false, nextNotice: 0, center: g.center };
      g.members.forEach((id, k) => {
        const a = makeActor(createEnemy(id), 'enemy', g.cells[k] ?? g.center, grp);
        if (g.roam) a.roam = { home: { gx: a.gx, gy: a.gy }, dest: null };
        grp.actors.push(a);
        this.enemies.push(a);
        this.actors.push(a);
      });
      this.groups.push(grp);
    });
    // cel polowania / boss
    let target: Actor | null = null;
    if ((this.objType === 'hunt' || this.objType === 'boss') && this.enemies.length) {
      target =
        this.enemies.find((a) => a.ch.ai === 'boss' || /kostucha/i.test(a.ch.templateId ?? '')) ??
        this.enemies.slice().sort((a, b) => b.ch.level - a.ch.level)[0];
      target.isTarget = true;
    }
    for (const c of this.map.crates) this.things.push({ kind: 'crate', gx: c.gx, gy: c.gy, done: false, name: 'Skrzynia' });
    const oc = this.map.objCell;
    if (oc && this.objType === 'retrieve') {
      const itemId = contract.objective?.itemId ?? 'scrap_metal';
      this.itemThing = { kind: 'item', gx: oc.gx, gy: oc.gy, done: false, name: itemDef(itemId)?.name ?? 'Cel zlecenia', itemId };
      this.things.push(this.itemThing);
    } else if (oc && this.objType === 'rescue') {
      const ch = createCharacter({ name: 'Jeniec', classId: 'scavenger', ancestry: 'human' });
      ch.maxHp = 10;
      ch.hp = 10;
      const a = makeActor(ch, 'neutral', oc);
      this.neutral.push(a);
      this.actors.push(a);
      this.captive = { kind: 'captive', gx: oc.gx, gy: oc.gy, done: false, name: 'Jeniec', actor: a };
      this.things.push(this.captive);
    } else if (oc && this.objType === 'hack') {
      const c = this.solidSpot(oc) ?? this.freeCell(oc, 1, 4, true) ?? oc;
      this.objDevice = this.addDevice(c.gx, c.gy, 'server');
      this.objDevice.objective = true;
      this.grid.setKind(c.gx, c.gy, CellKind.LOW);
    } else if (oc && this.objType === 'liberate') {
      const NAMES = ['Osadnik', 'Osadniczka', 'Starzec', 'Pasterz', 'Kowalka'];
      const n = 3 + (this.level >= 4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const c = i === 0 ? oc : this.freeCell(oc, 1.5, 5);
        if (!c) break;
        const ch = createCharacter({ name: NAMES[i % NAMES.length], classId: 'scavenger', ancestry: 'human' });
        ch.maxHp = 10;
        ch.hp = 10;
        const a = makeActor(ch, 'neutral', c);
        this.neutral.push(a);
        this.actors.push(a);
        const th: MissionThing = { kind: 'captive', gx: c.gx, gy: c.gy, done: false, name: ch.name, actor: a, objective: true };
        this.settlers.push(th);
        this.things.push(th);
      }
    } else if (this.objType === 'purge') {
      const n = 2 + (this.level >= 3 ? 1 : 0);
      const far = this.map.maxD * 0.4;
      for (let i = 0; i < n; i++) {
        const near = i === 0 && oc ? oc : null;
        const c = (near ? this.freeCell(near, 1, 4, true) : null) ??
          this.pickCell((r) => r.d >= far && this.nests.every((x) => cheb(x, r) >= 7), true) ??
          this.pickCell((r) => r.d >= 8, true);
        if (!c) break;
        const th: MissionThing = { kind: 'nest', gx: c.gx, gy: c.gy, done: false, name: 'Gniazdo mutantów', objective: true };
        this.grid.setKind(c.gx, c.gy, CellKind.LOW);
        this.nests.push(th);
        this.things.push(th);
      }
    } else if (this.objType === 'forage') {
      // zapasy rozrzucone po terenie: pierwsza skrzynia na polu celu, reszta daleko od siebie
      const n = 3 + (this.level >= 4 ? 1 : 0);
      const far = this.map.maxD * 0.35;
      for (let i = 0; i < n; i++) {
        const c = (i === 0 && oc && this.cellOk(oc) ? { gx: oc.gx, gy: oc.gy } : null) ??
          this.pickCell((r) => r.d >= far && this.supplies.every((x) => cheb(x, r) >= 6)) ??
          this.pickCell((r) => r.d >= 6 && this.supplies.every((x) => cheb(x, r) >= 3));
        if (!c) break;
        const th: MissionThing = { kind: 'item', gx: c.gx, gy: c.gy, done: false, name: SUPPLY_NAME, itemId: 'canned_food', objective: true };
        this.supplies.push(th);
        this.things.push(th);
      }
    }

    return target;
  }

  // ---------- zapis
  /** Zapis stanu misji; tylko w eksploracji (walka ma kolejkę tur i stan HUD-u), inaczej null. */
  snapshot(): MissionSnapshot | null {
    if (this.mode !== 'explore') return null;
    const ai = (a: Actor | null | undefined): number => (a ? this.actors.indexOf(a) : -1);
    const ti = (t: MissionThing | null): number => (t ? this.things.indexOf(t) : -1);
    const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    return {
      version: 1,
      contractId: this.contract.id,
      cells: Array.from(this.grid.cells),
      actors: this.actors.map((a) => {
        const pc = a.side === 'pc' ? this.party.indexOf(a.ch) : -1;
        return {
          ...(pc >= 0 ? { pc } : { ch: clone(a.ch) }),
          side: a.side, gx: a.gx, gy: a.gy, state: a.state, group: a.group ? this.groups.indexOf(a.group) : null,
          engaged: a.engaged, roam: a.roam ? clone(a.roam) : null, isTarget: a.isTarget, following: a.following,
        };
      }),
      groups: this.groups.map((g) => ({ alerted: g.alerted, nextNotice: g.nextNotice, center: { ...g.center } })),
      things: this.things.map(({ actor, ...t }) => ({ ...clone(t), actor: actor ? ai(actor) : undefined })),
      finds: this.finds.map((f) => ({ ...f })),
      itemThing: ti(this.itemThing),
      captive: ti(this.captive),
      objDevice: ti(this.objDevice),
      settlers: this.settlers.map(ti),
      nests: this.nests.map(ti),
      supplies: this.supplies.map(ti),
      wave: this.wave,
      nextWave: this.nextWave,
      stage: this.stage,
      steps: this.steps,
      scrap: this.scrap,
      loot: clone(this.loot),
      killed: this.killed.map((ch) => this.actors.findIndex((a) => a.ch === ch)).filter((i) => i >= 0),
      explored: Array.from(this.explored, (v) => (v ? '1' : '0')).join(''),
    };
  }

  /** Odtworzenie misji z zapisu (konstruktor). Zwraca cel polowania (albo null). */
  private restore(s: MissionSnapshot, party: readonly Character[]): Actor | null {
    if (s.cells.length === this.grid.cells.length) this.grid.cells.set(s.cells);
    for (let i = 0; i < this.explored.length; i++) this.explored[i] = s.explored.charCodeAt(i) === 49 ? 1 : 0;
    for (const [gi, g] of s.groups.entries()) this.groups.push({ idx: gi, actors: [], alerted: g.alerted, nextNotice: g.nextNotice, center: g.center });
    let target: Actor | null = null;
    for (const r of s.actors) {
      const ch = r.pc !== undefined ? party[r.pc] : r.ch;
      if (!ch) continue;
      const grp = r.group !== null ? this.groups[r.group] ?? null : null;
      const a = makeActor(ch, r.side, r, grp);
      a.state = r.state;
      a.engaged = false;
      if (r.roam) a.roam = r.roam;
      if (r.isTarget) {
        a.isTarget = true;
        target = a;
      }
      if (r.following) a.following = true;
      grp?.actors.push(a);
      this.actors.push(a);
      (r.side === 'pc' ? this.pcs : r.side === 'enemy' ? this.enemies : this.neutral).push(a);
    }
    const actorAt = (i: number | undefined): Actor | undefined => (i !== undefined && i >= 0 ? this.actors[i] : undefined);
    for (const { actor, ...t } of s.things) {
      const th: MissionThing = { ...t };
      const a = actorAt(actor);
      if (a) th.actor = a;
      this.things.push(th);
    }
    const thing = (i: number): MissionThing | null => (i >= 0 ? this.things[i] ?? null : null);
    this.itemThing = thing(s.itemThing);
    this.captive = thing(s.captive);
    this.objDevice = thing(s.objDevice);
    for (const i of s.settlers) if (thing(i)) this.settlers.push(thing(i)!);
    for (const i of s.nests) if (thing(i)) this.nests.push(thing(i)!);
    for (const i of s.supplies ?? []) if (thing(i)) this.supplies.push(thing(i)!);
    this.wave = s.wave;
    this.nextWave = s.nextWave;
    this.stage = s.stage;
    this.steps = s.steps;
    this.scrap = s.scrap;
    this.loot = s.loot;
    this.killed = s.killed.map((i) => this.actors[i]?.ch).filter((c): c is Character => !!c);
    return target;
  }

  // ---------- rozmieszczanie celów
  /** Pole wolne od wszystkiego (postacie, obiekty, znaleziska, strefa wejścia). `solid` = wokół zostaje przejście. */
  private cellOk(c: GridPos, solid = false): boolean {
    if (!this.grid.isFree(c.gx, c.gy) || inEntryZone(this.map.entry, c)) return false;
    if (this.actors.some((a) => a.gx === c.gx && a.gy === c.gy) || this.things.some((t) => t.gx === c.gx && t.gy === c.gy)) return false;
    if (this.map.finds.some((f) => f.gx === c.gx && f.gy === c.gy)) return false;
    if (!solid) return true;
    // obiekt blokujący: wszystkie 4 sąsiednie pola wolne, żeby nie zatkać korytarza
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => this.grid.isFree(c.gx + dx, c.gy + dy));
  }
  private pickCell(pred: (r: { gx: number; gy: number; d: number }) => boolean, solid = false): GridPos | null {
    const c = this.map.reach.filter((r) => pred(r) && this.cellOk(r, solid));
    if (!c.length) return null;
    const r = c[Math.floor(this.rng() * c.length)];
    return { gx: r.gx, gy: r.gy };
  }
  /** Losowe pole w pierścieniu [r0, r1] wokół `p`. */
  private freeCell(p: GridPos, r0: number, r1: number, solid = false): GridPos | null {
    return this.pickCell((r) => {
      const d = Math.hypot(r.gx - p.gx, r.gy - p.gy);
      return d >= r0 && d <= r1;
    }, solid);
  }
  private solidSpot(p: GridPos): GridPos | null {
    return this.cellOk(p, true) ? { gx: p.gx, gy: p.gy } : null;
  }

  // ---------- sygnały
  on(fn: (s: MissionSignal) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(s: MissionSignal): void {
    for (const fn of this.listeners) fn(s);
  }
  log(text: string, tone: LogTone = 'dim'): void {
    this.emit({ kind: 'log', text, tone });
  }

  // ---------- zapytania
  /** Metoda (nie pole), bo tryb zmienia się w trakcie ruchu - TS nie zawęża wtedy typu. */
  inCombat(): boolean {
    return this.mode === 'combat';
  }
  get level(): number {
    return this.contract.level || 1;
  }
  thingAt(gx: number, gy: number): MissionThing | undefined {
    return this.things.find((t) => t.gx === gx && t.gy === gy && !t.done);
  }
  actorAt(gx: number, gy: number): Actor | null {
    return this.combat.actorAt(gx, gy);
  }
  inExtraction(p: GridPos): boolean {
    return inEntryZone(this.map.entry, p);
  }
  isVisible(p: GridPos): boolean {
    return !!this.vis[this.grid.index(p.gx, p.gy)];
  }
  isExplored(p: GridPos): boolean {
    return !!this.explored[this.grid.index(p.gx, p.gy)];
  }

  /** Mgła wojny: co widzą najemnicy (9 pól) i idący za nimi jeniec (5 pól). */
  updateVisibility(): void {
    this.vis.fill(0);
    const mark = (a: Actor, r: number): void => {
      for (const i of this.grid.visible(a, r)) {
        this.vis[i] = 1;
        this.explored[i] = 1;
      }
    };
    for (const a of this.pcs) if (a.state !== 'dead') mark(a, SIGHT_PC);
    for (const n of this.neutral) if (n.following) mark(n, SIGHT_NEUTRAL);
    this.emit({ kind: 'visibility' });
  }

  // ---------- ruch eksploracyjny
  /** Zasięg ruchu w eksploracji: Prędkość wybranego, a w trybie drużynowym - najwolniejszego. */
  moveRange(sel: Actor, group: boolean): number {
    const ups = this.pcs.filter((p) => p.state === 'up');
    return group && ups.length ? Math.min(...ups.map((p) => this.combat.speedOf(p))) : this.combat.speedOf(sel);
  }
  private passForPcs = (gx: number, gy: number): boolean => {
    const a = this.actorAt(gx, gy);
    return !a || a.side === 'pc';
  };
  /** Pola osiągalne jednym ruchem (do podświetlenia). */
  exploreReach(sel: Actor, group: boolean): GridPos[] {
    if (sel.state !== 'up') return [];
    const res = this.grid.search(sel, this.moveRange(sel, group), this.passForPcs);
    const out: GridPos[] = [];
    for (let i = 0; i < res.cost.length; i++) {
      const c = res.cost[i];
      if (c <= 0 || c >= UNREACHABLE || !this.explored[i]) continue;
      const p = this.grid.posOf(i);
      if (this.thingAt(p.gx, p.gy)?.kind === 'crate') continue;
      const o = this.actorAt(p.gx, p.gy);
      if (o && (o.side !== 'pc' || !group)) continue;
      out.push(p);
    }
    return out;
  }

  /** Najbliższe wolne pole przy (tx, ty) w promieniu 4 (dla formacji drużyny). */
  nearestFree(t: GridPos, who: Actor, taken?: ReadonlySet<number>): GridPos | null {
    let best: GridPos | null = null;
    let bd = 1e9;
    for (let y = t.gy - 4; y <= t.gy + 4; y++) {
      for (let x = t.gx - 4; x <= t.gx + 4; x++) {
        if (!this.grid.isFree(x, y) || taken?.has(this.grid.index(x, y))) continue;
        const a = this.actorAt(x, y);
        if ((a && a !== who) || this.thingAt(x, y)?.kind === 'crate') continue;
        if (this.neutral.some((n) => n !== who && n.gx === x && n.gy === y)) continue;
        const d = Math.hypot(x - t.gx, y - t.gy) + (this.thingAt(x, y) ? 0.2 : 0);
        if (d < bd) {
          bd = d;
          best = { gx: x, gy: y };
        }
      }
    }
    return best;
  }

  /** Przycina ścieżkę do kosztu `max` (1 / 1.5 po przekątnej); ostatnie pole musi być wolne. */
  clipPath(path: GridPos[], from: Actor, max: number, solo: boolean): GridPos[] {
    let c = 0;
    let px = from.gx;
    let py = from.gy;
    let n = 0;
    for (const st of path) {
      c += st.gx !== px && st.gy !== py ? 1.5 : 1;
      if (c > max + 1e-6) break;
      n++;
      px = st.gx;
      py = st.gy;
    }
    const ok = (t: GridPos): boolean => {
      const o = this.actorAt(t.gx, t.gy);
      return (!o || o === from || (o.side === 'pc' && !solo)) && this.thingAt(t.gx, t.gy)?.kind !== 'crate' && !this.neutral.some((q) => q.gx === t.gx && q.gy === t.gy);
    };
    while (n > 0 && !ok(path[n - 1])) n--;
    return path.slice(0, n);
  }

  /**
   * Jeden ruch eksploracyjny (= jedna akcja). Lider idzie krok po kroku (na każdym kroku: znaleziska i wypatrywanie
   * przez wrogów - wykrycie przerywa ruch i zaczyna walkę), reszta drużyny ustawia się w formacji.
   * Zwraca przebyte ścieżki do animacji.
   */
  exploreMove(sel: Actor, target: GridPos, opts: { group?: boolean } = {}): { ok: boolean; reason?: string; paths: Map<Actor, GridPos[]>; combat: boolean } {
    const paths = new Map<Actor, GridPos[]>();
    if (this.mode !== 'explore' || sel.state !== 'up') return { ok: false, reason: 'Teraz nie można się ruszać.', paths, combat: false };
    const group = opts.group ?? true;
    const dest = this.nearestFree(target, sel);
    if (!dest) return { ok: false, reason: 'Nie da się tam dojść.', paths, combat: false };
    const full = this.grid.findPath(sel, dest, this.passForPcs, 80);
    if (!full || !full.length) return { ok: false, reason: 'Nie da się tam dojść.', paths, combat: false };
    const path = this.clipPath(full, sel, this.moveRange(sel, group), !group);
    if (!path.length) return { ok: false, reason: 'Brak wolnego pola w zasięgu ruchu.', paths, combat: false };
    const end = path[path.length - 1];
    // cele formacji wokół końca ruchu lidera
    const movers = group ? this.pcs.filter((p) => p !== sel && p.state === 'up') : [];
    const taken = new Set([this.grid.index(end.gx, end.gy)]);
    const formation = new Map<Actor, GridPos>();
    for (const p of movers) {
      const c = this.nearestFree(end, p, taken);
      if (c) {
        taken.add(this.grid.index(c.gx, c.gy));
        formation.set(p, c);
      }
    }
    // lider: krok po kroku
    const walked: GridPos[] = [];
    let spotted = false;
    for (const st of path) {
      sel.gx = st.gx;
      sel.gy = st.gy;
      walked.push(st);
      this.steps++;
      this.updateVisibility();
      this.checkFinds();
      if (this.checkSpotting()) {
        spotted = true;
        break;
      }
    }
    paths.set(sel, walked);
    // reszta drużyny
    for (const [p, c] of formation) {
      const pp = this.grid.findPath(p, c, this.passForPcs, 80);
      if (!pp || !pp.length) continue;
      const walkedP = spotted ? pp.slice(0, Math.min(pp.length, walked.length)) : pp;
      if (!walkedP.length) continue;
      const last = walkedP[walkedP.length - 1];
      if (this.actorAt(last.gx, last.gy)) continue;
      p.gx = last.gx;
      p.gy = last.gy;
      paths.set(p, walkedP);
    }
    this.updateVisibility();
    if (this.mode === 'explore') {
      for (const [e, p] of this.advanceWorld()) paths.set(e, p);
      this.checkFinds();
      this.checkSpotting();
      const np = this.followNeutral(sel);
      if (np && this.captive?.actor) paths.set(this.captive.actor, np);
    }
    return { ok: true, paths, combat: this.inCombat() };
  }

  /** Uwolniony jeniec idzie za liderem. */
  followNeutral(lead: Actor): GridPos[] | null {
    const cap = this.captive;
    const n = cap?.actor;
    if (!cap || !cap.freed || !n) return null;
    const c = this.nearestFree(lead, n, new Set(this.pcs.map((p) => this.grid.index(p.gx, p.gy))));
    if (!c) return null;
    const p = this.grid.findPath(n, c, () => true, 60);
    if (!p || !p.length) return null;
    n.gx = c.gx;
    n.gy = c.gy;
    this.updateVisibility();
    return p;
  }

  // ---------- znaleziska
  /** Ukryte znaleziska w promieniu 2 odkrywa test Percepcji najlepszego najemnika; odkryte zbiera ten, kto stoi obok. */
  checkFinds(): void {
    if (this.mode !== 'explore') return;
    const pcs = this.pcs.filter((p) => p.state === 'up');
    if (!pcs.length) return;
    const dc = dcForLevel(this.level);
    for (const f of this.finds) {
      if (f.taken) continue;
      const near = pcs.filter((p) => cheb(p, f) <= 2);
      if (!near.length) continue;
      if (!f.found) {
        if (f.tried) continue;
        f.tried = true;
        const best = near.slice().sort((a, b) => getStat(b.ch, 'perception') - getStat(a.ch, 'perception'))[0];
        const r = checkBy(best.ch, getStat(best.ch, 'perception'), dc, this.rng);
        if (r.degree >= 2) {
          f.found = true;
          this.log(`${best.ch.name} dostrzega coś w gruzach (Percepcja ${r.total} vs KT ${dc}).`, 'amber');
          this.emit({ kind: 'discover', find: f, by: best, roll: r });
        }
        continue;
      }
      const taker = pcs.find((p) => cheb(p, f) <= 1);
      if (!taker) continue;
      f.taken = true;
      const scrap = Math.round((f.kind === 'scrap' ? 10 : f.kind === 'cache' ? 6 : 2) + this.rng() * 8 * (1 + this.level * 0.4));
      this.scrap += scrap;
      const got = [`${scrap} Złomu`];
      const items: ItemInstance[] = [];
      const pool = FIND_LOOT[f.kind];
      if (pool.length) {
        let id = pool[Math.floor(this.rng() * pool.length)];
        if (id === '@any') {
          const any = allItems().filter((i) => ['consumable', 'tech', 'junk'].includes(i.type) && i.level <= this.level + 1);
          id = any.length ? any[Math.floor(this.rng() * any.length)].id : 'scrap_metal';
        }
        const it = newItem(id);
        this.loot.push(it);
        items.push(it);
        got.push(itemDef(id)?.name ?? id);
      }
      this.log(`${taker.ch.name} znajduje ${FIND_NAMES[f.kind]}: ${got.join(', ')}.`, 'good');
      this.emit({ kind: 'pickup', find: f, by: taker, scrap, items });
    }
  }

  // ---------- wykrywanie przez wrogów
  /**
   * Wrogowie wypatrują drużyny - tylko ci, których drużyna widzi (pole widzenia najemników, linia wzroku).
   * Zaalarmowana grupa atakuje od razu; nieświadoma: bardzo blisko (≤3.2) = wykrycie od razu, dalej - Percepcja
   * najlepszego z widocznych vs 10 + najlepsze Skradanie drużyny, co 3 kroki. Wykrycie zaczyna walkę.
   */
  checkSpotting(): EnemyGroup | null {
    if (this.mode !== 'explore') return null;
    this.checkWave();
    const ups = this.pcs.filter((p) => p.state === 'up');
    if (!ups.length) return null;
    for (const g of this.groups) {
      const seers = g.actors.filter((e) => e.state === 'up' && this.isVisible(e));
      let seer: Actor | null = null;
      let best = Infinity;
      for (const e of seers) {
        for (const p of ups) {
          const d = dist(e, p);
          if (d < best && this.grid.los(e, p).clear) {
            best = d;
            seer = e;
          }
        }
      }
      if (!seer) continue;
      const close = best <= 3.2;
      if (g.alerted) this.log(`${seer.ch.name} dostrzega drużynę i atakuje!`, 'bad');
      else if (!close) {
        if (this.steps < g.nextNotice) continue;
        g.nextNotice = this.steps + 3;
        const per = seers.reduce((m, e) => Math.max(m, getStat(e.ch, 'perception')), -9);
        const dc = 10 + Math.max(...ups.map((p) => getStat(p.ch, 'stealth')));
        const r = check(per, dc, this.rng);
        this.log(`${seer.ch.name} wypatruje czegoś (Percepcja ${r.total} vs Skradanie ${dc}): ${r.degree >= 2 ? 'ZAUWAŻA!' : 'nic nie widzi.'}`, r.degree >= 2 ? 'bad' : 'dim');
        if (r.degree < 2) continue;
      } else this.log(`${seer.ch.name} jest tuż obok — wykrywa drużynę!`, 'bad');
      this.emit({ kind: 'spotted', group: g, by: seer, close });
      this.startCombat(g);
      return g;
    }
    return null;
  }

  /** Obrona: kolejna grupa napastników rusza na drużynę (po kilku krokach od poprzedniej fali); walczy, gdy dotrze w pole widzenia. */
  private checkWave(): void {
    if (this.objType !== 'defend' || this.steps < this.nextWave) return;
    const g = this.groups.find((x) => !x.alerted && x.actors.some((e) => e.state !== 'dead'));
    if (!g) return;
    this.wave++;
    g.alerted = true;
    // następna fala po odparciu tej (onCombatEnd), najpóźniej za 10 kroków
    this.nextWave = this.steps + 10;
    this.log(`Fala ${this.wave}/${this.groups.length}: napastnicy ruszają do ataku!`, 'bad');
  }

  /**
   * Walka; biorą w niej udział tylko wrogowie w polu widzenia drużyny - pozostali dołączają, gdy sami się w nim znajdą
   * (Combat.engageVisible). `ambush` = drużyna zaczyna z zaskoczenia (patrz Combat.start).
   */
  startCombat(g: EnemyGroup, ambush = false): void {
    this.mode = 'combat';
    let foes = this.enemies.filter((e) => e.state === 'up' && this.isVisible(e));
    // walka wymuszona bez nikogo w polu widzenia (np. symulacja) - cała grupa
    if (!foes.length) foes = g.actors.filter((e) => e.state !== 'dead');
    g.alerted = true;
    this.combat.start(foes, { ambush });
    this.updateVisibility();
  }

  // ---------- życie poza walką
  /**
   * Wrogowie spoza walki ruszają się (co ruch eksploracji / co rundę walki). Zaalarmowani (grupa wie o drużynie) idą
   * do najbliższego najemnika i stają, gdy wejdą w pole widzenia; wędrowcy krążą wokół swojego miejsca.
   * W walce ruch idzie sygnałem Combat 'move'; poza nią - zwrócone ścieżki animuje widok.
   */
  advanceWorld(): Map<Actor, GridPos[]> {
    const out = new Map<Actor, GridPos[]>();
    const ups = this.pcs.filter((p) => p.state === 'up');
    if (!ups.length || this.mode === 'over') return out;
    const fighting = this.inCombat();
    for (const e of this.enemies) {
      if (e.state !== 'up' || e.engaged) continue;
      const speed = this.combat.speedOf(e);
      let path: GridPos[] | null = null;
      if (e.group?.alerted) {
        const near = ups.reduce((m, p) => (dist(p, e) < dist(m, e) ? p : m));
        const full = this.grid.findPath(e, near, this.passFor(e, near), 240);
        if (full && full.length > 1) path = this.clipWalk(full.slice(0, -1), fighting ? speed * 2 : speed, true);
      } else if (e.roam) {
        if (this.rng() < 0.35) continue; // przystaje
        const r = e.roam;
        if (!r.dest || (r.dest.gx === e.gx && r.dest.gy === e.gy)) r.dest = this.roamDest(e);
        if (!r.dest) continue;
        const full = this.grid.findPath(e, r.dest, this.passFor(e, r.dest), 120);
        if (!full || !full.length) {
          r.dest = null;
          continue;
        }
        path = this.clipWalk(full, Math.min(speed, 4), fighting);
      }
      if (!path?.length) continue;
      if (fighting) this.combat.relocate(e, path);
      else {
        const end = path[path.length - 1];
        e.gx = end.gx;
        e.gy = end.gy;
      }
      out.set(e, path);
    }
    return out;
  }

  /** Przejście dla wroga: wolne pola (bez innych postaci), cel zawsze dozwolony (dalej i tak przycinany). */
  private passFor(e: Actor, goal: GridPos): (gx: number, gy: number) => boolean {
    return (gx, gy) => (gx === goal.gx && gy === goal.gy) || (gx === e.gx && gy === e.gy) || !this.combat.occupied(gx, gy);
  }

  /** Ścieżka przycięta do `max` pól; `stopOnSight` = stop na pierwszym polu w zasięgu wzroku drużyny. Koniec nie na zajętym polu / obiekcie. */
  private clipWalk(path: GridPos[], max: number, stopOnSight: boolean): GridPos[] {
    const out: GridPos[] = [];
    for (const p of path) {
      if (out.length >= max || this.combat.occupied(p.gx, p.gy)) break;
      out.push(p);
      if (stopOnSight && this.isVisible(p)) break;
    }
    while (out.length && this.thingAt(out[out.length - 1].gx, out[out.length - 1].gy)) out.pop();
    return out;
  }

  /** Losowy cel wędrówki: wolne pole ≤7 od miejsca startu, poza strefą wejścia. */
  private roamDest(e: Actor): GridPos | null {
    const h = e.roam?.home ?? e;
    const c = this.map.reach.filter(
      (r) => cheb(r, h) <= 7 && cheb(r, e) >= 2 && this.grid.isFree(r.gx, r.gy) && !inEntryZone(this.map.entry, r) && !this.combat.occupied(r.gx, r.gy),
    );
    if (!c.length) return null;
    const r = c[Math.floor(this.rng() * c.length)];
    return { gx: r.gx, gy: r.gy };
  }

  /**
   * Atak z ukrycia na nieświadomą grupę: Skradanie atakującego vs 10 + najlepsza Percepcja grupy.
   * Sukces = zasadzka (Combat.start ambush), porażka = zwykła walka (grupa w porę dostrzega drużynę).
   * W Oldgame kliknięcie wroga tylko podchodziło; tu atak jest dostępny, ale wymaga udanego testu.
   */
  ambushAttack(a: Actor, g: EnemyGroup): CheckResult {
    const alive = g.actors.filter((e) => e.state !== 'dead');
    const dc = 10 + Math.max(0, ...alive.map((e) => getStat(e.ch, 'perception')));
    const r = checkBy(a.ch, getStat(a.ch, 'stealth'), dc, this.rng);
    const ok = r.degree >= 2;
    this.log(`${a.ch.name}: Skradanie ${r.d20}${r.mod >= 0 ? '+' : ''}${r.mod} = ${r.total} vs ST ${dc} — ${ok ? 'zasadzka!' : 'wrogowie dostrzegają ruch.'}`, ok ? 'amber' : 'bad');
    this.startCombat(g, ok);
    return r;
  }

  private onCombatEnd(outcome: CombatEnd): void {
    if (outcome === 'defeat') {
      // Cała drużyna powalona = koniec drogi (Oldgame mission.js:558-568: ekran końca gry, polegli = faktycznie martwi).
      this.finish('fail');
      return;
    }
    this.mode = 'explore';
    this.steps += 3;
    if (this.objType === 'defend') this.nextWave = this.steps + 2;
    this.emitObjectives();
    this.checkObjective();
  }

  // ---------- interakcje
  /**
   * Interakcja z obiektem obok (cel, jeniec, skrzynia, drzwi, urządzenie). Skrzynia, drzwi i urządzenie
   * wymagają wyboru umiejętności (`skill`). W walce 1 akcja; wytrych i hakowanie 2 akcje (PF2e). Zwraca false, gdy nic się nie stało.
   */
  interact(a: Actor, th: MissionThing, skill?: SkillId): boolean {
    if (th.done || cheb(a, th) > 1 || a.state !== 'up') return false;
    // Oldgame combat.js:450: akcja schodzi tylko, gdy interakcja się udała.
    if ((th.kind === 'crate' || th.kind === 'door' || th.kind === 'device') && !skill) return false;
    if ((th.kind === 'door' || th.kind === 'device') && th.lock?.jammed) return false;
    // PF2e: Otwieranie zamka i hakowanie = 2 akcje (wyważenie 1), reszta interakcji 1
    const cost = (th.kind === 'door' && skill !== 'athletics') || th.kind === 'device' ? 2 : 1;
    if (this.mode === 'combat' && !this.combat.spendActions(a, cost)) return false;
    if (th.kind === 'item' && th.objective) {
      // zapasy żywności idą do spichrza Przystani (nagroda zlecenia), nie do plecaka
      th.done = true;
      const got = this.supplies.filter((x) => x.done).length;
      const all = got === this.supplies.length;
      this.log(`${a.ch.name} zabiera: ${th.name} (${got}/${this.supplies.length}).${all ? ' Wszystko zebrane — czas wracać do strefy ewakuacji!' : ''}`, 'good');
      this.emit({ kind: 'interact', thing: th, by: a });
      this.emitObjectives();
      this.checkObjective();
      return true;
    }
    if (th.kind === 'item') {
      th.done = true;
      this.stage = Math.max(this.stage, 1);
      this.loot.push(newItem(th.itemId ?? 'scrap_metal'));
      this.log(`${a.ch.name} zabiera: ${th.name}. Czas wracać do strefy ewakuacji!`, 'good');
      this.emit({ kind: 'interact', thing: th, by: a });
      this.emitObjectives();
      return true;
    }
    if (th.kind === 'nest') {
      th.done = true;
      this.grid.setKind(th.gx, th.gy, CellKind.FREE);
      this.log(`${a.ch.name} niszczy ${th.name.toLowerCase()}.`, 'good');
      this.emit({ kind: 'interact', thing: th, by: a });
      this.emitObjectives();
      this.checkObjective();
      return true;
    }
    if (th.kind === 'captive' && th.objective) {
      th.done = true;
      th.freed = true;
      this.log(`${a.ch.name} uwalnia: ${th.name}.`, 'good');
      this.emit({ kind: 'interact', thing: th, by: a });
      this.updateVisibility();
      this.emitObjectives();
      this.checkObjective();
      return true;
    }
    if (th.kind === 'captive') {
      th.done = true;
      th.freed = true;
      if (th.actor) th.actor.following = true;
      this.stage = Math.max(this.stage, 1);
      this.log(`${a.ch.name} uwalnia jeńca. Trzeba go wyprowadzić do strefy ewakuacji.`, 'good');
      this.emit({ kind: 'interact', thing: th, by: a });
      this.updateVisibility();
      this.emitObjectives();
      return true;
    }
    if (th.kind === 'door' && skill) return this.openLock(a, th, skill);
    if (th.kind === 'device' && skill) return this.hack(a, th, skill);
    return skill ? this.openCrate(a, th, skill) : false;
  }

  /** Zamknięte drzwi na polu (blokują przejście do otwarcia). Mapy i zlecenia dodadzą je później. */
  addLockedDoor(gx: number, gy: number, quality: LockQuality = 'simple'): MissionThing {
    const th: MissionThing = { kind: 'door', gx, gy, done: false, name: LOCKS[quality].name, quality, lock: lockState(quality) };
    this.things.push(th);
    this.grid.setKind(gx, gy, CellKind.HIGH);
    return th;
  }

  /** Urządzenie elektroniczne do zhakowania (terminal, komputer, serwer, panel, sterownik robota). */
  addDevice(gx: number, gy: number, device: DeviceKind = 'terminal'): MissionThing {
    const th: MissionThing = { kind: 'device', gx, gy, done: false, name: DEVICES[device].name, device, lock: deviceState(device, this.level) };
    this.things.push(th);
    return th;
  }

  /** Otwieranie drzwi: wytrych (Złodziejstwo, kilka sukcesów) albo wyważenie (Atletyka). */
  openLock(a: Actor, th: MissionThing, skill: SkillId): boolean {
    const lock = th.lock;
    if (th.kind !== 'door' || th.done || !lock) return false;
    const at = pickLock(a.ch, lock, skill, this.rng, th.name);
    this.log(at.log, at.opened ? 'good' : at.roll.degree === 0 ? 'bad' : 'dim');
    if (at.opened) {
      th.done = true;
      this.grid.setKind(th.gx, th.gy, CellKind.FREE);
      this.updateVisibility();
    }
    this.emit({ kind: 'lock', thing: th, by: a, attempt: at, hack: false });
    return true;
  }

  /** Hakowanie urządzenia. Kryt. porażka: blokada i alarm - najbliższa nieświadoma grupa wrogów rusza do walki. */
  hack(a: Actor, th: MissionThing, skill: SkillId): boolean {
    const dev = th.lock;
    if (th.kind !== 'device' || th.done || !dev || dev.jammed) return false;
    const at = hackDevice(a.ch, dev, skill, this.rng, th.name);
    this.log(at.log, at.opened ? 'good' : at.roll.degree === 0 ? 'bad' : 'dim');
    if (at.opened) th.done = true;
    if (at.jammed && th.objective && !at.opened) {
      // serwer z celem zlecenia nie blokuje się na stałe - alarm i restart zabezpieczeń
      dev.jammed = false;
      dev.progress = 0;
      this.log(`${th.name} restartuje zabezpieczenia — trzeba zacząć od nowa.`, 'bad');
    } else if (at.jammed) th.done = true;
    this.emit({ kind: 'lock', thing: th, by: a, attempt: at, hack: true });
    if (at.opened && th.objective) {
      this.log('Dane pobrane. Czas wracać do strefy ewakuacji!', 'good');
      this.checkObjective();
    }
    if (at.alarm && this.mode === 'explore') {
      // alarm: najbliższa nieświadoma grupa rusza na drużynę (walka, gdy wejdzie w pole widzenia)
      const g = this.groups
        .filter((x) => !x.alerted && x.actors.some((e) => e.state !== 'dead'))
        .sort((x, y) => dist(x.center, th) - dist(y.center, th))[0];
      if (g && dist(g.center, th) <= 16) {
        g.alerted = true;
        this.log('Alarm! Wrogowie w pobliżu zostają postawieni na nogi.', 'bad');
        this.checkSpotting();
      }
    }
    return true;
  }

  /**
   * Pole, z którego `a` dosięgnie obiektu (sąsiednie, najtańsze po drodze; obecne, jeśli już stoi obok).
   * null = nie da się dojść.
   */
  interactCell(a: Actor, th: GridPos): GridPos | null {
    if (cheb(a, th) <= 1) return { gx: a.gx, gy: a.gy };
    const res = this.grid.search(a, 80, this.passForPcs);
    let best: GridPos | null = null;
    let bc = UNREACHABLE;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = th.gx + dx;
        const y = th.gy + dy;
        if ((!dx && !dy) || !this.grid.isFree(x, y)) continue;
        const o = this.actorAt(x, y);
        if ((o && o !== a) || this.thingAt(x, y) || this.neutral.some((n) => n.gx === x && n.gy === y)) continue;
        const c = res.cost[this.grid.index(x, y)];
        if (c > 0 && c < bc) {
          bc = c;
          best = { gx: x, gy: y };
        }
      }
    }
    return best;
  }

  /** ST zamka skrzyni. */
  crateDC(): number {
    return dcForLevel(this.level) + 1;
  }

  /**
   * Otwieranie skrzyni (Złodziejstwo / Technika / Atletyka vs ST poziomu + 1).
   * Kryt. porażka = pułapka 1k6; porażka = zamknięta (2 próby); sukces = Złom + 1 przedmiot; kryt. = x1.5 i 2 przedmioty.
   */
  openCrate(a: Actor, th: MissionThing, skill: SkillId): boolean {
    if (th.kind !== 'crate' || th.done) return false;
    const dc = this.crateDC();
    th.done = true;
    // Złodziejstwo = wytrych: bez wytrychów kara -2 (PF2e), kryt. porażka łamie wytrych
    const improvised = skill === 'thievery' && !hasLockpick(a.ch);
    const r = improvised ? checkBy(a.ch, getStat(a.ch, skill) + IMPROVISED_PENALTY, dc, this.rng) : skillCheck(a.ch, skill, dc, this.rng);
    if (improvised) this.log(`${a.ch.name} nie ma wytrychów — improwizuje (-2).`);
    if (skill === 'thievery' && !improvised && r.degree === 0) {
      const it = a.ch.inventory.find((i) => i.id === LOCKPICK_ID)!;
      it.qty -= 1;
      if (it.qty <= 0) a.ch.inventory.splice(a.ch.inventory.indexOf(it), 1);
      this.log(`${a.ch.name}: wytrych pęka.`, 'bad');
    }
    const DEG = ['KRYTYCZNA PORAŻKA', 'porażka', 'sukces', 'KRYTYCZNY SUKCES'];
    this.log(`${a.ch.name}: ${SKILLS[skill]?.name ?? skill} ${r.total} vs KT ${dc} — ${DEG[r.degree]}`, r.degree >= 2 ? 'good' : 'bad');
    let trapDamage = 0;
    let scrap = 0;
    const items: ItemInstance[] = [];
    if (r.degree === 0) {
      trapDamage = roll('1d6', this.rng).total;
      applyDamage(a.ch, trapDamage);
      this.log(`Pułapka! ${a.ch.name} traci ${trapDamage} PW.`, 'bad');
      this.combat.syncAll();
    } else if (r.degree === 1) {
      this.log('Zamek się nie poddaje — skrzynia pozostaje zamknięta.');
      th.tries = (th.tries ?? 0) + 1;
      th.done = th.tries >= 2;
    } else {
      const n = r.degree === 3 ? 2 : 1;
      scrap = Math.round((8 + this.rng() * 14) * (1 + this.level * 0.5) * (r.degree === 3 ? 1.5 : 1));
      this.scrap += scrap;
      this.log(`Znaleziono ${scrap} Złomu.`, 'amber');
      const pool = allItems().filter((i) => ['consumable', 'junk', 'tech', 'ammo'].includes(i.type) && i.level <= this.level + 1);
      for (let i = 0; i < n && pool.length; i++) {
        const it = pool[Math.floor(this.rng() * pool.length)];
        const inst = newItem(it.id);
        this.loot.push(inst);
        items.push(inst);
        this.log(`Łup: ${it.name}.`, 'good');
      }
    }
    this.emit({ kind: 'crate', thing: th, by: a, roll: r, scrap, items, trapDamage });
    this.emitObjectives();
    return true;
  }

  // ---------- cele i ewakuacja
  objectiveDone(): boolean {
    return this.stage >= 1;
  }
  /** Czy po wykonaniu celu trzeba wrócić do strefy ewakuacji (bez tego - ewakuacja w dowolnej chwili). */
  needsExtraction(): boolean {
    return EXTRACTION_OBJECTIVES.includes(this.objType);
  }
  private allDead(): boolean {
    return this.enemies.every((e) => e.state === 'dead');
  }
  /** Czy cel zlecenia jest spełniony (retrieve / rescue ustawiają etap w interact). */
  private objectiveMet(): boolean {
    switch (this.objType) {
      case 'eliminate':
      case 'defend':
        return this.allDead();
      case 'hunt':
      case 'boss':
        return this.target?.state === 'dead';
      case 'hack':
        return !!this.objDevice?.done;
      case 'liberate':
        return this.allDead() && this.settlers.every((x) => x.freed);
      case 'purge':
        return this.allDead() && this.nests.every((x) => x.done);
      case 'forage':
        return this.supplies.length > 0 && this.supplies.every((x) => x.done);
      default:
        return this.stage >= 1;
    }
  }
  /** Sprawdza cel; przy pierwszym spełnieniu ogłasza wykonanie (sygnał 'complete' z listą pozostałych nagród). */
  checkObjective(): void {
    if (this.stage >= 1 || this.mode === 'over' || !this.objectiveMet()) return;
    this.stage = 1;
    const left = this.leftovers();
    this.log(left.length ? `Cel zlecenia wykonany. Na terenie zostało jeszcze: ${left.join(', ')}.` : 'Cel zlecenia wykonany.', 'good');
    this.emit({ kind: 'complete', leftovers: left });
    this.emitObjectives();
  }
  /** Co jeszcze można zdobyć / odkryć na terenie misji (opisy dla gracza). */
  leftovers(): string[] {
    const out: string[] = [];
    const crates = this.things.filter((x) => x.kind === 'crate' && !x.done).length;
    if (crates) out.push(`zamknięte skrzynie: ${crates}`);
    const finds = this.finds.filter((f) => f.found && !f.taken).length;
    if (finds) out.push(`znaleziska do zabrania: ${finds}`);
    const hidden = this.finds.filter((f) => !f.found && !f.taken).length;
    if (hidden) out.push('ukryte znaleziska do odkrycia');
    const devices = this.things.filter((x) => x.kind === 'device' && !x.done && !x.lock?.jammed && !x.objective).length;
    if (devices) out.push(`urządzenia do zhakowania: ${devices}`);
    const foes = this.enemies.filter((e) => e.state !== 'dead').length;
    if (foes) out.push(`wrogowie: ${foes}`);
    return out;
  }

  objectives(): ObjectiveLine[] {
    const alive = this.enemies.filter((a) => a.state !== 'dead').length;
    const tot = this.enemies.length;
    const L: ObjectiveLine[] = [];
    const t = this.objType;
    if (t === 'eliminate') L.push({ text: `Wyeliminuj wszystkich wrogów (${tot - alive}/${tot})`, done: alive === 0 });
    else if (t === 'hunt' || t === 'boss') {
      L.push({ text: `Zabij cel: ${this.target?.ch.name ?? 'cel'}`, done: this.target?.state === 'dead' });
      L.push({ text: `Eskorta wrogów: ${alive}`, done: false, tone: 'dim' });
    } else if (t === 'hack') {
      const d = this.objDevice;
      L.push({ text: `Włam się do serwera (${d?.lock?.progress ?? 0}/${d?.lock?.needed ?? 3})`, done: !!d?.done });
      L.push({ text: 'Wróć z danymi do strefy ewakuacji', done: false, go: this.stage >= 1 });
    } else if (t === 'liberate') {
      L.push({ text: `Uwolnij osadników (${this.settlers.filter((x) => x.freed).length}/${this.settlers.length})`, done: this.settlers.every((x) => x.freed) });
      L.push({ text: `Pokonaj szabrowników (${tot - alive}/${tot})`, done: alive === 0 });
    } else if (t === 'purge') {
      L.push({ text: `Zniszcz gniazda (${this.nests.filter((x) => x.done).length}/${this.nests.length})`, done: this.nests.every((x) => x.done) });
      L.push({ text: `Wybij faunę (${tot - alive}/${tot})`, done: alive === 0 });
    } else if (t === 'defend') {
      const waves = this.groups.length;
      const cleared = this.groups.filter((g) => g.actors.every((e) => e.state === 'dead')).length;
      L.push({ text: `Odeprzyj fale napastników (${cleared}/${waves})`, done: alive === 0 });
    } else if (t === 'forage') {
      const got = this.supplies.filter((x) => x.done).length;
      L.push({ text: `Zbierz zapasy żywności (${got}/${this.supplies.length})`, done: got === this.supplies.length });
      L.push({ text: 'Wróć z zapasami do strefy ewakuacji', done: false, go: this.stage >= 1 });
    } else if (t === 'retrieve') {
      L.push({ text: `Odzyskaj: ${this.itemThing?.name ?? 'cel'}`, done: this.stage >= 1 });
      L.push({ text: 'Wróć do strefy ewakuacji', done: false, go: this.stage >= 1 });
    } else {
      L.push({ text: 'Znajdź i uwolnij jeńca', done: this.stage >= 1 });
      L.push({ text: 'Doprowadź go do strefy ewakuacji', done: false, go: this.stage >= 1 });
    }
    if (this.stage >= 1 && !this.needsExtraction()) L.push({ text: 'Cel wykonany: przeszukaj teren lub wróć do ewakuacji', done: false, go: true });
    const crates = this.things.filter((x) => x.kind === 'crate');
    L.push({ text: `Skrzynie: ${crates.filter((x) => x.done).length}/${crates.length}`, done: false, tone: 'dim' });
    return L;
  }
  private emitObjectives(): void {
    this.emit({ kind: 'objective', lines: this.objectives() });
  }

  /** Cel wykonany, wszyscy przytomni (i uwolniony jeniec) stoją w strefie ewakuacji. */
  canExtract(): boolean {
    if (this.mode !== 'explore' || !this.objectiveDone()) return false;
    const up = this.pcs.filter((p) => p.state === 'up');
    if (!up.length || !up.every((p) => this.inExtraction(p))) return false;
    const cap = this.captive;
    return !cap || !cap.freed || !cap.actor || this.inExtraction(cap.actor);
  }

  // ---------- zakończenie
  /** Kończy misję: PD za zabitych, łup z wrogów, ukradziony Złom, polegli. */
  finish(result: MissionOutcome): MissionResult {
    if (this.result) return this.result;
    this.mode = 'over';
    this.combat.active = false;
    const casualties = this.pcs.filter((a) => !isAlive(a.ch)).map((a) => a.ch.name);
    const xp = encounterXP(partyLevel(this.pcs.map((a) => a.ch)), this.killed);
    for (const ch of this.killed) {
      const lo = rollLoot(ch, this.rng);
      this.loot.push(...lo.items);
      this.scrap += lo.scrap;
    }
    for (const a of this.pcs) {
      if (a.ch.stolenScrap) {
        this.scrap += a.ch.stolenScrap;
        a.ch.stolenScrap = 0;
      }
      if (result !== 'fail') endEncounter(a.ch);
    }
    this.result = { contractId: this.contract.id, result, xp, loot: this.loot.slice(), scrap: this.scrap, casualties };
    if (this.objType === 'forage') this.result.supplies = { got: this.supplies.filter((x) => x.done).length, total: this.supplies.length };
    this.emit({ kind: 'finish', result: this.result });
    return this.result;
  }

  /** Odwrót z misji (w eksploracji i w walce - stary przycisk "Odwrót" działał zawsze). */
  retreat(): MissionResult | null {
    if (this.mode === 'over') return null;
    // cel wykonany (poza jeńcem, którego trzeba wyprowadzić) = zlecenie zaliczone
    return this.finish(this.objectiveDone() && this.objType !== 'rescue' ? 'success' : 'retreat');
  }
}
