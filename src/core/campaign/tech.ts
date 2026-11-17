// Warsztat Przystani: fanty z misji -> schematy -> stała oferta handlarza i tania produkcja.
// Projekt: docs/ROZWOJ_TECHNOLOGICZNY.md. Receptury: data/recipes.ts. Czysta logika (bez Phasera / DOM).
//
// Części liczą się z magazynu warsztatu (TechState.parts) i ze skrytki drużyny; zużywany jest najpierw magazyn.
// Opracowanie schematu (raz): części + Złom + dni w Przystani (jak odpoczynek: zapasy, tablica zleceń) i test
// Techniki najlepszego technika w drużynie. Krytyczny sukces skraca czas, porażka wydłuża, krytyczna porażka
// niszczy jedną część i schemat nie powstaje. Pierwszy egzemplarz po opracowaniu jest gratis.
import { RECIPES, WORKSHOP_LEVELS, recipeDef, type RecipeDef } from '../data/recipes.ts';
import { check, type CheckResult, type Rng } from '../rules/dice.ts';
import { newItem } from '../rules/character.ts';
import { addToStack } from '../rules/equipment.ts';
import { itemDef } from '../rules/lookup.ts';
import { getStat } from '../rules/stats.ts';
import type { Character, ItemInstance } from '../rules/types.ts';
import { restDay } from './economy.ts';
import { freshTech, type CampaignState, type TechState } from './state.ts';

export type RecipeState = 'unknown' | 'hinted' | 'known';

/** Stan warsztatu; uzupełnia brakujące pola (zapisy sprzed warsztatu). MUTUJE `state`. */
export function techOf(state: CampaignState): TechState {
  const t = (state.tech ??= freshTech());
  t.known ??= [];
  t.hinted ??= [];
  t.level ??= 0;
  t.parts ??= [];
  return t;
}

const qtyIn = (list: readonly ItemInstance[], id: string): number => list.reduce((s, i) => s + (i.id === id ? i.qty || 1 : 0), 0);

/** Ile sztuk części `id` jest dostępnych (magazyn warsztatu + skrytka). */
export function partCount(state: CampaignState, id: string): number {
  return qtyIn(techOf(state).parts, id) + qtyIn(state.stash, id);
}

export function hasParts(state: CampaignState, r: RecipeDef): boolean {
  return r.parts.every((p) => partCount(state, p.id) >= p.qty);
}

/** Zabiera `qty` sztuk z listy; zwraca, ile zabrano. */
function takeFrom(list: ItemInstance[], id: string, qty: number): number {
  let taken = 0;
  for (let i = list.length - 1; i >= 0 && taken < qty; i--) {
    const inst = list[i];
    if (inst.id !== id) continue;
    const n = Math.min(inst.qty || 1, qty - taken);
    taken += n;
    if ((inst.qty || 1) > n) inst.qty = (inst.qty || 1) - n;
    else list.splice(i, 1);
  }
  return taken;
}

/** Zużywa części (najpierw magazyn warsztatu, potem skrytka). Wywoływać po hasParts. */
function consumeParts(state: CampaignState, parts: readonly { id: string; qty: number }[]): void {
  for (const p of parts) {
    const got = takeFrom(techOf(state).parts, p.id, p.qty);
    if (got < p.qty) takeFrom(state.stash, p.id, p.qty - got);
  }
}

/** Oddaje część ze skrytki / plecaka (`from`) do magazynu warsztatu. */
export function storePart(state: CampaignState, inst: ItemInstance, from: ItemInstance[]): boolean {
  if (!partUses(inst.id).length) return false;
  const i = from.indexOf(inst);
  if (i < 0) return false;
  from.splice(i, 1);
  const t = techOf(state);
  const ex = t.parts.find((p) => p.id === inst.id);
  if (ex) ex.qty = (ex.qty || 1) + (inst.qty || 1);
  else t.parts.push({ ...inst, qty: inst.qty || 1 });
  hintFromParts(state);
  return true;
}

/** Receptury, w których część `id` jest potrzebna (podpowiedź przy sprzedaży). */
export function partUses(id: string): RecipeDef[] {
  return RECIPES.filter((r) => r.parts.some((p) => p.id === id));
}

/** Stan receptury: znana / przeczuwana (widać części) / nieznana („???”). */
export function recipeState(state: CampaignState, id: string): RecipeState {
  const t = techOf(state);
  if (t.known.includes(id)) return 'known';
  if (t.hinted.includes(id)) return 'hinted';
  const r = recipeDef(id);
  if (!r) return 'unknown';
  // połowa rodzajów części w zasięgu ręki odsłania recepturę
  const have = r.parts.filter((p) => partCount(state, p.id) > 0).length;
  return have * 2 >= r.parts.length && have > 0 ? 'hinted' : 'unknown';
}

/** Czy przy nieznanej recepturze pokazać podpowiedź (masz choć jedną część). */
export function showHint(state: CampaignState, r: RecipeDef): boolean {
  return r.parts.some((p) => partCount(state, p.id) > 0);
}

/** Utrwala odsłonięte receptury (zostają przeczuwane, nawet gdy części się sprzeda). */
export function hintFromParts(state: CampaignState): void {
  const t = techOf(state);
  for (const r of RECIPES) if (!t.known.includes(r.id) && !t.hinted.includes(r.id) && recipeState(state, r.id) === 'hinted') t.hinted.push(r.id);
}

/** Najlepszy technik (modyfikator Techniki) wśród żywych członków drużyny. */
export function bestTechnician(state: CampaignState): { ch: Character; mod: number } | null {
  let best: { ch: Character; mod: number } | null = null;
  for (const ch of state.party) {
    if (ch.conditions?.dead || ch.hp <= 0) continue;
    const mod = getStat(ch, 'crafting');
    if (!best || mod > best.mod) best = { ch, mod };
  }
  return best;
}

/** ST testu Techniki przy opracowaniu: 15 + 3 za poziom receptury. */
export const researchDC = (r: RecipeDef): number => 15 + r.level * 3;

/** Cena produkcji ze schematu: ~30% ceny wyniku (min. 3 Złomu). */
export function craftCost(r: RecipeDef): number {
  return Math.max(3, Math.round((itemDef(r.out.id)?.price ?? 10) * r.out.qty * 0.3));
}

/** Dlaczego nie da się opracować (null = można). */
export function researchBlock(state: CampaignState, id: string): string | null {
  const r = recipeDef(id);
  if (!r) return 'Nieznana receptura.';
  const t = techOf(state);
  if (t.known.includes(id)) return 'Schemat już opracowany.';
  if (r.level > t.level) return `Wymaga poziomu warsztatu: ${WORKSHOP_LEVELS[r.level]?.name ?? r.level}.`;
  if (!hasParts(state, r)) return 'Brakuje części.';
  if (state.scrap < r.scrap) return 'Za mało Złomu.';
  if (!bestTechnician(state)) return 'Nikt w drużynie nie może pracować w warsztacie.';
  return null;
}

export interface ResearchResult {
  ok: boolean;
  reason?: string;
  /** Schemat opracowany. */
  learned?: boolean;
  days?: number;
  roll?: CheckResult;
  by?: string;
  /** Część zniszczona przy krytycznej porażce. */
  lost?: string;
  text?: string;
}

/**
 * Opracowanie schematu. Sukces: `days` dni, krytyczny: o 1 mniej (min. 1), porażka: o 1 więcej (schemat i tak
 * powstaje), krytyczna porażka: 1 dzień, jedna część przepada, Złom wydany, schematu brak. MUTUJE `state`.
 */
export function research(state: CampaignState, id: string, rng: Rng = Math.random): ResearchResult {
  const block = researchBlock(state, id);
  if (block) return { ok: false, reason: block };
  const r = recipeDef(id)!;
  const t = techOf(state);
  const tech = bestTechnician(state)!;
  const roll = check(tech.mod, researchDC(r), rng);
  state.scrap -= r.scrap;
  const out = itemDef(r.out.id)?.name ?? r.out.id;
  let res: ResearchResult;
  if (roll.degree === 0) {
    const p = r.parts[Math.floor(rng() * r.parts.length)];
    consumeParts(state, [{ id: p.id, qty: 1 }]);
    const lost = itemDef(p.id)?.name ?? p.id;
    res = { ok: true, learned: false, days: 1, roll, by: tech.ch.name, lost, text: `${tech.ch.name} psuje próbę: ${lost} do wyrzucenia. Schemat „${out}” nie powstał.` };
  } else {
    consumeParts(state, r.parts);
    const days = roll.degree === 3 ? Math.max(1, r.days - 1) : roll.degree === 1 ? r.days + 1 : r.days;
    t.known.push(id);
    t.hinted = t.hinted.filter((h) => h !== id);
    addToStack(state.stash, { ...newItem(r.out.id), qty: r.out.qty });
    res = { ok: true, learned: true, days, roll, by: tech.ch.name, text: `${tech.ch.name} opracowuje schemat: ${out} (${days} dn.). Handlarz będzie go mieć na stanie.` };
  }
  // dni w Przystani: zapasy, odpoczynek, tablica zleceń
  for (let d = 0; d < res.days!; d++) restDay(state);
  state.log.push({ day: state.day, text: res.text! });
  return res;
}

/** Produkcja ze schematu: części + Złom, przedmiot od razu w skrytce (bez dni). MUTUJE `state`. */
export function craft(state: CampaignState, id: string): { ok: boolean; reason?: string; item?: ItemInstance } {
  const r = recipeDef(id);
  if (!r) return { ok: false, reason: 'Nieznana receptura.' };
  if (!techOf(state).known.includes(id)) return { ok: false, reason: 'Najpierw opracuj schemat.' };
  if (!hasParts(state, r)) return { ok: false, reason: 'Brakuje części.' };
  const cost = craftCost(r);
  if (state.scrap < cost) return { ok: false, reason: 'Za mało Złomu.' };
  state.scrap -= cost;
  consumeParts(state, r.parts);
  const item = { ...newItem(r.out.id), qty: r.out.qty };
  addToStack(state.stash, item);
  return { ok: true, item };
}

/** Następny poziom warsztatu i czego brakuje do rozbudowy (null = maksymalny poziom). */
export function nextLevel(state: CampaignState): { level: number; name: string; missing: string[] } | null {
  const t = techOf(state);
  const next = WORKSHOP_LEVELS[t.level + 1];
  if (!next) return null;
  const missing: string[] = [];
  if (t.known.length < next.known) missing.push(`schematy ${t.known.length}/${next.known}`);
  if (next.part && partCount(state, next.part) < 1) missing.push(itemDef(next.part)?.name ?? next.part);
  if (state.scrap < next.scrap) missing.push(`${next.scrap} Złomu`);
  return { level: t.level + 1, name: next.name, missing };
}

/** Rozbudowa warsztatu (zużywa kluczową część i Złom). MUTUJE `state`. */
export function upgradeWorkshop(state: CampaignState): { ok: boolean; reason?: string } {
  const n = nextLevel(state);
  if (!n) return { ok: false, reason: 'Warsztat jest w pełni rozbudowany.' };
  if (n.missing.length) return { ok: false, reason: `Brakuje: ${n.missing.join(', ')}.` };
  const def = WORKSHOP_LEVELS[n.level];
  state.scrap -= def.scrap;
  if (def.part) consumeParts(state, [{ id: def.part, qty: 1 }]);
  techOf(state).level = n.level;
  state.log.push({ day: state.day, text: `Warsztat rozbudowany: ${def.name}.` });
  return { ok: true };
}
