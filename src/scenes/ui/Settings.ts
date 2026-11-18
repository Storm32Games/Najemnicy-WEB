// Opcje gracza (port Oldgame/src/core/settings.js): rozdzielczość, rozmiar interfejsu, efekty retro, profil Amiga. Głośność i wyciszenie trzyma SoundManager.
// Zapis w localStorage pod tym samym kluczem co w Oldgame - osobno od zapisu gry. `?res=640x480|hd|fhd|qhd|4k` w URL nadpisuje
// (bez zapisu); stare `?res=2..6` (krotność siatki 480x270) trafia na najbliższy preset.
// Moduł bez zależności od Kit.ts (Kit czyta stąd rozdzielczość przy starcie).

const KEY = 'pyl-i-rdza-settings-v1';

/**
 * Rozdzielczość płótna (presety). Domyślnie Full HD 1920x1080 = siatka projektowa 480x270 x4; w dół HD i 640x480,
 * w górę QHD i 4K. Zoom = min(szer./480, wys./270) bywa ułamkowy (HD 2.67, QHD 5.33); 640x480 (4:3) ma czarne pasy.
 */
export type ResSetting = '640x480' | 'hd' | 'fhd' | 'qhd' | '4k';
export interface ResPreset {
  id: ResSetting;
  w: number;
  h: number;
  label: string;
}
export const RES_PRESETS: readonly ResPreset[] = [
  { id: '640x480', w: 640, h: 480, label: '640×480' },
  { id: 'hd', w: 1280, h: 720, label: 'HD' },
  { id: 'fhd', w: 1920, h: 1080, label: 'Full HD' },
  { id: 'qhd', w: 2560, h: 1440, label: 'QHD' },
  { id: '4k', w: 3840, h: 2160, label: '4K' },
];
export const RES_CHOICES: readonly ResSetting[] = RES_PRESETS.map((p) => p.id);
export const DEFAULT_RES: ResSetting = 'fhd';
export const resPreset = (id: ResSetting): ResPreset => RES_PRESETS.find((p) => p.id === id) ?? RES_PRESETS[2];

/** Rozmiar interfejsu (Oldgame/src/core/settings.js:9 UI_SIZES): skala okien, podpowiedzi i komunikatów. */
export const UI_SIZES: readonly (readonly [number, string])[] = [[0.9, 'Mały'], [1, 'Normalny'], [1.15, 'Duży'], [1.3, 'Bardzo duży']];

/**
 * Przyciemnienie okien UI = krycie teł paneli i ich cieni: 100% / 50% / 0% (napisy, ramki i przyciski zostają kryjące).
 * [id, nazwa, mnożnik krycia tła, znak przełącznika w nagłówku okna].
 */
export type UiAlpha = 'solid' | 'half' | 'clear';
export const UI_ALPHAS: readonly (readonly [UiAlpha, string, number, string])[] = [
  ['solid', '100%', 1, '●'],
  ['half', '50%', 0.5, '◐'],
  ['clear', '0%', 0, '○'],
];
const validAlpha = (v: unknown): v is UiAlpha => UI_ALPHAS.some(([k]) => k === v);

export interface SettingsValues {
  res: ResSetting;
  /** Rozmiar interfejsu: jedna z wartości UI_SIZES (0.9 / 1 / 1.15 / 1.3). */
  ui: number;
  scanlines: boolean;
  grain: boolean;
  dither: boolean;
  /**
   * Profil sprzętowy A1200 + PiStorm (miniGL): logika i rysowanie w 50 Hz (PAL), bez pełnoekranowych nakładek
   * z mieszaniem alfa (linie / ziarno / raster), bez tekstur większych niż 256x256 w logo. Podgląd budżetu docelowego.
   */
  amiga: boolean;
  /** Zapamiętywanie układu okien HUD misji (pozycje i skale paneli) między uruchomieniami gry. */
  layout: boolean;
  /** Przezroczystość okien UI (patrz UI_ALPHAS). */
  uiAlpha: UiAlpha;
}

const DEFAULTS: SettingsValues = { res: DEFAULT_RES, ui: 1, scanlines: true, grain: true, dither: true, amiga: false, layout: false, uiAlpha: 'solid' };

const validRes = (v: unknown): v is ResSetting => typeof v === 'string' && (RES_CHOICES as readonly string[]).includes(v);

/** Stary zapis / URL: krotność siatki 480x270 (2..6) -> preset o najbliższej wysokości; reszta -> domyślny. */
function migrateRes(v: unknown): ResSetting {
  if (validRes(v)) return v;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RES;
  const h = 270 * n;
  return RES_PRESETS.reduce((a, b) => (Math.abs(b.h - h) < Math.abs(a.h - h) ? b : a)).id;
}

function read(): SettingsValues {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<SettingsValues> | null;
    if (s && typeof s === 'object') {
      const v = { ...DEFAULTS, ...s };
      // stare zapisy: 'auto' lub krotność 2..6 -> preset
      v.res = migrateRes(v.res);
      if (!validAlpha(v.uiAlpha)) v.uiAlpha = 'solid';
      if (!UI_SIZES.some(([k]) => Math.abs(k - Number(v.ui)) < 0.01)) v.ui = 1;
      return v;
    }
  } catch {
    /* brak localStorage / zły JSON */
  }
  return { ...DEFAULTS };
}

type Listener = (v: SettingsValues) => void;
const listeners = new Set<Listener>();

export const Settings = {
  values: read(),
  /** Skala interfejsu (okna, podpowiedzi, komunikaty, HUD-y, które ją czytają). */
  get uiScale(): number {
    return Number(this.values.ui) || 1;
  },
  /** Mnożnik krycia tła okien UI (1 / 0.5 / 0). */
  get uiAlphaK(): number {
    return UI_ALPHAS.find(([k]) => k === this.values.uiAlpha)?.[2] ?? 1;
  },
  /** Następny poziom przyciemnienia (przełącznik w nagłówku okna: 100% -> 50% -> 0% -> 100%). */
  cycleUiAlpha(): void {
    const i = UI_ALPHAS.findIndex(([k]) => k === this.values.uiAlpha);
    this.set('uiAlpha', UI_ALPHAS[(i + 1) % UI_ALPHAS.length][0]);
  },
  /** Rozdzielczość, z którą wystartowała ta sesja (później zmieniana na żywo przez Kit.applyResolution, poza misją). */
  get startRes(): ResSetting {
    const q = new URLSearchParams(window.location.search).get('res');
    if (q) return migrateRes(q);
    return this.values.res;
  },
  /** Profil Amiga, z którym wystartowała sesja (`?profile=amiga|pc` w URL nadpisuje; zmiana wymaga restartu). */
  get startAmiga(): boolean {
    const q = new URLSearchParams(window.location.search).get('profile');
    if (q === 'amiga') return true;
    if (q === 'pc') return false;
    return this.values.amiga;
  },
  set<K extends keyof SettingsValues>(k: K, v: SettingsValues[K]): void {
    this.values = { ...this.values, [k]: v };
    try {
      // zachowujemy ewentualne inne pola (np. z Oldgame: ui)
      const prev = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
      localStorage.setItem(KEY, JSON.stringify({ ...prev, ...this.values }));
    } catch {
      /* ignoruj */
    }
    for (const f of listeners) f(this.values);
  },
  /** Subskrypcja zmian; zwraca funkcję wypisującą. */
  onChange(f: Listener): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
