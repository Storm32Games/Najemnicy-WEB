// Pakowanie gry w samodzielne pliki wykonywalne (launcher w Go z wbudowanym dist/).
// Użycie: npm run package            -> wszystkie platformy
//         npm run package -- windows  -> tylko wybrane (windows | linux | macos)
// Wynik: release/pyl-i-rdza-<wersja>-<platforma>[.exe]
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const launcher = join(root, 'tools', 'launcher');
const out = join(root, 'release');

const TARGETS = [
  { os: 'windows', arch: 'amd64', name: 'windows-x64.exe', group: 'windows' },
  { os: 'linux', arch: 'amd64', name: 'linux-x64', group: 'linux' },
  { os: 'darwin', arch: 'amd64', name: 'macos-intel', group: 'macos' },
  { os: 'darwin', arch: 'arm64', name: 'macos-arm', group: 'macos' },
];

const want = process.argv.slice(2);
const targets = want.length ? TARGETS.filter((t) => want.includes(t.group)) : TARGETS;
if (!targets.length) {
  console.error(`Nieznana platforma: ${want.join(', ')} (dostępne: windows, linux, macos)`);
  process.exit(1);
}

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });

try {
  execSync('go version', { stdio: 'ignore' });
} catch {
  console.error('Brak Go (https://go.dev/dl/, wersja >= 1.22). Jest potrzebne tylko do pakowania, nie do gry.');
  process.exit(1);
}

// Wersja jak w grze (vite.config.ts): liczba merge'y na main, fallback package.json.
let version;
try {
  const merges = Number(execSync('git rev-list --count --merges --first-parent HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  version = `${Math.floor(merges / 10)}.${merges % 10}`;
} catch {
  version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version.split('.').slice(0, 2).join('.');
}

// Względne ścieżki (--base=./): build działa niezależnie od ścieżki serwera.
run('npm run build -- --base=./');

const web = join(launcher, 'web');
rmSync(web, { recursive: true, force: true });
cpSync(join(root, 'dist'), web, { recursive: true });
mkdirSync(out, { recursive: true });

for (const t of targets) {
  const file = join(out, `pyl-i-rdza-${version}-${t.name}`);
  console.log(`-> ${file}`);
  run(`go build -trimpath -ldflags "-s -w -X main.version=${version}" -o "${file}" .`, {
    cwd: launcher,
    env: { ...process.env, GOOS: t.os, GOARCH: t.arch, CGO_ENABLED: '0' },
  });
}
console.log(`Gotowe: ${out}`);
