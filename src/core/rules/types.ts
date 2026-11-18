// Typy stanu gry (postacie, przedmioty, wyniki akcji). Postać to czysty JSON - da się ją zapisać.
import type {
  AbilityId, AncestryId, Attributes, CharacterLook, ClassId, ConditionId, DamageMods, DamageType, DefenseCategory,
  DiceExpr, EnemyAI, EnemyAttack, EnemyId, EnemyLook, EnemyTrait, Faction, ItemId, SkillId, WeaponCategory, WeaponStats,
} from '../data/types.ts';
import type { CheckResult, DamageRoll, Degree, Rng } from './dice.ts';

/** Pozycja na siatce 2D (Three.js (x, z) -> (gx, gy)). */
export interface GridPos {
  gx: number;
  gy: number;
}

export interface ItemInstance {
  uid: string;
  id: ItemId;
  qty: number;
}

/** Wartość stanu: liczba (przerażony 2) albo wyrażenie kości dla obrażeń ciągłych (krwawienie '1d6'). */
export type ConditionValue = number | DiceExpr;
export type Conditions = Partial<Record<ConditionId, ConditionValue>>;

export interface Equipment {
  weapon: ItemInstance | null;
  weapon2: ItemInstance | null;
  armor: ItemInstance | null;
  shield: ItemInstance | null;
}
export type EquipSlot = keyof Equipment;

/** Rangi biegłości postaci (0..4). Mutowalne - rosną przy awansie. */
export interface CharProficiencies {
  perception: number;
  fortitude: number;
  reflex: number;
  will: number;
  classDC: number;
  skills: Partial<Record<SkillId, number>>;
  attacks: Partial<Record<WeaponCategory, number>>;
  defense: Partial<Record<DefenseCategory, number>>;
}

/** Gotowe statystyki wroga (zamiast biegłości). */
export interface EnemyBase {
  ac: number;
  fortitude: number;
  reflex: number;
  will: number;
  perception: number;
  classDC: number;
  skills: Partial<Record<SkillId, number>>;
}

export interface Character {
  id: string;
  name: string;
  /** Biernik do dziennika walki ("trafia Szabrownika-zbira"). */
  nameAcc?: string;
  ancestry: AncestryId | '';
  classId: ClassId | '';
  recruitId?: string;
  level: number;
  xp: number;
  isEnemy: boolean;
  /** Szablon wroga (EnemyId) albo nomada spotkanego na misji (tactical/nomads.ts, np. 'nomad_trader'). */
  templateId?: EnemyId | `nomad_${string}`;
  attrs: Attributes;
  maxHp: number;
  hp: number;
  tempHp: number;
  prof: CharProficiencies;
  equipment: Equipment;
  inventory: ItemInstance[];
  abilities: AbilityId[];
  /** Pozostałe użycia zdolności z limitem. */
  uses: Partial<Record<AbilityId, number>>;
  conditions: Conditions;
  /** Prędkość w polach na akcję Marszu. 0 = nieruchomy. */
  speed: number;
  look: Partial<CharacterLook> | Partial<EnemyLook>;
  bio: string;
  // --- tylko wrogowie
  base?: EnemyBase;
  attacks?: EnemyAttack[];
  faction?: Faction;
  ai?: EnemyAI;
  traits?: EnemyTrait[];
  resist?: DamageMods;
  weak?: DamageMods;
  immune?: string[];
  // --- stan przejściowy misji
  /** Wróg już okradziony (Kradzież). */
  stolen?: number;
  /** Złom ukradziony w trakcie misji (doliczany w podsumowaniu). */
  stolenScrap?: number;
  /** Kolor imienia wybrany przez gracza ('#rrggbb'). */
  nameColor?: string;
}

/** Atak ad hoc (np. żądło skorpiona) - kształt jak atak wroga. */
export interface AttackLike {
  readonly name: string;
  readonly bonus: number;
  readonly damage: DiceExpr;
  readonly dmgType: DamageType;
  readonly range?: number;
  readonly traits: readonly string[];
  readonly sfx?: string;
}

/** Broń sprowadzona do wspólnej postaci (przedmiot gracza albo atak wroga). */
export interface NormWeapon {
  readonly normalized: true;
  readonly id: string | null;
  readonly name: string;
  readonly dmg: DiceExpr;
  readonly type: DamageType;
  /** Zasięg w polach (0 = wręcz). */
  readonly range: number;
  readonly category?: WeaponCategory;
  readonly traits: readonly string[];
  readonly sfx: string;
  readonly potency: number;
  readonly hands: number;
  /** Stała premia do trafienia (ataki wrogów). */
  readonly flat?: number;
}

// ---------- wyniki akcji
export type CombatEvent =
  | { type: 'damage'; target: Character; amount: number; dmgType: DamageType; degree?: Degree; persistent?: ConditionId }
  | { type: 'heal'; target: Character; amount: number; temp?: boolean }
  | { type: 'miss'; target: Character; degree: Degree }
  | { type: 'condition'; target: Character; condition: ConditionId | 'stable'; value?: ConditionValue }
  | { type: 'crit'; target: Character; degree: 3 }
  | { type: 'death'; target: Character }
  | { type: 'down'; target: Character }
  | { type: 'recovery'; target: Character; degree: Degree }
  | { type: 'steal'; target: Character; item: ItemInstance }
  | { type: 'scrap'; amount: number };

export interface ActionResult {
  log: string[];
  events: CombatEvent[];
  /** true -> akcja liczy się do kary za wielokrotny atak (PWA). */
  attack: boolean;
  /** Ile ataków doliczyć do PWA (np. Podwójny cios = 2). */
  attacks?: number;
  /** Główny rzut k20 (do animacji kości). */
  d20?: CheckResult;
  /** Główny rzut obrażeń (do animacji kości obrażeń). */
  dmg?: DamageRoll;
  /** Główny rzut leczenia (do animacji kości). */
  heal?: DamageRoll;
  hit?: boolean;
  dealt?: number;
  weapon?: NormWeapon;
  consumed?: boolean;
}

export const emptyResult = (): ActionResult => ({ log: [], events: [], attack: false });

export interface AbilityContext {
  user: Character;
  targets: Character[];
  rng?: Rng;
  /** Liczba ataków wykonanych już w tej turze (0, 1, 2+). */
  mapIndex?: number;
  weapon?: WeaponRef;
  rangeIncrements?: number;
  bonus?: number;
  damageBonus?: number;
  /** Pole docelowe dla zdolności obszarowych. */
  cell?: GridPos;
}

/** Wszystko, co można podać jako broń. */
export type WeaponRef = ItemId | ItemInstance | NormWeapon | AttackLike | WeaponItemLike;

/** Przedmiot-broń (także Pięść / UNARMED). */
export interface WeaponItemLike {
  readonly id: string;
  readonly name: string;
  readonly weapon: WeaponStats;
}
