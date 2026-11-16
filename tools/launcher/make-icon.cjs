// Generuje ikonę aplikacji macOS (tools/launcher/AppIcon.icns) proceduralnie, w stylu gry:
// pixel art 32x32 (znak radiacji w bursztynie na rdzawej blasze), skalowany do 1024 px
// i obcięty do zaokrąglonego kwadratu macOS. Wynik jest w repo; skrypt potrzebny tylko do zmian.
// Użycie: node tools/launcher/make-icon.cjs   (wymaga Playwright z Chromium)
const { chromium } = require('playwright');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const draw = (size) => {
  const N = 32; // siatka pixel artu
  const BODY = 832; // 32 * 26 px na 1024 (siatka ikon macOS: ok. 100 px marginesu)
  const big = document.createElement('canvas');
  big.width = big.height = 1024;
  const g = big.getContext('2d');
  const px = document.createElement('canvas');
  px.width = px.height = N;
  const p = px.getContext('2d');
  const img = p.createImageData(N, N);
  const rnd = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
  const AMBER = [242, 169, 59], AMBER_D = [176, 104, 30], DARK = [20, 16, 13], RUST = [92, 46, 24], RUST2 = [140, 70, 32];
  const c = (N - 1) / 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - c, dy = y - c, r = Math.hypot(dx, dy);
    let ang = Math.atan2(dy, dx) * 180 / Math.PI + 90; // 0 = góra
    ang = ((ang % 360) + 360) % 360;
    // tło: ciemna blacha z plamami rdzy
    const n = rnd(x >> 1, y >> 1, 1) * 0.6 + rnd(x, y, 2) * 0.4;
    let col = n > 0.72 ? mix(RUST, RUST2, rnd(x, y, 3)) : mix(DARK, RUST, n * 0.5);
    // znak radiacji: środek + 3 płaty co 120 stopni (płat na górze skierowany w dół, jak klasyczny trefoil)
    const blade = ((ang + 30) % 120) < 60; // płaty wycentrowane na 30/150/270 st.
    const ring = r >= 4.6 && r <= 13.2 && !blade;
    const hub = r <= 2.9;
    // bursztynowa tarcza pod znakiem
    if (r <= 14.9) col = mix(AMBER, AMBER_D, Math.min(1, Math.max(0, (dy + dx * 0.4) / 18 + 0.35)));
    if (r <= 14.9 && rnd(x, y, 5) > 0.9) col = mix(col, RUST2, 0.6); // odpryski farby
    if (r > 14.9 && r <= 15.9) col = [12, 9, 7]; // obwódka
    if (ring || hub) col = DARK;
    const i = (y * N + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
  }
  p.putImageData(img, 0, 0);
  // zaokrąglony kwadrat macOS + ostre skalowanie pixel artu
  const o = (1024 - BODY) / 2, rad = 186;
  g.save();
  g.beginPath(); g.roundRect(o, o, BODY, BODY, rad); g.clip();
  g.imageSmoothingEnabled = false;
  g.drawImage(px, o, o, BODY, BODY);
  g.restore();
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.roundRect(o + 3, o + 3, BODY - 6, BODY - 6, rad - 3); g.stroke();
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
  og.drawImage(big, 0, 0, size, size);
  return out.toDataURL('image/png').split(',')[1];
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // typ ICNS -> rozmiar PNG
  const types = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const parts = [];
  for (const [type, size] of types) {
    const png = Buffer.from(await page.evaluate(draw, size), 'base64');
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    parts.push(head, png);
    if (size === 1024) writeFileSync(join(__dirname, 'icon-preview.png'), png);
  }
  await browser.close();
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  writeFileSync(join(__dirname, 'AppIcon.icns'), Buffer.concat([head, body]));
  console.log('Zapisano tools/launcher/AppIcon.icns i icon-preview.png');
})();
