import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Wersja gry: numer rosnący o 1 z każdym merge'em do main (commity scalające na głównej linii historii)
// plus VERSION_OFFSET - po scaleniu PR #63 (60. merge) wersja to 66. Bez dostępu do gita: wersja z package.json.
const VERSION_OFFSET = 6;
function gameVersion(): string {
  try {
    const merges = Number(execSync('git rev-list --count --merges --first-parent HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    if (Number.isInteger(merges) && merges > 0) return String(merges + VERSION_OFFSET);
  } catch {
    // brak gita (np. paczka zip) - fallback niżej
  }
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version.split('.')[0];
}

export default defineConfig({
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion()),
  },
});
