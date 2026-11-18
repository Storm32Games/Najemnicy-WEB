import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Wersja gry = numer ostatniego scalenia (PR) podzielony przez 100: scalenie #72 -> 0.72, #105 -> 1.05.
// Numer scalenia = liczba merge'y do main (commity scalające na głównej linii historii) plus VERSION_OFFSET
// (część PR-ów nie trafiła do main jako merge) - po scaleniu PR #70 (67. merge) numer to 70.
// Bez dostępu do gita (np. paczka zip): wersja z package.json (major.minor).
// Wersja jest liczona przy każdym buildzie i NIE jest zapisywana do package.json - build nie zmienia plików
// śledzonych przez gita, więc `git pull` po lokalnym buildzie się nie blokuje.
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

const VERSION = gameVersion();

export default defineConfig({
  define: {
    __GAME_VERSION__: JSON.stringify(VERSION),
  },
});
