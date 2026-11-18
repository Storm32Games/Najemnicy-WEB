import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// Wersja gry = numer ostatniego scalenia (PR) podzielony przez 100: scalenie #72 -> 0.72, #105 -> 1.05.
// Numer scalenia = liczba merge'y do main (commity scalające na głównej linii historii) plus VERSION_OFFSET
// (część PR-ów nie trafiła do main jako merge) - po scaleniu PR #70 (67. merge) numer to 70.
// Bez dostępu do gita: wersja zapisana w package.json (major.minor).
const VERSION_OFFSET = 3;
const PKG = new URL('./package.json', import.meta.url);

/** Numer ostatniego scalenia z historii gita albo null (brak gita, np. paczka zip). */
function mergeNumber(): number | null {
  try {
    const merges = Number(execSync('git rev-list --count --merges --first-parent HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    return Number.isInteger(merges) && merges > 0 ? merges + VERSION_OFFSET : null;
  } catch {
    return null;
  }
}

/** Numer scalenia / 100 z dwoma miejscami po przecinku ("0.72"). */
const versionOf = (merge: number): string => (merge / 100).toFixed(2);

function gameVersion(): string {
  const n = mergeNumber();
  if (n !== null) return versionOf(n);
  const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { version: string };
  return pkg.version.split('.').slice(0, 2).join('.');
}

/** Przy `npm run build` zapisuje ustaloną wersję w package.json ("0.72.0"), żeby paczka bez gita znała ją dalej. */
function saveVersion(version: string): Plugin {
  return {
    name: 'save-game-version',
    apply: 'build',
    buildStart() {
      try {
        const src = readFileSync(PKG, 'utf8');
        const next = src.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}.0$2`);
        if (next !== src) writeFileSync(PKG, next);
      } catch {
        // package.json tylko do odczytu - wersja i tak trafia do gry przez __GAME_VERSION__
      }
    },
  };
}

const VERSION = gameVersion();

export default defineConfig({
  define: {
    __GAME_VERSION__: JSON.stringify(VERSION),
  },
  plugins: [saveVersion(VERSION)],
});
