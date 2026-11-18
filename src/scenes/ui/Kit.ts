import Phaser from 'phaser';
import { SoundManager } from '../../audio/SoundManager';
import { type ResSetting, Settings, UI_ALPHAS, resPreset } from './Settings';
import { FLAME_TONGUES, MoteField, Q12, Q8, TickClock, TypeProgress, flameKQ12, flameSwayQ8, glowAlphaQ8, potTiles, secToQ8 } from '../../core/frontend';
import { PixelText, pixelText } from './BitmapFont';
import { addHiRes } from '../iso/HiRes';
import { ditherGradient, glow, ground, mix, ruins } from '../fx/Painter';

export { PixelText } from './BitmapFont';

// Wspólny zestaw UI scen menu + model rozdzielczości.
//
// Gra jest komponowana na siatce projektowej 480x270 (BASE_W x BASE_H) - wszystkie współrzędne scen są w tych
// "pikselach projektowych". Płótno ma rozmiar wybranego presetu (domyślnie 1920x1080, patrz Settings.RES_PRESETS),
// a każda kamera ma zoom = ZOOM = min(płótno / siatka), więc pixel art zostaje gruby; tekst to czcionka bitmapowa
// w tej samej siatce pikseli (BitmapFont.ts). ZOOM bywa ułamkowy (HD 2.67, QHD 5.33). Gdy proporcje płótna są inne
// niż 16:9 (640x480), kamery dostają viewport BASE * ZOOM na środku płótna - reszta to czarne pasy.
// (Odpowiednik Engine.pixelScale z Oldgame/src/core/engine.js.)

export const BASE_W = 480;
export const BASE_H = 270;

/** Preset rozdzielczości aktywny w tej chwili (żywe wiązanie; zmienia go applyResolution). */
export let RES: ResSetting = Settings.startRes;
/** Rozmiar płótna w pikselach ekranu. */
export let CANVAS_W = resPreset(RES).w;
export let CANVAS_H = resPreset(RES).h;
/**
 * Piksele płótna na piksel projektowy. Żywe wiązanie (`let`): zmienia je tylko applyResolution() (Opcje, poza misją);
 * kod czytający ZOOM / SX0 / SY0 przy każdym użyciu widzi nową wartość.
 */
export let ZOOM = Math.min(CANVAS_W / BASE_W, CANVAS_H / BASE_H);
/**
 * Gęstość nowych tekstur: teksele na piksel projektowy (= ZOOM, czyli 1 teksel = 1 piksel płótna; patrz iso/HiRes.ts).
 * Idzie za ZOOM; tekstury zbudowane wcześniej zostają w starej gęstości (wymiary projektowe się nie zmieniają).
 */
export let ART = ZOOM;
/** Lewy górny róg obszaru gry (BASE * ZOOM) na płótnie - niezerowy tylko przy pasach (640x480). */
export let VX = Math.round((CANVAS_W - BASE_W * ZOOM) / 2);
export let VY = Math.round((CANVAS_H - BASE_H * ZOOM) / 2);
/** Rozmiar obszaru gry na płótnie (viewport kamer). */
export let VW = CANVAS_W - 2 * VX;
export let VH = CANVAS_H - 2 * VY;

/** Przesunięcie obiektów ze scrollFactor(0) przy kamerze z zoomem wokół środka: pozycja ekranu (x, y) -> (x + SX0, y + SY0). */
export let SX0 = (VW - BASE_W) / 2;
export let SY0 = (VH - BASE_H) / 2;

function setRes(id: ResSetting): void {
  RES = id;
  CANVAS_W = resPreset(id).w;
  CANVAS_H = resPreset(id).h;
  ZOOM = Math.min(CANVAS_W / BASE_W, CANVAS_H / BASE_H);
  ART = ZOOM;
  VX = Math.round((CANVAS_W - BASE_W * ZOOM) / 2);
  VY = Math.round((CANVAS_H - BASE_H * ZOOM) / 2);
  VW = CANVAS_W - 2 * VX;
  VH = CANVAS_H - 2 * VY;
  SX0 = (VW - BASE_W) / 2;
  SY0 = (VH - BASE_H) / 2;
}

/** Zdarzenie sceny emitowane po zmianie rozdzielczości: (nowy ZOOM, stary ZOOM). Scena z własną kamerą może je obsłużyć sama. */
export const ZOOM_EVENT = 'kit-zoom';

/** Czy rozdzielczość da się zmienić bez restartu (misja ma własną kamerę i nakładkę ekranową liczoną przy starcie). */
export const canApplyZoomLive = (game: Phaser.Game): boolean => !game.scene.isActive('WorldScene') && !game.scene.isActive('UIScene');

/**
 * Zmiana rozdzielczości na żywo (Phaser ScaleManager.setGameSize): płótno = preset, kamery scen statycznych
 * (fitCamera) dostają nowy zoom i viewport. Scena nasłuchująca ZOOM_EVENT ustawia swoje kamery sama.
 */
export function applyResolution(game: Phaser.Game, id: ResSetting): void {
  if (id === RES) return;
  const old = ZOOM;
  setRes(id);
  game.scale.setGameSize(CANVAS_W, CANVAS_H);
  for (const s of game.scene.getScenes(true)) {
    if (s.events.listenerCount(ZOOM_EVENT)) s.events.emit(ZOOM_EVENT, ZOOM, old);
    else if (s.cameras.main && Math.abs(s.cameras.main.zoom - old) < 1e-6) fitCamera(s);
  }
}

export const FONT = '"Menlo", "Consolas", "DejaVu Sans Mono", "Courier New", monospace';

/** Paleta z Oldgame/index.html (:root). */
export const PAL = {
  bg: 0x0b0a09,
  panel: 0x1a1612,
  panel2: 0x241e18,
  edge: 0x6b5233,
  edgeHi: 0xc08a3e,
  text: 0xe8dcc0,
  dim: 0x9a8b70,
  amber: 0xf2a93b,
  rust: 0xb4532a,
  toxic: 0x8fd14f,
  blood: 0xc43d2f,
  steel: 0x7f9aa8,
  good: 0x7fc46a,
  bad: 0xe0553f,
} as const;

/** Jeden kolor tytułów wszystkich okien UI (jak nagłówek dziennika misji). */
export const UI_TITLE = PAL.amber;

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
/** '#rrggbb' -> 0xRRGGBB (z bezpiecznym zapasem). */
export const parseColor = (s: string | undefined, fallback: number): number => {
  if (!s) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return parseInt(m[1], 16);
  const m3 = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m3) return parseInt([...m3[1]].map((c) => c + c).join(''), 16);
  return fallback;
};
export const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Viewport kamery = obszar gry na płótnie (przy 16:9 całe płótno, przy 640x480 pas na środku). */
export function fitViewport(cam: Phaser.Cameras.Scene2D.Camera): Phaser.Cameras.Scene2D.Camera {
  return cam.setViewport(VX, VY, VW, VH);
}

/** Kamera sceny statycznej: widzi dokładnie prostokąt projektowy 0..480 x 0..270. */
export function fitCamera(scene: Phaser.Scene): Phaser.Cameras.Scene2D.Camera {
  const cam = fitViewport(scene.cameras.main);
  cam.setZoom(ZOOM);
  cam.centerOn(BASE_W / 2, BASE_H / 2);
  return cam;
}

export interface LabelOptions {
  size?: number;
  color?: number;
  bold?: boolean;
  italic?: boolean;
  /** Szerokość zawijania w pikselach projektowych. */
  wrap?: number;
  /** Maksymalna szerokość linii (przycięcie z wielokropkiem). */
  maxW?: number;
  align?: 'left' | 'center' | 'right';
  shadow?: boolean;
  lineSpacing?: number;
  /** Drobny druk (podpowiedzi, przypisy): napis w skali SMALL_TEXT. `wrap` / `maxW` podaje się w pikselach po skalowaniu. */
  small?: boolean;
}

/**
 * Skala drobnego druku. 0.75 daje całe piksele płótna przy każdym presecie (ZOOM 1.33 / 2.67 / 4 / 5.33 / 8
 * -> 1 / 2 / 3 / 4 / 6 px na piksel czcionki), więc litery zostają równe.
 */
export const SMALL_TEXT = 0.75;

/**
 * Tekst pikselowy (ręcznie rysowana czcionka bitmapowa 6x8, BitmapFont.ts) - 1 piksel czcionki = 1 piksel projektowy.
 * `size` nie skaluje czcionki (brak pixel-mismatch): size >= 12 daje wariant pogrubiony (nagłówki); `bold` przy
 * mniejszych rozmiarach jest ignorowane, bo pogrubiona czcionka 6x8 nie mieści się w gęstych układach.
 * Domyślnie czarny obrys 1 px (czytelność na tle pixel artu); shadow: false = bez obrysu.
 */
export function label(scene: Phaser.Scene, x: number, y: number, s: string, o: LabelOptions = {}): PixelText {
  const k = o.small ? SMALL_TEXT : 1;
  const t = pixelText(scene, x, y, s, {
    color: o.color ?? PAL.text,
    bold: (o.size ?? 8) >= 12,
    style: o.shadow === false ? 'plain' : 'outline',
    wrap: o.wrap === undefined ? undefined : o.wrap / k,
    maxW: o.maxW === undefined ? undefined : o.maxW / k,
    align: o.align,
    lineSpacing: o.lineSpacing,
  });
  return k === 1 ? t : t.setScale(k);
}

// ------------------------------------------------------------------ przezroczystość okien (Opcje / przełącznik w nagłówku)

/** Tła i cienie okien UI, których krycie zależy od Settings.uiAlpha (bazowe krycie cienia zapamiętane przy rejestracji). */
const uiBgs = new Map<Phaser.GameObjects.Rectangle, number | null>();
const paintUiBg = (r: Phaser.GameObjects.Rectangle, shadow: number | null): void => {
  const k = Settings.uiAlphaK;
  r.setFillStyle(r.fillColor, shadow === null ? k : shadow * k);
};
let lastUiAlpha = Settings.values.uiAlpha;
Settings.onChange((v) => {
  if (v.uiAlpha === lastUiAlpha) return;
  lastUiAlpha = v.uiAlpha;
  for (const [r, sh] of uiBgs) paintUiBg(r, sh);
});

/**
 * Tło okna UI: krycie wg ustawienia przezroczystości (brak = w pełni kryjące, 50/50, pełna = samo obramowanie).
 * `shadow` = cień okna: jego krycie (bieżące krycie wypełnienia) mnoży się przez ten sam współczynnik.
 */
export function uiBg<T extends Phaser.GameObjects.Rectangle>(r: T, shadow = false): T {
  const sh = shadow ? r.fillAlpha : null;
  uiBgs.set(r, sh);
  r.once(Phaser.GameObjects.Events.DESTROY, () => uiBgs.delete(r));
  paintUiBg(r, sh);
  return r;
}

/**
 * Przełącznik przezroczystości okien w nagłówku okna (● brak / ◐ 50/50 / ○ pełna); klik = następny poziom,
 * dotyczy wszystkich okien. (x, y) = prawy górny róg znaku. `hover` dostaje opis (null = zjechanie kursorem).
 */
/** Opis przełącznika przyciemnienia okien (podpowiedź). */
export const uiAlphaTip = (): string => `Przyciemnienie okien: ${UI_ALPHAS.find(([k]) => k === Settings.values.uiAlpha)?.[1] ?? ''} (klik: zmień)`;

export function uiAlphaToggle(scene: Phaser.Scene, x: number, y: number, color: number = PAL.dim, hover?: (tip: string | null) => void): PixelText {
  const glyph = (): string => UI_ALPHAS.find(([k]) => k === Settings.values.uiAlpha)?.[3] ?? '●';
  const tip = uiAlphaTip;
  const t = label(scene, x, y, glyph(), { color }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
  t.on('pointerdown', (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
    ev?.stopPropagation();
    if (p.rightButtonDown()) return;
    Settings.cycleUiAlpha();
    SoundManager.sfx('click');
    hover?.(tip());
  });
  t.on('pointerover', () => {
    t.setColor(PAL.amber);
    hover?.(tip());
  });
  t.on('pointerout', () => {
    t.setColor(color);
    hover?.(null);
  });
  const off = Settings.onChange(() => t.active && t.setText(glyph()));
  t.once(Phaser.GameObjects.Events.DESTROY, off);
  return t;
}

/** Panel w stylu starego .panel: ciemne tło, rdzawa ramka, twardy cień. Połyka kliknięcia. Krycie tła: Settings.uiAlpha. */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, edge: number = PAL.edge, _alpha = 0.94): Phaser.GameObjects.Container {
  const shadow = uiBg(scene.add.rectangle(2, 2, w, h, 0x000000, 0.5).setOrigin(0), true);
  const bg = uiBg(scene.add.rectangle(0, 0, w, h, PAL.panel, 1).setOrigin(0).setStrokeStyle(1, edge).setInteractive());
  return scene.add.container(x, y, [shadow, bg]);
}

export interface UiButton {
  box: Phaser.GameObjects.Container;
  setEnabled(on: boolean): void;
  setLabel(s: string): void;
  /** Fokus z klawiatury / joysticka - wygląda jak najechanie myszą. */
  setFocus(on: boolean): void;
}

export interface ButtonOptions {
  w?: number;
  h?: number;
  size?: number;
  primary?: boolean;
  danger?: boolean;
  enabled?: boolean;
  /** Wołane przy najechaniu myszą (np. przeniesienie fokusu menu). */
  onOver?: () => void;
}

/** Przycisk w stylu starego .btn. (x, y) = lewy górny róg. */
export function button(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, o: ButtonOptions = {}): UiButton {
  const size = o.size ?? 8;
  const t = label(scene, 0, 0, text.toUpperCase(), { size, bold: true }).setOrigin(0.5);
  const w = o.w ?? Math.ceil(t.displayWidth) + 14;
  // napis zawsze mieści się w przycisku (czcionka bitmapowa nie zmniejsza się)
  t.setMaxLineWidth(w - 6);
  const h = o.h ?? size + 8;
  const base = o.primary ? PAL.amber : o.danger ? PAL.bad : PAL.text;
  const edge = o.primary ? PAL.amber : o.danger ? PAL.blood : PAL.edge;
  const shadow = scene.add.rectangle(1.5, 1.5, w, h, 0x000000, 0.8).setOrigin(0);
  const bg = scene.add.rectangle(0, 0, w, h, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, edge).setInteractive({ useHandCursor: true });
  t.setPosition(w / 2, h / 2).setColor(hex(base));
  const box = scene.add.container(x, y, [shadow, bg, t]);
  let enabled = o.enabled ?? true;
  let focused = false;
  const paint = (over: boolean) => {
    const hover = over || focused;
    bg.setFillStyle(hover && enabled ? 0x3a2c1e : PAL.panel2, 1).setStrokeStyle(1, hover && enabled ? PAL.edgeHi : edge);
    t.setColor(hex(hover && enabled ? 0xffffff : base));
    box.setAlpha(enabled ? 1 : 0.4);
  };
  bg.on('pointerover', () => {
    if (enabled) SoundManager.sfx('hover');
    paint(true);
    o.onOver?.();
  });
  bg.on('pointerout', () => paint(false));
  bg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
    ev?.stopPropagation();
    if (!enabled) return;
    SoundManager.sfx('click');
    onClick();
  });
  paint(false);
  return {
    box,
    setEnabled(on) {
      enabled = on;
      paint(false);
    },
    setLabel(s) {
      t.setText(s.toUpperCase());
    },
    setFocus(on) {
      focused = on;
      paint(false);
    },
  };
}

/** Przejście do innej sceny przez wygaszenie do czerni (jak fadeLayer + Game.goto w Oldgame). */
export function goto(scene: Phaser.Scene, key: string, data?: object, ms = 400): void {
  const st = scene.data;
  if (st.get('leaving')) return;
  st.set('leaving', true);
  scene.input.enabled = false;
  scene.cameras.main.fadeOut(ms, 0, 0, 0);
  scene.time.delayedCall(ms + 20, () => scene.scene.start(key, data));
}

/** Wołane na początku create(): kamera, wejście z czerni, reset flagi przejścia. */
export function enter(scene: Phaser.Scene, ms = 500): void {
  scene.data.set('leaving', false);
  scene.input.enabled = true;
  fitCamera(scene).fadeIn(ms, 0, 0, 0);
}

/** Maszyna do pisania (port Typewriter z Oldgame/src/scenes/meta/common.js); tempo liczy core/frontend TypeProgress w tickach 50 Hz. */
export class Typewriter {
  private readonly chars: string[];
  private readonly target: PixelText;
  private readonly prog: TypeProgress;
  private readonly clock = new TickClock();

  constructor(target: PixelText, text: string, cps = 34) {
    this.target = target;
    // zawijamy cały tekst z góry, żeby słowa nie przeskakiwały między wierszami w trakcie pisania
    this.chars = [...target.getWrappedText(text).join('\n')];
    this.prog = new TypeProgress(this.chars.length, cps);
    target.setText('');
  }

  get done(): boolean {
    return this.prog.done;
  }

  finish(): void {
    this.prog.finish();
    this.target.setText(this.chars.join(''));
  }

  /** `dt` w sekundach (czas klatki). */
  update(dt: number): void {
    if (this.done) return;
    const before = this.prog.shown;
    if (!this.prog.step(this.clock.advance(dt * 1000))) return;
    const shown = this.prog.shown;
    this.target.setText(this.chars.slice(0, shown).join(''));
    if (this.chars.slice(before, shown).some((c) => c.trim())) SoundManager.sfx('typewriter', { vol: 0.35 });
  }
}

// ------------------------------------------------------------------ tła rysowane na płótnie 2D

export type Stops = readonly (readonly [number, string])[];
export type Ctx2D = CanvasRenderingContext2D;

/** Deterministyczny mulberry32 dla dekoracji (rngSeed z Oldgame). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tekstura-płótno (zastępuje istniejącą o tym samym kluczu). Rysunek w pikselach projektowych (w x h),
 * tekstura w gęstości ART (iso/HiRes.ts); scale > 1 = rysunek jest powiększany do w*scale x h*scale pikseli projektowych.
 */
export function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Ctx2D, w: number, h: number) => void, scale = 1): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g, w, h);
  addHiRes(scene, key, c, { w: w * scale, h: h * scale });
  return key;
}

/**
 * Obraz z tekstury płótna jako kontener. W profilu Amiga dzielony na kafle <= 256 px w teksturach potęgi dwójki
 * (core/frontend potTiles) - tak jak musi go załadować miniGL; poza nim jeden obraz. (ox, oy) = punkt zaczepienia
 * w pikselach obrazu: kontener stoi w (x, y), a skala / obrót działają wokół tego punktu.
 */
export function tiledImage(scene: Phaser.Scene, key: string, x = 0, y = 0, ox = 0, oy = 0): Phaser.GameObjects.Container {
  const box = scene.add.container(x + ox, y + oy);
  const tex = scene.textures.get(key);
  const src = tex.getSourceImage() as HTMLCanvasElement | HTMLImageElement;
  if (!Settings.startAmiga) {
    box.add(scene.add.image(-ox, -oy, key).setOrigin(0));
    return box;
  }
  // obraz źródłowy tekstury hi-res (addHiRes) ma ART tekseli na piksel projektowy - kafle tniemy w tekselach,
  // a kładziemy w pikselach projektowych (bez tego obraz wychodzi ART razy za duży)
  const k = src.width / (tex.get().width || src.width);
  potTiles(src.width, src.height).forEach((t, i) => {
    const tk = `${key}@${i}`;
    if (scene.textures.exists(tk)) scene.textures.remove(tk);
    const tile = scene.textures.createCanvas(tk, t.texW, t.texH);
    if (!tile) return;
    tile.getContext().drawImage(src, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
    tile.refresh();
    box.add(scene.add.image(t.x / k - ox, t.y / k - oy, tk).setOrigin(0).setCrop(0, 0, t.w, t.h).setScale(1 / k));
  });
  // źródło (> 256 px) nie jest już potrzebne - w porcie też go nie ma, zostają tylko kafle
  scene.textures.remove(key);
  return box;
}

/** Gradient nieba: pasma ograniczonej palety z ditheringiem Bayera na granicach (fx/Painter.ts). */
export function skyGradient(g: Ctx2D, w: number, h: number, stops: Stops, _band = 3): void {
  ditherGradient(g, 0, 0, w, h, stops, Math.max(10, Math.round(h / 9)));
}

export interface SkylineOptions {
  n: number;
  base: number;
  hMin: number;
  hMax: number;
  color: string;
  lit?: string | null;
  wMin?: number;
  wMax?: number;
  /** Obwódka światła (domyślnie fasada rozjaśniona w stronę ciepłego światła zachodu); null = bez. */
  rim?: string | null;
  /** Strona światła: -1 z lewej (domyślnie), 1 z prawej. */
  light?: number;
  /** Ilość szczegółów 0..1. */
  detail?: number;
}

/** Rząd zrujnowanych wieżowców z bryłą: ściana boczna, okna, stropy, szczerby, zbrojenie, anteny (fx/Painter.ts ruins). */
export function skyline(g: Ctx2D, w: number, rnd: () => number, o: SkylineOptions): void {
  ruins(g, rnd, {
    base: o.base, n: o.n, hMin: o.hMin, hMax: o.hMax, wMin: o.wMin ?? 8, wMax: o.wMax ?? 20,
    body: o.color, side: mix(o.color, '#000000', 0.4), rim: o.rim === null ? null : o.rim ?? mix(o.color, '#ff9a50', 0.22),
    win: mix(o.color, '#000000', 0.45), lit: o.lit ?? null, litChance: 0.08, light: o.light ?? -1, detail: o.detail ?? 1, x0: -10, x1: w + 10,
  });
}

/** Pasmo wydm: sinusoidalny grzbiet z jasną krawędzią, cień ditherowany w dół i drobny gruz. */
export function dunes(g: Ctx2D, w: number, h: number, y0: number, amp: number, color: string, seed: number, freq = 0.03): void {
  ground(g, w, h, y0, { crest: mix(color, '#ffd8a0', 0.28), body: color, deep: mix(color, '#000000', 0.3), amp, freq, seed, debris: 0.12, rnd: seeded(seed * 7 + 1) });
}

/** Pył / popiół / iskry: ruch liczy core/frontend MoteField (Q8 pikseli, tick 50 Hz), tu tylko prostokąty 1x1. */
export class Motes {
  private readonly field: MoteField;
  private readonly dots: Phaser.GameObjects.Rectangle[] = [];
  private readonly clock = new TickClock();

  constructor(scene: Phaser.Scene, n: number, box: { x: number; y: number; w: number; h: number }, color: number, vx: number, vy: number, seed: number, alpha = 0.5, depth = 5) {
    this.field = new MoteField(n, box, vx, vy, seed, alpha);
    for (let i = 0; i < n; i++) this.dots.push(scene.add.rectangle(0, 0, 1, 1, color, this.field.alpha[i] / Q8).setDepth(depth));
    this.place();
  }

  private place(): void {
    const f = this.field;
    for (let i = 0; i < f.n; i++) this.dots[i].setPosition(f.x[i] >> 8, f.y[i] >> 8);
  }

  /** `dt` w sekundach (czas klatki). */
  update(dt: number): void {
    let n = this.clock.advance(dt * 1000);
    if (!n) return;
    while (n--) this.field.step();
    this.place();
  }
}

/**
 * Ognisko w stylu pixel art: skrzyżowane polana z żarem, krąg kamieni, trzy języki ognia rysowane rzędami pikseli
 * (czerwony brzeg -> pomarańcz -> żółć -> biały rdzeń), odrywające się iskierki i ditherowana poświata (ADD).
 * Zwraca funkcję aktualizującą (t w sekundach). Wysokość i kołysanie języków: core/frontend/fx.ts.
 */
export function campfire(scene: Phaser.Scene, x: number, y: number, size = 1, depth = 4): (t: number) => void {
  const s = size;
  const gk = `campfire_glow_${Math.round(s * 10)}`;
  if (!scene.textures.exists(gk)) canvasTexture(scene, gk, Math.round(64 * s), Math.round(32 * s), (g, w, h) => glow(g, w / 2, h / 2, w / 2, h / 2, '#ff8a30', 0.55, { levels: 5 }));
  const halo = scene.add.image(x, y - 3 * s, gk).setDepth(depth - 1).setBlendMode(Phaser.BlendModes.ADD);
  const R = (v: number): number => Math.round(v);
  const base = scene.add.graphics().setDepth(depth);
  // kamienie (tył), polana na krzyż, kamienie (przód)
  for (let k = -3; k <= 3; k++) base.fillStyle(k % 2 ? 0x4a3e36 : 0x5a4c40, 1).fillRect(R(x + k * 2.2 * s) - 1, R(y - 1 - (3 - Math.abs(k)) * 0.4 * s), R(2 * s) || 1, 1);
  for (let k = 0; k < R(10 * s); k++) {
    const lx = R(x - 5 * s + k), ly1 = R(y - 1 - k * 0.25), ly2 = R(y - 1 - (R(10 * s) - k) * 0.25);
    base.fillStyle(0x3a2212, 1).fillRect(lx, ly1, 1, R(2 * s) || 1).fillRect(lx, ly2, 1, R(2 * s) || 1);
    base.fillStyle(0x6a4020, 1).fillRect(lx, ly1, 1, 1);
  }
  for (let k = -4; k <= 4; k += 2) base.fillStyle(0x2a2420, 1).fillRect(R(x + k * 1.6 * s), R(y + 1), R(2 * s) || 1, 1);
  const embers = scene.add.graphics().setDepth(depth);
  const fl = scene.add.graphics().setDepth(depth);
  const hash = (a: number, b: number, c: number): number => {
    const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  return (t: number) => {
    const tq8 = secToQ8(t);
    const f = Math.floor(t * 12);
    fl.clear();
    embers.clear();
    // żar na polanach
    for (let k = 0; k < 4; k++) if (hash(k, f >> 1, 3) > 0.4) embers.fillStyle(hash(k, f, 4) > 0.5 ? 0xffa040 : 0xc43d1a, 1).fillRect(R(x - 3 * s + k * 2 * s), R(y - 2), 1, 1);
    // języki: lewy, prawy, środkowy (najwyższy, rysowany na wierzchu)
    for (const i of [0, 2, 1]) {
      const k = flameKQ12(tq8, i % FLAME_TONGUES) / Q12;
      const sway = (flameSwayQ8(tq8, i % FLAME_TONGUES) * s) / Q8;
      const H = Math.max(2, R((i === 1 ? 10 : 6) * s * k));
      const W0 = (i === 1 ? 6 : 4) * s;
      const cx = x + (i - 1) * 2.4 * s;
      for (let j = 0; j < H; j++) {
        const u = j / H;
        const w = Math.max(1, R(W0 * Math.pow(1 - u, 0.75)));
        const xo = R(cx - w / 2 + sway * u * 1.4 + (hash(j, f, i) > 0.78 ? 1 : 0));
        const yy = R(y - 2 - j);
        fl.fillStyle(u > 0.55 ? 0xb8301a : 0xe0601e, 1).fillRect(xo, yy, w, 1);
        if (w > 2) fl.fillStyle(u > 0.6 ? 0xff8a30 : 0xffa840, 1).fillRect(xo + 1, yy, w - 2, 1);
        if (w > 4 && u < 0.55) fl.fillStyle(0xffd860, 1).fillRect(xo + 2, yy, w - 4, 1);
        if (w > 5 && u < 0.3) fl.fillStyle(0xfff4c0, 1).fillRect(xo + 3, yy, w - 6 || 1, 1);
      }
      // odrywający się płomyk nad czubkiem
      if (hash(i, f, 7) > 0.55) fl.fillStyle(0xff8a30, 1).fillRect(R(cx + sway * 1.5), R(y - 3 - H - hash(i, f, 8) * 3 * s), 1, 1);
    }
    halo.setAlpha(glowAlphaQ8(tq8) / Q8 * 3.2).setScale(1 + (hash(f, 1, 2) - 0.5) * 0.06);
  };
}
