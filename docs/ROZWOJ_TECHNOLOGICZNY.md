# Rozwój technologiczny: fanty -> schematy -> nowy sprzęt u handlarza

Status: **projekt** (nic z tego nie jest jeszcze w kodzie). Etapy wdrożenia na końcu.

## Idea w jednym zdaniu
Fanty z misji przestają być tylko walutą: można je **oddać do Warsztatu w Przystani**, gdzie z odpowiedniego zestawu
części powstaje **schemat** (np. zegarek + dynamit + miedź = bomba zegarowa). Odkryty schemat na stałe trafia
do oferty handlarza, a części przyniesione później tanio zamieniają się w gotowe egzemplarze.

## Pętla rozgrywki
1. **Misja**: drużyna znajduje fanty (już są: `old_watch`, `copper_wire`, `scrap_metal`, `battery`, `circuit`,
   `vacuum_tube`, `drone_parts`, `power_core`, `memory_card`, `mutant_gland`, `fuel_can`, `gas_mask`...).
2. **Przystań, handlarz**: przy każdym fancie są dwie opcje: **Sprzedaj** (Złom teraz) albo **Do warsztatu** (część
   trafia do magazynu części). Podpowiedź przy fancie mówi, w ilu znanych / przeczuwanych recepturach jest potrzebny.
3. **Warsztat** (nowa zakładka w Przystani): lista receptur. Receptura ma trzy stany:
   - **nieznana**: widać tylko `???` i jedną podpowiedź („coś, co tyka”), gdy masz choć jedną z jej części,
   - **przeczuwana**: widać listę części, brakujące są wyszarzone (odsłania się po zdobyciu połowy części albo po
     znalezieniu notatek / karty pamięci),
   - **opracowana**: schemat jest twój.
4. **Opracowanie schematu** (raz): zużywa komplet części + Złom + **dni** (jak odpoczynek: drużyna je zapasy,
   `food.ts`). Test Techniki najlepszego technika w drużynie skraca czas; porażka krytyczna niszczy jedną część.
5. **Po opracowaniu**:
   - handlarz **zawsze** ma przedmiot w ofercie (`shopStock` dokłada znane schematy), cena rynkowa,
   - **Produkcja w warsztacie**: oddajesz części, płacisz ~30% ceny, przedmiot od razu w skrytce (bez dni),
   - pierwszy egzemplarz dostajesz gratis (nagroda za badania).

Dzięki temu sprzedaż i badania konkurują: sprzedany zegarek to 40 Złomu teraz, zatrzymany to bomba na zawsze.

## Poziomy warsztatu (oś „technologii”)
Postęp mierzy liczba opracowanych schematów i kilka **przełomów** (kluczowe części). Poziom odblokowuje kolejne receptury.

| Poziom | Nazwa | Warunek | Co otwiera |
|---|---|---|---|
| 0 | Majsterkownia | start | proste receptury: bandaże, pułapki, koktajle, wytrychy |
| 1 | Warsztat | 3 schematy + `battery` | elektryka: zapalniki, latarki, prosty terminal, bomba zegarowa |
| 2 | Pracownia | 6 schematów + `circuit` | elektronika: aplikacje hakerskie, EMP, modyfikacje broni |
| 3 | Laboratorium | 10 schematów + `power_core` | energia: broń laserowa, drony, implanty, wieżyczka |

Przełomy można też dostać fabularnie (Nomadzi uczą chemii przy reputacji, Ocaleni dają dostęp do starej
biblioteki technicznej) - to wiąże rozwój z frakcjami z `contracts.ts`.

## Gałęzie i przykładowe receptury
Nowe fanty oznaczone *kursywą* (trzeba je dodać do `items.ts` i tabel łupów); reszta już istnieje.

### Materiały wybuchowe
| Wynik | Części | Poziom | Efekt |
|---|---|---|---|
| Ładunek dynamitu | *dynamit* + `copper_wire` | 0 | rzut, duże obrażenia obszarowe, głośny |
| **Bomba zegarowa** | `old_watch` + *dynamit* + `copper_wire` | 1 | kładziona na polu, wybucha po 2 turach; niszczy drzwi i osłony; idealna do zasadzki |
| Mina zbliżeniowa | *dynamit* + `circuit` + `scrap_metal` | 2 | ukryta na polu, wybucha, gdy wróg wejdzie |
| Granat EMP (lepszy) | `battery` + `circuit` + `copper_wire` | 2 | ogłusza drony / wieżyczki na 2 tury |
| Koktajl Mołotowa (tani) | `fuel_can` + *butelka* + *szmata* | 0 | taniej niż u handlarza |

### Włamywanie
| Wynik | Części | Poziom | Efekt |
|---|---|---|---|
| Wytrychy (lepsze) | `scrap_metal` x2 + *sprężyna* | 0 | `lockpick`, +1 do Złodziejstwa |
| Łom hydrauliczny | *rura* + *siłownik* | 1 | otwiera drzwi siłą (Atletyka zamiast Złodziejstwa), głośno |
| Pasta termitowa | *aluminium* + *rdza* + `fuel_can` | 1 | otwiera zamek bez testu w 1 turę, ślad i hałas |
| Elektroniczny wytrych | `circuit` + `battery` + `lockpick` | 2 | zamki elektroniczne (bunkry) bez kary |

### Elektronika i aplikacje hakerskie
Nowy przedmiot **Terminal polowy** (receptura poziomu 1: `vacuum_tube` + `battery` + `copper_wire` + *obudowa*).
Ma 2-3 gniazda na **aplikacje** (przedmioty typu `app`, wgrywane w warsztacie). Aplikacje działają przy akcji
hakowania (misja `hack`, terminale na mapie, drony, wieżyczki):

| Aplikacja | Części | Poziom | Efekt |
|---|---|---|---|
| Łamacz haseł | `memory_card` + `circuit` | 2 | +2 do testu hakowania |
| Pętla kamer | `memory_card` + `drone_parts` | 2 | wyłącza alarm / kamery w sektorze (krótsze wykrywanie) |
| Robak przejęcia | `memory_card` + `drone_parts` + `circuit` | 3 | przejęty dron walczy po stronie drużyny przez 3 tury |
| Dekoder archiwów | `memory_card` x2 | 2 | z kart pamięci odczytuje podpowiedzi receptur (stan „przeczuwana”) |

To daje drugie życie karcie pamięci: sprzedać, odczytać schemat albo zrobić z niej aplikację.

### Broń i modyfikacje
| Wynik | Części | Poziom | Efekt |
|---|---|---|---|
| Lufa obrzynana | `scrap_metal` + *rura* | 0 | strzelba: +rozrzut, -zasięg |
| Celownik z soczewek | *soczewka* x2 + `scrap_metal` | 1 | +1 do trafienia bronią dystansową |
| Strzały z grotem z blachy | `scrap_metal` + *pióra* | 0 | łuk / kusza: +1 obrażeń (łucznik dostaje własną ścieżkę) |
| Elektryczna pałka | `pipe` + `battery` + `copper_wire` | 1 | ogłuszenie przy trafieniu |
| Pistolet laserowy | `power_core` + `circuit` + `vacuum_tube` | 3 | `laser_pistol` z warsztatu zamiast losowej oferty |

Modyfikacje to osobny slot na broni (`ItemInstance.mods`), więc ten sam karabin można ulepszać.

### Chemia i medycyna (alchemik, medyk)
| Wynik | Części | Poziom | Efekt |
|---|---|---|---|
| Bandaż (tani) | *szmata* + *bimber* | 0 | `bandage` |
| Stymulant bojowy | `mutant_gland` + *chemikalia* | 1 | `combat_stim` |
| Antyrad | `mutant_gland` + `gas_mask` (filtr) | 1 | `antirad` |
| Filtr do maski | `gas_mask` + *węgiel* | 1 | odporność na gaz / toksyczną mgłę |

### Przetrwanie i Przystań
| Wynik | Części | Poziom | Efekt |
|---|---|---|---|
| Wędzarnia | `scrap_metal` x3 + `fuel_can` | 1 | budowa w Przystani: spichrz +4 dni (`food.ts`, max 20 -> 24) |
| Radio dalekiego zasięgu | `radio_part` + `vacuum_tube` + `battery` | 2 | więcej zleceń na tablicy / zlecenia frakcji |

Tu technologia rozwija **bazę**, nie tylko ekwipunek - dobrze łączy się z zapasami żywności.

## Zasady balansu
- Wartość wyniku ≈ 1,5-2 x suma cen sprzedaży części (opłaca się badać, ale sprzedaż nie jest głupia).
- Każdy fant jest w 2-3 recepturach z różnych gałęzi, więc gracz wybiera, w co inwestuje.
- Rzadkie części (`circuit`, `power_core`, `drone_parts`) wyłącznie z misji (nie u handlarza), żeby misje
  zostały głównym źródłem postępu. Pospolite (`scrap_metal`, `copper_wire`) handlarz czasem sprzedaje.
- Nowe fanty trafiają do łupów zależnie od biomu: *dynamit* - przemysł / kopalnie, *soczewka*, *sprężyna* - ruiny,
  *chemikalia* - bunkry, *pióra*, *węgiel* - pustkowia.
- Produkcja przedmiotów jednorazowych (bomby, granaty) jest tania; trwałe (terminal, broń, modyfikacje)
  wymagają opracowania i części za każdym razem.

## Architektura (zgodnie z CLAUDE.md)
- `src/core/data/recipes.ts` - tabela receptur: `{ id, out, parts: {id, qty}[], scrap, days, level, branch, hint }`.
- `src/core/campaign/tech.ts` (czysta logika, bez Phasera):
  `recipeState(state, id)`, `canResearch`, `research(state, id, rng)`, `craft(state, id)`, `workshopLevel(state)`,
  `partUses(id)` (do podpowiedzi przy sprzedaży).
- `CampaignState.tech = { known: string[]; hinted: string[]; parts: ItemInstance[] }` + migracja zapisów
  (stare zapisy: puste pola).
- `economy.shopStock` dokłada wyniki `known` (zawsze w ofercie).
- Nowy typ przedmiotu `app` i pole `slots` na terminalu; akcja hakowania (`Combat` / `Mission`) czyta aplikacje.
- UI: zakładka **Warsztat** w `HubScene` + przycisk „Do warsztatu” w sklepie.
- Testy: `tests/core.selftest.ts` - receptura zużywa części, schemat trafia do `known`, sklep go oferuje,
  zapis bez `tech` się wczytuje.

## Etapy wdrożenia
1. **Rdzeń**: `recipes.ts`, `tech.ts`, stan + zapis, 5 receptur na istniejących fantach (bomba zegarowa
   z nowym fantem *dynamit*, wytrychy, mołotow, bandaż, granat EMP), oferta handlarza, testy.
2. **UI Warsztatu** w Przystani, „Do warsztatu” w sklepie, podpowiedzi „???”.
3. **Nowe fanty** w łupach wg biomu + bomba zegarowa jako akcja w walce (kładzenie ładunku, odliczanie tur).
4. **Terminal i aplikacje hakerskie** (misja `hack`, drony).
5. **Modyfikacje broni** i budowy w Przystani (wędzarnia, radio).
6. Poziomy warsztatu 2-3, broń laserowa, przełomy fabularne z frakcjami.
