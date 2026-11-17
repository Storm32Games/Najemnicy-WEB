// Stan kampanii (zapisywany w całości jako JSON) i typ zlecenia.
// Migracja z Oldgame/src/core/game.js (freshState) i docs/DESIGN.md (Contract).
import type { EnemyId, ItemId } from '../data/types.ts';
import type { Character, ItemInstance } from '../rules/types.ts';
import type { Biome } from '../tactical/mapgen.ts';
import type { ObjectiveType } from '../tactical/mission.ts';

export type FactionId = 'survivors' | 'nomads';
export type Mood = 'day' | 'dusk' | 'night' | 'toxic' | 'storm';
export type Reputation = Record<FactionId, number>;

export interface ContractReward {
  scrap: number;
  xp: number;
  items: ItemId[];
  rep: Partial<Reputation>;
  /** Dni zapasów żywności dla Przystani (zlecenie zaopatrzenia). */
  food?: number;
}

export interface Contract {
  id: string;
  title: string;
  giver: string;
  faction: FactionId;
  desc: string;
  type: ObjectiveType;
  level: number;
  biome: Biome;
  mood: Mood;
  enemies: EnemyId[];
  objective: { type: ObjectiveType; itemId?: ItemId | null; count?: number };
  reward: ContractReward;
  story?: boolean;
  travelDays: number;
}

export interface CampaignState {
  version: 1;
  /** Do 4 najemników. */
  party: Character[];
  /** Waluta: Złom. */
  scrap: number;
  /** Zapasy żywności Przystani w dniach (campaign/food.ts). */
  food: number;
  day: number;
  rep: Reputation;
  /** Wspólna skrytka drużyny. */
  stash: ItemInstance[];
  /** Bieżąca tablica zleceń. */
  contracts: Contract[];
  /** Id ukończonych zleceń. */
  completed: string[];
  /** Postęp wątku głównego (0..3). */
  story: number;
  flags: { fallen?: string[]; fallenIds?: string[]; victory?: boolean; [k: string]: unknown };
  log: { day: number; text: string }[];
  /** Warsztat Przystani (campaign/tech.ts). Stare zapisy: brak pola - techOf() uzupełnia. */
  tech: TechState;
}

/** Postęp technologiczny: opracowane schematy, odsłonięte receptury, poziom warsztatu, magazyn części. */
export interface TechState {
  known: string[];
  hinted: string[];
  level: number;
  /** Części oddane do warsztatu (nie do sprzedania, nie do plecaka). */
  parts: ItemInstance[];
}

export const freshTech = (): TechState => ({ known: [], hinted: [], level: 0, parts: [] });

export function freshState(): CampaignState {
  return { version: 1, party: [], scrap: 120, food: 8, day: 1, rep: { nomads: 0, survivors: 0 }, stash: [], contracts: [], completed: [], story: 0, flags: {}, log: [], tech: freshTech() };
}

/** Średni poziom drużyny w kampanii (min. 1). */
export function campaignPartyLevel(state: Pick<CampaignState, 'party'> | null | undefined): number {
  const p = state?.party ?? [];
  return p.length ? Math.max(1, Math.round(p.reduce((s, c) => s + (c.level || 1), 0) / p.length)) : 1;
}

export const MAX_PARTY = 4;
