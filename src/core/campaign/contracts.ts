// Generowanie zleceń (poboczne skalowane do poziomu drużyny, budżet PD wg PF2e) + 3 zlecenia fabularne.
// Migracja z Oldgame/src/data/contracts.js.
import type { EnemyId, ItemId, ItemType } from '../data/types.ts';
import { createEnemy, encounterXP } from '../rules/character.ts';
import { pickOne, type Rng } from '../rules/dice.ts';
import { allEnemyIds, allItems, enemyDef, isItemId } from '../rules/lookup.ts';
import type { Biome } from '../tactical/mapgen.ts';
import type { ObjectiveType } from '../tactical/mission.ts';
import { foodLow, foodOf } from './food.ts';
import { campaignPartyLevel, type CampaignState, type Contract, type FactionId, type Mood } from './state.ts';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const levelOf = (id: EnemyId): number => enemyDef(id)?.level ?? 1;
const factionOf = (id: EnemyId): string => enemyDef(id)?.faction ?? '';
export const isBossEnemy = (id: EnemyId): boolean => enemyDef(id)?.ai === 'boss' || /kostucha/i.test(id);

/** Pula wrogów danych frakcji w okolicy poziomu (z bezpiecznymi zapasami). */
function pool(factions: readonly string[] | null, level: number): EnemyId[] {
  const all = allEnemyIds().filter((id) => !isBossEnemy(id));
  let p = all.filter((id) => (!factions || factions.includes(factionOf(id))) && Math.abs(levelOf(id) - level) <= 1);
  if (!p.length) p = all.filter((id) => !factions || factions.includes(factionOf(id)));
  if (!p.length) p = all;
  return p;
}

/** spec: konkretne id albo '@typ' (losowy przedmiot do poziomu+1; '@any' = broń/pancerz/tarcza/konsumabelka/tech). */
export function rollItem(spec: string | null | undefined, level = 1, rng: Rng = Math.random): ItemId | null {
  if (!spec) return null;
  if (!spec.startsWith('@')) return isItemId(spec) ? spec : null;
  const t = spec.slice(1);
  const ANY: readonly ItemType[] = ['weapon', 'armor', 'shield', 'consumable', 'tech'];
  const c = allItems().filter((i) => (t === 'any' ? ANY.includes(i.type) : i.type === t) && i.level <= level + 1 && i.price > 0);
  return c.length ? pickOne(c, rng).id : null;
}

/** Co jest już na tablicy: obłożenie sektorów (flagi na mapie) i użyte tytuły (bez powtórek). */
export interface BoardUse {
  biomes: Partial<Record<Biome, number>>;
  titles: Set<string>;
}
function pickTitle(titles: readonly string[], board: BoardUse | undefined, rng: Rng): string {
  const free = board ? titles.filter((t) => !board.titles.has(t)) : titles;
  const t = pickOne(free.length ? free : titles, rng);
  board?.titles.add(t);
  return t;
}

interface ContractTemplate {
  factions: readonly string[];
  biomes: readonly Biome[];
  moods: readonly Mood[];
  titles: readonly string[];
  descs: readonly string[];
  /** Zleceniodawca zawsze z tej frakcji (domyślnie losowo). */
  giver?: FactionId;
}
type SideType = Exclude<ObjectiveType, 'boss'>;
/** Zwykłe zlecenia poboczne (każde co najmniej raz na tablicy). Zaopatrzenie ('forage') dochodzi, gdy brakuje żywności. */
export const SIDE_TYPES: readonly Exclude<SideType, 'forage'>[] = ['eliminate', 'retrieve', 'rescue', 'hunt', 'hack', 'liberate', 'purge', 'defend'];

const TYPES: Readonly<Record<SideType, ContractTemplate>> = {
  eliminate: {
    factions: ['raider'], biomes: ['ruins', 'industrial', 'wastes'], moods: ['dusk', 'day', 'night'],
    titles: ['Oczyścić skład', 'Wyplenić gniazdo Szabrowników', 'Odbić stację przekaźnikową', 'Dym nad Rdzawiskiem', 'Rozbić obóz Żelaznych Szczęk', 'Wyczyścić zajezdnię'],
    descs: [
      'Banda Szabrowników zajęła budynek, przez który prowadzi szlak zaopatrzenia. Wybić ich wszystkich.',
      'Dym z ich ognisk widać z murów Przystani. Ktoś musi ich stamtąd wykurzyć.',
      'Zdegenerowani bandyci blokują drogę karawanom. Zrób z tym porządek.',
    ],
  },
  retrieve: {
    factions: ['raider', 'mutant', 'machine'], biomes: ['ruins', 'bunker', 'industrial'], moods: ['dusk', 'night', 'toxic'],
    titles: ['Odzyskać rdzeń zasilania', 'Skrzynia z lekami', 'Zaginiony generator', 'Dane z bunkra', 'Sprzęt medyczny z kliniki', 'Zgubiony ładunek karawany'],
    descs: [
      'W ruinach leży cenny ładunek. Znajdź go i wynieś, zanim zrobią to inni.',
      'Przeżyjemy zimę tylko wtedy, gdy to odzyskacie. Uważajcie na to, co się tam lęgnie.',
      'Cenny sprzęt został w skażonej strefie. Wejść, wziąć, wyjść.',
    ],
  },
  rescue: {
    factions: ['raider', 'mutant'], biomes: ['ruins', 'industrial', 'bunker'], moods: ['night', 'dusk', 'storm'],
    titles: ['Ocalić zwiadowcę', 'Jeńcy w piwnicach', 'Uwięziony inżynier', 'Wołanie o pomoc', 'Karawana w potrzasku'],
    descs: [
      'Ktoś z naszych wpadł w ręce Szabrowników. Zostało mało czasu.',
      'Radio zacharczało: „pomocy". Potem tylko trzaski. Idźcie tam.',
      'Uwięziony technik wie, jak naprawić pompę wody w Przystani. Przyprowadźcie go żywego.',
    ],
  },
  hunt: {
    factions: ['beast', 'mutant'], biomes: ['wastes', 'ruins', 'industrial'], moods: ['day', 'dusk', 'toxic', 'storm'],
    titles: ['Polowanie na alfę', 'Koniec z szczuroludźmi', 'Bestia z kanałów', 'Wataha przy studni', 'Plaga mutantów'],
    descs: [
      'Mutanty zżerają nam zapasy i pasą się na kupcach. Znajdź legowisko i zabij przywódcę.',
      'Nomadzi proszą o pomoc: coś wielkiego krąży przy ich studni od trzech nocy.',
      'Za głowę potwora wyznaczono nagrodę. Przynieś dowód.',
    ],
  },
  hack: {
    factions: ['machine', 'raider'], biomes: ['bunker', 'industrial'], moods: ['night', 'dusk', 'toxic'],
    titles: ['Włamanie do serwera', 'Archiwum sprzed Wojny', 'Szyfry Żelaznych Szczęk', 'Martwa sieć', 'Dane z centrum dowodzenia', 'Ostatni serwer Vaultu'],
    descs: [
      'W starym centrum danych wciąż działa serwer z mapami tras przedwojennych konwojów. Włamcie się i ściągnijcie wszystko.',
      'Szabrownicy trzymają listy swoich dostaw na zdobycznym serwerze. Wejdźcie do systemu, zanim zatrą ślady.',
      'Maszyny strzegą serwera z planami oczyszczalni wody. Ktoś z głową do elektroniki musi się tam dostać.',
    ],
  },
  liberate: {
    factions: ['raider'], biomes: ['wastes', 'ruins'], moods: ['day', 'dusk', 'night'], giver: 'nomads',
    titles: ['Uwolnić osadę Nomadów', 'Jarzmo szabrowników', 'Studnia w niewoli', 'Obóz pod Czerwoną Skałą', 'Spętani wędrowcy'],
    descs: [
      'Szabrownicy zajęli osadę Nomadów i trzymają jej mieszkańców w klatkach. Wybijcie najeźdźców i uwolnijcie ludzi.',
      'Nasze rodziny zostały przy studni, gdy przyszli bandyci. Każdego dnia ktoś znika. Odbijcie osadę.',
      'Osada przy szlaku karawan płaci szabrownikom daninę krwią. Skończcie z tym i przetnijcie więzy jeńców.',
    ],
  },
  purge: {
    factions: ['beast', 'mutant'], biomes: ['ruins', 'industrial', 'wastes'], moods: ['toxic', 'night', 'dusk', 'storm'],
    titles: ['Oczyścić dzielnicę', 'Gniazda w kanałach', 'Plaga w starym osiedlu', 'Zmutowana fauna', 'Wypalić lęgowiska'],
    descs: [
      'Zmutowana fauna zagnieździła się w całej dzielnicy. Zniszczcie gniazda i wybijcie wszystko, co się rusza.',
      'Z ruin wypełzają kolejne pomioty. Dopóki gniazda stoją, nie da się tam zbierać złomu. Spalcie je.',
      'Kupcy omijają tę dzielnicę szerokim łukiem. Oczyśćcie ją z bestii, a szlak znów będzie bezpieczny.',
    ],
  },
  forage: {
    factions: ['beast', 'mutant', 'raider'], biomes: ['wastes', 'ruins', 'industrial'], moods: ['day', 'dusk', 'storm', 'toxic'], giver: 'survivors',
    titles: ['Pusty spichrz', 'Głodne zimy', 'Konserwy z magazynu', 'Ziarno z silosu', 'Zapasy z dawnego marketu', 'Chleb dla Przystani', 'Wyprawa po prowiant'],
    descs: [
      'Spichrz w Przystani świeci pustkami, a dzieci już chodzą głodne. W starym magazynie leżą skrzynie z konserwami — przynieście, ile zdołacie.',
      'Ocaleni muszą jeść. Zwiadowcy wypatrzyli nienaruszone zapasy w ruinach, ale okolica nie jest pusta. Zbierzcie żywność i wróćcie cało.',
      'Za kilka dni zabraknie nam chleba. W silosach za miastem zostało ziarno — zabierzcie wszystkie worki, zanim zje je robactwo albo ktoś gorszy.',
      'Karawana z żywnością przepadła na pustkowiach. Ładunek wciąż tam leży, rozrzucony między wrakami. Zbierzcie go dla Przystani.',
    ],
  },
  defend: {
    factions: ['raider', 'mutant', 'beast'], biomes: ['wastes', 'ruins'], moods: ['dusk', 'night', 'storm'], giver: 'survivors',
    titles: ['Obrona Przystani', 'Oblężenie przedpola', 'Noc długich noży', 'Ostatnia linia', 'Atak na posterunek'],
    descs: [
      'Zwiadowcy donoszą, że w stronę Przystani ciągnie kilka band naraz. Zajmijcie przedpole i odeprzyjcie każdą falę.',
      'Coś wygoniło stada mutantów z pustkowi i pędzi je prosto na nasze mury. Zatrzymajcie je, zanim dotrą do bram.',
      'Posterunek przy Przystani zgłasza ruch na horyzoncie. Potrzebujemy ludzi, którzy wytrzymają kilka szturmów z rzędu.',
    ],
  },
};
const GIVERS: Readonly<Record<FactionId, readonly string[]>> = {
  survivors: ['Starsza Wiera', 'Kapitan Dobosz', 'Mechanik Rudy', 'Siostra Hanna', 'Burmistrz Kalinowski'],
  nomads: ['Stary Tuareg', 'Handlarka Zeyna', 'Przewodnik Kasim', 'Wędrowiec Orzeł', 'Matka Karawany'],
};

/**
 * Zlecenie poboczne. Budżet PD (4 postacie): ~85-110 standardowo, 125 gdy zlecenie jest powyżej poziomu drużyny
 * (grupy walczy się zwykle po kolei, więc całość jest nieco ponad "umiarkowane" starcie).
 */
export function makeContract(
  type: SideType, level: number, state: Pick<CampaignState, 'party' | 'day'> | null, rng: Rng = Math.random, board?: BoardUse,
): Contract {
  const biomeUse = board?.biomes;
  const base = TYPES[type];
  // obrona: jedna frakcja napastników na zlecenie (fale z tej samej bandy / stada)
  const T: ContractTemplate = type === 'defend' ? { ...base, factions: [pickOne(base.factions, rng)] } : base;
  const faction: FactionId = T.giver ?? (rng() < 0.55 ? 'survivors' : 'nomads');
  const plv = campaignPartyLevel(state);
  const hard = level > plv;
  const BONUS: Partial<Record<SideType, number>> = { hunt: 10, liberate: 10, purge: 10, defend: 20 };
  let budget = (hard ? 125 : 85 + Math.floor(rng() * 25)) + (BONUS[type] ?? 0);
  const cost = (id: EnemyId): number => encounterXP(plv, [createEnemy(id)]) || 40;
  const enemies: EnemyId[] = [];
  if (type === 'hunt') {
    // jeden silniejszy cel (maks. poziom drużyny + 2)
    const strong = allEnemyIds().filter((id) => !isBossEnemy(id) && T.factions.includes(factionOf(id)) && levelOf(id) >= level && levelOf(id) <= plv + 2);
    if (strong.length) {
      const s0 = pickOne(strong, rng);
      enemies.push(s0);
      budget -= cost(s0);
    }
  }
  const p = allEnemyIds().filter((id) => !isBossEnemy(id) && T.factions.includes(factionOf(id)) && levelOf(id) <= level && levelOf(id) >= level - 3);
  const fallback = pool(T.factions, level);
  const maxN = type === 'defend' ? 10 : 8;
  for (let guard = 0; guard < 24 && enemies.length < maxN; guard++) {
    const fit = (p.length ? p : fallback).filter((id) => cost(id) <= budget);
    if (!fit.length) break;
    const id = pickOne(fit, rng);
    enemies.push(id);
    budget -= cost(id);
  }
  while (enemies.length < 2) enemies.push(pickOne(fallback.filter((id) => levelOf(id) <= plv).concat(fallback).slice(0, 3), rng));
  const objective: Contract['objective'] =
    type === 'retrieve' ? { type, itemId: rollItem('@tech', 5, rng) ?? rollItem('@consumable', 5, rng) ?? 'scrap_metal', count: 1 } : { type };
  const anyItem = rollItem('@any', level, rng);
  const techItem = type === 'hack' ? rollItem('@tech', level, rng) : null;
  // sektor: najmniej obłożony z pasujących (flagi zleceń na mapie się nie nakładają)
  const least = biomeUse ? Math.min(...T.biomes.map((b) => biomeUse[b] ?? 0)) : 0;
  const biome = pickOne(biomeUse ? T.biomes.filter((b) => (biomeUse[b] ?? 0) === least) : T.biomes, rng);
  if (biomeUse) biomeUse[biome] = (biomeUse[biome] ?? 0) + 1;
  // zaopatrzenie: główną nagrodą jest żywność dla Przystani, Złomu mniej
  const MULT: Partial<Record<SideType, number>> = { rescue: 1.15, hack: 1.1, liberate: 1.2, purge: 1.15, defend: 1.25, forage: 0.7 };
  return {
    id: 'k' + (state?.day ?? 1) + '_' + rng().toString(36).slice(2, 7),
    title: pickTitle(T.titles, board, rng), giver: pickOne(GIVERS[faction], rng), faction, desc: pickOne(T.descs, rng),
    type, level, biome, mood: pickOne(T.moods, rng), enemies, objective,
    reward: {
      scrap: Math.round((35 + level * 32 + Math.floor(rng() * 30)) * (hard ? 1.2 : 1) * (MULT[type] ?? 1)),
      xp: 300 + level * 100 + (type === 'defend' || type === 'liberate' ? 100 : 0),
      items: techItem ? [techItem] : rng() < 0.4 && anyItem ? [anyItem] : [],
      rep: { [faction]: 1 + (hard ? 1 : 0) + (type === 'liberate' || type === 'defend' || type === 'forage' ? 1 : 0) },
      ...(type === 'forage' ? { food: 6 + Math.min(4, level) + Math.floor(rng() * 3) } : {}),
    },
    travelDays: 1 + (rng() < 0.25 ? 1 : 0),
  };
}

// ---------- wątek główny
const STORY_ENEMIES: readonly (readonly EnemyId[])[] = [
  ['raider_thug', 'raider_thug', 'raider_gunner', 'raider_psycho'],
  ['raider_thug', 'raider_gunner', 'raider_gunner', 'raider_psycho', 'raider_burner', 'raider_chief'],
  ['kostucha', 'raider_thug', 'raider_thug', 'raider_gunner', 'raider_sniper', 'raider_psycho', 'raider_burner'],
];
export const STORY_CONTRACTS: readonly Readonly<Contract>[] = [
  {
    id: 'story1', story: true, title: 'Cień Żelaznych Szczęk', giver: 'Kapitan Dobosz', faction: 'survivors',
    desc: 'Szabrownicy z Żelaznych Szczęk przejęli stary posterunek na trasie do Przystani. Ich flaga — czaszka w stalowych szczękach — wisi tam od tygodnia. Kapitan chce wiedzieć, kim jest ich wódz.',
    type: 'eliminate', level: 2, biome: 'industrial', mood: 'dusk', objective: { type: 'eliminate' }, travelDays: 1,
    reward: { scrap: 220, xp: 500, items: [], rep: { survivors: 2 } }, enemies: [...STORY_ENEMIES[0]],
  },
  {
    id: 'story2', story: true, title: 'Karawana w ogniu', giver: 'Handlarka Zeyna', faction: 'nomads',
    desc: 'Szczęki wyrżnęły karawanę Nomadów i pojmały jej przewodnika. Zeyna zapłaci wszystko, co ma, byście go odbili — a on zna kryjówkę Kostuchy.',
    type: 'rescue', level: 3, biome: 'ruins', mood: 'night', objective: { type: 'rescue' }, travelDays: 2,
    reward: { scrap: 340, xp: 700, items: [], rep: { nomads: 3 } }, enemies: [...STORY_ENEMIES[1]],
  },
  {
    id: 'story3', story: true, title: 'Kostucha', giver: 'Burmistrz Kalinowski', faction: 'survivors',
    desc: 'Znamy już jej kryjówkę: pogrzebany pod Rdzawiskiem bunkier. Kostucha rządzi Szczękami żelazną ręką — i tylko jej śmierć powstrzyma atak na Przystań. To zlecenie, z którego się nie wraca z pustymi rękami.',
    type: 'boss', level: 5, biome: 'bunker', mood: 'toxic', objective: { type: 'boss' }, travelDays: 2,
    reward: { scrap: 800, xp: 1000, items: [], rep: { survivors: 5, nomads: 5 } }, enemies: [...STORY_ENEMIES[2]],
  },
];
/** Wymagania kolejnych zleceń fabularnych: c = ukończone zlecenia, r = suma reputacji. */
const STORY_NEED: readonly { c: number; r: number }[] = [{ c: 2, r: 2 }, { c: 4, r: 6 }, { c: 7, r: 10 }];
const STORY_BUDGET: readonly number[] = [100, 110, 115];

export function storyUnlocked(state: CampaignState): boolean {
  const s = state.story || 0;
  if (s >= STORY_CONTRACTS.length) return false;
  const need = STORY_NEED[s];
  const rep = (state.rep.nomads || 0) + (state.rep.survivors || 0);
  return state.completed.length >= need.c && rep >= need.r;
}
export function storyHint(state: CampaignState): string {
  const s = state.story || 0;
  if (s >= STORY_CONTRACTS.length) return 'Kostucha nie żyje.';
  const need = STORY_NEED[s];
  return `Kolejne zlecenie fabularne: ${need.c} ukończone zlecenia i ${need.r} pkt reputacji.`;
}

/** Kopia zlecenia fabularnego z eskortą przyciętą do budżetu PD drużyny (boss/herszt zostaje zawsze). */
function cloneStory(i: number, state: CampaignState): Contract {
  const s = STORY_CONTRACTS[i];
  const enemies = [...s.enemies];
  const plv = campaignPartyLevel(state);
  const xp = (): number => encounterXP(plv, enemies.map((id) => createEnemy(id)));
  for (let g = 0; g < 10 && xp() > STORY_BUDGET[i] && enemies.length > 2; g++) {
    let k = enemies.length - 1;
    while (k > 0 && isBossEnemy(enemies[k])) k--;
    if (k <= 0) break;
    enemies.splice(k, 1);
  }
  return { ...s, enemies, reward: { ...s.reward, items: [...s.reward.items], rep: { ...s.reward.rep } }, objective: { ...s.objective } };
}

const levelJitter = (lvl: number, rng: Rng): number => clamp(lvl + (rng() < 0.25 ? 1 : rng() < 0.2 ? -1 : 0), 1, 10);

/** Liczba zleceń pobocznych na tablicy: 10-11. */
const BOARD_MIN = 10;
const boardTarget = (rng: Rng): number => BOARD_MIN + Math.floor(rng() * 2);
const boardUse = (list: readonly Contract[]): BoardUse => {
  const out: BoardUse = { biomes: {}, titles: new Set() };
  for (const c of list) {
    out.biomes[c.biome] = (out.biomes[c.biome] ?? 0) + 1;
    out.titles.add(c.title);
  }
  return out;
};

/** Nowa tablica: 10-11 zleceń pobocznych, każdy typ co najmniej raz (+ fabularne, jeśli odblokowane). */
export function generateContracts(state: CampaignState, rng: Rng = Math.random): Contract[] {
  const lvl = campaignPartyLevel(state);
  const out: Contract[] = [];
  const use = boardUse([]);
  const n = boardTarget(rng);
  for (let i = 0; i < n; i++) out.push(makeContract(i < SIDE_TYPES.length ? SIDE_TYPES[i] : pickOne(SIDE_TYPES, rng), levelJitter(lvl, rng), state, rng, use));
  addForage(state, out, rng, use);
  if (storyUnlocked(state)) out.unshift(cloneStory(state.story || 0, state));
  return out;
}

/** Szansa na zlecenie zaopatrzenia, gdy zapasy są skromne (ale jeszcze nie na wyczerpaniu). */
const FORAGE_CHANCE = 0.3;
/**
 * Zaopatrzenie: gdy w Przystani brakuje żywności, na tablicy zawsze jest zlecenie zdobycia jedzenia
 * (przy skromnych zapasach - czasem). Dokłada na początek listy pobocznych. MUTUJE `list`.
 */
function addForage(state: CampaignState, list: Contract[], rng: Rng, use: BoardUse): void {
  if (list.some((c) => c.type === 'forage')) return;
  const need = foodLow(state);
  if (!need && !(foodOf(state) <= 7 && rng() < FORAGE_CHANCE)) return;
  const lvl = campaignPartyLevel(state);
  const c = makeContract('forage', clamp(lvl - (need ? 1 : 0), 1, 10), state, rng, use);
  const at = list.findIndex((k) => !k.story);
  list.splice(at < 0 ? list.length : at, 0, c);
}

/** Odświeża tablicę: usuwa `drop` losowych pobocznych, dopełnia do 10-11, dokłada fabularne. MUTUJE state.contracts. */
export function refreshBoard(state: CampaignState, drop = 0, rng: Rng = Math.random): Contract[] {
  for (let i = 0; i < drop; i++) {
    const side = state.contracts.filter((c) => !c.story && c.type !== 'forage');
    if (side.length > 2) state.contracts.splice(state.contracts.indexOf(pickOne(side, rng)), 1);
  }
  if (storyUnlocked(state) && !state.contracts.some((c) => c.story)) state.contracts.unshift(cloneStory(state.story || 0, state));
  const lvl = campaignPartyLevel(state);
  const target = boardTarget(rng);
  const use = boardUse(state.contracts);
  // spichrz znów pełny: zaopatrzenie znika z tablicy
  if (foodOf(state) > 12) state.contracts = state.contracts.filter((c) => c.type !== 'forage');
  addForage(state, state.contracts, rng, use);
  while (state.contracts.filter((c) => !c.story && c.type !== 'forage').length < target) {
    const missing = SIDE_TYPES.find((t) => !state.contracts.some((c) => c.type === t));
    state.contracts.push(makeContract(missing ?? pickOne(SIDE_TYPES, rng), clamp(lvl + (rng() < 0.25 ? 1 : 0), 1, 10), state, rng, use));
  }
  return state.contracts;
}

export type DifficultyTone = 'good' | 'amber' | 'bad';
export function difficulty(contractLevel: number, partyLevel: number): { label: string; tone: DifficultyTone } {
  const d = contractLevel - partyLevel;
  if (d <= -2) return { label: 'Łatwe', tone: 'good' };
  if (d <= 0) return { label: 'Standardowe', tone: 'amber' };
  return { label: d === 1 ? 'Trudne' : 'Śmiertelne', tone: 'bad' };
}
export const BIOME_NAMES: Readonly<Record<Biome, string>> = { ruins: 'Ruiny', wastes: 'Pustkowia', industrial: 'Strefa przemysłowa', bunker: 'Bunkier' };
export const TYPE_NAMES: Readonly<Record<ObjectiveType, string>> = {
  eliminate: 'Eliminacja', retrieve: 'Odzyskanie', rescue: 'Ratunek', hunt: 'Polowanie', boss: 'Wódz',
  hack: 'Włamanie', liberate: 'Wyzwolenie', purge: 'Oczyszczanie', defend: 'Obrona', forage: 'Zaopatrzenie',
};
export const FACTION_NAMES: Readonly<Record<FactionId, string>> = { survivors: 'Ocaleni z Przystani', nomads: 'Nomadzi' };
export const MOOD_NAMES: Readonly<Record<Mood, string>> = { day: 'dzień', dusk: 'zmierzch', night: 'noc', toxic: 'toksyczna mgła', storm: 'burza' };
