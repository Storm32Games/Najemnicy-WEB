// Rozliczenie misji: polegli, Złom, łup, reputacja, PD i awanse, postęp fabuły, następny dzień.
// Migracja z Oldgame/src/scenes/debrief.js -> apply().
import type { AbilityId, ItemId } from '../data/types.ts';
import { addXP, newItem } from '../rules/character.ts';
import { addToStack } from '../rules/equipment.ts';
import type { Character } from '../rules/types.ts';
import type { MissionResult } from '../tactical/mission.ts';
import { refreshBoard } from './contracts.ts';
import { addFood, consumeFood } from './food.ts';
import type { CampaignState, Contract, FactionId } from './state.ts';

export interface MemberProgress {
  member: Character;
  before: { level: number; maxHp: number; xp: number };
  levelsGained: number;
  newAbilities: AbilityId[];
}

export interface DebriefSummary {
  contract: Contract | null;
  result: MissionResult['result'];
  scrap: number;
  /** W tym ukradzione w trakcie misji. */
  stolen: number;
  xp: number;
  items: ItemId[];
  rep: Partial<Record<FactionId, number>>;
  fallen: string[];
  members: MemberProgress[];
  /** Wątek główny posunął się naprzód. */
  story: boolean;
  /** Kostucha pokonana. */
  win: boolean;
  /** Cała drużyna zginęła. */
  tpk: boolean;
  /** Dni zapasów żywności dostarczone do Przystani (zaopatrzenie). */
  food: number;
  /** Komunikaty o zapasach po upływie dni podróży (strata, głód). */
  foodNotes: string[];
  /** Podopieczni (uwolnieni cywile) zabici przez drużynę i potrącony za nich Złom z nagrody. */
  civiliansLost: string[];
  civilianFine: number;
}

/**
 * Nakłada wynik misji na stan kampanii (MUTUJE `state`).
 * Sukces: pełna nagroda; odwrót: połowa Złomu z nagrody i PD; porażka: brak łupu, 25% PD, -1 reputacji u zleceniodawcy.
 */
export function applyMissionResult(state: CampaignState, mission: MissionResult, contractArg?: Contract | null): DebriefSummary {
  const c = contractArg ?? state.contracts.find((k) => k.id === mission.contractId) ?? null;
  const result = mission.result;
  const ok = result === 'success';
  const retreat = result === 'retreat';
  const mult = ok ? 1 : retreat ? 0.5 : 0;
  const rw = c?.reward ?? { scrap: 0, xp: 0, items: [], rep: {} };
  const out: DebriefSummary = { contract: c, result, scrap: 0, stolen: 0, xp: 0, items: [], rep: {}, fallen: [], members: [], story: false, win: false, tpk: false, food: 0, foodNotes: [], civiliansLost: [], civilianFine: 0 };

  // polegli
  const names = new Set(mission.casualties);
  const dead = state.party.filter((m) => m.conditions.dead || names.has(m.name));
  for (const m of dead) {
    (state.flags.fallen ??= []).push(m.name);
    if (m.recruitId) (state.flags.fallenIds ??= []).push(m.recruitId);
    out.fallen.push(m.name);
  }
  state.party = state.party.filter((m) => !dead.includes(m));

  // Złom
  out.scrap = Math.round(mission.scrap * (result === 'fail' ? 0 : 1) + rw.scrap * mult);
  for (const m of state.party) {
    if (!m.stolenScrap) continue;
    out.scrap += m.stolenScrap;
    out.stolen += m.stolenScrap;
    m.stolenScrap = 0;
  }
  // zabici podopieczni: -25% Złomu z nagrody za każdego (najwyżej cała nagroda)
  const lost = mission.civilians?.lost ?? [];
  if (lost.length) {
    out.civiliansLost = lost.slice();
    out.civilianFine = Math.min(Math.round(rw.scrap * mult), Math.round(rw.scrap * mult * 0.25 * lost.length));
    out.scrap -= out.civilianFine;
  }
  // zakupy u nomadów na misji schodzą z kasy zawsze (także przy porażce)
  if (mission.nomads?.spent) out.scrap -= mission.nomads.spent;
  state.scrap += out.scrap;

  // przedmioty
  if (result !== 'fail') {
    for (const i of mission.loot) {
      addToStack(state.stash, i);
      out.items.push(i.id);
    }
  }
  if (ok) {
    for (const id of rw.items) {
      addToStack(state.stash, newItem(id));
      out.items.push(id);
    }
  }

  // żywność dla Przystani: pełna przy sukcesie, przy odwrocie za każdą zebraną skrzynię zapasów
  if (rw.food && result !== 'fail') {
    const sup = mission.supplies;
    const part = ok ? 1 : sup && sup.total ? sup.got / sup.total : 0;
    out.food = addFood(state, rw.food * part);
  }

  // reputacja
  if (ok) {
    for (const [f, v] of Object.entries(rw.rep) as [FactionId, number][]) {
      state.rep[f] = (state.rep[f] || 0) + v;
      out.rep[f] = v;
    }
  } else if (result === 'fail') {
    const f = c?.faction ?? 'survivors';
    state.rep[f] = (state.rep[f] || 0) - 1;
    out.rep[f] = -1;
  }

  // zabici podopieczni: -1 reputacji u zleceniodawcy za każdego
  if (lost.length) {
    const f = c?.faction ?? 'survivors';
    state.rep[f] = (state.rep[f] || 0) - lost.length;
    out.rep[f] = (out.rep[f] ?? 0) - lost.length;
  }

  // nomadzi spotkani na misji (rozmowa, kradzież z namiotu): reputacja bez względu na wynik zlecenia
  if (mission.nomads?.rep) {
    state.rep.nomads = (state.rep.nomads || 0) + mission.nomads.rep;
    out.rep.nomads = (out.rep.nomads ?? 0) + mission.nomads.rep;
  }

  // PD i ocaleni (powaleni wracają z 1 PW)
  out.xp = Math.round(mission.xp * (result === 'fail' ? 0.25 : retreat ? 0.5 : 1) + (ok ? rw.xp : 0));
  for (const m of state.party) {
    const before = { level: m.level, maxHp: m.maxHp, xp: m.xp };
    const abil = [...m.abilities];
    if (m.hp <= 0) m.hp = 1;
    delete m.conditions.dying;
    delete m.conditions.unconscious;
    const g = addXP(m, out.xp);
    out.members.push({ member: m, before, levelsGained: g, newAbilities: m.abilities.filter((a) => !abil.includes(a)) });
  }

  // postęp
  if (c) {
    const idx = state.contracts.findIndex((k) => k.id === c.id);
    if (idx >= 0) state.contracts.splice(idx, 1);
  }
  if (ok && c) {
    state.completed.push(c.id);
    if (c.story) {
      state.story = (state.story || 0) + 1;
      out.story = true;
      if (c.type === 'boss' || /kostucha/i.test(c.title)) out.win = true;
    }
  }
  const days = c?.travelDays ?? 1;
  state.day += days;
  out.foodNotes = consumeFood(state, days).notes;
  state.log.push({ day: state.day, text: `${c?.title ?? 'Zlecenie'}: ${result}` });
  if (out.win) state.flags.victory = true;
  refreshBoard(state, ok ? 1 : 0);
  out.tpk = state.party.length === 0;
  return out;
}
