# Launcher (plik wykonywalny)

Samodzielny plik wykonywalny, który uruchamia grę w domyślnej przeglądarce. Gracz nie potrzebuje Node, Go ani instalacji.

## Jak działa
- `tools/launcher/main.go` (Go) ma wbudowany cały build Vite (`dist/`) przez `go:embed`.
- Po uruchomieniu startuje serwer HTTP na `127.0.0.1:47820` i otwiera `http://127.0.0.1:47820/` w przeglądarce.
- Windows / Linux: okno konsoli trzeba zostawić otwarte; zamknięcie go (lub Ctrl+C) kończy serwer.
- macOS (`Pył i Rdza.app`): bez okna i bez ikony w Docku; launcher kończy pracę sam, ok. 10 s po zamknięciu ostatniej karty z grą (tryb `--auto-exit`).
- **Stały port** jest celowy: ustawienia i zapisy gry są w `localStorage`, przypisanym do adresu z portem. Inny port = puste zapisy.
- Drugie uruchomienie, gdy gra już działa, tylko otwiera nową kartę.
- Plik nie działa z `file://`, bo Phaser wczytuje obrazy przez XHR — stąd lokalny serwer.

## Opcje
| Flaga | Opis |
|---|---|
| `--res=640x480\|hd\|fhd\|qhd\|4k` | rozdzielczość (przekazywana jako `?res=`) |
| `--port=N` | inny port (gdy 47820 zajmuje obcy program; zapisy będą osobne) |
| `--no-browser` | tylko serwer, bez otwierania przeglądarki |
| `--auto-exit` | zakończ po zamknięciu ostatniej karty z grą (domyślnie włączone w `.app`) |

### Auto-wyjście
Serwer dokleja do `index.html` `new EventSource('/__alive')`. Każda otwarta karta trzyma to połączenie; gdy przez 10 s nie ma żadnego (odświeżenie strony mieści się w tym czasie), launcher kończy pracę. Jeśli żadna karta nie połączy się w ciągu 3 min od startu (przeglądarka się nie otworzyła), też kończy.

## Budowanie
Wymaga Go >= 1.22 (tylko do pakowania).

```
npm run package             # wszystkie platformy
npm run package -- windows  # tylko wybrane: windows | linux | macos
```

Wynik w `release/` (ignorowany przez git):
- `pyl-i-rdza-<wersja>-windows-x64.exe`, `pyl-i-rdza-<wersja>-linux-x64` (ok. 16 MB),
- `Pył i Rdza.app` (ok. 32 MB): jeden uniwersalny plik Mach-O dla Apple Silicon i Intel (łączony w `tools/package.mjs` bez `lipo`), `Info.plist` z `LSUIElement` (bez Docka) i ikona `tools/launcher/AppIcon.icns`. Budowana na Macu jest dodatkowo podpisywana ad hoc (`codesign --sign -`).

Aby przekazać `.app` komuś innemu: prawy klik w Finderze → „Kompresuj” i wysłać `.zip`.

### Ikona
`tools/launcher/AppIcon.icns` jest generowana proceduralnie (pixel art: znak radiacji na rdzawej blasze) przez `node tools/launcher/make-icon.cjs` (Playwright). Podgląd: `tools/launcher/icon-preview.png`.

## Ograniczenia
- Pliki nie są podpisane: Windows SmartScreen pokaże ostrzeżenie („Więcej informacji” → „Uruchom mimo to”), macOS Gatekeeper wymaga prawego kliku → „Otwórz” (albo `xattr -d com.apple.quarantine <plik>`). Na Linux/macOS może być potrzebne `chmod +x`.
- macOS: gdy gra już działa, ponowny dwuklik w `.app` nic nie robi (system tylko aktywuje działającą, niewidoczną aplikację) — kartę z grą trzeba znaleźć w przeglądarce.
- Gra działa w karcie przeglądarki (z paskiem adresu); pełny ekran przez F11 lub opcję w grze.
