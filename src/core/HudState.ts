// Model HUD-u: jedyne źródło prawdy dla UIScene (paski PW, Punkty Akcji, ekwipunek, dziennik walki).
// Port danych z Oldgame/src/mission/hud.js - bez DOM. WorldScene zmienia stan i woła notify(),
// UIScene subskrybuje on() i rysuje; polecenia gracza z HUD-u wracają przez command().
// Zero zależności od Phasera / DOM.
import { DEGREE_NAMES, DMG_ADJ } from './data/rules.ts';
import type { AbilityId, ConditionId, ItemDef } from './data/types.ts';
import { usesLeft } from './rules/abilities.ts';
import { fmtMod } from './rules/dice.ts';
import { abilityDef, classDef, conditionDef, itemDef } from './rules/lookup.ts';
import { getStat } from './rules/stats.ts';
import type { Character, EquipSlot, ItemInstance } from './rules/types.ts';
import { MAX_ACTION_POINTS } from './TurnState.ts';
import { TurnPhase } from './TurnManager.ts';

export type LogTone = 'dim' | 'good' | 'bad' | 'amber' | 'hd';

export interface LogEntry {
  id: number;
  text: string;
  tone: LogTone;
  round: number;
}

/** Co się zmieniło - UIScene przerysowuje tylko potrzebny panel. */
export type HudChange =
  | 'stats' | 'turn' | 'log' | 'inventory' | 'hover' | 'banner'
  | 'objectives' | 'actions' | 'initiative' | 'roll' | 'damage' | 'prompt' | 'settings' | 'help';

/** Polecenia z HUD-u do warstwy gry. */
export type HudCommand =
  | { kind: 'endTurn' }
  | { kind: 'useItem'; uid: string }
  | { kind: 'swapWeapons' }
  /** Klik na kartę najemnika: wybór lidera (eksploracja) / zamiana kolejności (walka). */
  | { kind: 'selectMember'; index: number }
  /** Przycisk paska akcji walki (id z HudState.actions). */
  | { kind: 'action'; id: string }
  /** Esc: anuluj tryb celowania / podmenu. */
  | { kind: 'cancel' }
  | { kind: 'retreat' }
  /** Wyjście z gry do ekranu tytułowego (misja przepada). */
  | { kind: 'quit' }
  | { kind: 'save' }
  | { kind: 'load' }
  | { kind: 'toggleGroup' }
  | { kind: 'cycleSpeed' }
  /** Mapa − / Mapa + (przybliżenie kamery; f = mnożnik). */
  | { kind: 'zoom'; f: number }
  /** Tab: następny najemnik (eksploracja) / wycentruj na aktywnym (walka). */
  | { kind: 'cycleMember' };

/** Wiersz panelu celów zlecenia (port H.objective). */
export interface ObjectiveRow {
  text: string;
  done: boolean;
  /** "Idź do ewakuacji" - strzałka zamiast pola wyboru. */
  go?: boolean;
  dim?: boolean;
}

/** Przycisk paska akcji (port H.abBtn). */
export interface ActionButton {
  id: string;
  label: string;
  /** Koszt w akcjach; 'r' = reakcja; null = bez kosztu. */
  cost: number | 'r' | null;
  enabled: boolean;
  /** Wybrany tryb celowania. */
  active?: boolean;
  tip?: string;
}

/** Pozycja paska inicjatywy. */
export interface InitEntry {
  ch: Character;
  side: 'pc' | 'enemy';
  init: number;
  current: boolean;
  /** Już działał w tej rundzie. */
  done: boolean;
  down: boolean;
}

/** Rzut obrażeń do pokazania: kości k4..k12 (PF2e, bez k100) + tekst wyniku. */
export interface DamageShow {
  id: number;
  label: string;
  dice: { sides: number; value: number }[];
  /** Kości dodane po mnożeniu (deadly / fatal) - pokazane za resztą. */
  post: { sides: number; value: number }[];
  /** Gotowy tekst wyniku, np. "(4+2+3) ×2 +5 = 23". */
  text: string;
  mine: boolean;
  /** Rzut leczenia (inny kolor tabliczki). */
  heal?: boolean;
  duration: number;
}

/** Rzut k20 do pokazania (port G.showD20Roll). */
export interface D20Roll {
  id: number;
  label: string;
  d20: number;
  mod: number;
  total: number;
  dc: number;
  /** 0..3 (krytyczna porażka .. krytyczny sukces). */
  degree: number;
  /** Rzut drużyny gracza (kolory sukcesu odwrotne dla wrogów). */
  mine: boolean;
  /** Czas pokazu w ms. */
  duration: number;
}

export interface PromptOption {
  label: string;
  value: string | null;
  primary?: boolean;
  danger?: boolean;
}

/** Pytanie do gracza (okno z przyciskami, port UI.modal). Pierwsza opcja = Esc / klik w tło. */
export interface Prompt {
  id: number;
  title: string;
  body: string;
  options: PromptOption[];
  w?: number;
  /** Rozmowa: portrety rozmówców po bokach treści (lewy = najemnik, prawy = np. nomad), z podpisem. */
  speakers?: { left?: PromptSpeaker; right?: PromptSpeaker };
}
/** Rozmówca w oknie pytania: postać (portret jak na kartach drużyny) i podpis pod portretem. */
export interface PromptSpeaker {
  ch: Pick<Character, 'id' | 'name' | 'classId' | 'ancestry' | 'look' | 'recruitId' | 'templateId'>;
  caption?: string;
}

export interface Banner {
  text: string;
  sub: string;
  tone: LogTone;
}

const MAX_LOG = 300;

export class HudState {
  /** Drużyna gracza. */
  party: Character[] = [];
  /** Indeks aktywnej postaci w `party` (lider w eksploracji, postać w turze w walce). */
  activeIndex = 0;
  /** Wrogowie widoczni dla drużyny (pasek inicjatywy). */
  foes: Character[] = [];
  ap = MAX_ACTION_POINTS;
  maxAp = MAX_ACTION_POINTS;
  /** Ataki wykonane w tej turze (kara PWA). */
  attacksMade = 0;
  phase: TurnPhase = TurnPhase.PLAYER_TURN;
  round = 1;
  /** Postać gracza jest w ruchu / animacji - przyciski zablokowane. */
  busy = false;
  inventoryOpen = false;
  /** Opis pola/wroga pod kursorem (np. szansa trafienia). */
  hover: string | null = null;
  banner: Banner | null = null;
  readonly log: LogEntry[] = [];
  /** Tytuł zlecenia + cele (panel celów). */
  objectiveTitle = '';
  objectives: ObjectiveRow[] = [];
  /** Zlecenie zaliczone: przycisk "Odwrót" staje się "Powrotem" (wyjście z nagrodą). */
  contractDone = false;
  /** Pasek akcji walki (pusty poza turą najemnika). */
  actions: ActionButton[] = [];
  actionsHead: string | null = null;
  /** Kolejność inicjatywy (tylko w walce). */
  initiative: InitEntry[] = [];
  roll: D20Roll | null = null;
  damage: DamageShow | null = null;
  prompt: Prompt | null = null;
  /** Tempo animacji x1 / x2 / x4 (x4 = bez kości). */
  speed = 1;
  /** Ruch w eksploracji: cała drużyna / tylko wybrany. */
  groupMove = true;
  helpOpen = false;

  private nextRollId = 1;
  private nextPromptId = 1;
  private promptResolve: ((v: string | null) => void) | null = null;

  private nextLogId = 1;
  private listeners = new Set<(c: HudChange) => void>();
  private commandListeners = new Set<(c: HudCommand) => void>();

  get active(): Character | null {
    return this.party[this.activeIndex] ?? this.party[0] ?? null;
  }

  get inCombat(): boolean {
    return this.phase !== TurnPhase.EXPLORATION;
  }

  /** Gracz może wydawać polecenia (eksploracja albo tura najemnika, nie w ruchu, żyje). */
  get canAct(): boolean {
    const a = this.active;
    return this.phase !== TurnPhase.ENEMY_TURN && !this.busy && !!a && a.hp > 0;
  }

  // ---------- subskrypcje
  on(fn: (c: HudChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify(change: HudChange): void {
    for (const fn of this.listeners) fn(change);
  }
  onCommand(fn: (c: HudCommand) => void): () => void {
    this.commandListeners.add(fn);
    return () => this.commandListeners.delete(fn);
  }
  command(c: HudCommand): void {
    for (const fn of this.commandListeners) fn(c);
  }

  // ---------- mutatory z powiadomieniem
  setAp(ap: number): void {
    this.ap = Math.max(0, ap);
    this.notify('stats');
  }
  setActive(ch: Character | null): void {
    const i = ch ? this.party.indexOf(ch) : -1;
    if (i < 0 || i === this.activeIndex) return;
    this.activeIndex = i;
    this.notify('stats');
    this.notify('turn');
    if (this.inventoryOpen) this.notify('inventory');
  }
  setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    this.notify('turn');
  }
  setPhase(phase: TurnPhase, round: number): void {
    this.phase = phase;
    this.round = round;
    this.notify('turn');
  }
  setHover(text: string | null): void {
    if (this.hover === text) return;
    this.hover = text;
    this.notify('hover');
  }
  setFoes(foes: Character[]): void {
    const same = foes.length === this.foes.length && foes.every((f, i) => f === this.foes[i]);
    if (same) return;
    this.foes = foes;
    this.notify('stats');
  }
  toggleInventory(open = !this.inventoryOpen): void {
    this.inventoryOpen = open;
    this.notify('inventory');
  }
  showBanner(text: string, tone: LogTone = 'amber', sub = ''): void {
    this.banner = { text, sub, tone };
    this.notify('banner');
  }

  setObjectives(title: string, rows: ObjectiveRow[]): void {
    this.objectiveTitle = title;
    this.objectives = rows;
    this.notify('objectives');
  }
  setActions(head: string | null, list: ActionButton[]): void {
    this.actionsHead = head;
    this.actions = list;
    this.notify('actions');
  }
  setInitiative(list: InitEntry[]): void {
    this.initiative = list;
    this.notify('initiative');
  }
  /** Pokazuje rzut k20; zwraca czas pokazu w ms (0 = pominięty przy szybkim tempie). */
  showRoll(r: Omit<D20Roll, 'id' | 'duration'>): number {
    if (this.speed >= 4 || (!r.mine && this.speed >= 2)) return 0;
    const duration = Math.round(1100 / this.speed);
    this.roll = { ...r, id: this.nextRollId++, duration };
    this.notify('roll');
    return duration;
  }
  /** Pokazuje rzut obrażeń; zwraca czas pokazu w ms (0 = pominięty - te same zasady tempa co k20). */
  showDamage(r: Omit<DamageShow, 'id' | 'duration'>): number {
    if (this.speed >= 4 || (!r.mine && this.speed >= 2) || r.dice.length + r.post.length === 0) return 0;
    const duration = Math.round(950 / this.speed);
    this.damage = { ...r, id: this.nextRollId++, duration };
    this.notify('damage');
    return duration;
  }
  /** Zadaje pytanie (UIScene pokazuje okno) i czeka na odpowiedź. */
  ask(p: Omit<Prompt, 'id'>): Promise<string | null> {
    this.answer(p.options[0]?.value ?? null); // poprzednie pytanie (jeśli wisi) dostaje odpowiedź domyślną
    return new Promise((resolve) => {
      this.prompt = { ...p, id: this.nextPromptId++ };
      this.promptResolve = resolve;
      this.setHover(null);
      this.notify('prompt');
    });
  }
  answer(v: string | null): void {
    const r = this.promptResolve;
    if (!r) return;
    this.promptResolve = null;
    this.prompt = null;
    this.notify('prompt');
    r(v);
  }
  setSpeed(s: number): void {
    this.speed = s;
    this.notify('settings');
  }
  setGroupMove(g: boolean): void {
    this.groupMove = g;
    this.notify('settings');
  }
  toggleHelp(open = !this.helpOpen): void {
    this.helpOpen = open;
    this.notify('help');
  }

  // ---------- dziennik
  pushLog(text: string, tone: LogTone = 'dim'): void {
    this.log.push({ id: this.nextLogId++, text, tone, round: this.round });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.notify('log');
  }
  pushLines(lines: readonly string[], tone: LogTone = 'dim'): void {
    for (const l of lines) this.pushLog(l, tone);
  }
  clearLog(): void {
    this.log.length = 0;
    this.notify('log');
  }
}

// ====================================================================== widoki danych dla HUD-u

/** Kolor paska PW (jak hpCol w starym HUD): drużyna zielony->bursztyn->czerwony, wrogowie odwrotnie. */
export function hpTone(ch: Character): 'good' | 'amber' | 'bad' {
  const p = hpRatio(ch);
  if (ch.isEnemy) return p > 0.5 ? 'bad' : p > 0.25 ? 'amber' : 'good';
  return p > 0.6 ? 'good' : p > 0.3 ? 'amber' : 'bad';
}

export const hpRatio = (ch: Character): number => Math.max(0, Math.min(1, ch.maxHp > 0 ? ch.hp / ch.maxHp : 0));

/** Stan postaci słownie (pusty, gdy walczy). */
export function stateLabel(ch: Character): string {
  if (ch.conditions.dead) return 'POLEGŁ';
  if (ch.hp <= 0) return ch.conditions.dying ? `UMIERA ${ch.conditions.dying}` : 'NIEPRZYT.';
  return '';
}

/** Polska odmiana: 1 punkt / 2 punkty / 5 punktów. */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10, n100 = n % 100;
  if (n === 1) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

const BAD_CONDITIONS = new Set<string>([
  'dying', 'bleeding', 'burning', 'poisoned', 'sickened', 'frightened', 'stunned', 'slowed', 'prone', 'off_guard', 'wounded', 'unconscious',
  'clumsy', 'enfeebled', 'distracted',
]);

export interface ConditionChip {
  id: ConditionId;
  /** Trzyliterowy skrót + wartość, np. "PRZ2". */
  label: string;
  name: string;
  desc: string;
  value: number;
  bad: boolean;
}

/** Stany postaci jako "chipy" (port H.condList). */
export function conditionChips(ch: Character): ConditionChip[] {
  const out: ConditionChip[] = [];
  for (const [id, v] of Object.entries(ch.conditions) as [ConditionId, number | string | undefined][]) {
    if (!v || id === 'dead') continue;
    const def = conditionDef(id);
    if (!def || def.hidden) continue;
    const value = typeof v === 'number' ? v : 1;
    out.push({ id, label: def.name.slice(0, 3).toUpperCase() + (value > 1 ? value : ''), name: def.name, desc: def.desc, value, bad: BAD_CONDITIONS.has(id) });
  }
  return out;
}

/** Linia statystyk przedmiotu (port itemStat). `short` = wersja do wąskiego panelu. */
export function itemStatLine(def: ItemDef | undefined, short = false): string {
  if (!def) return '';
  switch (def.type) {
    case 'weapon': {
      const w = def.weapon;
      if (short) return `${w.damage} ${w.range ? 'z' + w.range : 'wręcz'}`;
      return `${w.damage} ${DMG_ADJ[w.dmgType] ?? ''}`.trim() + (w.range ? ` · zasięg ${w.range}` : ' · wręcz');
    }
    case 'armor':
      return `KP +${def.armor.ac}`;
    case 'shield':
      return `tarcza +${def.shield.ac}`;
    case 'consumable':
      return def.consumable.amount ? def.consumable.amount : '';
    default:
      return '';
  }
}

export const EQUIP_SLOTS: readonly { slot: EquipSlot; label: string }[] = [
  { slot: 'weapon', label: 'Broń główna' },
  { slot: 'weapon2', label: 'Broń zapasowa' },
  { slot: 'armor', label: 'Pancerz' },
  { slot: 'shield', label: 'Tarcza' },
];

export interface InventoryRow {
  inst: ItemInstance | null;
  /** Etykieta slotu (wyposażenie) albo pusty napis (plecak). */
  slot: string;
  name: string;
  desc: string;
  stat: string;
  /** Krótka wersja statystyk (wąski panel). */
  statShort: string;
  qty: number;
  /** Można użyć z plecaka (przedmiot jednorazowy). */
  usable: boolean;
}

/** Wyposażenie (sloty). Puste sloty zapasowe są pomijane, jak w starym HUD. */
export function equipmentRows(ch: Character): InventoryRow[] {
  const rows: InventoryRow[] = [];
  for (const { slot, label } of EQUIP_SLOTS) {
    const inst = ch.equipment[slot];
    const def = itemDef(inst?.id);
    if (!def && (slot === 'weapon2' || slot === 'shield')) continue;
    rows.push({ inst, slot: label, name: def?.name ?? '— brak —', desc: def?.desc ?? '', stat: itemStatLine(def), statShort: itemStatLine(def, true), qty: inst?.qty ?? 0, usable: false });
  }
  return rows;
}

/** Plecak. */
export function backpackRows(ch: Character): InventoryRow[] {
  return ch.inventory.flatMap((inst) => {
    const def = itemDef(inst.id);
    if (!def) return [];
    return [{ inst, slot: '', name: def.name, desc: def.desc, stat: itemStatLine(def), statShort: itemStatLine(def, true), qty: inst.qty, usable: def.type === 'consumable' }];
  });
}

/** Podstawowe statystyki do karty postaci (port siatki .st). */
export function statPairs(ch: Character): [string, string][] {
  return [
    ['PW', `${Math.max(0, ch.hp)}/${ch.maxHp}`],
    ['KP', String(getStat(ch, 'ac'))],
    ['Ruch', `${getStat(ch, 'speed')} pól`],
    ['Perc.', `+${getStat(ch, 'perception')}`],
    ['Refl.', `+${getStat(ch, 'reflex')}`],
    ['Wola', `+${getStat(ch, 'will')}`],
  ];
}

/** Opis rzutu k20: "k20 14+7 = 21 vs KT 18". */
export function rollLine(r: Pick<D20Roll, 'd20' | 'mod' | 'total' | 'dc'>): string {
  return `k20 ${r.d20}${fmtMod(r.mod)} = ${r.total} vs ${r.dc}`;
}
export const degreeName = (d: number): string => DEGREE_NAMES[Math.max(0, Math.min(3, d))] ?? '';

export interface AbilityRow {
  id: string;
  name: string;
  desc: string;
  /** Koszt w akcjach (null = reakcja). */
  cost: number | null;
  /** Pozostałe użycia (null = bez limitu). */
  uses: number | null;
  off: boolean;
}

/** Akcje postaci do karty (port sekcji "Dostępne akcje" z H.sheetDraw). */
export function abilityRows(ch: Character, actionsLeft = 3): AbilityRow[] {
  const sp = getStat(ch, 'speed');
  const rows: AbilityRow[] = [
    { id: 'stride', name: 'Marsz', desc: `Ruch do ${sp} pól za 1 akcję.`, cost: 1, uses: null, off: actionsLeft < 1 },
    { id: 'step', name: 'Krok', desc: 'Jedno pole obok.', cost: 1, uses: null, off: actionsLeft < 1 },
  ];
  for (const id of ch.abilities) {
    const ab = abilityDef(id);
    if (!ab || id === 'strike' || id === 'stand' || (id === 'raise_shield' && !ch.equipment.shield)) continue;
    const cost = ab.actions === 'reaction' ? null : ab.actions;
    const left = ab.uses ? usesLeft(ch, id as AbilityId) : null;
    rows.push({ id, name: ab.name, desc: ab.desc, cost, uses: left, off: (cost !== null && cost > actionsLeft) || left === 0 });
  }
  return rows;
}

export function classLabel(ch: Character): string {
  if (ch.isEnemy) return `poz. ${ch.level}`;
  return `${classDef(ch.classId)?.name ?? ch.classId} · poz. ${ch.level}`;
}
