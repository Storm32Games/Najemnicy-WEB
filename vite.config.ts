import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Wersja gry: 0.1 za każdy merge do main (liczone po commitach scalających na głównej linii historii).
// 9 merge'y = 0.9, 10 = 1.0 itd. Bez dostępu do gita: wersja z package.json.
function gameVersion(): string {
  try {
    const merges = Number(execSync('git rev-list --count --merges --first-parent HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    if (Number.isInteger(merges) && merges > 0) return `${Math.floor(merges / 10)}.${merges % 10}`;
  } catch {
    // brak gita (np. paczka zip) - fallback niżej
  }
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version.split('.').slice(0, 2).join('.');
}

export default defineConfig({
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion()),
  },
});
