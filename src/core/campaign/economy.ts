// Handlarz Nomadów (ceny, dzienny asortyment) i Lecznica (koszt leczenia, odpoczynek).
// Migracja z Oldgame/src/data/shop.js i logiki Oldgame/src/scenes/hub.js.
import { longRest, newItem } from '../rules/character.ts';
import { makeRng } from '../rules/dice.ts';
import { addToStack } from '../rules/equipment.ts';
import { allItems, itemDef } from '../rules/lookup.ts';
import type { Character, ItemInstance } from '../rules/types.ts';
import { refreshBoard } from './contracts.ts';
import { consumeFood, type FoodReport } from './food.ts';
import type { CampaignState } from './state.ts';

/** Rabat u Nomadów: 2% za punkt reputacji (od -20% do 25%). */
export const nomadDiscount = (state: Pick<CampaignState, 'rep'>): number => Math.min(0.25, Math.max(-0.2, (state.rep.nomads || 0) * 0.02));

export function buyPrice(id: string, state: Pick<CampaignState, 'rep'>): number {
  return Math.max(1, Math.round((itemDef(id)?.price ?? 10) * (1 - nomadDiscount(state))));
}
/** Skup: złom 60%, reszta 40% ceny (+1% za punkt reputacji Nomadów, maks. +10%). */
export function sellPrice(id: string, state: Pick<CampaignState, 'rep'>): number {
  const it = itemDef(id);
  const base = it?.type === 'junk' ? 0.6 : 0.4;
  return Math.max(0, Math.floor((it?.price ?? 0) * (base + Math.min(0.1, Math.max(0, (state.rep.nomads || 0) * 0.01)))));
}

/** Asortyment na dany dzień (deterministyczny): 8 konsumabelek/amunicji + 12 sztuk sprzętu do poziomu drużyny + 1. */
export function shopStock(state: Pick<CampaignState, 'day'>, partyLvl = 1): string[] {
  const all = allItems().filter((i) => i.price > 0 && i.type !== 'junk' && i.level <= partyLvl + 1);
  const rng = makeRng((state.day || 1) * 7919 + 13);
  const isCons = (t: string): boolean => t === 'consumable' || t === 'ammo';
  const shuffle = <T>(a: T[]): T[] => a.map((v) => [rng(), v] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  const picked = [...shuffle(all.filter((i) => isCons(i.type))).slice(0, 8), ...shuffle(all.filter((i) => !isCons(i.type))).slice(0, 12)];
  return [...new Set(picked.map((i) => i.id))];
}

export function buy(state: CampaignState, id: string): { ok: boolean; reason?: string; item?: ItemInstance } {
  const def = itemDef(id);
  if (!def) return { ok: false, reason: 'Nieznany przedmiot.' };
  const price = buyPrice(id, state);
  if (state.scrap < price) return { ok: false, reason: 'Za mało Złomu.' };
  state.scrap -= price;
  const item = newItem(def.id);
  addToStack(state.stash, item);
  return { ok: true, item };
}

/** Sprzedaje 1 sztukę z listy `from` (skrytka lub plecak). Zwraca uzyskany Złom (0 = nie do sprzedania). */
export function sell(state: CampaignState, inst: ItemInstance, from: ItemInstance[]): number {
  const price = sellPrice(inst.id, state);
  if (!price) return 0;
  if (inst.qty > 1) inst.qty--;
  else from.splice(from.indexOf(inst), 1);
  state.scrap += price;
  return price;
}

/** Koszt pełnego leczenia w Lecznicy: 1.5 Złomu za PW + 8 za zdjęcie stanów. */
export function healCost(c: Character): number {
  if (c.conditions.dead) return 0;
  const miss = c.maxHp - c.hp;
  const cond = Object.keys(c.conditions).length;
  return miss <= 0 && !cond ? 0 : Math.ceil(miss * 1.5) + (cond ? 8 : 0);
}
export function healAtClinic(state: CampaignState, c: Character): boolean {
  const k = healCost(c);
  if (!k || state.scrap < k) return false;
  state.scrap -= k;
  c.hp = c.maxHp;
  c.conditions = {};
  return true;
}

/** Odpoczynek: długi odpoczynek całej drużyny, następny dzień (Przystań zjada dzień zapasów), odświeżenie tablicy zleceń. */
export function restDay(state: CampaignState): FoodReport {
  for (const c of state.party) longRest(c);
  state.day++;
  const food = consumeFood(state, 1);
  refreshBoard(state, 2);
  return food;
}
