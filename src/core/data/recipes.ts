// Receptury warsztatu Przystani (projekt: docs/ROZWOJ_TECHNOLOGICZNY.md, logika: campaign/tech.ts).
// Schemat opracowuje się raz (części + Złom + dni); potem handlarz zawsze ma przedmiot w ofercie,
// a warsztat produkuje go z części za ~30% ceny.
import type { ItemId } from './ids.ts';

export type RecipeBranch = 'explosives' | 'breaking' | 'electronics' | 'weapons' | 'chemistry' | 'haven';

export const BRANCH_NAMES: Readonly<Record<RecipeBranch, string>> = {
  explosives: 'Materiały wybuchowe',
  breaking: 'Włamywanie',
  electronics: 'Elektronika',
  weapons: 'Broń',
  chemistry: 'Chemia',
  haven: 'Przystań',
};

export interface RecipePart {
  id: ItemId;
  qty: number;
}

export interface RecipeDef {
  id: string;
  /** Wynik produkcji (przedmiot i liczba sztuk). */
  out: RecipePart;
  parts: readonly RecipePart[];
  /** Koszt opracowania schematu w Złomie. */
  scrap: number;
  /** Dni opracowania (przy zwykłym sukcesie testu Techniki). */
  days: number;
  /** Wymagany poziom warsztatu (WORKSHOP_LEVELS). */
  level: number;
  branch: RecipeBranch;
  /** Podpowiedź do receptury nieznanej („???”). */
  hint: string;
  /** Przedmiot tylko ze schematu: bez opracowania nie ma go w losowej ofercie handlarza. */
  exclusive?: boolean;
}

export const RECIPES: readonly RecipeDef[] = [
  {
    id: 'lockpick', out: { id: 'lockpick', qty: 1 }, parts: [{ id: 'scrap_metal', qty: 2 }, { id: 'copper_wire', qty: 1 }],
    scrap: 15, days: 1, level: 0, branch: 'breaking', hint: 'Coś z cienkiego drutu i blachy, co otwiera drzwi.',
  },
  {
    id: 'molotov', out: { id: 'molotov', qty: 2 }, parts: [{ id: 'fuel_can', qty: 1 }],
    scrap: 10, days: 1, level: 0, branch: 'explosives', hint: 'Paliwo da się rozlać do butelek.',
  },
  {
    id: 'dynamite_charge', out: { id: 'dynamite_charge', qty: 1 }, parts: [{ id: 'dynamite', qty: 1 }, { id: 'copper_wire', qty: 1 }],
    scrap: 20, days: 1, level: 0, branch: 'explosives', hint: 'Laska czegoś wybuchowego potrzebuje zapalnika.', exclusive: true,
  },
  {
    id: 'time_bomb', out: { id: 'time_bomb', qty: 1 }, parts: [{ id: 'old_watch', qty: 1 }, { id: 'dynamite', qty: 1 }, { id: 'copper_wire', qty: 1 }],
    scrap: 40, days: 2, level: 1, branch: 'explosives', hint: 'Coś, co tyka, plus coś, co wybucha.', exclusive: true,
  },
  {
    id: 'emp_grenade', out: { id: 'emp_grenade', qty: 1 }, parts: [{ id: 'battery', qty: 1 }, { id: 'circuit', qty: 1 }, { id: 'copper_wire', qty: 1 }],
    scrap: 40, days: 2, level: 1, branch: 'electronics', hint: 'Ładunek z akumulatora potrafi usmażyć elektronikę.',
  },
];

export const recipeDef = (id: string): RecipeDef | undefined => RECIPES.find((r) => r.id === id);

/** Poziomy warsztatu: ile schematów trzeba znać i jaką kluczową część oddać (przełom), żeby rozbudować. */
export interface WorkshopLevel {
  name: string;
  /** Wymagana liczba opracowanych schematów. */
  known: number;
  /** Część zużywana przy rozbudowie (null = poziom startowy). */
  part: ItemId | null;
  scrap: number;
}

export const WORKSHOP_LEVELS: readonly WorkshopLevel[] = [
  { name: 'Majsterkownia', known: 0, part: null, scrap: 0 },
  { name: 'Warsztat', known: 3, part: 'battery', scrap: 60 },
  { name: 'Pracownia', known: 6, part: 'circuit', scrap: 120 },
  { name: 'Laboratorium', known: 10, part: 'power_core', scrap: 200 },
];
