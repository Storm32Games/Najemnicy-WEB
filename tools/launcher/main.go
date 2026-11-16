// Launcher gry "Pył i Rdza": jeden plik wykonywalny z wbudowanym buildem Vite (dist/).
// Uruchamia lokalny serwer HTTP na 127.0.0.1 i otwiera grę w domyślnej przeglądarce.
//
// Stały port jest ważny: gra trzyma ustawienia i zapisy w localStorage, a ten jest
// przypisany do originu (host + port). Inny port = puste zapisy.
//
// Budowanie: npm run package (patrz tools/package.mjs i docs/LAUNCHER.md).
package main

import (
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
	"time"
)

//go:embed all:web
var webFS embed.FS

const (
	defaultPort = 47820
	pingPath    = "/__launcher"
	pingReply   = "pyl-i-rdza-launcher"
)

// Ustawiane przez -ldflags "-X main.version=..." w tools/package.mjs.
var version = "dev"

func main() {
	port := flag.Int("port", defaultPort, "port lokalnego serwera")
	res := flag.String("res", "", "rozdzielczość: 640x480 | hd | fhd | qhd | 4k")
	noBrowser := flag.Bool("no-browser", false, "nie otwieraj przeglądarki (tylko serwer)")
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
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		fail("Brak wbudowanej gry (web/index.html). Zbuduj launcher przez: npm run package")
	}

	mux := http.NewServeMux()
	mux.HandleFunc(pingPath, func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, pingReply)
	})
	files := http.FileServer(http.FS(sub))
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Bez cache: po podmianie pliku .exe na nowszą wersję przeglądarka nie poda starych zasobów.
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	}))

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fail(err.Error())
		}
	}()

	fmt.Printf("Gra działa pod adresem: %s\n", gameURL)
	fmt.Println("Zamknij to okno (lub Ctrl+C), aby zakończyć.")
	if !*noBrowser {
		openBrowser(gameURL)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	<-stop
	_ = srv.Close()
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

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "BŁĄD: "+msg)
	if runtime.GOOS == "windows" {
		// Okno konsoli po dwukliku znika od razu — daj czas na przeczytanie.
		fmt.Fprintln(os.Stderr, "Naciśnij Enter, aby zamknąć...")
		fmt.Scanln()
	}
	os.Exit(1)
}
