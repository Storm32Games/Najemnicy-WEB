import type { Ctx2D } from '../ui/Kit';
import { FOLIAGE, bush, grass, ivy, leafyTree } from './Nature';
import { type ColorIn, css, glow, line, mix, rgbOf } from './Painter';

// Przystań na planszy 5 intro: dawna zajezdnia tramwajowa po zagładzie, zamieniona w osadę.
// Ceglana hala z trzema łukowymi bramami na tory (jedna zaspawana blachą, środkowa otwarta z lokomotywą w środku,
// prawa zawalona i zabita deskami), zawalony narożnik szczytu z odsłoniętymi kratownicami i brzozą z wyrwy,
// zniszczony skład kolejowy obok hali (wykolejona lokomotywa, wagon kryty, przewrócona cysterna, węglarka), wieże z rur i worków z piaskiem, wygięte słupy
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
/** Szum 0..1 z liczb całkowitych (deterministyczny). */
const hash = (a: number, b: number): number => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
/** Rdza w łatach: grube komórki 4x3 decydują o plamie, piksele w środku poszarpane. */
const rusty = (x: number, y: number, amount = 0.22): boolean => hash(Math.floor(x / 4), Math.floor(y / 3)) < amount && hash(x, y) > 0.35;

export function paintDepot(g: Ctx2D, ox: number, r: R): { bulbs: [number, number][]; sparks: [number, number]; cat: [number, number] } {
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
  // lokomotywa spalinowa stojąca w środkowej bramie (czoło pod światło): dwie szyby, tablica z numerem,
  // reflektory (jeden zbity), biało-czerwone pasy ostrzegawcze, dwa zderzaki i hak
  {
    const tx = GATES[1], ty = base;
    P('#22301e', tx - 16, ty - 44, 32, 40);
    P('#2a3a26', tx - 14, ty - 46, 28, 2);
    P('#3a4a34', tx - 16, ty - 44, 1, 40);
    for (const wx of [-13, 2]) {
      P('#ffcf70', tx + wx, ty - 41, 11, 9);
      P('#fff0b0', tx + wx, ty - 41, 3, 3);
      P('#22301e', tx + wx, ty - 33, 11, 1);
    }
    L(tx + 3, ty - 41, tx + 8, ty - 34, '#1a1a1a'); // pęknięta szyba
    L(tx + 8, ty - 34, tx + 12, ty - 37, '#1a1a1a');
    P('#141a12', tx - 4, ty - 31, 8, 4); // tablica z numerem
    for (const k of [-3, -1, 1, 2]) P('#e8dcb0', tx + k, ty - 30, 1, 2);
    P('#fff4c0', tx - 1, ty - 45, 3, 2); // górny reflektor
    P('#fff4c0', tx - 13, ty - 22, 4, 3); // dolne reflektory
    P('#1a1410', tx + 9, ty - 22, 4, 3);
    // pasy ostrzegawcze (skośne, wyblakłe)
    for (let y = 0; y < 7; y++) for (let x = -16; x < 16; x++) P(((x + y) >> 2) % 2 ? '#a83a26' : '#c8bca0', tx + x, ty - 16 + y);
    for (let k = 0; k < 18; k++) P('#5a4a30', tx - 16 + ((k * 7) % 32), ty - 16 + (k % 7)); // odpryski
    P('#1a1612', tx - 16, ty - 9, 32, 3); // pomost
    for (const bx of [-14, 10]) { P('#2a2622', tx + bx, ty - 8, 4, 4); P('#6a6660', tx + bx, ty - 8, 4, 1); } // zderzaki
    P('#2a2622', tx - 1, ty - 7, 3, 3); // sprzęg
    P('#0e0c0a', tx - 16, ty - 4, 32, 4);
    glow(g, ox + tx, ty - 22, 36, 30, WARM, 0.35, { levels: 4, add: true });
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

  // szyld "ZAJEZDNIA" na desce nad środkową bramą: przekrzywiony, na jednym łańcuchu, zniszczony -
  // "E" odpadło (jaśniejszy ślad i gwoździe), "N" wisi na jednym gwoździu pod deską, prawy koniec deski
  // odłamany razem z połową "A", farba odprysła, przez deskę biegnie pęknięcie
  const GL: Record<string, string[]> = {
    Z: ['111', '001', '010', '100', '111'], A: ['010', '101', '111', '101', '101'], J: ['001', '001', '001', '101', '010'],
    E: ['111', '100', '110', '100', '111'], D: ['110', '101', '101', '101', '110'], N: ['1001', '1101', '1011', '1001', '1001'],
    I: ['1', '1', '1', '1', '1'],
  };
  const word = 'ZAJEZDNIA';
  const sw = [...word].reduce((a, ch) => a + GL[ch][0].length + 1, 1);
  const sx = cx - Math.floor(sw / 2), sy = base - GH - 14;
  const tiltAt = (x: number): number => Math.round(((x - sx) / sw) * 2);
  const cut = sw - 2; // odłamany koniec deski (poszarpana krawędź)
  const edge = (y: number): number => cut + ((y * 5) % 3) - 1;
  for (let x = -1; x <= sw; x++)
    for (let y = -1; y < 8; y++) {
      if (x > edge(y)) continue;
      const crack = y === 3 + Math.round(Math.sin(x * 0.4) * 1.2) && x > 4 && x < sw - 12;
      P(crack ? '#140c08' : y === -1 ? '#5a3a22' : y === 7 ? '#24160e' : '#3a2618', sx + x, sy + y + tiltAt(sx + x));
    }
  // odłamany kawałek leży pod bramą
  P('#3a2618', sx + sw - 4, base - 2, 6, 2);
  P('#e8dcb0', sx + sw - 2, base - 2, 1, 1);
  let lx = sx + 1;
  [...word].forEach((ch, i) => {
    const gl = GL[ch], gw = gl[0].length;
    if (i === 3) {
      // odpadła litera: jaśniejsze, niezniszczone drewno w jej kształcie + dwa gwoździe
      gl.forEach((row, yy) => [...row].forEach((bit, xx) => bit === '1' && P('#6a4a30', lx + xx, sy + 1 + yy + tiltAt(lx + xx))));
      P('#9a9a9a', lx, sy + 1 + tiltAt(lx));
      P('#9a9a9a', lx + 2, sy + 5 + tiltAt(lx + 2));
    } else if (i === 6) {
      // obsunęła się: wisi na jednym gwoździu (lewy górny róg), przekrzywiona, częściowo pod deską
      const nx = lx, ny = sy + 4 + tiltAt(lx);
      gl.forEach((row, yy) => [...row].forEach((bit, xx) => {
        if (bit === '1') P('#d8cca0', nx + xx + Math.floor(yy / 2), ny + yy + Math.floor(xx * 0.6));
      }));
      P('#9a9a9a', nx, ny - 1);
      P('#4e3424', lx + 1, sy + 1 + tiltAt(lx + 1), 3, 2); // jaśniejszy ślad po literze na desce
    } else {
      gl.forEach((row, yy) => [...row].forEach((bit, xx) => {
        const x = lx + xx;
        if (bit !== '1' || x - sx > edge(yy)) return; // połowa "A" odpadła z końcem deski
        const chip = r() < 0.12;
        P(chip ? '#6a5238' : '#e8dcb0', x, sy + 1 + yy + tiltAt(x));
      }));
    }
    lx += gw + 1;
  });
  L(sx + 1, sy - 1, sx + 6, eave + 6, '#5a5a5a'); // łańcuch
  L(sx + sw - 6, sy + 1, sx + sw - 4, sy + 7, '#5a5a5a'); // zerwany łańcuch zwisa
  P('#5a5a5a', sx + sw - 3, sy + 8);

  // rura od piecyka wychodząca z dachu, krzywa, z daszkiem
  const px = cx + 62;
  for (let y = gable(px) - 22; y < gable(px); y++) P(y < gable(px) - 12 ? '#3a3634' : '#2a2624', px + (y < gable(px) - 14 ? 1 : 0), y, 3, 1);
  P('#4a4440', px - 1, gable(px) - 23, 6, 1);
  // chwasty na gzymsie i bluszcz na cegłach
  for (let k = 0; k < 10; k++) grass(g, ox + x0 + HOLE + r() * (hw * 2 - 70), eave - 1, 2, 2 + r() * 3, r, '#1a2a1a', '#2e4428', '#4a6a3a');
  ivy(g, ox + x1 - 18, ox + x1 - 2, eave + 1, 30, r, '#16241a', '#2e4a2a');
  ivy(g, ox + x0 + HOLE, ox + x0 + 80, eave + 1, 18, r, '#16241a', '#2e4a2a');

  // ---------------------------------------------------------------- 5) mur z wraków i złomu
  // ---- zniszczony skład kolejowy przy zajezdni (zamiast muru po bokach):
  // lewa strona: wykolejona lokomotywa spalinowa + przechylony wagon kryty; prawa: przewrócona cysterna + węglarka
  const wheel = (x: number, y: number): void => {
    for (let dy = -2; dy <= 1; dy++) P('#121010', x - (Math.abs(dy + 0.5) > 1 ? 1 : 2), y + dy, Math.abs(dy + 0.5) > 1 ? 3 : 5, 1);
    P('#4a4440', x, y - 1);
  };
  /** Bryła przechylona: dla kolumny k wołamy col(k, x, góra, dół). */
  const body = (x0b: number, len: number, slope: number, h: (k: number) => number, col: (k: number, x: number, top: number, bot: number) => void): ((k: number) => number) => {
    const yo = (k: number): number => Math.round((k - len / 2) * slope);
    for (let k = 0; k < len; k++) {
      const bot = base - 5 + yo(k);
      col(k, x0b + k, bot - h(k), bot);
    }
    return (k: number) => base - 5 + yo(k);
  };
  // lokomotywa: kabina z lewej, maska z kratkami, żółty pas, rdza, wypalona maska, rozbita szyba
  const LOCO = 8, LL = 58;
  const locoBot = body(LOCO, LL, 0.07, (k) => (k < 14 ? 22 : 16) - (k === 0 || k === LL - 1 ? 1 : 0), (k, x, top, bot) => {
    const cab = k < 14;
    for (let y = top; y < bot; y++) {
      const j = y - top, fromBot = bot - y;
      let c: ColorIn = '#2e4434';
      if (j === 0) c = mix('#4a5a4a', MOON, 0.4);
      else if (fromBot === 5 || fromBot === 6) c = '#9a8a3a'; // żółty pas
      else if (cab && j > 3 && j < 10 && k > 2 && k < 12) c = (k + j) % 9 === 0 ? '#5a6a8a' : '#0a0c10'; // okna kabiny
      else if (!cab && j > 3 && j < 11 && k % 3 === 0) c = '#1a2a20'; // kratki maski
      if (rusty(x, y)) c = hash(x, y) > 0.7 ? '#8a4a22' : '#6a3a1e'; // rdza
      if (!cab && k > 34 && k < 50 && j < 9 && ((k + j) & 1) === 0) c = '#0e0c0a'; // wypalone
      P(c, x, y);
    }
    P('#0e0c0a', x, bot, 1, 2); // rama
  });
  for (const k of [6, 14, LL - 14, LL - 6]) wheel(LOCO + k, locoBot(k) + 3);
  P('#1a1612', LOCO + 24, locoBot(24) - 20, 3, 4); // komin wydechu
  for (let k = 16; k < LL - 2; k += 2) P('#5a5a50', LOCO + k, locoBot(k) - 17, 1, 1); // poręcz (połamana)
  L(LOCO + 40, locoBot(40) - 17, LOCO + 44, locoBot(40) - 23, '#5a5a50');
  for (let k = 0; k < 8; k++) P(k % 2 ? '#c04a8a' : '#e8dcb0', LOCO + 18 + k * 2, locoBot(18 + k * 2) - 9 + (k % 3), 2, 1); // graffiti
  // wagon kryty: deski, łukowy dach, uchylone drzwi, wypalona dziura z żebrami, drut kolczasty na dachu
  const BOX = LOCO + LL + 2, BL = 52;
  P('#1a1612', BOX - 2, locoBot(LL - 1) - 4, 2, 2); // sprzęg
  const boxBot = body(BOX, BL, -0.09, () => 20, (k, x, top, bot) => {
    for (let y = top; y < bot; y++) {
      const j = y - top;
      let c: ColorIn = k % 3 === 0 ? '#3a1a14' : '#5a2a1e';
      if (j < 2) c = j === 0 ? mix('#4a3e38', MOON, 0.4) : '#3a3430';
      if (k >= 20 && k < 32 && j > 2) c = k === 20 || k === 31 ? '#2a1610' : '#4a2218'; // drzwi przesuwne
      if (k >= 32 && k < 35 && j > 2) c = '#06060a'; // szpara uchylonych drzwi
      if (k > 38 && k < 47 && j > 4 && j < 13 && Math.sin(k * 1.9 + j * 1.3) > -0.6) c = k % 3 === 0 ? '#2a1a14' : '#06060a'; // dziura z żebrami
      if (rusty(x, y, 0.15)) c = '#7a4a26';
      P(c, x, y);
    }
    P('#0e0c0a', x, bot, 1, 2);
    if (k % 6 === 0) P('#6a6a70', x, top - 2); // drut kolczasty
    P('#5a5a60', x, top - 1 - ((k % 6) < 3 ? 0 : 1));
  });
  for (const k of [5, 11, BL - 11, BL - 5]) wheel(BOX + k, boxBot(k) + 3);
  for (const [k, j] of [[8, 9], [9, 9], [10, 9], [8, 11], [10, 11], [9, 10]] as const) P('#d8d0c0', BOX + k, boxBot(k) - 20 + j); // biały szablon na desce
  // cysterna przewrócona kołami do góry, z wyciekiem
  const TK = 362, TL = 52;
  for (let k = 0; k < TL; k++) {
    const end = Math.min(k, TL - 1 - k);
    const inset = end === 0 ? 4 : end === 1 ? 2 : end === 2 ? 1 : 0;
    for (let y = base - 17 + inset; y < base - inset; y++) {
      const j = y - (base - 17);
      let c: ColorIn = j < 3 ? mix('#2a2a30', MOON, 0.45) : j < 6 ? '#24242a' : j > 13 ? '#0c0c10' : '#18181c';
      if (j >= 7 && j <= 9 && k > 6 && k < TL - 6) c = '#8a5a20'; // wyblakły pas ostrzegawczy
      if (rusty(TK + k, y, 0.3)) c = hash(k, y) > 0.6 ? '#7a3e1c' : '#5a2e18';
      P(c, TK + k, y);
    }
  }
  P('#141418', TK + 4, base - 21, TL - 8, 3); // rama (u góry, bo do góry nogami)
  for (const k of [6, 12, TL - 12, TL - 6]) wheel(TK + k, base - 23);
  P('#18181c', TK + 22, base - 1, 8, 2); // właz wbity w ziemię
  glow(g, ox + TK + 26, base + 3, 22, 4, '#7aff40', 0.35, { levels: 3, add: true }); // toksyczny wyciek
  P('#3a6a1a', TK + 12, base + 2, 26, 1);
  P('#6ad02a', TK + 18, base + 2, 8, 1);
  // węglarka wykolejona, przechylona, węgiel wysypany na ziemię
  const GD = TK + TL + 2, GLn = 470 - GD;
  const gBot = body(GD, GLn, 0.1, () => 13, (k, x, top, bot) => {
    for (let y = top; y < bot; y++) {
      const j = y - top;
      let c: ColorIn = k % 6 === 0 ? '#2a201c' : '#3e3028';
      if (j === 0) c = mix('#5a4a40', MOON, 0.4);
      if (rusty(x, y, 0.3)) c = '#6a3a1e';
      P(c, x, y);
    }
    for (let j = 1; j < 3 + ((k * 7) % 3); j++) P(((k + j) % 3) ? '#0c0c0e' : '#2a2a30', x, top - j); // hałda węgla
    P('#0e0c0a', x, bot, 1, 2);
  });
  for (const k of [5, 11, GLn - 11, GLn - 5]) wheel(GD + k, gBot(k) + 3);
  for (let k = 0; k < 40; k++) P(r() < 0.6 ? '#0c0c0e' : '#2a2a30', GD - 6 + r() * 16, base + 3 - r() * (6 - Math.abs(k % 8 - 4)), 2, 1);
  // szyny pod składem: jedna wyrwana i wygięta w górę
  for (const [a2, b2] of [[4, 124], [358, 474]] as const) {
    P('#4a4a50', a2, base + 2, b2 - a2, 1);
    for (let x = a2; x < b2; x += 5) P('#2a1e16', x, base + 3, 3, 1); // podkłady
  }
  L(70, base + 2, 76, base - 8, '#6a6a70');
  L(76, base - 8, 84, base - 12, '#6a6a70');
  // opony i beczki pod murem
  for (const [x, y] of [[x0 - 4, base + 4], [x1 + 4, base + 4], [x1 + 12, base + 4]] as const) {
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

  return { bulbs, sparks: [x0 + 58, gable(x0 + 58) + 1], cat: [BOX + 14, boxBot(14) - 22] };
}
