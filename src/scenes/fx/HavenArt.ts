import type { Ctx2D } from '../ui/Kit';
import { FOLIAGE, bush, grass, ivy, leafyTree } from './Nature';
import { type ColorIn, css, glow, line, mix, rgbOf } from './Painter';

// Przystań na planszy 5 intro: dawna zajezdnia tramwajowa po zagładzie, zamieniona w osadę.
// Ceglana hala z trzema łukowymi bramami na tory (jedna zaspawana blachą, środkowa otwarta z tramwajem w środku,
// prawa zawalona i zabita deskami), zawalony narożnik szczytu z odsłoniętymi kratownicami i brzozą z wyrwy,
// mur z wraków tramwajów, blach i opon pod drutem kolczastym, wieże z rur i worków z piaskiem, wygięte słupy
// trakcji z zerwanymi drutami, girlandy żarówek. Noc: księżyc z prawej (chłodna obwódka), ciepłe światło z bram.
// Wszystko w pikselach projektowych; (ox) - przesunięcie warstwy paralaksy.

type R = () => number;

/** Hala: środek, połowa szerokości, podstawa, wysokość ścian i szczytu. */
export const DEPOT = { cx: 240, hw: 118, base: 197, eave: 124, ridge: 86 } as const;
/** Bramy (środki x) i ich półszerokość. */
const GATES = [184, 240, 296] as const;
const GW = 22;
/** Wysokość bram (łuk wystaje nad głowy postaci stojących przed halą). */
const GH = 64;
/** Spoiny i palety. */
const BRICK = ['#2a1a18', '#341f1c', '#3e2620', '#4a2c24', '#5a3628'] as const;
const MORTAR = '#1a1210';
const MOON = '#6a7aa0';
const WARM = '#ffb050';

export function paintDepot(g: Ctx2D, ox: number, r: R): { bulbs: [number, number][]; sparks: [number, number] } {
  const P = (c: ColorIn, x: number, y: number, w = 1, h = 1): void => {
    g.fillStyle = css(c);
    g.fillRect(Math.round(ox + x), Math.round(y), Math.round(w), Math.round(h));
  };
  const L = (x0: number, y0: number, x1: number, y1: number, c: ColorIn): void => line(g, ox + x0, y0, ox + x1, y1, c);
  const { cx, hw, base, eave, ridge } = DEPOT;
  const x0 = cx - hw, x1 = cx + hw;
  /** Górna krawędź szczytu (łuk) w kolumnie x. */
  const gable = (x: number): number => {
    const u = (x - cx) / hw;
    return Math.round(eave - (eave - ridge) * Math.sqrt(Math.max(0, 1 - u * u)));
  };
  /** Zawalony narożnik: lewa część szczytu wyrwana po skosie, poszarpana krawędź. */
  const HOLE = 92;
  const broken = (x: number): number => {
    if (x > x0 + HOLE) return gable(x);
    const jag = Math.round((Math.sin(x * 1.7) + Math.sin(x * 0.63)) * 2.5);
    return Math.max(gable(x), Math.round(eave + 26 - (x - x0) * 0.6 + jag));
  };
  const top = (x: number): number => broken(x);

  // ---------------------------------------------------------------- 1) kratownice dachu widoczne w wyrwie
  for (let x = x0; x < x0 + HOLE + 4; x += 1) {
    const gt = gable(x), bt = broken(x);
    if (bt <= gt + 1) continue;
    if ((x - x0) % 10 === 0) L(x, gt, x + 7, bt, '#1e1818'); // ukośne pręty kratownicy
    if ((x - x0) % 10 === 5) L(x, bt, x + 6, gt + 2, '#1e1818');
    if ((x - x0) % 10 === 0) L(x, gt, x, bt, '#2a2222');
  }
  for (let x = x0; x < x0 + HOLE + 4; x++) {
    P('#221a18', x, gable(x), 1, 2); // łuk dźwigara
    const inner = Math.round(gable(x) + 8 + (x - x0) * 0.05);
    if (inner < broken(x)) P('#181212', x, inner, 1, 1); // dźwigar w głębi hali
  }
  for (let x = x0; x < x0 + HOLE + 4; x += 3) P(MOON, x, gable(x), 1, 1);
  // zwisająca, pogięta blacha i brzoza wyrastająca z wyrwy
  for (let k = 0; k < 16; k++) P(k % 2 ? '#5a4a40' : '#3a302a', x0 + 56 + k, gable(x0 + 56 + k) + 2 + Math.round(k * 1.1), 1, 3);
  for (let k = 0; k < 10; k++) P(k % 2 ? '#4a4038' : '#2a2420', x0 + 20 + k, gable(x0 + 20 + k) + 3 + k, 1, 2);
  leafyTree(g, ox + x0 + 40, broken(x0 + 40) + 2, 30, r, { ...FOLIAGE.night, lit: '#4a5a40', hi: '#7a8a5a', trunk: '#8a8a80', trunkLit: '#c0c0b0' }, 1);

  // ---------------------------------------------------------------- 2) fasada z cegły
  for (let x = x0; x <= x1; x++) {
    const t = top(x);
    for (let y = t; y < base; y++) {
      const row = Math.floor((y - eave) / 3);
      const off = row % 2 ? 3 : 0;
      const mortar = (y - eave) % 3 === 2 || (x + off) % 6 === 0;
      const v = Math.floor(((Math.sin(x * 12.9898 + row * 78.233) * 43758.5453) % 1 + 1) % 1 * 3);
      // chłodne światło księżyca na prawej połowie, ciepłe od dołu
      let c = mortar ? rgbOf(MORTAR) : rgbOf(BRICK[1 + v]);
      if (x > cx + 40) c = mix(c, MOON, 0.08);
      if (y > base - 24) c = mix(c, WARM, ((y - (base - 24)) / 24) * 0.12);
      P(c, x, y);
    }
    // krawędź muru: chłodny blik od księżyca / ciemna na wyrwie
    P(x < x0 + HOLE ? '#1a1210' : mix(BRICK[4], MOON, 0.5), x, t);
  }
  // korona szczytu: obróbka z blachy na łuku (przerwana w wyrwie)
  for (let x = x0 + HOLE; x <= x1; x++) {
    P('#2a2626', x, gable(x) - 2, 1, 2);
    if (x % 4 === 0) P('#6a6a70', x, gable(x) - 2, 1, 1);
  }
  // pilastry między bramami (jaśniejsza cegła, gzymsy)
  for (const px of [x0, cx - 28, cx + 28, x1 - 6]) {
    for (let y = eave + 4; y < base; y++) P((y % 3 === 2 ? MORTAR : y % 6 < 3 ? BRICK[4] : BRICK[3]), px, y, 6, 1);
    P(mix(BRICK[4], MOON, 0.35), px + 5, eave + 4, 1, base - eave - 4);
  }
  P('#4a3028', x0, eave - 1, hw * 2, 2); // gzyms
  P('#6a4a3a', x0 + HOLE, eave - 1, hw * 2 - 66, 1);

  // okno-rozeta w szczycie: część szyb wybita, jedna ciepło świeci
  const rx = cx + 4, ry = ridge + 14;
  for (let y = -8; y <= 8; y++)
    for (let x = -8; x <= 8; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > 8.5) continue;
      if (d > 7) { P('#1a1210', rx + x, ry + y); continue; }
      const spoke = Math.abs(x) < 1 || Math.abs(y) < 1 || Math.abs(x - y) < 1 || Math.abs(x + y) < 1 || Math.abs(d - 4) < 0.6;
      const pane = Math.atan2(y, x) > 0 && Math.atan2(y, x) < 0.9;
      P(spoke ? '#2a2220' : pane ? '#ffc860' : (x + y * 3) % 5 === 0 ? '#3a4a6a' : '#06060c', rx + x, ry + y);
    }
  glow(g, ox + rx + 3, ry + 3, 10, 8, WARM, 0.3, { levels: 3, add: true });

  // ---------------------------------------------------------------- 3) bramy na tory
  const arch = (gx: number, y: number): boolean => {
    const top2 = base - GH + GW; // środek łuku
    if (y >= top2) return true;
    const dx = gx, dy = y - top2;
    return dx * dx + dy * dy <= GW * GW;
  };
  for (const [i, gcx] of GATES.entries()) {
    // obramienie łuku z jaśniejszej cegły (klińce)
    for (let y = base - GH - 4; y < base; y++)
      for (let x = -GW - 3; x <= GW + 3; x++) {
        const inside = arch(x, y), ring = !inside && arch(Math.sign(x) * Math.max(0, Math.abs(x) - 3), y + 3);
        if (ring) P(((x + y) & 3) === 0 ? MORTAR : BRICK[4], gcx + x, y);
      }
    for (let y = base - GH; y < base; y++)
      for (let x = -GW; x <= GW; x++) {
        if (!arch(x, y)) continue;
        const X = gcx + x;
        if (i === 0) {
          // zaspawana blachami różnych kolorów, nity, rdza, drzwiczki ze szparą światła
          const strip = Math.floor((x + GW) / 7);
          let c = rgbOf(['#3a4a4a', '#4a3a2a', '#2e3a30', '#5a3a26', '#3a3a40', '#4a4030'][strip % 6]);
          if ((x + GW) % 7 === 0) c = mix(c, '#000000', 0.5);
          if ((y + strip * 3) % 9 === 0 && (x + GW) % 7 === 3) c = rgbOf('#8a8a8a');
          if (Math.sin(x * 3.1 + y * 0.7) > 0.93) c = rgbOf('#7a3a1a');
          P(c, X, y);
        } else if (i === 1) {
          // otwarta: wnętrze hali w ciepłym świetle (jaśniej przy ziemi)
          const u = (y - (base - GH)) / GH;
          P(mix('#1a0e08', '#c06a28', Math.pow(u, 1.6)), X, y);
        } else {
          // zawalona: deski na krzyż, za nimi ciemność
          P('#08060a', X, y);
        }
      }
  }
  // tramwaj stojący w środkowej bramie (przód wagonu pod światło)
  {
    const tx = GATES[1], ty = base;
    // przód wagonu: zaokrąglony dach, trzy okna w ciepłym świetle, numer linii, jeden reflektor zbity
    P('#1e1610', tx - 15, ty - 40, 30, 40);
    P('#1e1610', tx - 13, ty - 42, 26, 2);
    P('#2a1e14', tx - 11, ty - 43, 22, 1);
    for (const wx of [-12, -3, 6]) {
      P('#ffcf70', tx + wx, ty - 36, 7, 11);
      P('#fff0b0', tx + wx, ty - 36, 2, 4);
      P('#1e1610', tx + wx + 3, ty - 36, 1, 11);
    }
    P('#3a2a1a', tx - 4, ty - 41, 8, 4); // tablica z numerem linii
    P('#e8dcb0', tx - 2, ty - 40, 1, 2);
    P('#e8dcb0', tx + 1, ty - 40, 2, 1);
    P('#e8dcb0', tx + 2, ty - 39, 1, 1);
    P('#7a2a1a', tx - 15, ty - 22, 30, 4); // czerwony pas
    P('#5a2016', tx - 15, ty - 18, 30, 1);
    P('#fff4c0', tx - 11, ty - 12, 4, 3); // reflektory
    P('#3a2a1a', tx + 7, ty - 12, 4, 3);
    P('#2a2420', tx - 15, ty - 4, 30, 2); // zderzak
    L(tx - 2, ty - 43, tx - 9, ty - 54, '#2a2420'); // pantograf
    L(tx - 9, ty - 54, tx + 5, ty - 55, '#2a2420');
    glow(g, ox + tx, ty - 20, 34, 30, WARM, 0.35, { levels: 4, add: true });
  }
  // deski na prawej bramie
  for (let k = 0; k < 7; k++) {
    const y = base - GH + 8 + k * 9 + Math.round(Math.sin(k * 2.3) * 2);
    L(GATES[2] - GW + 1, y, GATES[2] + GW - 1, y + (k % 2 ? 4 : -4), '#5a4430');
    L(GATES[2] - GW + 1, y + 1, GATES[2] + GW - 1, y + 1 + (k % 2 ? 4 : -4), '#3a2a1c');
  }
  // drzwiczki z ciepłą szparą w zaspawanej bramie
  P('#1a1612', GATES[0] - 4, base - 16, 8, 16);
  P('#ffb050', GATES[0] + 3, base - 15, 1, 15);
  glow(g, ox + GATES[0] + 4, base - 4, 8, 6, WARM, 0.3, { levels: 3, add: true });

  // ---------------------------------------------------------------- 4) zniszczenia na fasadzie
  // pęknięcia (zygzaki), ubytki cegieł, dziury po kulach, sadza nad bramami
  for (let k = 0; k < 7; k++) {
    let x = x0 + 8 + r() * (hw * 2 - 16), y = eave + 2 + r() * 20;
    for (let s = 0; s < 10 + r() * 12; s++) {
      const nx = x + (r() < 0.5 ? -1 : 1), ny = y + 1 + (r() < 0.3 ? 1 : 0);
      L(x, y, nx, ny, '#0e0808');
      x = nx;
      y = ny;
    }
  }
  for (let k = 0; k < 26; k++) {
    const x = x0 + 4 + r() * (hw * 2 - 8), y = eave + 2 + r() * (base - eave - 6);
    if (r() < 0.5) { P('#120c0a', x, y, 3, 2); P('#6a4434', x, y + 2, 3, 1); } else { P('#0a0606', x, y); P('#5a3a2a', x + 1, y + 1); }
  }
  for (const gcx of GATES) for (let y = base - GH - 14; y < base - GH - 4; y++) for (let x = -12; x <= 12; x++)
    if (((x + y) & 1) === 0 && Math.abs(x) < 12 - (base - GH - 4 - y)) P('#140c0a', gcx + x, y);
  // wyrwa po pocisku w prawej części fasady: poszarpany otwór, osmalone cegły dookoła
  {
    const hx = cx + 76, hy = eave + 22;
    for (let y = -12; y <= 12; y++)
      for (let x = -12; x <= 12; x++) {
        const d = Math.sqrt(x * x + y * y) + Math.sin(Math.atan2(y, x) * 5) * 1.6;
        if (d < 6) P('#050408', hx + x, hy + y);
        else if (d < 7) P(BRICK[4], hx + x, hy + y);
        else if (d < 12 && ((x + y) & 1) === 0 && d < 9 + Math.sin(x * 2.1) * 2) P('#120a08', hx + x, hy + y);
      }
    L(hx - 3, hy - 4, hx + 4, hy + 3, '#2a2222'); // pręt w otworze
  }
  // łaty z blachy przykręcone na dziury, plakaty
  for (const [x, y, w, h, c] of [[cx + 52, eave + 8, 9, 7, '#4a5a5a'], [cx - 60, eave + 20, 7, 6, '#5a3a22'], [cx + 70, base - 30, 6, 9, '#3a4430']] as const) {
    P(c, x, y, w, h);
    P(mix(c, '#000000', 0.4), x, y + h - 1, w, 1);
    P('#9a9a9a', x, y);
    P('#9a9a9a', x + w - 1, y);
  }

  // szyld "PRZYSTAŃ" na desce nad środkową bramą, przekrzywiony, na jednym łańcuchu
  const GL: Record<string, string[]> = {
    P: ['111', '101', '111', '100', '100'], R: ['110', '101', '110', '101', '101'], Z: ['111', '001', '010', '100', '111'],
    Y: ['101', '101', '010', '010', '010'], S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
    A: ['010', '101', '111', '101', '101'], Ń: ['1001', '1101', '1011', '1001', '1001'],
  };
  const word = 'PRZYSTAŃ';
  const sw = [...word].reduce((a, ch) => a + GL[ch][0].length + 1, 1);
  const sx = cx - Math.floor(sw / 2), sy = base - GH - 14;
  for (let x = -1; x <= sw; x++) {
    const tilt = Math.round((x / sw) * 2);
    P('#3a2618', sx + x, sy - 1 + tilt, 1, 9);
    P('#5a3a22', sx + x, sy - 1 + tilt, 1, 1);
  }
  let lx = sx + 1;
  for (const ch of word) {
    const gl = GL[ch];
    gl.forEach((row, yy) => [...row].forEach((b, xx) => {
      if (b === '1') P(r() < 0.12 ? '#8a7a5a' : '#e8dcb0', lx + xx, sy + 1 + yy + Math.round(((lx + xx - sx) / sw) * 2));
    }));
    if (ch === 'Ń') P('#e8dcb0', lx + 2, sy - 1 + Math.round(((lx + 2 - sx) / sw) * 2));
    lx += gl[0].length + 1;
  }
  L(sx + 1, sy - 1, sx + 6, eave + 6, '#5a5a5a'); // łańcuch (drugi zerwany)
  L(sx + sw - 2, sy + 1, sx + sw, sy + 6, '#5a5a5a');

  // rura od piecyka wychodząca z dachu, krzywa, z daszkiem
  const px = cx + 62;
  for (let y = gable(px) - 22; y < gable(px); y++) P(y < gable(px) - 12 ? '#3a3634' : '#2a2624', px + (y < gable(px) - 14 ? 1 : 0), y, 3, 1);
  P('#4a4440', px - 1, gable(px) - 23, 6, 1);
  // chwasty na gzymsie i bluszcz na cegłach
  for (let k = 0; k < 10; k++) grass(g, ox + x0 + HOLE + r() * (hw * 2 - 70), eave - 1, 2, 2 + r() * 3, r, '#1a2a1a', '#2e4428', '#4a6a3a');
  ivy(g, ox + x1 - 18, ox + x1 - 2, eave + 1, 30, r, '#16241a', '#2e4a2a');
  ivy(g, ox + x0 + HOLE, ox + x0 + 80, eave + 1, 18, r, '#16241a', '#2e4a2a');

  // ---------------------------------------------------------------- 5) mur z wraków i złomu
  const wallTop = 176;
  // przechylony tramwaj po lewej (wyblakły krem / czerwień, wybite okna, wygięty pantograf)
  const tram = (tx: number, len: number, slope: number, burnt: boolean): void => {
    for (let k = 0; k < len; k++) {
      const x = tx + k, y0 = Math.round(wallTop - 2 + k * slope);
      const end = k < 3 || k > len - 4;
      const roof = y0 + (end ? 2 : 0);
      const hgt = 24 - (end ? 2 : 0);
      for (let j = 0; j < hgt; j++) {
        const y = roof + j;
        let c: ColorIn;
        if (burnt) c = j < 2 ? '#2a2420' : j < 11 ? ((k % 9 > 1 && j > 3 && j < 10) ? '#06060a' : '#1e1a18') : '#16120f';
        else if (j < 2) c = '#5a5248';
        else if (j < 11) c = (k % 9 > 1 && j > 3 && j < 10) ? ((k * 7 + j) % 11 === 0 ? '#6a7a9a' : '#0a0a10') : '#8a7a5a';
        else if (j < 14) c = '#6a2a20';
        else c = '#5a2a1e';
        if (!burnt && Math.sin(k * 0.9 + j * 1.7) > 0.86) c = '#7a4a26'; // rdza
        P(c, x, y);
      }
      if (!burnt && k % 5 === 0) P('#3a2a20', x, roof + 13, 1, 9); // drzwi / poszycie
      P(burnt ? '#3a3a40' : '#a09888', x, roof, 1, 1); // blik księżyca na dachu
    }
    // pantograf
    const mx = tx + Math.round(len / 2), my = Math.round(wallTop - 2 + (len / 2) * slope);
    L(mx, my, mx - 5, my - 9, '#2a2420');
    L(mx - 5, my - 9, mx + 6, my - 12, '#2a2420');
    // graffiti
    if (!burnt) for (let k = 0; k < 10; k++) P(k % 2 ? '#c04a8a' : '#6ad04a', tx + 6 + k * 2, Math.round(wallTop + 15 + (6 + k * 2) * slope + Math.sin(k) * 1.5), 2, 1);
  };
  tram(66, 52, 0.06, false);
  tram(364, 50, -0.05, true);
  // blachy, drzwi aut, opony - poszarpana linia muru między wrakami i halą
  const scrap = (a: number, b: number): void => {
    for (let x = a; x < b;) {
      const w = 4 + Math.floor(r() * 8), h = 16 + Math.floor(r() * 10);
      const c = rgbOf(['#3a3a36', '#4a3a2a', '#2e3438', '#3e2e22', '#44403a'][Math.floor(r() * 5)]);
      for (let k = 0; k < w && x + k < b; k++) {
        P((k % 3 === 0) ? mix(c, '#000000', 0.35) : c, x + k, base + 4 - h + (k === 0 ? 1 : 0), 1, h);
        P(mix(c, MOON, 0.35), x + k, base + 4 - h, 1, 1);
      }
      if (r() < 0.3) { P('#7a3a1a', x + 1, base - h + 8, 2, 4); }
      x += w;
    }
    // drut kolczasty: zygzak z kolcami
    for (let x = a; x < b; x++) {
      const y = base + 4 - 28 + ((x % 6) < 3 ? (x % 3) : 3 - (x % 3));
      P('#6a6a70', x, y);
      if (x % 6 === 0) P('#8a8a90', x, y - 1);
    }
  };
  scrap(10, 66);
  scrap(414, 472);
  // opony i beczki pod murem
  for (const [x, y] of [[30, base + 4], [38, base + 4], [34, base - 2], [440, base + 4], [449, base + 4]] as const) {
    P('#0e0c0c', x - 3, y - 6, 7, 6);
    P('#2a2626', x - 3, y - 6, 7, 1);
    P('#1e1a18', x - 1, y - 4, 3, 2);
  }
  for (const x of [x0 + 2, x1 - 8]) {
    P('#3a2a1e', x, base - 8, 6, 9);
    P('#5a3a22', x, base - 6, 6, 1);
    P('#5a3a22', x, base - 2, 6, 1);
    P(MOON, x + 5, base - 8, 1, 9);
  }
  // gruz pod zawalonym narożnikiem: cegły, belki
  for (let k = 0; k < 50; k++) {
    const x = x0 + r() * (HOLE - 10), y = base + 2 - Math.max(0, 9 - Math.abs(x - x0 - 30) * 0.25) * r();
    P(r() < 0.5 ? BRICK[3] : BRICK[2], x, y, 2 + Math.floor(r() * 2), 2);
  }
  L(x0 + 8, base - 2, x0 + 30, base - 12, '#2a1e16');
  L(x0 + 40, base, x0 + 52, base - 8, '#2a1e16');
  // gruz pod zawaloną bramą
  for (let k = 0; k < 40; k++) {
    const x = GATES[2] - 26 + r() * 52, y = base + 2 - Math.max(0, 10 - Math.abs(x - GATES[2] - 6) * 0.4) * r();
    P(r() < 0.5 ? BRICK[3] : BRICK[1], x, y, 2 + Math.floor(r() * 2), 2);
  }
  // szyny wychodzące z bram (w głąb ku widzowi)
  for (const gcx of GATES) for (const s of [-1, 1]) L(gcx + s * 7, base, gcx + s * 14, base + 12, '#6a6a70');

  // ---------------------------------------------------------------- 6) wieże z rur i worków z piaskiem
  for (const tx of [78, 402]) {
    // nogi z rur (lekko rozstawione), stężenia nierówne, drabina
    L(tx - 10, base + 4, tx - 8, 112, '#2a2622');
    L(tx + 10, base + 4, tx + 8, 112, '#2a2622');
    L(tx - 9, base + 4, tx - 7, 112, '#1a1714');
    L(tx + 9, base + 4, tx + 7, 112, MOON);
    for (let y = 120; y < base; y += 11 + Math.floor(r() * 4)) {
      L(tx - 9, y, tx + 9, y + 8 + Math.floor(r() * 3), '#221e1a');
      if (r() < 0.6) L(tx + 9, y, tx - 9, y + 9, '#221e1a');
    }
    for (let y = 116; y < base; y += 3) P('#3a342e', tx + 3, y, 3, 1); // szczeble
    P('#2a2622', tx + 2, 116, 1, base - 116);
    P('#2a2622', tx + 6, 116, 1, base - 116);
    // podest z worków z piaskiem
    P('#2a2420', tx - 15, 112, 30, 3);
    for (let k = 0; k < 6; k++) {
      const bx = tx - 15 + k * 5;
      P('#5a4c36', bx, 106, 5, 3);
      P('#7a6a4a', bx + 1, 106, 3, 1);
      P('#3a3024', bx, 108, 5, 1);
      P('#5a4c36', bx + 2, 103, 5, 3);
      P('#7a6a4a', bx + 3, 103, 3, 1);
    }
    // skośny daszek z blachy na słupkach
    L(tx - 13, 103, tx - 13, 92, '#2a2420');
    L(tx + 12, 103, tx + 12, 95, '#2a2420');
    for (let x = -16; x <= 15; x++) P(x % 3 ? '#3a3632' : '#4a4640', tx + x, Math.round(91 + (x + 16) * 0.12), 1, 2);
    // reflektor (lampę rysuje scena) + postrzępiona flaga
    P('#3a3530', tx - 5, 101, 10, 4);
    L(tx + 15, 95, tx + 15, 80, '#2a2420');
    for (let x = 0; x < 9; x++) P(x % 3 === 2 ? '#4a120e' : '#7a1e18', tx + 16 + x, 81 + Math.round(Math.sin(x * 0.8)), 1, 5 - (x > 6 ? 2 : 0));
  }

  // ---------------------------------------------------------------- 7) trakcja tramwajowa: słupy, jeden wygięty, zerwane druty
  const poles: [number, number][] = [];
  for (const [px2, bend] of [[22, 0], [150, 0], [330, 1], [462, 0]] as const) {
    const topY = 128;
    if (bend) {
      L(px2, base + 4, px2, 160, '#2a2826');
      L(px2, 160, px2 + 16, 138, '#2a2826');
      L(px2 + 1, 160, px2 + 17, 138, '#1a1816');
      poles.push([px2 + 16, 138]);
    } else {
      P('#2a2826', px2, topY, 2, base + 4 - topY);
      P(MOON, px2 + 1, topY, 1, base + 4 - topY);
      L(px2, topY + 4, px2 + 12, topY + 4, '#2a2826'); // wysięgnik
      L(px2, topY + 10, px2 + 12, topY + 4, '#2a2826');
      poles.push([px2 + 12, topY + 5]);
    }
  }
  const sagLine = (a: [number, number], b: [number, number], sag: number, c: ColorIn): void => {
    const n = Math.max(2, Math.abs(b[0] - a[0]));
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      P(c, a[0] + (b[0] - a[0]) * u, Math.round(a[1] + (b[1] - a[1]) * u + Math.sin(u * Math.PI) * sag));
    }
  };
  sagLine(poles[0], poles[1], 6, '#4a4a50');
  sagLine(poles[2], poles[3], 8, '#4a4a50');
  // zerwany drut zwisający z wygiętego słupa
  for (let k = 0; k < 26; k++) P('#4a4a50', poles[2][0] - Math.round(Math.sin(k * 0.15) * 4), poles[2][1] + k);

  // girlandy żarówek: wieża -> hala, hala -> wieża (pozycje żarówek dla migotania w scenie)
  const bulbs: [number, number][] = [];
  const garland = (a: [number, number], b: [number, number], sag: number): void => {
    const n = Math.abs(b[0] - a[0]);
    for (let k = 0; k <= n; k++) {
      const u = k / n, x = a[0] + (b[0] - a[0]) * u, y = Math.round(a[1] + (b[1] - a[1]) * u + Math.sin(u * Math.PI) * sag);
      P('#1a1612', x, y);
      if (k % 6 === 3) {
        const dead = r() < 0.25;
        P(dead ? '#3a3020' : '#ffd070', x, y + 1);
        if (!dead) bulbs.push([Math.round(x), y + 1]);
      }
    }
  };
  garland([88, 114], [x0 + 2, eave + 2], 10);
  garland([x1 - 2, eave + 2], [392, 114], 10);
  garland([x0 + HOLE + 4, gable(x0 + HOLE + 4) + 6], [x1 - 30, gable(x1 - 30) + 6], 14);
  for (const [bx, by] of bulbs) glow(g, ox + bx, by, 4, 3, '#ffc060', 0.35, { levels: 2, add: true });

  // pierwszy plan: kępy trawy i krzaki przy torach
  for (let k = 0; k < 6; k++) bush(g, ox + 10 + r() * 460, base + 7, 2 + r() * 2, r, FOLIAGE.night, 1);
  for (let k = 0; k < 34; k++) grass(g, ox + r() * 480, base + 2 + r() * 6, 3, 2 + r() * 3, r, '#141a14', '#2a3a24', '#5a6a3a');

  return { bulbs, sparks: [x0 + 58, gable(x0 + 58) + 1] };
}
