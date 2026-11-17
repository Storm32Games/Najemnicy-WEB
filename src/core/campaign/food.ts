// Zapasy żywności Przystani: ocaleni jedzą codziennie, zapasy czasem się psują albo giną.
// Gdy zapasów brakuje, na tablicy pojawia się zlecenie zaopatrzenia ('forage'); głód obniża reputację u Ocalonych.
import type { Rng } from '../rules/dice.ts';
import type { CampaignState } from './state.ts';

/** Zapasy na starcie kampanii (w dniach). */
export const FOOD_START = 8;
/** Poniżej tej liczby dni (włącznie) Przystań prosi o zaopatrzenie (zlecenie na tablicy). */
export const FOOD_LOW = 4;
/** Spichrz mieści najwyżej tyle dni zapasów. */
export const FOOD_MAX = 20;
/** Szansa na dzień, że część zapasów przepadnie (szczury, zepsucie, kradzież). */
export const FOOD_LOSS_CHANCE = 0.12;

const LOSSES: readonly string[] = [
  'Szczury dobrały się do spichrza',
  'Część konserw okazała się zepsuta',
  'Ktoś podkradł worki z mąką',
  'Wilgoć zniszczyła suszone mięso',
  'Przystań nakarmiła głodnych uchodźców',
];

export interface FoodReport {
  /** Ile dni minęło. */
  days: number;
  /** Ile dni zapasów zjedzono / straciło się. */
  used: number;
  /** Dni bez jedzenia (każdy: -1 reputacji u Ocalonych). */
  hungry: number;
  /** Komunikaty dla gracza (strata zapasów, głód). */
  notes: string[];
}

/** Zapasy z zapisu sprzed wprowadzenia żywności albo uszkodzone: wartość domyślna. */
export const foodOf = (state: Pick<CampaignState, 'food'>): number => (Number.isFinite(state.food) ? Math.max(0, state.food) : FOOD_START);

/** Czy Przystań potrzebuje zaopatrzenia (zlecenie 'forage' na tablicy). */
export const foodLow = (state: Pick<CampaignState, 'food'>): boolean => foodOf(state) <= FOOD_LOW;

/** Opis stanu spichrza. */
export function foodStatus(state: Pick<CampaignState, 'food'>): { label: string; tone: 'good' | 'amber' | 'bad' } {
  const f = foodOf(state);
  if (f <= 0) return { label: 'GŁÓD', tone: 'bad' };
  if (f <= FOOD_LOW) return { label: 'na wyczerpaniu', tone: 'bad' };
  if (f <= FOOD_LOW + 3) return { label: 'skromne', tone: 'amber' };
  return { label: 'wystarczające', tone: 'good' };
}

/** Dostawa żywności (z zaopatrzenia). Zwraca faktycznie dodane dni (spichrz ma limit). */
export function addFood(state: CampaignState, days: number): number {
  const before = foodOf(state);
  state.food = Math.min(FOOD_MAX, before + Math.max(0, Math.round(days)));
  return state.food - before;
}

/**
 * Upływ `n` dni: każdy dzień zjada 1 dzień zapasów, czasem przepada więcej.
 * Gdy zapasów nie ma - głód: -1 reputacji u Ocalonych za dzień. MUTUJE `state` (food, rep, log; NIE zmienia `day`).
 */
export function consumeFood(state: CampaignState, n: number, rng: Rng = Math.random): FoodReport {
  const rep: FoodReport = { days: Math.max(0, Math.floor(n)), used: 0, hungry: 0, notes: [] };
  let food = foodOf(state);
  for (let d = 0; d < rep.days; d++) {
    if (food > 0) {
      food--;
      rep.used++;
      if (food > 0 && rng() < FOOD_LOSS_CHANCE) {
        const lost = Math.min(food, 1 + Math.floor(rng() * 2));
        food -= lost;
        rep.used += lost;
        rep.notes.push(`${LOSSES[Math.floor(rng() * LOSSES.length)]}: -${lost} dn. zapasów.`);
      }
    } else {
      rep.hungry++;
      state.rep.survivors = (state.rep.survivors || 0) - 1;
    }
  }
  state.food = food;
  if (rep.hungry) rep.notes.push(`Przystań głoduje (${rep.hungry} dn.): Ocaleni -${rep.hungry}.`);
  else if (food > 0 && food <= FOOD_LOW) rep.notes.push(`Zapasy żywności na wyczerpaniu: ${food} dn.`);
  for (const t of rep.notes) state.log.push({ day: state.day, text: t });
  return rep;
}
