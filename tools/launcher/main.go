// Launcher gry "Pył i Rdza": jeden plik wykonywalny z wbudowanym buildem Vite (dist/).
// Uruchamia lokalny serwer HTTP na 127.0.0.1 i otwiera grę w domyślnej przeglądarce.
//
// Stały port jest ważny: gra trzyma ustawienia i zapisy w localStorage, a ten jest
// przypisany do originu (host + port). Inny port = puste zapisy.
//
// Tryb auto-wyjścia (--auto-exit, domyślny wewnątrz "Pył i Rdza.app" na macOS, gdzie nie ma
// okna konsoli do zamknięcia): do index.html wstrzykiwany jest EventSource na /__alive.
// Serwer kończy pracę, gdy przez chwilę nie ma żadnej otwartej karty z grą.
//
// Budowanie: npm run package (patrz tools/package.mjs i docs/LAUNCHER.md).
package main

import (
	"bytes"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed all:web
var webFS embed.FS

const (
	defaultPort = 47820
	pingPath    = "/__launcher"
	pingReply   = "pyl-i-rdza-launcher"
	alivePath   = "/__alive"

	// Ile czekać po zamknięciu ostatniej karty (odświeżenie strony nie może zabić serwera).
	closeGrace = 10 * time.Second
	// Ile czekać na pierwszą kartę, zanim uznamy, że przeglądarka się nie otworzyła.
	firstVisitTimeout = 3 * time.Minute
)

// Ustawiane przez -ldflags "-X main.version=..." w tools/package.mjs.
var version = "dev"

// Wewnątrz pakietu .app nie ma konsoli: komunikaty idą do okienek systemowych.
var inAppBundle = strings.Contains(exePath(), ".app/Contents/MacOS/")

func main() {
	port := flag.Int("port", defaultPort, "port lokalnego serwera")
	res := flag.String("res", "", "rozdzielczość: 640x480 | hd | fhd | qhd | 4k")
	noBrowser := flag.Bool("no-browser", false, "nie otwieraj przeglądarki (tylko serwer)")
	autoExit := flag.Bool("auto-exit", inAppBundle, "zakończ, gdy zamknięto ostatnią kartę z grą")
	flag.Parse()

	fmt.Printf("Pył i Rdza — launcher %s\n", version)

	gameURL := fmt.Sprintf("http://127.0.0.1:%d/", *port)
	if *res != "" {
		gameURL += "?res=" + url.QueryEscape(*res)
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		// Port zajęty: jeśli to nasz launcher (gra już działa), wystarczy otworzyć kartę.
		if isOurLauncher(*port) {
			fmt.Println("Gra już działa — otwieram nową kartę.")
			if !*noBrowser {
				openBrowser(gameURL)
			}
			return
		}
		fail(fmt.Sprintf("Port %d jest zajęty przez inny program.\nUruchom z innym portem, np.:  --port %d\n(Uwaga: zapisy gry są przypisane do portu.)", *port, *port+1))
	}

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		fail(err.Error())
	}
	index, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		fail("Brak wbudowanej gry (web/index.html). Zbuduj launcher przez: npm run package")
	}
	if *autoExit {
		// Karta trzyma połączenie; jego zerwanie = karta zamknięta. EventSource sam wznawia
		// połączenie po odświeżeniu lub chwilowym błędzie.
		index = bytes.Replace(index, []byte("</head>"), []byte("<script>new EventSource('"+alivePath+"')</script></head>"), 1)
	}

	tabs := newTabCounter()
	mux := http.NewServeMux()
	mux.HandleFunc(pingPath, func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, pingReply)
	})
	mux.HandleFunc(alivePath, tabs.serve)
	files := http.FileServer(http.FS(sub))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Bez cache: po podmianie launchera na nowszą wersję przeglądarka nie poda starych zasobów.
		w.Header().Set("Cache-Control", "no-cache")
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(index)
			return
		}
		files.ServeHTTP(w, r)
	}))

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fail(err.Error())
		}
	}()

	fmt.Printf("Gra działa pod adresem: %s\n", gameURL)
	if *autoExit {
		fmt.Println("Launcher zakończy pracę po zamknięciu karty z grą.")
	} else {
		fmt.Println("Zamknij to okno (lub Ctrl+C), aby zakończyć.")
	}
	if !*noBrowser {
		openBrowser(gameURL)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	done := make(chan struct{})
	if *autoExit {
		go tabs.watch(done)
	}
	select {
	case <-stop:
	case <-done:
		fmt.Println("Brak otwartych kart z grą — koniec.")
	}
	_ = srv.Close()
}

// tabCounter liczy otwarte karty (połączenia EventSource na /__alive).
type tabCounter struct {
	mu      sync.Mutex
	open    int
	seen    bool      // była już co najmniej jedna karta
	emptyAt time.Time // od kiedy nie ma żadnej karty
}

func newTabCounter() *tabCounter { return &tabCounter{emptyAt: time.Now()} }

func (t *tabCounter) serve(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	io.WriteString(w, ": ok\n\n")
	fl.Flush()

	t.mu.Lock()
	t.open++
	t.seen = true
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		t.open--
		if t.open == 0 {
			t.emptyAt = time.Now()
		}
		t.mu.Unlock()
	}()

	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
			// Komentarz SSE: podtrzymuje połączenie i szybko wykrywa zamkniętą kartę.
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

func (t *tabCounter) watch(done chan<- struct{}) {
	for range time.Tick(time.Second) {
		t.mu.Lock()
		open, seen, idle := t.open, t.seen, time.Since(t.emptyAt)
		t.mu.Unlock()
		if open > 0 {
			continue
		}
		if (seen && idle >= closeGrace) || (!seen && idle >= firstVisitTimeout) {
			close(done)
			return
		}
	}
}

func isOurLauncher(port int) bool {
	c := http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d%s", port, pingPath))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
	return strings.TrimSpace(string(b)) == pingReply
}

func openBrowser(u string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	case "darwin":
		cmd = exec.Command("open", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	if err := cmd.Start(); err != nil {
		fmt.Printf("Nie udało się otworzyć przeglądarki (%v).\nOtwórz ręcznie: %s\n", err, u)
		return
	}
	go cmd.Wait()
}

func exePath() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	return p
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "BŁĄD: "+msg)
	switch {
	case inAppBundle:
		// Aplikacja .app nie ma konsoli: pokaż okienko systemowe.
		esc := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(msg)
		_ = exec.Command("osascript", "-e",
			`display dialog "`+esc+`" with title "Pył i Rdza" buttons {"OK"} default button "OK" with icon stop`).Run()
	case runtime.GOOS == "windows":
		// Okno konsoli po dwukliku znika od razu — daj czas na przeczytanie.
		fmt.Fprintln(os.Stderr, "Naciśnij Enter, aby zamknąć...")
		fmt.Scanln()
	}
	os.Exit(1)
}
