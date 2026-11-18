// Kontroler walki turowej: inicjatywa, 3 akcje PF2e, PWA, Marsz/Krok, ataki, zdolności, przedmioty,
// flankowanie, osłona, dołączanie grup wrogów, koniec walki.
// Migracja z Oldgame/src/mission/combat.js - bez renderingu, animacji i DOM.
// Warstwa widoku (Phaser) subskrybuje sygnały przez combat.on() i animuje je po swojemu.
import type { AbilityDef, AbilityId, ConsumableStats } from '../data/types.ts';
import { DEGREE_NAMES, UNIVERSAL_ABILITIES } from '../data/rules.ts';
import { useAbility as resolveAbility, canUse } from '../rules/abilities.ts';
import { endEncounter } from '../rules/character.ts';
import { useConsumable } from '../rules/consumables.ts';
import { isAlive, isDown } from '../rules/damage.ts';
import { fmtD20, fmtMod, hitChances, type Rng } from '../rules/dice.ts';
import { swapWeapons } from '../rules/equipment.ts';
import { abilityDef, itemDef } from '../rules/lookup.ts';
import { strike as strikeRule } from '../rules/strike.ts';
import { attackHalves, concealHalves, dieHalves, getAttackBonus, getStat, getWeapon, normWeapon, traitVal } from '../rules/stats.ts';
import { endTurn as endTurnRule, rollInitiative, startTurn } from '../rules/turn.ts';
import type { ActionResult, Character, GridPos, ItemInstance, NormWeapon, WeaponRef } from '../rules/types.ts';
import { cheb, strideActions, TacticalGrid, UNREACHABLE, type SearchResult } from './grid.ts';

export type Side = 'pc' | 'enemy' | 'neutral';
export type ActorState = 'up' | 'down' | 'dead';

export interface EnemyGroup {
  idx: number;
  actors: Actor[];
  /** Grupa wie o drużynie (wykrycie, hałas, alarm): niewidoczni członkowie idą w jej stronę. */
  alerted: boolean;
  /** Krok eksploracji, od którego grupa może znów wypatrywać drużyny. */
  nextNotice: number;
  center: GridPos;
}

/** Postać na planszy. */
export interface Actor extends GridPos {
  id: string;
  ch: Character;
  side: Side;
  state: ActorState;
  group: EnemyGroup | null;
  /** Wróg bierze udział w trwającej walce (dołącza dopiero, gdy wejdzie w pole widzenia najemników). */
  engaged: boolean;
  /** Samotny wędrowiec: krąży wokół `home` (Mission.advanceWorld). */
  roam?: { home: GridPos; dest: GridPos | null } | null;
  /** Ataki wykonane w tej turze (kara PWA). */
  mapN: number;
  init: number;
  /** Jednorazowe flagi tury/walki (darmowe akcje, buffy AI). */
  used: Record<string, boolean>;
  /** Odłożona tura (Delay / zamiana najemnika). */
  savedTurn: { actions: number; round: number } | null;
  isTarget?: boolean;
  /** Neutralny jeniec idzie za drużyną. */
  following?: boolean;
  /**
   * Podopieczny: uwolniony jeniec / osadnik (cywil). Najemnicy mogą go zranić - zabłąkany pocisk, gdy stoi
   * na linii strzału, albo wybuch, gdy jest w polu rażenia. Przy 0 PW ginie.
   */
  ward?: boolean;
}

export function makeActor(ch: Character, side: Side, pos: GridPos, group: EnemyGroup | null = null): Actor {
  return {
    id: ch.id, ch, side, gx: pos.gx, gy: pos.gy, group, engaged: false, mapN: 0, init: 0, used: {}, savedTurn: null,
    state: side === 'enemy' ? (isAlive(ch) ? 'up' : 'dead') : isDown(ch) ? 'down' : isAlive(ch) ? 'up' : 'dead',
  };
}

export interface TurnInfo {
  actor: Actor;
  actions: number;
  /** Akcje na początku tury. */
  full: number;
  /** Czy wydano już jakąkolwiek akcję. */
  used: boolean;
  delayed: boolean;
  switched: boolean;
}

export type LogTone = 'dim' | 'good' | 'bad' | 'amber' | 'hd';
export type CombatEnd = 'defeat' | 'target' | 'cleared';

export interface StrikeInfo {
  ok: boolean;
  reason?: string;
  /** Cel poza zasięgiem broni białej (można podejść). */
  melee?: boolean;
  weapon: NormWeapon;
  mod: number;
  ac: number;
  baseAc: number;
  /** Szansa na trafienie / krytyk (0..1). */
  hit: number;
  crit: number;
  flank: boolean;
  geoCover: boolean;
  /** Połowienia k20 trafienia (przerażony atakujący, ukryty cel). */
  halves: number;
  /** Cel w ukryciu (Ukryty) - kość trafienia dzielona na 2. */
  concealed: boolean;
  /** Atakujący przerażony - jego kości dzielone na 2. */
  frightened: boolean;
  /** Przyrosty zasięgu (każdy -2). */
  inc: number;
  mapIdx: number;
  ranged: boolean;
}

export type CombatSignal =
  | { kind: 'log'; text: string; tone: LogTone }
  | { kind: 'combatStart'; order: Actor[]; boss: boolean; ambush: boolean }
  | { kind: 'join'; actors: Actor[] }
  | { kind: 'round'; round: number }
  | { kind: 'turnStart'; turn: TurnInfo; round: number }
  | { kind: 'turnEnd'; actor: Actor }
  | { kind: 'move'; actor: Actor; path: GridPos[] }
  | { kind: 'strike'; attacker: Actor; defender: Actor; info: StrikeInfo; result: ActionResult }
  /** Chybiony strzał najemnika poleciał dalej i trafił (lub minął) podopiecznego na linii strzału. */
  | { kind: 'stray'; attacker: Actor; ward: Actor; intended: Actor; result: ActionResult }
  | { kind: 'ability'; actor: Actor; ability: AbilityDef; targets: Actor[]; cell?: GridPos; result: ActionResult }
  | { kind: 'item'; actor: Actor; item: ItemInstance; targets: Actor[]; cell?: GridPos; result: ActionResult }
  | { kind: 'rules'; actor: Actor; result: Pick<ActionResult, 'log' | 'events'> }
  | { kind: 'state'; actor: Actor; from: ActorState; to: ActorState }
  | { kind: 'noise'; actor: Actor; radius: number }
  | { kind: 'end'; outcome: CombatEnd };

export interface ActionOutcome {
  ok: boolean;
  reason?: string;
  result?: ActionResult;
  path?: GridPos[];
}
const fail = (reason: string): ActionOutcome => ({ ok: false, reason });

/** Plansza widziana przez walkę (dostarcza ją misja). */
export interface Battlefield {
  grid: TacticalGrid;
  actors: Actor[];
  groups: EnemyGroup[];
  /** Cel polowania (hunt/boss) - jego śmierć kończy misję. */
  target?: Actor | null;
  /** Dodatkowo zajęte pola (np. jeniec). */
  isBlocked?: (gx: number, gy: number) => boolean;
  /** Czy postać jest w polu widzenia drużyny (mgła wojny misji). Domyślnie: ≤9 pól i linia wzroku od żywego najemnika. */
  inSight?: (a: Actor) => boolean;
  /** Eksploracja: najemnicy mogą używać zdolności i przedmiotów poza walką (bez kosztu akcji). */
  freeActions?: () => boolean;
  /** Wybuch / ogień w polu `cell` (granat, koktajl, rakiety) - misja sprawdza, czy zapalił wraki. Przed syncAll / checkEnd. */
  onBlast?: (cell: GridPos, radius: number) => void;
}
/** Zdolności "wybuchowe", które nie zapalają paliwa (EMP, wstrząs). */
const NO_IGNITE: ReadonlySet<string> = new Set(['emp_grenade', 'quake']);

/** Na kogo działa zdolność obszarowa. Dystansowe obszary (granaty) trafiają wszystkich - także swoich. */
const AREA_ALLIES: ReadonlySet<AbilityId> = new Set<AbilityId>(['rally', 'field_clinic', 'chief_rally', 'kostucha_command']);
export const areaAffects = (ab: AbilityDef): 'allies' | 'foes' | 'all' =>
  AREA_ALLIES.has(ab.id as AbilityId) ? 'allies' : ab.range > 0 ? 'all' : 'foes';

/** Postawy i zdolności z sensem tylko w turze walki (poza walką niedostępne). */
const COMBAT_ONLY: ReadonlySet<AbilityId> = new Set<AbilityId>(['strike', 'raise_shield', 'take_cover', 'dodge', 'rage', 'frenzy', 'stand']);
/** Czy zdolność da się użyć w eksploracji: tylko na siebie / sojuszników (leczenie, wzmocnienia). */
export const exploreAbilityOk = (ab: AbilityDef): boolean =>
  !COMBAT_ONLY.has(ab.id as AbilityId) && ab.actions !== 'reaction' &&
  (ab.target === 'self' || ab.target === 'ally' || (ab.target === 'area' && areaAffects(ab) === 'allies'));
/** Czy przedmiot jednorazowy da się użyć w eksploracji (na siebie / sojusznika, bez wybuchów i dymu). */
export const exploreItemOk = (c: ConsumableStats): boolean => c.target !== 'enemy' && c.target !== 'area';

const UNIVERSAL: ReadonlySet<string> = new Set(UNIVERSAL_ABILITIES);
export const isUniversalAbility = (id: string): boolean => UNIVERSAL.has(id);

export class Combat {
  readonly field: Battlefield;
  readonly rng: Rng;
  active = false;
  order: Actor[] = [];
  round = 1;
  idx = -1;
  turn: TurnInfo | null = null;
  private listeners = new Set<(s: CombatSignal) => void>();

  constructor(field: Battlefield, rng: Rng = Math.random) {
    this.field = field;
    this.rng = rng;
  }

  // ---------- sygnały
  on(fn: (s: CombatSignal) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  protected emit(s: CombatSignal): void {
    for (const fn of this.listeners) fn(s);
  }
  log(text: string, tone: LogTone = 'dim'): void {
    this.emit({ kind: 'log', text, tone });
  }
  private logAll(lines: readonly string[], tone: LogTone = 'dim'): void {
    for (const l of lines) this.log(l, tone);
  }

  // ---------- zapytania
  get grid(): TacticalGrid {
    return this.field.grid;
  }
  get pcs(): Actor[] {
    return this.field.actors.filter((a) => a.side === 'pc');
  }
  get enemies(): Actor[] {
    return this.field.actors.filter((a) => a.side === 'enemy');
  }
  get current(): Actor | null {
    return this.turn?.actor ?? null;
  }
  /** Przeciwnicy zdolni do walki (dla graczy: tylko wrogowie biorący udział w walce). */
  foesOf(a: Actor): Actor[] {
    const list = a.side === 'pc' ? this.enemies.filter((e) => e.engaged) : this.pcs;
    return list.filter((f) => f.state === 'up');
  }
  alliesOf(a: Actor): Actor[] {
    return this.field.actors.filter((f) => f !== a && f.side === a.side);
  }
  /** Żywa postać (nie neutralna) na polu. */
  actorAt(gx: number, gy: number): Actor | null {
    return this.field.actors.find((a) => a.state !== 'dead' && a.side !== 'neutral' && a.gx === gx && a.gy === gy) ?? null;
  }
  occupied(gx: number, gy: number): boolean {
    return !!this.actorAt(gx, gy) || !!this.field.isBlocked?.(gx, gy);
  }
  speedOf(a: Actor): number {
    return Math.max(1, Math.round(getStat(a.ch, 'speed')) || 5);
  }
  weaponOf(a: Actor): WeaponRef {
    return getWeapon(a.ch);
  }

  // ---------- stan postaci (up / down / dead)
  sync(a: Actor): ActorState {
    const ch = a.ch;
    let s: ActorState = !isAlive(ch) ? 'dead' : isDown(ch) || ch.hp <= 0 ? 'down' : 'up';
    if (a.side !== 'pc' && s !== 'up') s = 'dead';
    if (s !== a.state) {
      const from = a.state;
      a.state = s;
      if (s === 'dead' && a.side === 'pc') this.log(`${ch.name} POLEGŁ.`, 'bad');
      else if (s === 'dead' && a.side === 'neutral') this.log(`${ch.name} ginie od ognia drużyny!`, 'bad');
      else if (s === 'up' && from !== 'up') this.log(`${ch.name} wraca do walki.`, 'good');
      this.emit({ kind: 'state', actor: a, from, to: s });
    }
    return s;
  }
  syncAll(): void {
    for (const a of this.field.actors) if (a.side !== 'neutral' || a.ward) this.sync(a);
  }

  // ---------- podopieczni (uwolnieni cywile)
  /** Żywi podopieczni (uwolnieni jeńcy / osadnicy), których najemnicy mogą przypadkiem zranić. */
  get wards(): Actor[] {
    return this.field.actors.filter((a) => a.side === 'neutral' && a.ward && a.state !== 'dead');
  }
  /** Podopieczni stojący na linii strzału `att` -> `def` (od najbliższego strzelcowi). */
  wardsOnLine(att: GridPos, def: GridPos): Actor[] {
    const ws = this.wards;
    if (!ws.length) return [];
    const out: Actor[] = [];
    for (const c of this.grid.lineCells(att, def)) {
      const w = ws.find((x) => x.gx === c.gx && x.gy === c.gy);
      if (w) out.push(w);
    }
    return out;
  }
  /**
   * Zabłąkany pocisk: chybiony strzał najemnika leci dalej i może trafić pierwszego podopiecznego na linii strzału
   * (zwykły rzut ataku tą samą bronią przeciw jego KP, bez kary PWA).
   */
  private strayShot(att: Actor, def: Actor, w: WeaponRef, missed: boolean): void {
    if (att.side !== 'pc' || !missed) return;
    const ward = this.wardsOnLine(att, def)[0];
    if (!ward) return;
    const nw = normWeapon(w);
    if (nw.range <= 0) return;
    const inc = Math.max(0, Math.ceil(cheb(att, ward) / nw.range) - 1);
    const result = strikeRule(att.ch, ward.ch, { weapon: w, mapIndex: 0, rng: this.rng, rangeIncrements: inc });
    this.log(`Pocisk ${att.ch.name} leci dalej — na linii strzału stoi ${ward.ch.name}!`, 'bad');
    this.emit({ kind: 'stray', attacker: att, ward, intended: def, result });
    this.logAll(result.log, result.hit ? 'bad' : 'dim');
  }

  // ---------- informacje o ataku
  /** Flankowanie: sojusznik stoi dokładnie po przeciwnej stronie celu (tylko wręcz). */
  flanked(side: Side, pos: GridPos, def: Actor, w: NormWeapon): boolean {
    if (w.range > 0 || cheb(pos, def) > 1) return false;
    const ox = def.gx - (pos.gx - def.gx);
    const oy = def.gy - (pos.gy - def.gy);
    return this.field.actors.some((z) => z.side === side && z.state === 'up' && z.gx === ox && z.gy === oy);
  }

  /** Tymczasowo nakłada geometryczną osłonę / flankowanie na obrońcę (zasady czytają je w getStat('ac')). */
  private withTemp<T>(def: Actor, geoCover: boolean, flank: boolean, fn: () => T): T {
    const c = def.ch.conditions;
    const ic = c.in_cover;
    const og = c.off_guard;
    if (geoCover) c.in_cover = typeof ic === 'number' && ic >= 1 ? 2 : 1;
    if (flank && !og) c.off_guard = 1;
    try {
      return fn();
    } finally {
      if (def.ch.hp > 0) {
        if (ic === undefined) delete c.in_cover;
        else c.in_cover = ic;
      }
      if (og === undefined) delete c.off_guard;
      else c.off_guard = og;
    }
  }

  /** Czy i z jaką szansą `att` może zaatakować `def` z pozycji `pos` (domyślnie obecnej). */
  strikeInfo(att: Actor, def: Actor, w: WeaponRef = this.weaponOf(att), pos: GridPos = att): StrikeInfo {
    const nw = normWeapon(w);
    const info: StrikeInfo = {
      ok: false, weapon: nw, mod: 0, ac: 0, baseAc: 0, hit: 0, crit: 0, flank: false, geoCover: false, halves: 0, concealed: false, frightened: false, inc: 0, mapIdx: 0, ranged: nw.range > 0,
    };
    const d = cheb(pos, def);
    const r = nw.range;
    let cover = false;
    if (r === 0) {
      const reach = traitVal(nw, 'reach') ? 2 : 1;
      if (d > reach) return { ...info, reason: 'za daleko', melee: true };
    } else {
      if (d > r * 6) return { ...info, reason: 'poza zasięgiem' };
      const los = this.grid.los(pos, def);
      if (!los.clear) return { ...info, reason: 'brak linii strzału' };
      cover = los.cover;
      info.inc = Math.ceil(d / r) - 1;
    }
    info.flank = this.flanked(att.side, pos, def, nw);
    info.geoCover = r > 0 && cover;
    info.mapIdx = Math.min(2, att.mapN);
    info.mod = getAttackBonus(att.ch, w, info.mapIdx, { rangeIncrements: info.inc });
    info.concealed = concealHalves(def.ch) > 0;
    info.frightened = dieHalves(att.ch) > 0;
    info.halves = attackHalves(att.ch, def.ch);
    info.ac = this.withTemp(def, info.geoCover, info.flank, () => getStat(def.ch, 'ac', { ignoreCover: r === 0 }));
    info.baseAc = getStat(def.ch, 'ac', { ignoreCover: r === 0 });
    const ch = hitChances(info.mod, info.ac, info.halves);
    info.hit = ch.hit;
    info.crit = ch.crit;
    info.ok = true;
    return info;
  }

  // ---------- ruch
  /** Zasięg ruchu za `actions` akcji (przez sojuszników można przechodzić, przez wrogów nie). */
  reachFor(a: Actor, actions: number): { res: SearchResult; sp: number } {
    const sp = this.speedOf(a);
    const pass = (gx: number, gy: number): boolean => {
      const o = this.actorAt(gx, gy);
      return !o || o.side === a.side;
    };
    return { res: this.grid.search(a, sp * actions, pass), sp };
  }
  /** Pola, na które aktywna postać może dojść, z kosztem w akcjach. */
  moveOptions(a: Actor): { gx: number; gy: number; actions: number }[] {
    const t = this.turn;
    if (!t || t.actor !== a || t.actions <= 0) return [];
    const { res, sp } = this.reachFor(a, t.actions);
    const out: { gx: number; gy: number; actions: number }[] = [];
    for (let i = 0; i < res.cost.length; i++) {
      const c = res.cost[i];
      if (c <= 0 || c >= UNREACHABLE) continue;
      const p = this.grid.posOf(i);
      if (this.occupied(p.gx, p.gy)) continue;
      out.push({ ...p, actions: strideActions(c, sp) });
    }
    return out;
  }

  /**
   * Eksploracja: zdolności bez limitu użyć (np. Pierwsza pomoc) działają na danego sojusznika raz między walkami,
   * żeby leczenie poza walką nie było nieskończone. Czyszczone na starcie kolejnej walki.
   */
  private restUsed = new Map<Actor, Set<AbilityId>>();
  /** Czy zdolność bez limitu była już użyta na tym celu od ostatniej walki. */
  restSpent(id: AbilityId, target: Actor): boolean {
    return !!this.restUsed.get(target)?.has(id);
  }

  /** Poza walką (eksploracja) najemnik działa bez tury i bez kosztu akcji. */
  get exploring(): boolean {
    return !this.active && !!this.field.freeActions?.();
  }

  private canAct(a: Actor, cost: number): string | null {
    if (this.exploring && a.side === 'pc') return a.state !== 'up' ? `${a.ch.name} nie może działać.` : null;
    const t = this.turn;
    if (!this.active || !t || t.actor !== a) return 'Nie twoja tura.';
    if (a.state !== 'up') return `${a.ch.name} nie może działać.`;
    if (cost > t.actions) return 'Brak akcji.';
    return null;
  }
  /** Wydaje akcje bieżącej postaci (np. interakcja ze skrzynią w trakcie walki). */
  spendActions(a: Actor, n: number): boolean {
    if (this.canAct(a, n)) return false;
    if (this.exploring) return true;
    const t = this.turn!;
    t.actions -= n;
    if (n > 0) t.used = true;
    return true;
  }

  private moveAlong(a: Actor, path: GridPos[]): void {
    if (!path.length) return;
    delete a.ch.conditions.in_cover;
    const end = path[path.length - 1];
    a.gx = end.gx;
    a.gy = end.gy;
    this.emit({ kind: 'move', actor: a, path });
    if (a.side === 'pc') this.engageVisible();
  }

  /** Marsz: do Prędkości za każdą akcję (koszt w akcjach liczony z drogi). */
  stride(a: Actor, dest: GridPos): ActionOutcome {
    const t = this.turn;
    const err = this.canAct(a, 1);
    if (err || !t) return fail(err ?? 'Nie twoja tura.');
    if (this.occupied(dest.gx, dest.gy)) return fail('Pole zajęte.');
    const { res, sp } = this.reachFor(a, t.actions);
    const c = this.grid.costAt(res, dest);
    if (!(c > 0 && c < UNREACHABLE)) return fail('Nie ma tam drogi.');
    const path = this.grid.pathFrom(res, dest);
    if (!path) return fail('Nie ma tam drogi.');
    this.spendActions(a, strideActions(c, sp));
    this.moveAlong(a, path);
    return { ok: true, path };
  }

  /** Pola, na które można zrobić Krok. */
  stepOptions(a: Actor): GridPos[] {
    const out: GridPos[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = a.gx + dx;
        const y = a.gy + dy;
        if ((!dx && !dy) || !this.grid.isFree(x, y) || this.occupied(x, y)) continue;
        if (dx && dy && !(this.grid.isFree(a.gx + dx, a.gy) && this.grid.isFree(a.gx, a.gy + dy))) continue;
        out.push({ gx: x, gy: y });
      }
    }
    return out;
  }

  /** Krok: jedno wolne pole obok (bez ścinania rogów). */
  step(a: Actor, dest: GridPos): ActionOutcome {
    const err = this.canAct(a, 1);
    if (err) return fail(err);
    const dx = dest.gx - a.gx;
    const dy = dest.gy - a.gy;
    const okCorner = !dx || !dy || (this.grid.isFree(a.gx + dx, a.gy) && this.grid.isFree(a.gx, a.gy + dy));
    if (cheb(a, dest) !== 1 || !this.grid.isFree(dest.gx, dest.gy) || this.occupied(dest.gx, dest.gy) || !okCorner) {
      return fail('Krok: jedno wolne pole obok.');
    }
    this.spendActions(a, 1);
    const path = [{ gx: dest.gx, gy: dest.gy }];
    this.moveAlong(a, path);
    return { ok: true, path };
  }

  /** Najtańsze wolne pole obok celu osiągalne za `actions` akcji (premiuje flankowanie). */
  approachCell(a: Actor, target: Actor, actions: number, w?: WeaponRef): { cell: GridPos; cost: number; res: SearchResult; sp: number } | null {
    const { res, sp } = this.reachFor(a, actions);
    let best: GridPos | null = null;
    let bc = UNREACHABLE;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = target.gx + dx;
        const y = target.gy + dy;
        if ((!dx && !dy) || !this.grid.isFree(x, y)) continue;
        const here = x === a.gx && y === a.gy;
        if (!here && this.occupied(x, y)) continue;
        let c = here ? 0 : res.cost[this.grid.index(x, y)];
        if (!here && (c <= 0 || c >= UNREACHABLE)) continue;
        if (w && this.strikeInfo(a, target, w, { gx: x, gy: y }).flank) c -= 0.5;
        if (c < bc) {
          bc = c;
          best = { gx: x, gy: y };
        }
      }
    }
    return best ? { cell: best, cost: Math.max(0, bc), res, sp } : null;
  }

  // ---------- atak
  /** Atak bronią (1 akcja). */
  strike(att: Actor, def: Actor, w: WeaponRef = this.weaponOf(att)): ActionOutcome {
    const err = this.canAct(att, 1);
    if (err) return fail(err);
    const info = this.strikeInfo(att, def, w);
    if (!info.ok) return fail(`Nie można zaatakować: ${info.reason}.`);
    this.spendActions(att, 1);
    const result = this.withTemp(def, info.geoCover, info.flank, () =>
      strikeRule(att.ch, def.ch, { weapon: w, mapIndex: info.mapIdx, rng: this.rng, rangeIncrements: info.inc, hitHalves: info.halves }),
    );
    att.mapN += 1;
    delete att.ch.conditions.in_cover;
    const d = result.d20;
    if (d) {
      const note = [info.frightened && 'przerażony ½', info.concealed && 'cel ukryty ½', info.flank && 'flankowanie', info.geoCover && 'osłona', info.mapIdx && (info.mapIdx === 1 ? 'PWA -5' : 'PWA -10'), info.inc && 'dystans']
        .filter(Boolean)
        .join(', ');
      const tone: LogTone = att.side === 'pc' ? (d.degree >= 3 ? 'amber' : d.degree >= 2 ? 'good' : 'dim') : d.degree >= 2 ? 'bad' : 'dim';
      this.log(
        `${att.ch.name} → ${def.ch.name} (${info.weapon.name}): k20 ${fmtD20(d)}${fmtMod(d.mod)} = ${d.total} vs KP ${d.dc} — ${DEGREE_NAMES[d.degree]}${note ? ' [' + note + ']' : ''}`,
        tone,
      );
    }
    this.emit({ kind: 'strike', attacker: att, defender: def, info, result });
    if (info.ranged) this.noise(att, 9);
    this.logAll(result.log);
    if (info.ranged) this.strayShot(att, def, w, !!d && d.degree <= 1);
    this.syncAll();
    this.checkEnd();
    return { ok: true, result };
  }

  /** Klik na wroga: jeśli broń biała nie sięga - podejdź (Marsz) i uderz. */
  attackTarget(att: Actor, def: Actor, w: WeaponRef = this.weaponOf(att)): ActionOutcome {
    const t = this.turn;
    const err = this.canAct(att, 1);
    if (err || !t) return fail(err ?? 'Nie twoja tura.');
    let info = this.strikeInfo(att, def, w);
    let path: GridPos[] | undefined;
    if (!info.ok && info.melee) {
      if (t.actions < 2) return fail('Za daleko — potrzeba akcji na ruch i atak.');
      const ap = this.approachCell(att, def, t.actions - 1, w);
      if (!ap) return fail('Nie można podejść.');
      const p = this.grid.pathFrom(ap.res, ap.cell);
      if (!p) return fail('Nie można podejść.');
      this.spendActions(att, strideActions(this.grid.costAt(ap.res, ap.cell), ap.sp));
      this.moveAlong(att, p);
      path = p;
      if (!this.active) return { ok: true, path };
      info = this.strikeInfo(att, def, w);
    }
    if (!info.ok) return { ok: false, reason: `Nie można zaatakować: ${info.reason}.`, path };
    return { ...this.strike(att, def, w), path };
  }

  // ---------- zdolności
  abilityCost(ab: AbilityDef): number {
    // Reakcje nie są dostępne jako akcja w turze (Oldgame combat.js:158: koszt 99).
    return ab.actions === 'reaction' ? 99 : ab.actions;
  }

  /** Cele w zasięgu (i na linii strzału) dla zdolności na wroga / sojusznika. */
  abilityTargets(a: Actor, ab: AbilityDef): Actor[] {
    const range = ab.move ? this.speedOf(a) + 1 : ab.range;
    const inR = (t: Actor): boolean => cheb(a, t) <= range && (range <= 1 || this.grid.los(a, t).clear);
    if (ab.target === 'enemy') return this.foesOf(a).filter(inR);
    if (ab.target === 'ally') return this.field.actors.filter((x) => x.side === a.side && x.state !== 'dead' && (x === a || inR(x)));
    return [];
  }

  /** Postacie w promieniu wybuchu. Rzucone przez najemnika (`by`) rani też podopiecznych w polu rażenia. */
  areaTargets(cell: GridPos, radius: number, by?: Actor): Actor[] {
    return this.field.actors.filter(
      (x) => (x.side !== 'neutral' || (by?.side === 'pc' && !!x.ward)) && x.state !== 'dead' && Math.hypot(x.gx - cell.gx, x.gy - cell.gy) <= (radius || 1) + 0.45,
    );
  }

  /** Cele zdolności obszarowej wycelowanej w `cell` (range 0 = wokół siebie). */
  areaTargetsFor(a: Actor, ab: AbilityDef, cell: GridPos = a): Actor[] {
    const all = this.areaTargets(cell, ab.radius || 1, a);
    const aff = areaAffects(ab);
    if (aff === 'allies') return all.filter((x) => x.side === a.side);
    if (aff === 'foes') return all.filter((x) => x.side !== a.side && x.side !== 'neutral');
    return all;
  }

  /** Czy pole jest prawidłowym celem obszaru (zasięg, linia strzału, nie wewnątrz ściany). */
  areaCellOk(a: Actor, cell: GridPos, range: number): boolean {
    return cheb(a, cell) <= range && this.grid.los(a, cell).clear && this.grid.kind(cell.gx, cell.gy) !== 2;
  }

  /**
   * Używa zdolności. Dla 'enemy'/'ally' podaj cel w `targets`; dla 'area' z zasięgiem podaj `cell`
   * (cele policzą się same); dla 'self' i obszaru wokół siebie wystarczy samo wywołanie.
   */
  useAbility(a: Actor, id: AbilityId, targets: Actor[] = [], cell?: GridPos): ActionOutcome {
    const ab = abilityDef(id);
    if (!ab) return fail('Nieznana zdolność.');
    const cost = this.abilityCost(ab);
    const err = this.canAct(a, cost);
    if (err) return fail(err);
    if (!a.ch.abilities.includes(id)) return fail(`${a.ch.name} nie zna tej zdolności.`);
    if (ab.uses && !canUse(a.ch, id)) return fail('Brak użyć.');
    const free = this.exploring;
    if (free && !exploreAbilityOk(ab)) return fail('Tego można użyć tylko w walce.');
    if (!free && cost === 0 && a.used['_free_' + id]) return fail('Już użyto w tej turze.');

    let tg = targets;
    if (ab.target === 'enemy' || ab.target === 'ally') {
      const valid = this.abilityTargets(a, ab);
      tg = targets.filter((x) => valid.includes(x));
      if (!tg.length) return fail(ab.target === 'ally' ? 'Wskaż sojusznika w zasięgu.' : 'Wskaż wroga w zasięgu i na linii strzału.');
      if (free && !ab.uses && tg.every((x) => this.restSpent(id, x))) return fail(`${ab.name}: ${tg[0].ch.name} już ${tg[0] === a ? 'skorzystał(a)' : 'otrzymał(a)'} to po ostatniej walce.`);
    } else if (ab.target === 'area') {
      if (ab.range > 0) {
        if (!cell || !this.areaCellOk(a, cell, ab.range)) return fail('Poza zasięgiem / brak linii.');
        tg = this.areaTargetsFor(a, ab, cell);
      } else {
        cell = { gx: a.gx, gy: a.gy };
        tg = this.areaTargetsFor(a, ab, cell);
        if (areaAffects(ab) === 'allies' && !tg.includes(a)) tg = [...tg, a];
      }
    } else if (ab.target === 'self') tg = [a];
    else tg = this.foesOf(a);

    if (free && !ab.uses && (ab.target === 'self' || ab.target === 'ally')) {
      if (ab.target === 'self' && this.restSpent(id, a)) return fail(`${ab.name}: już użyte po ostatniej walce.`);
      for (const x of tg) {
        const set = this.restUsed.get(x) ?? new Set<AbilityId>();
        set.add(id);
        this.restUsed.set(x, set);
      }
    }
    this.spendActions(a, cost);
    if (cost === 0 && !free) a.used['_free_' + id] = true;

    let path: GridPos[] | undefined;
    if (ab.move && tg[0] && tg[0] !== a && cheb(a, tg[0]) > 1) {
      const ap = this.approachCell(a, tg[0], 1);
      const p = ap ? this.grid.pathFrom(ap.res, ap.cell) : null;
      if (p && p.length) {
        this.moveAlong(a, p);
        path = p;
      }
    }
    this.log(`${a.ch.name} używa: ${ab.name}.`, a.side === 'pc' ? 'amber' : 'bad');
    const result = resolveAbility(id, { user: a.ch, targets: tg.map((x) => x.ch), rng: this.rng, mapIndex: Math.min(2, a.mapN), cell });
    if (result.attack) a.mapN += result.attacks || 1;
    this.emit({ kind: 'ability', actor: a, ability: ab, targets: tg, cell, result });
    if (ab.fx === 'explosion' && !NO_IGNITE.has(ab.id)) this.field.onBlast?.(cell ?? { gx: a.gx, gy: a.gy }, ab.radius || 1);
    if (ab.fx === 'shot') this.noise(a, 9);
    else if (ab.fx === 'explosion') this.noise(a, 10);
    this.logAll(result.log);
    if (ab.fx === 'shot' && ab.target === 'enemy' && tg[0]) this.strayShot(a, tg[0], this.weaponOf(a), !!result.d20 && result.d20.degree <= 1);
    this.syncAll();
    this.checkEnd();
    return { ok: true, result, path };
  }

  // ---------- przedmioty
  consumables(a: Actor): ItemInstance[] {
    return a.ch.inventory.filter((it) => itemDef(it.id)?.type === 'consumable' && it.qty > 0);
  }
  /** Parametry przedmiotu jednorazowego (null gdy to nie konsumabelka). */
  consumableOf(inst: ItemInstance): ConsumableStats | null {
    const def = itemDef(inst.id);
    return def && def.type === 'consumable' ? def.consumable : null;
  }

  /** Używa przedmiotu: obszar -> `cell`, wróg/sojusznik -> `target`, na siebie -> nic. */
  useItem(a: Actor, inst: ItemInstance, target?: Actor | null, cell?: GridPos): ActionOutcome {
    const c = this.consumableOf(inst);
    if (!c) return fail('Tego nie da się użyć.');
    if (this.exploring && !exploreItemOk(c)) return fail('Tego można użyć tylko w walce.');
    const err = this.canAct(a, c.actions);
    if (err) return fail(err);
    let targets: Actor[] = [a];
    if (c.target === 'area') {
      if (!cell || !this.areaCellOk(a, cell, c.range || 6)) return fail('Poza zasięgiem.');
      targets = this.areaTargets(cell, c.radius || 1, a);
    } else if (c.target !== 'self' && target) {
      if (c.target === 'enemy' && target.side === a.side) return fail('Wskaż wroga.');
      if (c.target !== 'enemy' && target.side !== a.side) return fail('Wskaż sojusznika.');
      if (cheb(a, target) > Math.max(1, c.range || 1)) return fail('Za daleko.');
      targets = [target];
    }
    this.spendActions(a, c.actions);
    const result = useConsumable(a.ch, inst, targets.map((x) => x.ch), this.rng);
    this.emit({ kind: 'item', actor: a, item: inst, targets, cell, result });
    if (c.target === 'area' && c.effect === 'damage' && cell && c.dmgType !== 'elec') this.field.onBlast?.(cell, c.radius || 1);
    if (c.effect === 'damage') this.noise(a, 10);
    this.logAll(result.log, 'amber');
    this.syncAll();
    this.checkEnd();
    return { ok: true, result };
  }

  /** Zamiana broni głównej z zapasową (1 akcja). */
  swapWeapon(a: Actor): ActionOutcome {
    const err = this.canAct(a, 1);
    if (err) return fail(err);
    if (!a.ch.equipment.weapon2) return fail('Brak broni zapasowej.');
    this.spendActions(a, 1);
    swapWeapons(a.ch);
    this.log(`${a.ch.name} zmienia broń na: ${normWeapon(getWeapon(a.ch)).name}.`);
    return { ok: true };
  }

  /** Schowaj się (1 akcja) - dostępne dla każdego, także wrogów bez tej zdolności na liście. */
  takeCover(a: Actor): ActionOutcome {
    const err = this.canAct(a, 1);
    if (err) return fail(err);
    this.spendActions(a, 1);
    const result = resolveAbility('take_cover', { user: a.ch, targets: [a.ch], rng: this.rng });
    const ab = abilityDef('take_cover');
    if (ab) this.emit({ kind: 'ability', actor: a, ability: ab, targets: [a], result });
    this.logAll(result.log);
    return { ok: true, result };
  }

  // ---------- hałas i dołączanie wrogów
  /** Strzały i wybuchy stawiają na nogi grupy w promieniu - idą w stronę walki, dołączają, gdy staną w polu widzenia. */
  noise(a: Actor, radius: number): void {
    this.emit({ kind: 'noise', actor: a, radius });
    let woke = false;
    for (const g of this.field.groups) {
      if (g.alerted || !g.actors.some((e) => e.state !== 'dead')) continue;
      if (!g.actors.some((e) => e.state !== 'dead' && cheb(e, a) <= radius)) continue;
      g.alerted = true;
      woke = true;
    }
    if (woke) this.log('Hałas przyciąga uwagę!', 'bad');
    this.engageVisible();
  }

  private rollInit(a: Actor): number {
    const r = rollInitiative(a.ch, this.rng);
    a.init = Math.round(r.total);
    return r.d20;
  }

  /** Czy wróg jest w polu widzenia któregoś z najemników. */
  inSight(e: Actor): boolean {
    if (this.field.inSight) return this.field.inSight(e);
    return this.pcs.some((p) => p.state !== 'dead' && cheb(e, p) <= 9 && this.grid.los(p, e).clear);
  }

  /** Wrogowie dołączają do trwającej walki (inicjatywa na koniec kolejki); ich grupa jest odtąd zaalarmowana. */
  engage(list: readonly Actor[], msg?: string): void {
    const fresh = list.filter((e) => e.side === 'enemy' && !e.engaged && e.state !== 'dead');
    if (!fresh.length) return;
    for (const e of fresh) {
      e.engaged = true;
      if (e.group) e.group.alerted = true;
      e.roam = null;
    }
    if (!this.active) return;
    if (msg) this.log(msg, 'bad');
    for (const e of fresh) {
      this.rollInit(e);
      this.order.push(e);
      this.log(`${e.ch.name} dołącza do walki (inicjatywa ${e.init}).`, 'bad');
    }
    this.emit({ kind: 'join', actors: fresh });
  }

  /** Każdy wróg, który znalazł się w polu widzenia drużyny, włącza się do walki. */
  engageVisible(): void {
    if (!this.active) return;
    const seen = this.enemies.filter((e) => !e.engaged && e.state === 'up' && this.inSight(e));
    if (!seen.length) return;
    this.engage(seen, seen.length === 1 ? `${seen[0].ch.name} wchodzi w pole widzenia!` : 'Kolejni wrogowie w polu widzenia!');
  }

  /** Przesuwa postać poza jej turą (wędrówka / podejście niewidocznych wrogów). */
  relocate(a: Actor, path: GridPos[]): void {
    if (!path.length) return;
    const end = path[path.length - 1];
    a.gx = end.gx;
    a.gy = end.gy;
    this.emit({ kind: 'move', actor: a, path });
  }

  // ---------- przebieg walki
  /**
   * Rozpoczyna walkę z podanymi wrogami (albo dołącza ich do trwającej). Zwraca kolejność inicjatywy.
   * Reszta wrogów dołącza później, gdy wejdzie w pole widzenia (engageVisible).
   * `ambush`: drużyna zaskakuje nieświadomych wrogów - najemnicy działają pierwsi w 1. rundzie,
   * a zaskoczeni są Odsłonięci (-2 KP) do swojej pierwszej tury.
   */
  start(foes: readonly Actor[], opts: { ambush?: boolean } = {}): Actor[] {
    if (this.active) {
      this.engage(foes);
      return this.order;
    }
    this.restUsed.clear();
    const enemies = foes.filter((e) => e.side === 'enemy' && e.state !== 'dead');
    const unaware = new Set(enemies.filter((e) => !e.group?.alerted));
    for (const e of enemies) {
      e.engaged = true;
      e.roam = null;
      if (e.group) e.group.alerted = true;
    }
    this.active = true;
    this.round = 1;
    this.idx = -1;
    this.turn = null;
    this.log('═══ WALKA! ═══', 'bad');
    const parts = this.pcs.filter((p) => p.state !== 'dead').concat(enemies);
    for (const a of parts) {
      const d20 = this.rollInit(a);
      this.log(`Inicjatywa: ${a.ch.name} ${a.init} (k20 ${d20})`);
    }
    const ambush = !!opts.ambush;
    this.order = parts.sort((x, y) => (ambush && x.side !== y.side ? (x.side === 'pc' ? -1 : 1) : 0) || y.init - x.init || (x.side === 'pc' ? -1 : 1));
    if (ambush) {
      for (const e of unaware) {
        if (!e.ch.conditions.off_guard) {
          e.ch.conditions.off_guard = 1;
          e.used._ambushed = true;
        }
      }
      this.log('ZASADZKA! Drużyna atakuje pierwsza — zaskoczeni wrogowie są odsłonięci (-2 KP).', 'amber');
    }
    this.emit({ kind: 'combatStart', order: this.order, boss: enemies.some((e) => e.ch.ai === 'boss'), ambush });
    return this.order;
  }

  /**
   * Przechodzi do następnej postaci, która może działać, i rozpoczyna jej turę.
   * Postacie nieprzytomne / bez akcji są obsługiwane automatycznie. null = walka się skończyła.
   */
  nextTurn(): TurnInfo | null {
    if (this.turn) this.endTurn();
    for (let guard = 0; guard < 1000 && this.active; guard++) {
      this.idx++;
      if (this.idx >= this.order.length) {
        this.idx = 0;
        this.round++;
        this.order = this.order.filter((x) => x.state !== 'dead');
        this.log(`═══ Runda ${this.round} ═══`, 'amber');
        this.emit({ kind: 'round', round: this.round });
        if (!this.order.length) return null;
      }
      const a = this.order[this.idx];
      if (!a || a.state === 'dead' || (a.side === 'enemy' && !a.engaged)) continue;
      const t = this.beginTurn(a);
      if (t) return t;
    }
    return null;
  }

  private beginTurn(a: Actor): TurnInfo | null {
    const t: TurnInfo = { actor: a, actions: 3, full: 3, used: false, delayed: false, switched: false };
    this.turn = t;
    a.mapN = 0;
    if (a.used._ambushed) {
      delete a.used._ambushed;
      delete a.ch.conditions.off_guard;
    }
    this.engageVisible();
    if (!this.active) return null;
    this.log(`— Tura: ${a.ch.name} —`, 'hd');
    const saved = a.savedTurn && a.savedTurn.round === this.round ? a.savedTurn : null;
    a.savedTurn = null;
    const st = saved ? { log: [], actions: saved.actions, events: [] } : startTurn(a.ch, this.rng);
    this.logAll(st.log);
    if (st.events.length) this.emit({ kind: 'rules', actor: a, result: st });
    this.syncAll();
    if (a.state === 'dead') {
      this.turn = null;
      this.checkEnd();
      return null;
    }
    if (a.state === 'down') {
      this.log(`${a.ch.name} leży nieprzytomny${!a.ch.conditions.dying ? ' (stabilny)' : ''}.`);
      this.checkEnd();
      if (this.active) this.endTurn();
      this.turn = null;
      return null;
    }
    t.actions = Math.max(0, st.actions);
    t.full = t.actions;
    this.emit({ kind: 'turnStart', turn: t, round: this.round });
    if (t.actions <= 0) {
      this.log(`${a.ch.name} traci akcje w tej turze.`, 'bad');
      this.endTurn();
      return null;
    }
    return t;
  }

  /** Kończy turę bieżącej postaci (stany maleją, obsługa Odłóż turę / zamiany najemnika). */
  endTurn(): void {
    const t = this.turn;
    if (!t) return;
    this.turn = null;
    if (t.switched) {
      this.idx--;
      return;
    }
    const a = t.actor;
    const e = endTurnRule(a.ch);
    this.logAll(e.log);
    if (e.events.length) this.emit({ kind: 'rules', actor: a, result: e });
    if (t.delayed) {
      this.order.splice(this.idx, 1);
      this.order.push(a);
      this.idx--;
      this.log(`${a.ch.name} odkłada turę.`);
    }
    this.syncAll();
    this.emit({ kind: 'turnEnd', actor: a });
  }

  /** Odłóż turę: postać działa na końcu rundy. */
  delay(): void {
    if (this.turn) this.turn.delayed = true;
  }

  /**
   * Gracz wybiera innego najemnika w turze drużyny (PF2e Delay): jeśli bieżący nie wydał akcji,
   * wybrany działa teraz, a bieżący zachowuje akcje na zaraz potem; inaczej wybrany działa jako następny.
   * Zwraca komunikat dla gracza lub null przy sukcesie natychmiastowej zamiany (wtedy wywołaj nextTurn()).
   */
  switchTo(b: Actor): { ok: boolean; immediate: boolean; message?: string } {
    const t = this.turn;
    if (!t || !this.active || b.side !== 'pc' || b === t.actor || t.actor.side !== 'pc') return { ok: false, immediate: false };
    if (b.state !== 'up') return { ok: false, immediate: false, message: `${b.ch.name} nie może działać.` };
    const bi = this.order.indexOf(b);
    if (bi < 0 || bi <= this.idx) return { ok: false, immediate: false, message: `${b.ch.name} już działał(a) w tej rundzie.` };
    this.order.splice(bi, 1);
    if (t.actions >= t.full && !t.used) {
      t.actor.savedTurn = { actions: t.actions, round: this.round };
      this.order.splice(this.idx, 0, b);
      t.switched = true;
      this.log(`${t.actor.ch.name} odkłada akcje — teraz ${b.ch.name}.`);
      return { ok: true, immediate: true };
    }
    this.order.splice(this.idx + 1, 0, b);
    this.log(`${b.ch.name} będzie działać następny.`);
    return { ok: true, immediate: false, message: `${b.ch.name} wykona turę jako następny.` };
  }

  /** Sprawdza koniec walki: porażka drużyny albo brak wrogów w walce (śmierć celu nie przerywa walki z eskortą). */
  checkEnd(): CombatEnd | null {
    if (!this.active) return null;
    if (this.pcs.every((p) => p.state !== 'up')) return this.finish('defeat');
    if (!this.enemies.some((e) => e.engaged && e.state !== 'dead')) {
      for (const a of this.field.actors) {
        a.mapN = 0;
        if (a.side === 'pc') endEncounter(a.ch);
      }
      this.log('Walka zakończona.', 'good');
      return this.finish('cleared');
    }
    return null;
  }

  private finish(outcome: CombatEnd): CombatEnd {
    this.active = false;
    for (const a of this.field.actors) {
      a.engaged = false;
      if (!a.used._ambushed) continue;
      delete a.used._ambushed;
      delete a.ch.conditions.off_guard;
    }
    this.turn = null;
    this.emit({ kind: 'end', outcome });
    return outcome;
  }
}
