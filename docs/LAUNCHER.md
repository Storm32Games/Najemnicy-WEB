# Launcher (plik wykonywalny)

Samodzielny plik wykonywalny, który uruchamia grę w domyślnej przeglądarce. Gracz nie potrzebuje Node, Go ani instalacji.

## Jak działa
- `tools/launcher/main.go` (Go) ma wbudowany cały build Vite (`dist/`) przez `go:embed`.
- Po uruchomieniu startuje serwer HTTP na `127.0.0.1:47820` i otwiera `http://127.0.0.1:47820/` w przeglądarce.
- Okno konsoli trzeba zostawić otwarte; zamknięcie go (lub Ctrl+C) kończy serwer.
- **Stały port** jest celowy: ustawienia i zapisy gry są w `localStorage`, przypisanym do adresu z portem. Inny port = puste zapisy.
- Drugie uruchomienie, gdy gra już działa, tylko otwiera nową kartę.
- Plik nie działa z `file://`, bo Phaser wczytuje obrazy przez XHR — stąd lokalny serwer.

## Opcje
| Flaga | Opis |
|---|---|
| `--res=640x480\|hd\|fhd\|qhd\|4k` | rozdzielczość (przekazywana jako `?res=`) |
| `--port=N` | inny port (gdy 47820 zajmuje obcy program; zapisy będą osobne) |
| `--no-browser` | tylko serwer, bez otwierania przeglądarki |

## Budowanie
Wymaga Go >= 1.22 (tylko do pakowania).

```
npm run package             # wszystkie platformy
npm run package -- windows  # tylko wybrane: windows | linux | macos
```

Wynik w `release/` (ignorowany przez git), ok. 16 MB na plik:
`pyl-i-rdza-<wersja>-windows-x64.exe`, `-linux-x64`, `-macos-intel`, `-macos-arm`.

## Ograniczenia
- Pliki nie są podpisane: Windows SmartScreen pokaże ostrzeżenie („Więcej informacji” → „Uruchom mimo to”), macOS Gatekeeper wymaga prawego kliku → „Otwórz” (albo `xattr -d com.apple.quarantine <plik>`). Na Linux/macOS może być potrzebne `chmod +x`.
- Gra działa w karcie przeglądarki (z paskiem adresu); pełny ekran przez F11 lub opcję w grze.
