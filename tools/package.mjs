// Pakowanie gry w samodzielne pliki wykonywalne (launcher w Go z wbudowanym dist/).
// Użycie: npm run package            -> wszystkie platformy
//         npm run package -- windows  -> tylko wybrane (windows | linux | macos)
// Wynik w release/:
//   pyl-i-rdza-<wersja>-windows-x64.exe, pyl-i-rdza-<wersja>-linux-x64
//   Pył i Rdza.app  (macOS, jeden plik dla Apple Silicon i Intel)
import { execSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const launcher = join(root, 'tools', 'launcher');
const out = join(root, 'release');
const APP_NAME = 'Pył i Rdza';

const TARGETS = [
  { os: 'windows', arch: 'amd64', name: 'windows-x64.exe', group: 'windows' },
  { os: 'linux', arch: 'amd64', name: 'linux-x64', group: 'linux' },
  { os: 'darwin', arch: 'arm64', group: 'macos' },
  { os: 'darwin', arch: 'amd64', group: 'macos' },
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

// Wersja jak w grze (vite.config.ts): liczba merge'y na main + 6 (VERSION_OFFSET), fallback package.json.
let version;
try {
  const merges = Number(execSync('git rev-list --count --merges --first-parent HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  version = String(merges + 6);
} catch {
  version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version.split('.')[0];
}

// Względne ścieżki (--base=./): build działa niezależnie od ścieżki serwera.
run('npm run build -- --base=./');

const web = join(launcher, 'web');
rmSync(web, { recursive: true, force: true });
cpSync(join(root, 'dist'), web, { recursive: true });
mkdirSync(out, { recursive: true });

const goBuild = (t, file) =>
  run(`go build -trimpath -ldflags "-s -w -X main.version=${version}" -o "${file}" .`, {
    cwd: launcher,
    env: { ...process.env, GOOS: t.os, GOARCH: t.arch, CGO_ENABLED: '0' },
  });

const macSlices = [];
for (const t of targets) {
  if (t.os === 'darwin') {
    const file = join(tmpdir(), `pyl-i-rdza-darwin-${t.arch}-${process.pid}`);
    console.log(`-> macOS ${t.arch}`);
    goBuild(t, file);
    macSlices.push({ arch: t.arch, file });
    continue;
  }
  const file = join(out, `pyl-i-rdza-${version}-${t.name}`);
  console.log(`-> ${file}`);
  goBuild(t, file);
}

if (macSlices.length) {
  buildMacApp(macSlices);
  for (const s of macSlices) rmSync(s.file, { force: true });
}
console.log(`Gotowe: ${out}`);

/** Pakiet "Pył i Rdza.app": uniwersalny plik Mach-O (arm64 + x86_64), Info.plist i ikona. */
function buildMacApp(slices) {
  const app = join(out, `${APP_NAME}.app`);
  rmSync(app, { recursive: true, force: true });
  const macos = join(app, 'Contents', 'MacOS');
  const resources = join(app, 'Contents', 'Resources');
  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });

  const exe = join(macos, 'pyl-i-rdza');
  writeFileSync(exe, fatMachO(slices));
  chmodSync(exe, 0o755);
  copyFileSync(join(launcher, 'AppIcon.icns'), join(resources, 'AppIcon.icns'));
  writeFileSync(join(app, 'Contents', 'Info.plist'), infoPlist());
  writeFileSync(join(app, 'Contents', 'PkgInfo'), 'APPL????');

  // Na Macu: podpis ad hoc całego pakietu (lokalnie zbudowana aplikacja otwiera się bez ostrzeżeń).
  if (process.platform === 'darwin') {
    try {
      execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });
    } catch {
      console.warn('codesign nie zadziałał — aplikacja i tak powinna się uruchomić (prawy klik → Otwórz).');
    }
  }
  console.log(`-> ${app}`);
}

/** Łączy pliki Mach-O w jeden uniwersalny (jak `lipo -create`), bez narzędzi Apple. */
function fatMachO(slices) {
  const CPU = { arm64: [0x0100000c, 0], amd64: [0x01000007, 3] };
  const ALIGN = 14; // 2^14 = 16 KiB (strona na arm64)
  const bins = slices.map((s) => readFileSync(s.file));
  const header = Buffer.alloc(8 + 20 * bins.length);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(bins.length, 4);
  const parts = [header];
  let offset = header.length;
  bins.forEach((bin, i) => {
    const pad = (-offset) & ((1 << ALIGN) - 1);
    if (pad) parts.push(Buffer.alloc(pad));
    offset += pad;
    const [cputype, subtype] = CPU[slices[i].arch];
    const e = 8 + 20 * i;
    header.writeUInt32BE(cputype, e);
    header.writeUInt32BE(subtype, e + 4);
    header.writeUInt32BE(offset, e + 8);
    header.writeUInt32BE(bin.length, e + 12);
    header.writeUInt32BE(ALIGN, e + 16);
    parts.push(bin);
    offset += bin.length;
  });
  return Buffer.concat(parts);
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>com.storm32games.pyl-i-rdza</string>
  <key>CFBundleExecutable</key><string>pyl-i-rdza</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <!-- Bez ikony w Docku: launcher nie ma okna, gra działa w przeglądarce. -->
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}
