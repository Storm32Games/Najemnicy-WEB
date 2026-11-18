// Nomadzi przy ogniskach i namiotach na mapie misji (czyste dane i reguły; rozmowę pokazuje WorldScene).
//
// Obóz = ognisko (z namiotem obok na pustkowiach, samotne w ruinach). Część obozów jest zajęta: przy ognisku siedzi
// nomad, z którym można porozmawiać (wypytać o okolicę, potargować się, kupić towar). Pusty namiot można przeszukać;
// namiot nomada da się tylko okraść (Złodziejstwo - przyłapany obraża się, -1 reputacji u Nomadów).
import type { ItemId, SkillId } from '../data/types.ts';
import { RECIPES } from '../data/recipes.ts';
import { itemDef } from '../rules/lookup.ts';
import type { GridPos } from '../rules/types.ts';
import type { TacticalMap } from './mapgen.ts';

export const NOMAD_KINDS = ['nomad_trader', 'nomad_scout', 'nomad_elder', 'nomad_hunter'] as const;
export type NomadKind = (typeof NOMAD_KINDS)[number];

/** Czego dotyczą informacje nomada (każdy wie co innego). */
export type NomadIntel = 'stash' | 'foes' | 'goal' | 'beasts';

export interface NomadDef {
  kind: NomadKind;
  /** Rola w dopełniaczu po imieniu ("Szafran, handlarz karawany"). */
  role: string;
  names: readonly string[];
  /** Powitanie (losowe). */
  greet: readonly string[];
  /** Towar do wyboru (3 losowe pozycje do poziomu misji + 1). */
  stock: readonly ItemId[];
  intel: NomadIntel;
  /** Opis tego, co wie (opcja rozmowy). */
  knows: string;
}

export const NOMADS: Readonly<Record<NomadKind, NomadDef>> = {
  nomad_trader: {
    kind: 'nomad_trader', role: 'handlarz karawany', names: ['Szafran', 'Kardamon', 'Mirra', 'Bazar'],
    greet: [
      'Pokój przy ogniu, przybysze. Mam towar, wy macie złom — pogadamy?',
      'Siadajcie. Karawana poszła dalej, a ja zostałem z pełnym plecakiem.',
    ],
    stock: ['bandage', 'stimpak', 'antirad', 'lockpick', 'battery', 'molotov', 'smoke_grenade', 'frag_grenade', 'ammo_box', 'medkit', 'combat_stim'],
    intel: 'stash', knows: 'Wie, gdzie szabrownicy chowają łupy (skrzynie i skrytki).',
  },
  nomad_scout: {
    kind: 'nomad_scout', role: 'zwiadowczyni', names: ['Wydma', 'Sokolica', 'Zawieja', 'Pył'],
    greet: [
      'Widziałam was z wydmy, zanim wy zobaczyliście mnie. Czego chcecie?',
      'Cicho. Tu się nie krzyczy. Mów, po co przyszedłeś.',
    ],
    stock: ['ammo_box', 'smoke_grenade', 'frag_grenade', 'lockpick', 'bandage', 'crossbow', 'antirad'],
    intel: 'foes', knows: 'Obserwuje okolicę — zna kryjówki wrogów.',
  },
  nomad_elder: {
    kind: 'nomad_elder', role: 'starszy wędrowców', names: ['Stary Kompas', 'Ojciec Szlak', 'Dziad Wiatr', 'Mędrzec Piach'],
    greet: [
      'Ogień grzeje każdego, kto przychodzi w pokoju. Usiądź, posłuchaj starego.',
      'Wiatr mówił, że przyjdziecie. Wiatr rzadko kłamie.',
    ],
    stock: ['antirad', 'bandage', 'stimpak', 'medkit', 'canned_food', 'gas_mask', 'nomad_cloak'],
    intel: 'goal', knows: 'Zna te ruiny od dziecka — wskaże cel zlecenia i ukryte znaleziska.',
  },
  nomad_hunter: {
    kind: 'nomad_hunter', role: 'łowczyni', names: ['Rogata', 'Skowyt', 'Kieł', 'Tropa'],
    greet: [
      'Uważajcie, gdzie stawiacie stopy. Tu poluje coś większego niż ja.',
      'Mięso się suszy, ogień się pali. Jak nie przyszliście kraść, to siadajcie.',
    ],
    stock: ['canned_food', 'bandage', 'molotov', 'ammo_box', 'bow', 'antirad', 'stimpak'],
    intel: 'beasts', knows: 'Tropi zwierzynę — wie, gdzie krążą bestie i wędrowcy.',
  },
};

/** Przedmioty tylko ze schematu warsztatu (RecipeDef.exclusive) - nomadzi ich nie sprzedają. */
const EXCLUSIVE = new Set<string>(RECIPES.filter((r) => r.exclusive).map((r) => r.out.id as string));
export const nomadSells = (id: ItemId): boolean => !EXCLUSIVE.has(id);

/** Szansa, że przy obozie siedzi nomad, i najwięcej nomadów na mapie. */
export const NOMAD_CHANCE = 0.45;
export const MAX_NOMADS = 2;
/** Narzut ceny w terenie (handlarz Przystani jest tańszy). */
export const FIELD_MARKUP = 1.15;

export interface NomadWare {
  id: ItemId;
  sold: boolean;
}

/** Stan nomada (MissionThing.nomad), zapisywany razem z misją. */
export interface NomadState {
  kind: NomadKind;
  /** Wypytany o okolicę (raz na misję). */
  asked: boolean;
  /** Mnożnik ceny po targowaniu (null = jeszcze się nie targowano). */
  haggle: number | null;
  wares: NomadWare[];
  /** Obrażony: nie handluje i nie rozmawia. */
  offended: boolean;
  /** Indeks powitania. */
  greet: number;
}

/** Obóz na mapie: ognisko i (opcjonalnie) namiot obok. */
export interface CampSite {
  fire: GridPos;
  tent: GridPos | null;
}

/** Obozy z mapy: ogniska z namiotami (pustkowia), samotne ogniska (ruiny), namioty bez ogniska. */
export function campSites(map: Pick<TacticalMap, 'props' | 'deco' | 'decor'>): CampSite[] {
  const fires = [...map.deco, ...map.decor].filter((p) => p.type === 'campfire').map((p) => ({ gx: p.gx, gy: p.gy }));
  const tents = map.props.filter((p) => p.type === 'tent').map((p) => ({ gx: p.gx, gy: p.gy }));
  const out: CampSite[] = [];
  const used = new Set<GridPos>();
  for (const f of fires) {
    if (out.some((c) => c.fire.gx === f.gx && c.fire.gy === f.gy)) continue;
    const t = tents.find((x) => !used.has(x) && Math.max(Math.abs(x.gx - f.gx), Math.abs(x.gy - f.gy)) <= 1) ?? null;
    if (t) used.add(t);
    out.push({ fire: f, tent: t });
  }
  for (const t of tents) if (!used.has(t)) out.push({ fire: t, tent: t });
  return out;
}

/** Cena towaru u nomada: cena bazowa x narzut x targowanie x reputacja (rabat jak u handlarza Przystani). */
export function nomadPrice(id: ItemId, st: Pick<NomadState, 'haggle'>, rep: number): number {
  const disc = Math.min(0.25, Math.max(-0.2, rep * 0.02));
  return Math.max(1, Math.round((itemDef(id)?.price ?? 10) * FIELD_MARKUP * (st.haggle ?? 1) * (1 - disc)));
}

/** Umiejętności rozmowy: wypytywanie (Dyplomacja / Zastraszanie) i targowanie (Dyplomacja / Oszustwo). */
export const ASK_SKILLS: readonly SkillId[] = ['diplomacy', 'intimidation'];
export const HAGGLE_SKILLS: readonly SkillId[] = ['diplomacy', 'deception'];
/** Mnożnik ceny wg stopnia sukcesu targowania (kryt. porażka, porażka, sukces, kryt. sukces). */
export const HAGGLE_MULT = [1.2, 1, 0.85, 0.7] as const;
/** Pula łupu z namiotu. */
export const TENT_LOOT: readonly ItemId[] = ['canned_food', 'canned_food', 'bandage', 'antirad', 'ammo_box', 'lockpick', 'molotov', 'copper_wire', 'old_watch', 'battery'];
