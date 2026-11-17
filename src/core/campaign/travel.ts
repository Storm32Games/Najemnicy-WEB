// Podróż na miejsce zlecenia: losowanie zdarzenia i rozstrzygnięcie wyboru.
// Migracja z Oldgame/src/scenes/worldmap.js (rollEvent, runEvent) - bez mapy 3D i UI.
import { addXP, newItem } from '../rules/character.ts';
import { dcForLevel, roll, pickOne, type CheckResult, type Rng } from '../rules/dice.ts';
import { addToStack } from '../rules/equipment.ts';
import { itemDef } from '../rules/lookup.ts';
import { getStat } from '../rules/stats.ts';
import { skillCheck } from '../rules/turn.ts';
import type { Character } from '../rules/types.ts';
import { rollItem } from './contracts.ts';
import { consumeFood } from './food.ts';
import { EVENTS, type EventChoice, type EventOutcome, type TravelEvent } from './events.ts';
import type { CampaignState, Contract, FactionId } from './state.ts';

/** Szansa na zdarzenie w trakcie podróży. */
export const EVENT_CHANCE = 0.3;

/** Losuje zdarzenie (ważone) albo null. */
export function rollTravelEvent(rng: Rng = Math.random, chance = EVENT_CHANCE): TravelEvent | null {
  if (rng() >= chance) return null;
  const tot = EVENTS.reduce((a, e) => a + (e.weight || 1), 0);
  let r = rng() * tot;
  for (const e of EVENTS) {
    r -= e.weight || 1;
    if (r <= 0) return e;
  }
  return EVENTS[0];
}

const living = (state: CampaignState): Character[] => state.party.filter((c) => !c.conditions.dead);

/** Kto z drużyny podejdzie do testu (najwyższa premia). */
export function bestForChoice(state: CampaignState, choice: EventChoice): Character | null {
  const alive = living(state);
  if (!choice.skill || !alive.length) return null;
  const skill = choice.skill;
  return alive.reduce((a, b) => (getStat(b, skill) > getStat(a, skill) ? b : a), alive[0]);
}

export const choiceDC = (choice: EventChoice, contract: Pick<Contract, 'level'>): number =>
  typeof choice.dc === 'number' ? choice.dc : dcForLevel(contract.level);

export type EventEffect = { text: string; tone: 'good' | 'bad' };
export interface EventResolution {
  degree: 0 | 1 | 2 | 3;
  who: Character | null;
  check: CheckResult | null;
  outcome: EventOutcome;
  effects: EventEffect[];
}

/** Rozstrzyga wybór (test najlepszego członka drużyny) i nakłada skutki na stan kampanii (MUTUJE `state`). */
export function resolveEventChoice(state: CampaignState, contract: Pick<Contract, 'level'>, choice: EventChoice, rng: Rng = Math.random): EventResolution {
  let degree: 0 | 1 | 2 | 3 = 2;
  let who: Character | null = null;
  let chk: CheckResult | null = null;
  if (choice.skill) {
    who = bestForChoice(state, choice);
    if (who) {
      chk = skillCheck(who, choice.skill, choiceDC(choice, contract), rng);
      degree = chk.degree;
    }
  }
  const outcome = choice.out[degree] ?? choice.out[2] ?? choice.out[1] ?? { text: '…' };
  const effects: EventEffect[] = [];
  const alive = living(state);
  if (outcome.scrap) {
    const d = Math.max(-state.scrap, outcome.scrap);
    state.scrap += d;
    effects.push({ text: `${d > 0 ? '+' : ''}${d} Złomu`, tone: d > 0 ? 'good' : 'bad' });
  }
  for (const spec of outcome.items ?? []) {
    const id = rollItem(spec, contract.level, rng);
    if (!id) continue;
    addToStack(state.stash, newItem(id));
    effects.push({ text: `Zdobyto: ${itemDef(id)?.name ?? id}`, tone: 'good' });
  }
  for (const [f, v] of Object.entries(outcome.rep ?? {}) as [FactionId, number][]) {
    state.rep[f] = (state.rep[f] || 0) + v;
    effects.push({ text: `${f === 'nomads' ? 'Nomadzi' : 'Ocaleni'} ${v > 0 ? '+' : ''}${v}`, tone: v > 0 ? 'good' : 'bad' });
  }
  if (outcome.xp) {
    for (const m of alive) addXP(m, outcome.xp);
    effects.push({ text: `+${outcome.xp} PD dla każdego`, tone: 'good' });
  }
  if (outcome.days) {
    state.day = Math.max(1, state.day + outcome.days);
    if (outcome.days > 0) for (const t of consumeFood(state, outcome.days, rng).notes) effects.push({ text: t, tone: 'bad' });
    effects.push({ text: outcome.days > 0 ? `Strata czasu: +${outcome.days} d.` : 'Zyskany czas: −1 d.', tone: outcome.days > 0 ? 'bad' : 'good' });
  }
  if (outcome.hp && alive.length) {
    // obrażenia z podróży nigdy nie zabijają (min. 1 PW)
    const v = typeof outcome.hp === 'number' ? outcome.hp : roll(outcome.hp, rng).total;
    const tgt = pickOne(alive, rng);
    tgt.hp = Math.max(1, tgt.hp - v);
    effects.push({ text: `${tgt.name} traci ${v} PW`, tone: 'bad' });
  }
  return { degree, who, check: chk, outcome, effects };
}
